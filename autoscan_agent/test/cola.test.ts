/**
 * La cola, que es donde vive la promesa de no perder una factura.
 *
 * Lo que se prueba aquí no es que SQLite funcione: es que las reglas que hacen
 * que un corte de luz no cueste una factura sigan en pie.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cola } from "../src/cola.ts";

let dir = "";
let cola: Cola;

const tarea = (n: string, extra: Partial<Parameters<Cola["encolar"]>[0]> = {}) => ({
  ruta: path.join(dir, "Inbox", n),
  nombre: n,
  tamano: 1234,
  sha256: `sha-de-${n}`,
  idempotencyKey: `idem-${n}`,
  escaneadoAtMs: null,
  ...extra,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-cola-"));
  cola = new Cola(path.join(dir, "data", "agent.db"));
});

afterEach(() => {
  cola.cerrar();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("encolar antes de subir", () => {
  it("una tarea nueva nace ENCOLADA y lista para ya", () => {
    const t = cola.encolar(tarea("f1.pdf"));
    expect(t.estado).toBe("ENCOLADO");
    expect(t.intentos).toBe(0);
    expect(t.proximoIntentoMs).toBe(0);
  });

  it("el mismo fichero dos veces es UNA tarea", () => {
    const a = cola.encolar(tarea("f1.pdf"));
    const b = cola.encolar(tarea("f1.pdf"));
    /*
     * Es lo que permite que el rescan del arranque sea tonto: mira la carpeta
     * entera e intenta encolarlo todo. Sin esto, cada reinicio duplicaría cada
     * fichero que quedara pendiente.
     */
    expect(b.id).toBe(a.id);
    expect(cola.resumen().pendientes).toBe(1);
  });

  it("la clave de idempotencia NO cambia entre intentos", () => {
    const t = cola.encolar(tarea("f1.pdf"));
    const reclamada = cola.reclamar()!;
    cola.devolverACola(reclamada.id, "sin red", reclamada.intentos, 60_000);
    const otra = cola.porRuta(t.ruta)!;
    /*
     * Si cambiara, un reintento tras un corte de red se vería en el servidor
     * como un documento distinto y la idempotencia no serviría de nada.
     */
    expect(otra.idempotencyKey).toBe(t.idempotencyKey);
  });
});

describe("reclamar", () => {
  it("marca SUBIENDO y cuenta el intento en la misma operación", () => {
    cola.encolar(tarea("f1.pdf"));
    const t = cola.reclamar()!;
    expect(t.estado).toBe("SUBIENDO");
    expect(t.intentos).toBe(1);
  });

  it("dos reclamaciones seguidas no se llevan la misma tarea", () => {
    cola.encolar(tarea("f1.pdf"));
    const primera = cola.reclamar();
    const segunda = cola.reclamar();
    expect(primera).not.toBeNull();
    expect(segunda).toBeNull();
  });

  it("respeta la espera del backoff", () => {
    cola.encolar(tarea("f1.pdf"));
    const t = cola.reclamar()!;
    cola.devolverACola(t.id, "5xx", t.intentos, 60_000);

    expect(cola.reclamar()).toBeNull();
    // Pasado el tiempo, vuelve a estar disponible.
    expect(cola.reclamar(Date.now() + 10 * 60_000)).not.toBeNull();
  });

  it("la espera crece pero tiene techo", () => {
    cola.encolar(tarea("f1.pdf"));
    const t = cola.reclamar()!;
    const tope = 15 * 60_000;
    cola.devolverACola(t.id, "sigue caído", 50, tope);
    const despues = cola.porRuta(t.ruta)!;
    /*
     * Sin techo, 2^50 segundos pondría el próximo intento después del fin del
     * universo y el agente no se recuperaría nunca solo.
     */
    expect(despues.proximoIntentoMs - Date.now()).toBeLessThanOrEqual(tope + 1_000);
  });
});

describe("lo que sobrevive a que se vaya la luz", () => {
  it("lo que quedó SUBIENDO vuelve a la cola al arrancar", () => {
    cola.encolar(tarea("f1.pdf"));
    cola.reclamar();
    expect(cola.resumen().pendientes).toBe(0);

    const rescatadas = cola.rescatarInterrumpidas();

    expect(rescatadas).toBe(1);
    expect(cola.resumen().pendientes).toBe(1);
  });

  it("y vuelve con la MISMA clave, para que el servidor la reconozca", () => {
    const t = cola.encolar(tarea("f1.pdf"));
    cola.reclamar();
    cola.rescatarInterrumpidas();
    expect(cola.porRuta(t.ruta)!.idempotencyKey).toBe(t.idempotencyKey);
  });

  it("entregado y archivado son estados distintos", () => {
    const t = cola.encolar(tarea("f1.pdf"));
    cola.reclamar();
    cola.marcarEntregada(t.id, 77, false);

    /*
     * Entre «el servidor lo tiene» y «he movido el PDF» hay una operación de
     * disco. Si se muere ahí, el arranque siguiente tiene que saber que ESTO ya
     * está entregado y solo falta moverlo — no volver a subirlo.
     */
    const sinArchivar = cola.entregadasSinArchivar();
    expect(sinArchivar).toHaveLength(1);
    expect(sinArchivar[0]!.documentoId).toBe(77);

    cola.marcarArchivada(t.id, path.join(dir, "Sent", "f1.pdf"));
    expect(cola.entregadasSinArchivar()).toHaveLength(0);
  });

  it("un duplicado del servidor cuenta como entregado", () => {
    const t = cola.encolar(tarea("f1.pdf"));
    cola.reclamar();
    cola.marcarEntregada(t.id, 77, true);
    const despues = cola.porRuta(t.ruta)!;
    expect(despues.estado).toBe("ENTREGADO");
    expect(despues.duplicado).toBe(true);
  });
});

describe("lo rechazado", () => {
  it("no vuelve a la cola solo", () => {
    const t = cola.encolar(tarea("gordo.pdf"));
    cola.reclamar();
    cola.marcarRechazada(t.id, "El documento pasa de 15 MB.");

    expect(cola.reclamar(Date.now() + 24 * 3600_000)).toBeNull();
    expect(cola.resumen().rechazadas).toBe(1);
  });

  it("pero se puede reintentar a mano desde la bandeja", () => {
    const t = cola.encolar(tarea("gordo.pdf"));
    cola.reclamar();
    cola.marcarRechazada(t.id, "formato");

    expect(cola.reencolarRechazadas()).toBe(1);
    const otra = cola.reclamar()!;
    expect(otra.id).toBe(t.id);
    // Los intentos se ponen a cero: es una decisión nueva de una persona.
    expect(otra.intentos).toBe(1);
  });
});

describe("lo que sabe el rescan", () => {
  it("las rutas conocidas son las que no hay que volver a encolar", () => {
    cola.encolar(tarea("f1.pdf"));
    cola.encolar(tarea("f2.pdf"));
    const conocidas = cola.rutasConocidas();
    expect(conocidas.has(path.join(dir, "Inbox", "f1.pdf"))).toBe(true);
    expect(conocidas.has(path.join(dir, "Inbox", "nueva.pdf"))).toBe(false);
  });
});

describe("la cola sobrevive a cerrar y abrir", () => {
  it("lo pendiente sigue ahí", () => {
    const ruta = path.join(dir, "data", "agent.db");
    cola.encolar(tarea("f1.pdf"));
    cola.cerrar();

    cola = new Cola(ruta);
    expect(cola.resumen().pendientes).toBe(1);
  });
});
