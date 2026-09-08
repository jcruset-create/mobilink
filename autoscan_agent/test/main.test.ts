/**
 * El agente entero, de la carpeta al servidor.
 *
 * Los módulos sueltos ya están probados. Lo que se comprueba aquí es que
 * ENCAJAN, que es donde se rompen las cosas: el orden del arranque, qué pasa
 * sin credencial, y que activar ponga en marcha lo que estaba esperando.
 *
 * El servidor es de mentira y entra por la costura del constructor
 * (`ServidorDeAutoScan`), el mismo patrón que `AlmacenDeCredencial`. El disco y
 * SQLite son de verdad: lo que se quiere probar es el agente, no la red.
 *
 * Se habla con él por donde habla la bandeja —su panel—, y no llamando a
 * métodos internos. Así lo que se prueba es lo que de verdad va a usar alguien.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Activacion, Resultado, ServidorDeAutoScan } from "../src/api.ts";
import { cargarConfig, prepararCarpetas, type Config } from "../src/config.ts";
import { AlmacenEnMemoria, type Credencial } from "../src/credencial.ts";
import { Agente } from "../src/main.ts";

const ACTIVACION: Activacion = {
  deviceId: 7,
  secret: "s3cr3t0-del-dispositivo",
  empresaId: "e1",
  centroId: "c1",
  nombre: "Tarragona · Mostrador",
};

class ServidorFalso implements ServidorDeAutoScan {
  subidas: string[] = [];
  latidos = 0;
  fallaActivacion: string | null = null;

  async activar(codigo: string): Promise<Activacion> {
    if (this.fallaActivacion) throw new Error(this.fallaActivacion);
    if (!codigo.trim()) throw new Error("Código vacío.");
    return ACTIVACION;
  }

  async subir(
    _secret: string,
    fichero: { ruta: string; nombre: string; tamano: number }
  ): Promise<Resultado> {
    this.subidas.push(fichero.nombre);
    return {
      clase: "entregado",
      documentoId: this.subidas.length,
      duplicado: false,
      estado: "PENDIENTE",
    };
  }

  async latido(): Promise<boolean> {
    this.latidos += 1;
    return true;
  }
}

let raiz = "";
let cfg: Config;
let almacen: AlmacenEnMemoria;
let servidor: ServidorFalso;
let agente: Agente;

/** Deja un escaneo listo: con contenido y con la fecha ya vieja. */
function escanear(nombre: string, bytes = 2_048): string {
  const ruta = path.join(cfg.inbox, nombre);
  fs.writeFileSync(ruta, Buffer.alloc(bytes, 5));
  const cuando = new Date(Date.now() - 60_000);
  fs.utimesSync(ruta, cuando, cuando);
  return ruta;
}

/** El token que el agente deja escrito para la bandeja. */
const token = (): string =>
  (JSON.parse(fs.readFileSync(path.join(cfg.raiz, "panel.json"), "utf8")) as { token: string })
    .token;

