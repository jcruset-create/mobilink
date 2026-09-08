/**
 * El panel, que es un servidor HTTP en el PC donde entran las facturas.
 *
 * Casi todo lo que se prueba aquí es seguridad, y no por manía: un puerto
 * abierto en el mostrador con una API que reactiva el dispositivo y lista los
 * escaneos es justo el tipo de cosa que se pone «temporalmente» sin token y se
 * queda diez años.
 *
 * Las cuatro reglas que fija este fichero:
 *   1. escucha solo en el bucle local;
 *   2. sin token no se contesta a nada, ni siquiera al estado;
 *   3. una web abierta en el navegador no puede conducir el agente;
 *   4. la credencial no sale por aquí de ninguna manera.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cargarConfig, prepararCarpetas, type Config } from "../src/config.ts";
import { Panel, type Acciones, type Estado } from "../src/panel.ts";

let raiz = "";
let cfg: Config;
let panel: Panel;
let puerto = 0;
let activaciones: string[];
let sincronizaciones: number;

const ESTADO = (): Estado => ({
  version: "0.2.0",
  activado: true,
  centro: "Tarragona",
  ultimoLatidoMs: 1_700_000_000_000,
  pendientes: 2,
  subiendo: 0,
  rechazadas: 1,
  archivadas: 148,
  vigilados: 0,
  atascados: [],
  ultimoError: null,
  carpetas: { inbox: "C:\\MobilinkAutoScan\\Inbox", sent: "s", failed: "f", logs: "l" },
});

const acciones = (): Acciones => ({
  estado: ESTADO,
  reintentarRechazadas: () => 1,
  sincronizarAhora: async () => {
    sincronizaciones += 1;
  },
  activar: async (codigo: string) => {
    activaciones.push(codigo);
  },
});

/** `res.json()` devuelve `unknown`; aquí siempre se sabe qué se ha pedido. */
const json = async <T,>(res: Response): Promise<T> => (await res.json()) as T;

/** Petición al panel. Sin token si no se pasa. */
function pedir(
  ruta: string,
  opciones: { metodo?: string; token?: string; origen?: string; cuerpo?: unknown } = {}
) {
  const cabeceras: Record<string, string> = {};
  if (opciones.token) cabeceras["x-autoscan-panel"] = opciones.token;
  if (opciones.origen) cabeceras.origin = opciones.origen;
  if (opciones.cuerpo !== undefined) cabeceras["content-type"] = "application/json";
  return fetch(`http://127.0.0.1:${puerto}${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers: cabeceras,
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  });
}

beforeEach(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-panel-"));
  cfg = cargarConfig(raiz);
  prepararCarpetas(cfg);
  activaciones = [];
  sincronizaciones = 0;
  panel = new Panel(cfg, acciones());
  /* Puerto 0: que lo elija el sistema, para no chocar con nada en la CI. */
  puerto = await panel.arrancar(0);
});

afterEach(async () => {
  await panel.parar();
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("solo escucha en el bucle local", () => {
  /**
   * La primera IPv4 de la máquina que no sea la de loopback, si la hay.
   *
   * En un contenedor sin red puede no haber ninguna, y entonces esta
   * comprobación no se puede hacer: se dice y se salta, en vez de pasar en
   * verde fingiendo que se ha comprobado algo.
   */
  const deFuera = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

  it("desde la IP de la red del taller no se puede ni conectar", async () => {
    if (!deFuera) {
      console.warn("[panel.test] sin IP externa en esta máquina: no se comprueba el bind");
      return;
    }

    /*
     * Ésta es LA medida. `listen(puerto)` a secas se abre a todas las
     * interfaces, y entonces cualquiera del wifi del taller —incluido el
     * cliente que espera en el mostrador— llega a esta API. Se prueba
     * conectando de verdad, no mirando un parámetro: lo que importa es el
     * socket, no la intención.
     */
    const conectado = await new Promise<boolean>((listo) => {
      const s = net.connect({ host: deFuera, port: puerto, family: 4 });
      const acabar = (v: boolean) => {
        s.destroy();
        listo(v);
      };
      s.setTimeout(2_000, () => acabar(false));
      s.once("connect", () => acabar(true));
      s.once("error", () => acabar(false));
    });

    expect(conectado).toBe(false);
  });

  it("y desde 127.0.0.1 sí", async () => {
    expect((await pedir("/estado", { token: panel.token })).status).toBe(200);
  });
});

describe("sin token no hay nada", () => {
  it("el estado no se enseña", async () => {
    const res = await pedir("/estado");
    expect(res.status).toBe(404);
  });

  it("y con un token equivocado, tampoco", async () => {
    expect((await pedir("/estado", { token: "no-es" })).status).toBe(404);
    expect((await pedir("/estado", { token: `${panel.token}x` })).status).toBe(404);
  });

  it("404 y no 401: no se confirma que aquí haya algo", async () => {
    /*
     * Un 401 le dice a quien barre puertos que ha acertado. Quien tiene el
     * token no llega nunca a esta rama.
     */
    const res = await pedir("/estado");
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).not.toContain("token");
  });

  it("activar sin token no activa nada", async () => {
    await pedir("/activar", { metodo: "POST", cuerpo: { codigo: "ABC123" } });
    expect(activaciones).toHaveLength(0);
  });

  it("con token, el estado sí sale", async () => {
    const res = await pedir("/estado", { token: panel.token });
    expect(res.status).toBe(200);
    expect((await json<{ pendientes: number }>(res)).pendientes).toBe(2);
  });
});

describe("una web abierta en el mostrador no puede conducir el agente", () => {
  it("con Origin de fuera se rechaza, aunque el token sea bueno", async () => {
    /*
     * Es el ataque realista: el navegador del mostrador abre una página
     * cualquiera y esa página hace fetch a 127.0.0.1. Sin esta regla, bastaría
     * con acertar el puerto y el token para reactivar el dispositivo desde una
     * pestaña.
     */
    const res = await pedir("/sincronizar", {
      metodo: "POST",
      token: panel.token,
      origen: "https://una-web-cualquiera.example",
    });
    expect(res.status).toBe(404);
    expect(sincronizaciones).toBe(0);
  });

  it("pero la propia pantalla de estado sí funciona", async () => {
    const res = await pedir("/sincronizar", {
      metodo: "POST",
      token: panel.token,
      origen: `http://127.0.0.1:${puerto}`,
    });
    expect(res.status).toBe(200);
    expect(sincronizaciones).toBe(1);
  });

  it("y la bandeja, que no manda Origin, también", async () => {
    const res = await pedir("/reintentar", { metodo: "POST", token: panel.token });
    expect(res.status).toBe(200);
    expect((await json<{ reencoladas: number }>(res)).reencoladas).toBe(1);
  });
});

