/**
 * El enviador, que es donde se cumple o se rompe la promesa de no perder nada.
 *
 * El cliente HTTP es de mentira a propósito. Lo que hay que comprobar no es que
 * `fetch` funcione —eso ya lo hace `fetch`— sino qué hace el agente con cada
 * respuesta posible del servidor, incluidas las que en la vida real aparecen una
 * vez al año y son justo las que se hacen mal: el duplicado, la licencia
 * caducada, el corte de luz entre subir y mover.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClienteAutoScan, Resultado } from "../src/api.ts";
import { Cola } from "../src/cola.ts";
import { cargarConfig, prepararCarpetas, type Config } from "../src/config.ts";
import { Enviador, rutaLibre } from "../src/enviador.ts";

const SECRETO = "un-secreto-de-mentira";

/** Cliente de mentira: se le dice qué contestar y apunta lo que le piden. */
class ClienteFalso {
  respuestas: Resultado[] = [];
  subidas: { nombre: string; idempotencyKey: string }[] = [];
  #porDefecto: Resultado = {
    clase: "entregado",
    documentoId: 1,
    duplicado: false,
    estado: "PENDIENTE",
  };

  async subir(
    _secret: string,
    fichero: { ruta: string; nombre: string; tamano: number },
    idempotencyKey: string
  ): Promise<Resultado> {
    this.subidas.push({ nombre: fichero.nombre, idempotencyKey });
    return this.respuestas.shift() ?? this.#porDefecto;
  }
}

const reintentable = (motivo = "sin red", codigo: string | null = null): Resultado => ({
  clase: "reintentable",
  motivo,
  codigo,
  credencialInvalida: false,
});

let raiz = "";
let cfg: Config;
let cola: Cola;
let cliente: ClienteFalso;
let enviador: Enviador;
let dicho: string[];

function enInbox(nombre: string, bytes = 1_024): string {
  const ruta = path.join(cfg.inbox, nombre);
  fs.writeFileSync(ruta, Buffer.alloc(bytes, 9));
  return ruta;
}

function encolar(nombre: string, bytes = 1_024) {
  const ruta = enInbox(nombre, bytes);
  return cola.encolar({
    ruta,
    nombre,
    tamano: bytes,
    sha256: `sha-${nombre}`,
    idempotencyKey: `idem-${nombre}`,
    escaneadoAtMs: null,
  });
}

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-env-"));
  cfg = cargarConfig(raiz);
  prepararCarpetas(cfg);
  cola = new Cola(cfg.baseDatos);
  cliente = new ClienteFalso();
  dicho = [];
  enviador = new Enviador(cfg, cola, cliente as unknown as ClienteAutoScan, (m) => dicho.push(m));
});

