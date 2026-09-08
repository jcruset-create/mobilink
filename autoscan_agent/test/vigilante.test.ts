/**
 * El vigilante, contra ficheros de verdad en el disco.
 *
 * `estabilidad.test.ts` prueba la regla con una tabla; esto prueba que el
 * vigilante la aplica sobre `fs`: que un PDF a medio escribir no entra en la
 * cola, que uno terminado sí, y que el barrido recoge lo que llegó con el
 * agente apagado — que es lo que convierte un corte de luz en un retraso en vez
 * de en una factura perdida.
 *
 * Se llama a `barrer()` a mano en vez de esperar al watcher. No es por ir más
 * rápido: `fs.watch` avisa cuando quiere, y una prueba que dependa de eso falla
 * un día de cada veinte en la CI por motivos que no tienen nada que ver con lo
 * que se quería comprobar. Lo que aquí importa es qué hace el barrido, y el
 * barrido se puede llamar.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cargarConfig, prepararCarpetas, type Config } from "../src/config.ts";
import { Cola } from "../src/cola.ts";
import { Vigilante, claveDeIdempotencia, sha256De } from "../src/vigilante.ts";

let raiz = "";
let cfg: Config;
let cola: Cola;
let vigilante: Vigilante;

/** Escribe un fichero en Inbox y le pone una fecha de modificación ya vieja. */
function escanear(nombre: string, bytes: number, antiguedadMs = 60_000): string {
  const ruta = path.join(cfg.inbox, nombre);
  fs.writeFileSync(ruta, Buffer.alloc(bytes, 7));
  const cuando = new Date(Date.now() - antiguedadMs);
  fs.utimesSync(ruta, cuando, cuando);
  return ruta;
}

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-vig-"));
  /*
   * Estabilidad a cero: la espera ya está probada con reloj de mentira, y aquí
   * repetirla solo añadiría segundos muertos a la CI. Lo que se prueba en este
   * fichero es el recorrido por el disco.
   */
  cfg = { ...cargarConfig(raiz), estabilidadMs: 0 };
  prepararCarpetas(cfg);
  cola = new Cola(cfg.baseDatos);
  vigilante = new Vigilante(cfg, cola);
});

