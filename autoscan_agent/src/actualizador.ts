/**
 * Traer la versión nueva y dejar que el guion de PowerShell la ponga.
 *
 * El reparto es deliberado y conviene no moverlo: **aquí se decide y se
 * descarga; allí se cambia**. Node sabe comparar versiones y validar una URL;
 * PowerShell sabe parar una tarea programada, mover carpetas y volver atrás si
 * la cosa sale mal. Cada uno hace lo suyo y ninguno de los dos reimplementa al
 * otro.
 *
 * ## Por qué el proceso se lanza SUELTO
 *
 * Lo primero que hace el guion es parar al agente — es decir, parar a quien lo
 * ha lanzado. Un hijo normal se iría por delante con su padre y dejaría la
 * actualización a medias, que es el único estado del que cuesta salir.
 *
 * Así que se lanza `detached`, sin tuberías y con `unref()`: sale del grupo de
 * procesos del agente y sigue vivo cuando el agente ya no está. **Esto no se ha
 * podido probar en Windows** —en el entorno de desarrollo no hay PowerShell— y
 * es el punto que más vigilar la primera vez que se use de verdad.
 *
 * ## Por qué el guion se copia fuera antes de ejecutarlo
 *
 * `actualizar.ps1` vive en `app\instalador\`, y `app` es justo la carpeta que el
 * guion mueve. Ejecutar un fichero desde el sitio que estás moviendo es pedir
 * que PowerShell se quede sin guion a media frase. Se copia a la carpeta
 * temporal y se ejecuta desde ahí.
 *
 * ## Lo que NO se hace aquí
 *
 * Descomprimir. Node no trae zip, y meter una dependencia para esto —en un
 * agente que hoy no tiene ninguna— saldría más caro que la línea de PowerShell
 * que ya lo sabe hacer. El .zip se le entrega al guion tal cual.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config.ts";
import { ESTRICTA, descargaAceptable, esMasNueva, type PoliticaDeDescarga } from "./version.ts";

/**
 * Lanzar un programa, que es lo único que el actualizador necesita del sistema.
 *
 * Mismo patrón que `AlmacenDeCredencial` y `ServidorDeAutoScan`: la de verdad
 * llama a PowerShell y las pruebas registran una falsa. Sin esta costura, probar
 * que la descarga valida bien exigiría un Windows con PowerShell delante, y lo
 * que se comprobaría entonces sería el andamio.
 */
export type Lanzador = (programa: string, args: string[]) => void;

/** El de verdad: suelto, sin tuberías y desligado del agente. */
export const lanzarSuelto: Lanzador = (programa, args) => {
  const hijo = spawn(programa, args, { detached: true, stdio: "ignore", windowsHide: true });
  hijo.unref();
};

/**
 * Techo de la descarga.
 *
 * El agente entero son unos cuantos ficheros de texto; treinta megas es holgado
 * con creces. Está para que una respuesta que no es lo que dice ser —o un
 * servidor que se ha vuelto loco— no llene el disco del mostrador, que es el
 * mismo donde se acumulan los escaneos pendientes.
 */
const MAXIMO_BYTES = 30 * 1024 * 1024;

const TIEMPO_DESCARGA_MS = 120_000;

export class Actualizador {
  readonly #cfg: Config;
  readonly #log: (m: string) => void;
  readonly #lanzar: Lanzador;
  readonly #politica: PoliticaDeDescarga;

  constructor(
    cfg: Config,
    log: (m: string) => void = () => {},
    lanzar: Lanzador = lanzarSuelto,
    /* Solo las pruebas la pasan; el agente construye esto sin tocarla. */
    politica: PoliticaDeDescarga = ESTRICTA
  ) {
    this.#cfg = cfg;
    this.#log = log;
    this.#lanzar = lanzar;
    this.#politica = politica;
  }

  /**
   * Descarga la versión indicada y lanza el cambio.
   *
   * Vuelve en cuanto el guion está lanzado, no cuando termina: para entonces
   * este proceso ya no existe. Quien llama solo puede saber que **empezó**, y
   * la bandeja lo dice así.
   */
  async aplicar(
    publicado: { version: string; url: string },
    versionActual: string
  ): Promise<void> {
    /*
     * Las dos puertas, otra vez y aquí.
     *
     * Ya las mira `main.ts` antes de ofrecer el botón, y aun así se repiten: lo
     * que separa las dos comprobaciones es una petición HTTP al panel, y quien
     * llegue a esa petición por otro camino no ha pasado por la primera. Una
     * comprobación de seguridad que solo vive en quien dibuja el botón no es una
     * comprobación de seguridad.
     */
    if (!esMasNueva(publicado.version, versionActual)) {
      throw new Error(
        `La versión ${publicado.version} no es más nueva que la ${versionActual}. No se instala.`
      );
    }
    if (!descargaAceptable(publicado.url, this.#politica)) {
      throw new Error("La dirección de descarga no es de donde Mobilink publica. No se instala.");
    }

    const destino = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "mobilink-autoscan-")),
      `mobilink-autoscan-${publicado.version}.zip`
    );

    this.#log(`[actualizador] descargando ${publicado.version}`);
    await this.#descargar(publicado.url, destino);

    const guion = this.#guionAparte();
    this.#log(`[actualizador] lanzando el cambio a ${publicado.version}`);
    this.#lanzar("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      guion,
      "-Zip",
      destino,
      "-Raiz",
      this.#cfg.raiz,
    ]);
  }

  async #descargar(url: string, destino: string): Promise<void> {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIEMPO_DESCARGA_MS),
    });
    if (!res.ok) {
      /*
       * El 404 tiene nombre propio porque tiene una causa concreta y un remedio
       * concreto: alguien subió la versión en el repositorio sin publicar la
       * release. Un «ha fallado la descarga» mandaría a mirar la red del taller.
       */
      throw new Error(
        res.status === 404
          ? "La versión anunciada no está publicada todavía. Vuelve a intentarlo más tarde."
          : `La descarga ha respondido ${res.status}.`
      );
    }
    if (!res.body) throw new Error("La descarga ha venido vacía.");

    /*
     * El techo se comprueba mientras llega, no al final: fiarse de
     * `content-length` es fiarse de que el otro lado dice la verdad, y para
     * entonces el disco ya estaría lleno.
     */
    let bytes = 0;
    const salida = fs.createWriteStream(destino);
    try {
      for await (const trozo of res.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += trozo.byteLength;
        if (bytes > MAXIMO_BYTES) {
          throw new Error("El paquete pasa del tamaño razonable para el agente. Se descarta.");
        }
        if (!salida.write(trozo)) {
          await new Promise((sigue) => salida.once("drain", sigue));
        }
      }
      await new Promise<void>((listo, falla) => {
        salida.end(() => listo());
        salida.on("error", falla);
      });
    } catch (e) {
      salida.destroy();
      try {
        fs.unlinkSync(destino);
      } catch {
        /* Si no llegó a existir, mejor. */
      }
      throw e;
    }
  }

  /** Copia `actualizar.ps1` fuera de `app\`, que es lo que va a moverse. */
  #guionAparte(): string {
    const origen = path.join(this.#cfg.raiz, "app", "instalador", "actualizar.ps1");
    const destino = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "mobilink-autoscan-guion-")),
      "actualizar.ps1"
    );
    fs.copyFileSync(origen, destino);
    return destino;
  }
}