afterEach(() => {
  enviador.parar();
  cola.cerrar();
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("una subida que sale bien", () => {
  it("el fichero acaba en Sent y la cola vacía", async () => {
    encolar("factura.pdf");
    const r = await enviador.ciclo(SECRETO);

    expect(r.entregadas).toBe(1);
    expect(fs.existsSync(path.join(cfg.sent, "factura.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.inbox, "factura.pdf"))).toBe(false);
    expect(cola.resumen().pendientes).toBe(0);
  });

  it("un ciclo vacía la cola entera, no sube una y se va", async () => {
    for (let i = 0; i < 8; i += 1) encolar(`f${i}.pdf`);
    const r = await enviador.ciclo(SECRETO);

    /*
     * Un lote de ocho hojas son ocho tareas. Subir una por ciclo las repartiría
     * a lo largo de ocho segundos sin ninguna razón.
     */
    expect(r.entregadas).toBe(8);
    expect(cola.resumen().pendientes).toBe(0);
  });

  it("un duplicado del servidor también se archiva", async () => {
    encolar("factura.pdf");
    cliente.respuestas = [{ clase: "entregado", documentoId: 7, duplicado: true, estado: "PENDIENTE" }];

    const r = await enviador.ciclo(SECRETO);

    /*
     * Que el servidor ya lo tuviera NO es un error: el fichero está entregado y
     * este agente ya no tiene nada que hacer con él. Tratarlo como fallo lo
     * dejaría en Inbox reintentándose para siempre.
     */
    expect(r.duplicadas).toBe(1);
    expect(fs.existsSync(path.join(cfg.sent, "factura.pdf"))).toBe(true);
  });

  it("no sobrescribe un fichero que ya esté en Sent", async () => {
    fs.writeFileSync(path.join(cfg.sent, "factura.pdf"), "el de ayer");
    encolar("factura.pdf");

    await enviador.ciclo(SECRETO);

    /*
     * ScanSnap reutiliza nombres. Sobrescribir borraría el papel de una factura
     * ya entregada: la única copia que queda de ese escaneo.
     */
    expect(fs.readFileSync(path.join(cfg.sent, "factura.pdf"), "utf8")).toBe("el de ayer");
    expect(fs.existsSync(path.join(cfg.sent, "factura (2).pdf"))).toBe(true);
  });
});

describe("lo que se reintenta", () => {
  it("sin red, el fichero se queda en Inbox y la tarea vuelve a la cola", async () => {
    encolar("factura.pdf");
    cliente.respuestas = [reintentable()];

    const r = await enviador.ciclo(SECRETO);

    expect(r.reintentables).toBe(1);
    expect(r.entregadas).toBe(0);
    // Lo que no se ha entregado NO se archiva: seguiría estando en el taller y en ningún sitio más.
    expect(fs.existsSync(path.join(cfg.inbox, "factura.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.sent, "factura.pdf"))).toBe(false);
  });

  it("y el reintento usa la MISMA clave de idempotencia", async () => {
    encolar("factura.pdf");
    cliente.respuestas = [reintentable()];
    await enviador.ciclo(SECRETO);

    /* Se salta la espera del backoff para ver el reintento. */
    cola.reencolarRechazadas();
    const t = cola.porRuta(path.join(cfg.inbox, "factura.pdf"))!;
    cola.devolverACola(t.id, "ya", 0, 0);
    await enviador.ciclo(SECRETO);

    expect(cliente.subidas).toHaveLength(2);
    expect(cliente.subidas[0]!.idempotencyKey).toBe(cliente.subidas[1]!.idempotencyKey);
  });

  it("la licencia caducada para el ciclo pero no toca la credencial", async () => {
    encolar("a.pdf");
    encolar("b.pdf");
    encolar("c.pdf");
    cliente.respuestas = [reintentable("Licencia caducada", "LICENCIA_CADUCADA")];

    const r = await enviador.ciclo(SECRETO);

    /*
     * Sin este corte, una cola de cincuenta escaneos daría cincuenta 403
     * seguidos contra el servidor cada segundo. Y no se borra nada: cuando la
     * licencia se renueve, el agente sigue solo.
     */
    expect(cliente.subidas).toHaveLength(1);
    expect(r.credencialInvalida).toBe(false);
    expect(cola.resumen().pendientes + cola.resumen().subiendo).toBe(3);
  });

  it("una credencial inválida se avisa y para el ciclo", async () => {
    encolar("a.pdf");
    encolar("b.pdf");
    cliente.respuestas = [
      { clase: "reintentable", motivo: "no autorizado", codigo: null, credencialInvalida: true },
    ];

    const r = await enviador.ciclo(SECRETO);

    expect(r.credencialInvalida).toBe(true);
    expect(cliente.subidas).toHaveLength(1);
  });
});

describe("lo que se aparta", () => {
  it("un fichero que pasa del máximo ni se intenta subir", async () => {
    encolar("gordo.pdf", cfg.tamanoMaximoBytes + 1);
    const r = await enviador.ciclo(SECRETO);

    /*
     * Gastar dos minutos de subida en algo que va a acabar en 400 es tiempo que
     * le falta al siguiente. Y el mensaje dice qué hacer, que es lo que
     * convierte un error en una instrucción.
     */
    expect(cliente.subidas).toHaveLength(0);
    expect(r.rechazadas).toBe(1);
    expect(fs.existsSync(path.join(cfg.failed, "gordo.pdf"))).toBe(true);
    expect(dicho.join(" ")).toContain("ScanSnap");
  });

  it("lo rechazado va a Failed y no vuelve solo", async () => {
    encolar("raro.pdf");
    cliente.respuestas = [{ clase: "rechazado", motivo: "Formato no admitido", codigo: "FORMATO" }];

    await enviador.ciclo(SECRETO);
    const r2 = await enviador.ciclo(SECRETO);

    expect(fs.existsSync(path.join(cfg.failed, "raro.pdf"))).toBe(true);
    expect(cliente.subidas).toHaveLength(1);
    expect(r2.entregadas).toBe(0);
  });

  it("un fichero que ha desaparecido se aparta con su motivo, no se reintenta", async () => {
    const ruta = encolar("fantasma.pdf").ruta;
    fs.unlinkSync(ruta);

    const r = await enviador.ciclo(SECRETO);

    expect(cliente.subidas).toHaveLength(0);
    expect(r.rechazadas).toBe(1);
    // Queda constancia de que ese escaneo NO se subió, en vez de desaparecer sin más.
    expect(dicho.join(" ")).toContain("ya no está en la carpeta");
  });

  it("nunca se borra nada: lo apartado sigue en el disco", async () => {
    encolar("raro.pdf");
    cliente.respuestas = [{ clase: "rechazado", motivo: "no", codigo: null }];
    await enviador.ciclo(SECRETO);

    const enFailed = fs.readdirSync(cfg.failed);
    expect(enFailed).toEqual(["raro.pdf"]);
  });
});

describe("el orden: primero se apunta, después se mueve", () => {
  /*
   * Es la promesa entera del módulo, y la única forma de comprobarla sin matar
   * el proceso de verdad es mirar en qué estado queda la tarea.
   */

  it("una entrega normal acaba en ARCHIVADO, que es el estado final", async () => {
    encolar("factura.pdf");
    await enviador.ciclo(SECRETO);

    /*
     * Con el orden al revés —mover primero y apuntar después— el
     * `marcarEntregada` pisa al `marcarArchivada` y la tarea se queda en
     * ENTREGADO con el fichero ya movido: un estado que dice que falta hacer
     * algo que ya está hecho, y que cada arranque vuelve a intentar.
     */
    const t = cola.porRuta(path.join(cfg.sent, "factura.pdf"))!;
    expect(t.estado).toBe("ARCHIVADO");
    expect(cola.entregadasSinArchivar()).toHaveLength(0);
  });

  it("si el movimiento falla, la entrega YA está apuntada", async () => {
    const original = encolar("factura.pdf").ruta;
    /* Sent bloqueado: hay un fichero donde debería estar la carpeta. */
    fs.rmSync(cfg.sent, { recursive: true, force: true });
    fs.writeFileSync(cfg.sent, "esto no es una carpeta");

    const r = await enviador.ciclo(SECRETO);

    /*
     * Este es el hueco donde se muere el proceso el día que se va la luz. Con
     * el orden correcto queda apuntado «el servidor lo tiene, falta moverlo».
     * Con el orden al revés no quedaría apuntado nada: la tarea seguiría
     * SUBIENDO y al arrancar volvería a la cola, subiendo otra vez un documento
     * que el servidor ya tiene.
     */
    expect(r.entregadas).toBe(1);
    expect(r.archivadas).toBe(0);
    expect(cola.porRuta(original)!.estado).toBe("ENTREGADO");
    expect(cola.porRuta(original)!.documentoId).toBe(1);
    expect(cola.entregadasSinArchivar()).toHaveLength(1);
  });
});

describe("lo que sobrevive a que se vaya la luz", () => {
  it("lo que quedó SUBIENDO vuelve a la cola al arrancar", async () => {
    encolar("factura.pdf");
    cola.reclamar(); // El proceso muere justo aquí.

    const { rescatadas } = await enviador.reconciliar();

    expect(rescatadas).toBe(1);
    expect(cola.resumen().pendientes).toBe(1);
  });

  it("lo entregado y sin mover se ARCHIVA, no se vuelve a subir", async () => {
    const t = encolar("factura.pdf");
    cola.reclamar();
    cola.marcarEntregada(t.id, 42, false);
    // El proceso muere entre apuntar en SQLite y mover el PDF.

    const { archivadas } = await enviador.reconciliar();

    /*
     * Este es el hueco que justifica que «entregado» y «archivado» sean dos
     * estados. Volver a subirlo sería contarlo dos veces; dejarlo sería un
     * fichero eternamente en Inbox de algo que el servidor ya tiene.
     */
    expect(archivadas).toBe(1);
    expect(cliente.subidas).toHaveLength(0);
    expect(fs.existsSync(path.join(cfg.sent, "factura.pdf"))).toBe(true);
  });

  it("si no se puede mover, la tarea espera y NO se vuelve a subir", async () => {
    const t = encolar("factura.pdf");
    cola.reclamar();
    cola.marcarEntregada(t.id, 42, false);

    /* Sent ocupado por un fichero con ese nombre... y por una carpeta que estorba. */
    fs.rmSync(cfg.sent, { recursive: true, force: true });
    fs.writeFileSync(cfg.sent, "esto no es una carpeta");

    const { archivadas } = await enviador.reconciliar();
    expect(archivadas).toBe(0);
    expect(cliente.subidas).toHaveLength(0);
    expect(cola.entregadasSinArchivar()).toHaveLength(1);

    /* Se arregla el estorbo y el siguiente ciclo termina el trabajo. */
    fs.unlinkSync(cfg.sent);
    const r = await enviador.ciclo(SECRETO);
    expect(r.archivadas).toBe(1);
    expect(cliente.subidas).toHaveLength(0);
  });
});

describe("rutaLibre", () => {
  it("devuelve el nombre tal cual si no hay nada", async () => {
    expect(await rutaLibre(cfg.sent, "a.pdf")).toBe(path.join(cfg.sent, "a.pdf"));
  });

  it("va sumando hasta encontrar hueco", async () => {
    fs.writeFileSync(path.join(cfg.sent, "a.pdf"), "x");
    fs.writeFileSync(path.join(cfg.sent, "a (2).pdf"), "x");
    expect(await rutaLibre(cfg.sent, "a.pdf")).toBe(path.join(cfg.sent, "a (3).pdf"));
  });

  it("respeta la extensión, que es lo que hace que el PDF se siga abriendo", async () => {
    fs.writeFileSync(path.join(cfg.sent, "escaneo.2026.pdf"), "x");
    expect(await rutaLibre(cfg.sent, "escaneo.2026.pdf")).toBe(
      path.join(cfg.sent, "escaneo.2026 (2).pdf")
    );
  });
});