async function panel(ruta: string, cuerpo?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${agente.puerto}${ruta}`, {
    method: ruta === "/estado" ? "GET" : "POST",
    headers: {
      "x-autoscan-panel": token(),
      ...(cuerpo === undefined ? {} : { "content-type": "application/json" }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

const estado = async (): Promise<Record<string, unknown>> =>
  (await (await panel("/estado")).json()) as Record<string, unknown>;

/**
 * Dos sincronizaciones seguidas.
 *
 * `Estabilizador` nunca decide en la primera observación, ni con el plazo a
 * cero: es justo lo que impide subir un PDF a medio escribir. Así que la
 * primera pasada VE el fichero y la segunda lo da por terminado.
 */
async function sincronizar(): Promise<void> {
  await panel("/sincronizar");
  await panel("/sincronizar");
}

async function montar(conCredencial = false): Promise<Agente> {
  if (conCredencial) {
    const c: Credencial = { ...ACTIVACION, activadoAtMs: Date.now() };
    await almacen.guardar(c);
  }
  return new Agente(cfg, almacen, servidor);
}

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-main-"));
  cfg = { ...cargarConfig(raiz), estabilidadMs: 0, servidor: "http://servidor.invalid" };
  prepararCarpetas(cfg);
  almacen = new AlmacenEnMemoria();
  servidor = new ServidorFalso();
});

afterEach(async () => {
  await agente?.parar().catch(() => {});
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("el agente sin activar", () => {
  it("arranca igual, y lo dice en vez de morirse", async () => {
    agente = await montar(false);
    await agente.arrancar(0);

    /*
     * Es el estado normal de una instalación recién hecha. Salir con error
     * dejaría al técnico sin bandeja donde pegar el código de activación — y
     * sin bandeja no hay forma de arreglarlo.
     */
    const e = await estado();
    expect(e.activado).toBe(false);
    expect(e.centro).toBeNull();
  });

  it("pero YA vigila la carpeta: encolar no necesita servidor", async () => {
    escanear("de-antes-de-activar.pdf");
    agente = await montar(false);
    await agente.arrancar(0);

    /*
     * UNA sola sincronización, no dos, y ahí está la gracia: el arranque ya
     * hizo el primer barrido, así que con esta segunda observación el fichero
     * se da por terminado y entra en la cola.
     *
     * Si el agente no vigilara hasta tener credencial, ésta sería la PRIMERA
     * observación —y `Estabilizador` nunca decide en la primera— así que no se
     * encolaría nada y la prueba se pondría roja. Es la forma de comprobar que
     * el arranque vigila de verdad sin depender de un temporizador.
     */
    await panel("/sincronizar");

    /*
     * Lo que se escanee entre la instalación y la activación no se pierde: se
     * queda en la cola y sale en cuanto haya credencial.
     */
    expect((await estado()).pendientes).toBe(1);
    expect(servidor.subidas).toHaveLength(0);
  });

  it("y no manda latidos que nadie puede atender", async () => {
    agente = await montar(false);
    await agente.arrancar(0);
    await new Promise((listo) => setTimeout(listo, 60));
    expect(servidor.latidos).toBe(0);
  });
});

describe("activar desde la bandeja", () => {
  it("guarda la credencial y suelta lo que estaba esperando", async () => {
    escanear("esperando.pdf");
    agente = await montar(false);
    await agente.arrancar(0);
    await sincronizar();

    const res = await panel("/activar", { codigo: "ABC-123" });
    expect(res.status).toBe(200);

    expect(await almacen.leer()).toMatchObject({ secret: ACTIVACION.secret });
    expect((await estado()).activado).toBe(true);

    /* La cola que se llenó mientras esperaba sale sola. */
    await sincronizar();
    expect(servidor.subidas).toEqual(["esperando.pdf"]);
  });

  it("si el servidor rechaza el código, no se guarda nada", async () => {
    servidor.fallaActivacion = "El código no vale o ya se ha usado.";
    agente = await montar(false);
    await agente.arrancar(0);

    const res = await panel("/activar", { codigo: "MAL" });

    /*
     * Ni credencial a medias ni agente que se cree activado: el remedio es
     * pedir otro código, y para eso hay que seguir viendo «sin activar».
     */
    expect(res.status).toBe(500);
    expect(await almacen.leer()).toBeNull();
    expect((await estado()).activado).toBe(false);
  });
});

describe("el recorrido entero, con credencial", () => {
  it("de la carpeta a Sent", async () => {
    escanear("factura.pdf");
    agente = await montar(true);
    await agente.arrancar(0);

    await sincronizar();

    expect(servidor.subidas).toEqual(["factura.pdf"]);
    expect(fs.existsSync(path.join(cfg.sent, "factura.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.inbox, "factura.pdf"))).toBe(false);
  });

  it("«sincronizar ahora» mira la carpeta Y vacía la cola", async () => {
    agente = await montar(true);
    await agente.arrancar(0);

    /*
     * Quien pulsa ese botón acaba de dejar un papel en el escáner. No distingue
     * entre «no lo he visto» y «no lo he subido», ni tiene por qué: si solo
     * hiciera una de las dos cosas, habría que pulsarlo dos veces.
     */
    escanear("recien-escaneada.pdf");
    await sincronizar();

    expect(servidor.subidas).toEqual(["recien-escaneada.pdf"]);
  });

  it("el latido sale solo al arrancar", async () => {
    agente = await montar(true);
    await agente.arrancar(0);
    await new Promise((listo) => setTimeout(listo, 60));
    expect(servidor.latidos).toBeGreaterThan(0);
  });

  it("el estado que ve la bandeja cuenta lo entregado", async () => {
    escanear("una.pdf");
    escanear("otra.pdf");
    agente = await montar(true);
    await agente.arrancar(0);
    await sincronizar();

    const e = await estado();
    expect(e.archivadas).toBe(2);
    expect(e.pendientes).toBe(0);
    expect(e.centro).toBe(ACTIVACION.nombre);
  });
});

describe("una sola instancia", () => {
  it("el segundo agente no arranca, y dice por qué", async () => {
    agente = await montar(true);
    await agente.arrancar(0);
    const ocupado = agente.puerto;

    const segundo = new Agente(cfg, almacen, servidor);
    /*
     * Dos agentes sobre la misma carpeta se pisan al archivar: uno mueve el PDF
     * mientras el otro cree que sigue en Inbox. El puerto del panel hace de
     * portero, y así no hace falta un fichero de bloqueo que a su vez puede
     * quedarse mal tras un cuelgue.
     */
    await expect(segundo.arrancar(ocupado)).rejects.toThrow(/Ya hay un agente/);
    await segundo.parar().catch(() => {});
  });
});

describe("lo que sobrevive a un reinicio", () => {
  it("lo ya entregado no se vuelve a subir al arrancar", async () => {
    escanear("a-medias.pdf");
    agente = await montar(true);
    await agente.arrancar(0);
    await sincronizar();
    await agente.parar();

    const antes = servidor.subidas.length;
    expect(antes).toBe(1);

    agente = await montar(true);
    await agente.arrancar(0);

    /* La reconciliación del arranque archiva, no reenvía. */
    expect(servidor.subidas).toHaveLength(antes);
  });

  it("lo que quedó en la carpeta con el agente parado se recoge al arrancar", async () => {
    agente = await montar(true);
    await agente.arrancar(0);
    await agente.parar();

    /* Llega con el proceso muerto: no hay ningún evento que recuperar. */
    escanear("de-la-noche.pdf");

    agente = await montar(true);
    await agente.arrancar(0);
    await sincronizar();

    expect(servidor.subidas).toEqual(["de-la-noche.pdf"]);
  });
});