afterEach(() => {
  vigilante.parar();
  cola.cerrar();
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("lo que se recoge de la carpeta", () => {
  it("un escaneo terminado acaba en la cola", async () => {
    escanear("factura.pdf", 4_096);
    await vigilante.barrer();
    await vigilante.barrer(); // La primera observación nunca decide; la segunda sí.

    expect(cola.resumen().pendientes).toBe(1);
  });

  it("dos barridos NO lo encolan dos veces", async () => {
    escanear("factura.pdf", 4_096);
    for (let i = 0; i < 5; i += 1) await vigilante.barrer();

    /*
     * Es lo que permite que el watcher sea tonto y dispare un barrido por cada
     * evento sin mirar de qué fichero venía. Sin idempotencia, un escaneo se
     * subiría tantas veces como eventos genere ScanSnap al moverlo y renombrarlo.
     */
    expect(cola.resumen().pendientes).toBe(1);
  });

  it("lo que llegó con el agente apagado se recoge al arrancar", async () => {
    escanear("de-ayer-1.pdf", 2_048);
    escanear("de-ayer-2.pdf", 2_048);

    /*
     * Ni un evento de sistema de ficheros que recuperar: llegaron con el
     * proceso muerto. Si el arranque no barriera, se quedarían ahí para siempre.
     */
    await vigilante.arrancar();
    await vigilante.barrer();

    expect(cola.resumen().pendientes).toBe(2);
  });

  it("lo que no es un documento se ignora en silencio", async () => {
    escanear("Thumbs.db", 1_024);
    escanear("~temporal.tmp", 1_024);
    escanear("factura.pdf", 1_024);
    await vigilante.barrer();
    await vigilante.barrer();

    // En esa carpeta ScanSnap y Windows dejan basura; no son errores que enseñar.
    expect(cola.resumen().pendientes).toBe(1);
    expect(cola.porRuta(path.join(cfg.inbox, "Thumbs.db"))).toBeNull();
  });

  it("las subcarpetas no se miran", async () => {
    fs.mkdirSync(path.join(cfg.inbox, "una-carpeta"));
    fs.writeFileSync(path.join(cfg.inbox, "una-carpeta", "dentro.pdf"), Buffer.alloc(512));
    await vigilante.barrer();
    await vigilante.barrer();

    expect(cola.resumen().pendientes).toBe(0);
  });
});

describe("lo que NO se recoge todavía", () => {
  it("un fichero de 0 bytes no entra en la cola por mucho que se barra", async () => {
    escanear("cortado.pdf", 0);
    for (let i = 0; i < 5; i += 1) await vigilante.barrer();

    /*
     * El escaneo se cortó: papel atascado, USB fuera, PC apagado. Subirlo
     * metería en el módulo una factura vacía esperando a que alguien la revise.
     */
    expect(cola.resumen().pendientes).toBe(0);
    expect(vigilante.estado().vigilados).toBe(1);
  });

  it("uno que sigue creciendo espera a que pare", async () => {
    /* Con estabilidad de verdad, para ver la espera. */
    const v = new Vigilante({ ...cfg, estabilidadMs: 60_000 }, cola);
    const ruta = escanear("creciendo.pdf", 1_024);

    await v.barrer();
    fs.appendFileSync(ruta, Buffer.alloc(1_024, 3));
    await v.barrer();
    await v.barrer();

    expect(cola.resumen().pendientes).toBe(0);
    v.parar();
  });
});

describe("lo que se guarda de cada fichero", () => {
  it("el sha256 guardado es el del contenido, tal cual", async () => {
    const ruta = escanear("factura.pdf", 4_096);
    await vigilante.barrer();
    await vigilante.barrer();

    // El servidor deduplica por este número: tiene que ser el del fichero.
    expect(cola.porRuta(ruta)!.sha256).toBe(
      crypto.createHash("sha256").update(Buffer.alloc(4_096, 7)).digest("hex")
    );
  });

  it("la clave de idempotencia no es aleatoria: sale del fichero", async () => {
    const ruta = escanear("factura.pdf", 4_096);
    await vigilante.barrer();
    await vigilante.barrer();

    /*
     * Es lo que hace que el reintento tras un corte de red sea el MISMO envío
     * para el servidor. Con un aleatorio, cada reintento sería un documento
     * nuevo y la idempotencia no serviría de nada.
     */
    const sha = crypto.createHash("sha256").update(Buffer.alloc(4_096, 7)).digest("hex");
    expect(cola.porRuta(ruta)!.idempotencyKey).toBe(claveDeIdempotencia(ruta, sha));
  });

  it("y dos ficheros distintos NUNCA comparten clave, aunque pesen y digan lo mismo", () => {
    /*
     * `idempotency_key` es UNIQUE en la cola. Sacándola solo del contenido, el
     * segundo de dos escaneos idénticos —dos copias de la misma factura, dos
     * hojas en blanco— se descartaba en silencio al encolarlo y se quedaba en
     * Inbox para siempre: sin subir, sin archivar y sin que nadie lo echara de
     * menos. Este es el caso que lo destapó.
     */
    const sha = "el-mismo-contenido";
    expect(claveDeIdempotencia("C:\\Inbox\\a.pdf", sha)).not.toBe(
      claveDeIdempotencia("C:\\Inbox\\b.pdf", sha)
    );
    // Y la misma entrada da siempre lo mismo, que es la otra mitad del trato.
    expect(claveDeIdempotencia("C:\\Inbox\\a.pdf", sha)).toBe(
      claveDeIdempotencia("C:\\Inbox\\a.pdf", sha)
    );
  });

  it("dos ficheros con el mismo contenido son dos tareas, no una", async () => {
    escanear("copia-a.pdf", 2_048);
    escanear("copia-b.pdf", 2_048);
    await vigilante.barrer();
    await vigilante.barrer();

    /*
     * La cola va por RUTA. Que el servidor los una por idempotencia es decisión
     * suya; el agente no puede decidir que uno de los dos ficheros de la
     * carpeta no existe — se quedaría ahí sin subir y sin archivar.
     */
    expect(cola.resumen().pendientes).toBe(2);
  });

  it("se guarda el tamaño y cuándo se escaneó", async () => {
    const ruta = escanear("factura.pdf", 3_000, 120_000);
    await vigilante.barrer();
    await vigilante.barrer();

    const t = cola.porRuta(ruta)!;
    expect(t.tamano).toBe(3_000);
    expect(t.escaneadoAtMs).toBeGreaterThan(0);
    expect(Date.now() - t.escaneadoAtMs!).toBeGreaterThan(100_000);
  });

  it("sha256De lee ficheros grandes sin metérselos en memoria de una vez", async () => {
    const ruta = path.join(cfg.inbox, "gordo.bin");
    fs.writeFileSync(ruta, Buffer.alloc(3 * 1024 * 1024, 1));
    const esperado = crypto
      .createHash("sha256")
      .update(Buffer.alloc(3 * 1024 * 1024, 1))
      .digest("hex");

    expect(await sha256De(ruta)).toBe(esperado);
  });
});

describe("el vigilante no se cae", () => {
  it("si la carpeta no existe, lo dice y sigue vivo", async () => {
    fs.rmSync(cfg.inbox, { recursive: true, force: true });
    const dicho: string[] = [];
    const v = new Vigilante(cfg, cola, (m) => dicho.push(m));

    /*
     * Alguien puede borrar o renombrar la carpeta. Que eso tumbe el proceso
     * dejaría el agente muerto sin bandeja donde avisar de por qué.
     */
    await expect(v.barrer()).resolves.toBeUndefined();
    expect(dicho.join(" ")).toContain("barrido fallido");
    v.parar();
  });

  it("parar dos veces no revienta", async () => {
    await vigilante.arrancar();
    vigilante.parar();
    expect(() => vigilante.parar()).not.toThrow();
  });
});
