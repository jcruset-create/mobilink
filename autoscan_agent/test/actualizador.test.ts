/**
 * El actualizador, con el lanzador de procesos falseado.
 *
 * Lo que se comprueba aquí es lo que decide si el agente ejecuta o no código
 * que viene de fuera. La parte de PowerShell —parar la tarea, mover carpetas,
 * volver atrás— NO se prueba: no hay PowerShell en el entorno de desarrollo, y
 * fingirlo comprobaría el andamio. Está dicho en el README y en el propio guion.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Actualizador, type Lanzador } from "../src/actualizador.ts";
import type { Config } from "../src/config.ts";

let raiz: string;
let cfg: Config;
let lanzado: { programa: string; args: string[] } | null;
const lanzador: Lanzador = (programa, args) => {
  lanzado = { programa, args };
};

/** Un servidor de mentira para las descargas, en 127.0.0.1. */
let servidor: http.Server;
let base: string;
let cuerpo: Buffer;
let estado: number;

beforeEach(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "actualizador-"));
  fs.mkdirSync(path.join(raiz, "app", "instalador"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "app", "instalador", "actualizar.ps1"), "# guion");

  cfg = { raiz } as Config;
  lanzado = null;
  cuerpo = Buffer.from("PK esto hace de paquete");
  estado = 200;

  servidor = http.createServer((_req, res) => {
    res.writeHead(estado);
    res.end(estado === 200 ? cuerpo : "no");
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  const dir = servidor.address() as { port: number };
  base = `http://127.0.0.1:${dir.port}`;
});

afterEach(async () => {
  await new Promise<void>((listo) => servidor.close(() => listo()));
  fs.rmSync(raiz, { recursive: true, force: true });
});

/**
 * El actualizador de las pruebas de descarga, apuntando al servidor local.
 *
 * Lo que se comprueba con él es lo de ALREDEDOR de la lista de anfitriones —el
 * techo de tamaño, el 404, el guion copiado aparte—. Que la lista por defecto
 * sea estricta se comprueba arriba, construyendo el actualizador exactamente
 * como lo construye el agente.
 */
/** Los .zip que hay ahora mismo en las carpetas temporales del agente. */
function zipsSueltos(): string[] {
  const salida: string[] = [];
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (!d.startsWith("mobilink-autoscan-")) continue;
    const c = path.join(os.tmpdir(), d);
    try {
      if (fs.statSync(c).isDirectory()) {
        for (const f of fs.readdirSync(c)) if (f.endsWith(".zip")) salida.push(path.join(d, f));
      }
    } catch {
      /* Se lo ha llevado otra prueba entre el listado y el stat. */
    }
  }
  return salida.sort();
}

const conServidorLocal = () =>
  new Actualizador(cfg, () => {}, lanzador, { anfitriones: ["127.0.0.1"], exigirTls: false });

describe("qué se niega a instalar", () => {
  it("una versión que no es más nueva", async () => {
    const a = new Actualizador(cfg, () => {}, lanzador);
    await expect(
      a.aplicar({ version: "1.0.2", url: "https://github.com/x/y.zip" }, "1.0.2")
    ).rejects.toThrow(/no es más nueva/);
    expect(lanzado).toBeNull();
  });

  it("una versión más vieja, aunque el servidor insista", async () => {
    const a = new Actualizador(cfg, () => {}, lanzador);
    await expect(
      a.aplicar({ version: "0.9.0", url: "https://github.com/x/y.zip" }, "1.0.2")
    ).rejects.toThrow(/no es más nueva/);
    expect(lanzado).toBeNull();
  });

  it("una dirección que no es de donde publica la casa", async () => {
    const a = new Actualizador(cfg, () => {}, lanzador);
    await expect(
      a.aplicar({ version: "2.0.0", url: "https://ejemplo.invalido/agente.zip" }, "1.0.2")
    ).rejects.toThrow(/no es de donde Mobilink publica/);
    /* Lo importante no es el mensaje: es que no se ha lanzado NADA. */
    expect(lanzado).toBeNull();
  });

  it("comprueba antes de descargar, no después", async () => {
    /*
     * Descargar primero y validar luego dejaría el fichero en el disco del
     * mostrador y, sobre todo, habría hecho la petición: quien controle la
     * dirección ya sabe que este PC existe y está escuchando.
     */
    let pedido = false;
    const espia = http.createServer((_q, r) => {
      pedido = true;
      r.end();
    });
    await new Promise<void>((listo) => espia.listen(0, "127.0.0.1", listo));
    const p = (espia.address() as { port: number }).port;

    const a = new Actualizador(cfg, () => {}, lanzador);
    await expect(
      a.aplicar({ version: "2.0.0", url: `http://127.0.0.1:${p}/x.zip` }, "1.0.2")
    ).rejects.toThrow();
    expect(pedido).toBe(false);
    await new Promise<void>((listo) => espia.close(() => listo()));
  });
});