describe("lo que el panel no dice nunca", () => {
  it("el estado no lleva la credencial ni por asomo", async () => {
    const texto = await (await pedir("/estado", { token: panel.token })).text();
    /*
     * Enseñar el secreto en una pantalla que se abre con un clic derecho lo
     * convierte en algo que se ve por encima del hombro. «Activado» es todo lo
     * que hace falta saber.
     */
    expect(texto).not.toMatch(/secret|credencial|clave/i);
    expect((JSON.parse(texto) as { activado: boolean }).activado).toBe(true);
  });

  it("activar contesta ok y no devuelve el código", async () => {
    const res = await pedir("/activar", {
      metodo: "POST",
      token: panel.token,
      cuerpo: { codigo: "ABC-123" },
    });
    const texto = await res.text();

    expect(activaciones).toEqual(["ABC-123"]);
    expect(texto).not.toContain("ABC-123");
  });

  it("un código vacío no llega a intentarse", async () => {
    const res = await pedir("/activar", {
      metodo: "POST",
      token: panel.token,
      cuerpo: { codigo: "   " },
    });
    expect(res.status).toBe(400);
    expect(activaciones).toHaveLength(0);
  });
});

describe("el token y su fichero", () => {
  it("se deja donde la bandeja puede leerlo, y solo el dueño", async () => {
    const fichero = path.join(cfg.raiz, "panel.json");
    const guardado = JSON.parse(fs.readFileSync(fichero, "utf8"));

    expect(guardado.token).toBe(panel.token);
    expect(guardado.puerto).toBe(puerto);
    if (process.platform !== "win32") {
      // En Windows manda la ACL de la carpeta; aquí sí significa algo.
      expect(fs.statSync(fichero).mode & 0o077).toBe(0);
    }
  });

  it("al parar, el fichero se va: ese token ya no vale", async () => {
    await panel.parar();
    expect(fs.existsSync(path.join(cfg.raiz, "panel.json"))).toBe(false);
  });

  it("cada arranque trae un token nuevo", async () => {
    const otro = new Panel(cfg, acciones());
    expect(otro.token).not.toBe(panel.token);
    /*
     * Importa porque el token acaba en el historial del navegador al abrir la
     * pantalla de estado. Rotándolo, lo que se escape deja de valer al
     * reiniciar.
     */
    expect(otro.token).toHaveLength(48);
  });
});

describe("la pantalla de estado", () => {
  it("se sirve con el token en la URL, que es como la abre la bandeja", async () => {
    const res = await fetch(`http://127.0.0.1:${puerto}/?t=${panel.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sin token, ni la pantalla", async () => {
    expect((await fetch(`http://127.0.0.1:${puerto}/`)).status).toBe(404);
  });
});

describe("aguanta lo que le manden", () => {
  it("una ruta que no existe es 404, no una caída", async () => {
    expect((await pedir("/lo-que-sea", { token: panel.token })).status).toBe(404);
  });

  it("un cuerpo que no es JSON no tumba el panel", async () => {
    const res = await fetch(`http://127.0.0.1:${puerto}/activar`, {
      method: "POST",
      headers: { "x-autoscan-panel": panel.token, "content-type": "application/json" },
      body: "{esto no es json",
    });
    expect(res.status).toBe(500);
    // Y sigue vivo:
    expect((await pedir("/estado", { token: panel.token })).status).toBe(200);
  });

  it("parar dos veces no revienta", async () => {
    await panel.parar();
    await expect(panel.parar()).resolves.toBeUndefined();
  });
});