describe("la descarga", () => {
  it("deja el paquete y lanza PowerShell con el guion, el zip y la raíz", async () => {
    const a = conServidorLocal();
    await a.aplicar({ version: "2.0.0", url: `${base}/agente.zip` }, "1.0.2");

    expect(lanzado).not.toBeNull();
    expect(lanzado!.programa).toBe("powershell.exe");

    const args = lanzado!.args;
    const zip = args[args.indexOf("-Zip") + 1]!;
    expect(fs.readFileSync(zip)).toEqual(cuerpo);
    expect(args[args.indexOf("-Raiz") + 1]).toBe(raiz);
  });

  it("ejecuta el guion desde FUERA de app\\, que es lo que se va a mover", async () => {
    /*
     * Si se ejecutara desde `app\instalador\`, PowerShell se quedaría sin guion
     * en cuanto el propio guion moviera la carpeta. Es el tipo de avería que
     * deja el mostrador a medio actualizar.
     */
    const a = conServidorLocal();
    await a.aplicar({ version: "2.0.0", url: `${base}/agente.zip` }, "1.0.2");

    const guion = lanzado!.args[lanzado!.args.indexOf("-File") + 1]!;
    expect(guion.startsWith(path.join(raiz, "app"))).toBe(false);
    expect(fs.readFileSync(guion, "utf8")).toBe("# guion");
  });

  it("un 404 se explica por su causa: falta publicar la release", async () => {
    estado = 404;
    const a = conServidorLocal();
    await expect(
      a.aplicar({ version: "2.0.0", url: `${base}/agente.zip` }, "1.0.2")
    ).rejects.toThrow(/no está publicada todavía/);
    expect(lanzado).toBeNull();
  });

  it("corta y no lanza nada si el paquete pasa del techo", async () => {
    cuerpo = Buffer.alloc(31 * 1024 * 1024, 1);
    const a = conServidorLocal();
    await expect(
      a.aplicar({ version: "2.0.0", url: `${base}/agente.zip` }, "1.0.2")
    ).rejects.toThrow(/tamaño razonable/);
    expect(lanzado).toBeNull();
  });

  it("no deja el fichero a medias cuando la descarga falla", async () => {
    const antes = zipsSueltos();
    cuerpo = Buffer.alloc(31 * 1024 * 1024, 1);
    const a = conServidorLocal();
    await expect(
      a.aplicar({ version: "2.0.0", url: `${base}/agente.zip` }, "1.0.2")
    ).rejects.toThrow();

    /* Un .zip a medias en el disco del mostrador es basura que nadie va a
       recoger, y la próxima vez estorba. Se compara CONTRA EL ANTES: una
       descarga que sí termina deja su paquete a propósito —lo necesita
       PowerShell— y contarlos todos mezclaría las dos cosas. */
    expect(zipsSueltos()).toEqual(antes);
  });
});
