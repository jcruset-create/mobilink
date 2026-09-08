/**
 * DPAPI sin módulo nativo.
 *
 * Windows cifra y descifra con `ProtectedData` de .NET, que está en cualquier
 * Windows 10 u 11 sin instalar nada. Se llama lanzando PowerShell, que también
 * viene de serie.
 *
 * ## Por qué no un módulo nativo
 *
 * `win-dpapi`, `keytar` y compañía funcionan, pero traen compilación nativa o
 * binarios precompilados por versión de Node y de Windows. Eso convierte el
 * instalador —que es lo que va a correr en quince mostradores sin nadie
 * delante— en la parte frágil del proyecto. Aquí no hay nada que compilar: el
 * agente es JavaScript y el cifrado lo hace el sistema operativo.
 *
 * El coste es un proceso de PowerShell por operación. Se paga dos veces en toda
 * la vida del agente: al activar y al arrancar.
 *
 * ## Detalles que importan
 *
 * - **Ámbito de usuario** (`CurrentUser`), no de máquina. Con `LocalMachine`,
 *   cualquier cuenta del PC podría descifrarlo, incluida la de un cliente que
 *   se sienta en recepción.
 * - **La entropía adicional** ata el secreto a esta aplicación: un programa
 *   distinto corriendo como el mismo usuario no puede descifrarlo llamando a
 *   DPAPI sin más.
 * - **El secreto no viaja por la línea de órdenes.** Va por la entrada estándar.
 *   Un argumento de proceso lo ve cualquiera con el Administrador de tareas y
 *   se queda en el historial de PowerShell.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type AlmacenDeCredencial,
  type Credencial,
  ErrorDeCredencial,
} from "./credencial.ts";

/**
 * Ata el cifrado a esta aplicación, además de a la cuenta de Windows.
 *
 * No es una clave y no la protege: si alguien tiene el binario, tiene esto. Lo
 * que hace es impedir que OTRO programa que corra como el mismo usuario pueda
 * descifrar el fichero llamando a DPAPI a secas. Contra el atacante que ya
 * ejecuta código como ese usuario no hay defensa posible en el lado del cliente,
 * y por eso la credencial se puede revocar desde el panel en cualquier momento.
 */
const ENTROPIA = "Mobilink.AutoScan.v1";

/** PowerShell y no `pwsh`: el que viene con Windows. */
const POWERSHELL = "powershell.exe";

function guion(operacion: "proteger" | "desproteger"): string {
  const metodo = operacion === "proteger" ? "Protect" : "Unprotect";
  /*
   * `[Console]::In.ReadToEnd()` y no un parámetro: el secreto entra por la
   * entrada estándar, que no aparece en la lista de procesos.
   */
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entrada = [Console]::In.ReadToEnd().Trim()
$entropia = [System.Text.Encoding]::UTF8.GetBytes('${ENTROPIA}')
$bytes = [System.Convert]::FromBase64String($entrada)
$salida = [System.Security.Cryptography.ProtectedData]::${metodo}(
  $bytes, $entropia, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Console]::Out.Write([System.Convert]::ToBase64String($salida))
`.trim();
}

async function powershell(guionPs: string, entrada: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );

    let salida = "";
    let error = "";
    p.stdout.on("data", (d) => (salida += String(d)));
    p.stderr.on("data", (d) => (error += String(d)));
    p.on("error", (e) =>
      reject(new ErrorDeCredencial("DPAPI_NO_DISPONIBLE", `No se ha podido lanzar PowerShell: ${e.message}`))
    );
    p.on("close", (codigo) => {
      if (codigo === 0) return resolve(salida.trim());
      /*
       * El mensaje de PowerShell NO se propaga tal cual: en el camino de
       * descifrado puede llevar trozos del contenido. Se registra el código y
       * ya está.
       */
      reject(
        new ErrorDeCredencial(
          "DPAPI_FALLO",
          `DPAPI ha fallado (código ${codigo}). ${error.slice(0, 200).replace(/\s+/g, " ")}`
        )
      );
    });

    // El guion primero, luego el dato, y se cierra la entrada.
    p.stdin.write(`${guionPs}\n`);
    p.stdin.end(entrada);
  });
}

/**
 * La credencial cifrada, en un fichero que solo sirve en este PC y esta cuenta.
 */
export class AlmacenDpapi implements AlmacenDeCredencial {
  readonly #ruta: string;

  constructor(raiz: string) {
    this.#ruta = path.join(raiz, "data", "credencial.dat");
  }

  async leer(): Promise<Credencial | null> {
    if (!fs.existsSync(this.#ruta)) return null;
    const cifrado = fs.readFileSync(this.#ruta, "utf8").trim();
    if (!cifrado) return null;

    const claro = await powershell(guion("desproteger"), cifrado);
    try {
      return JSON.parse(Buffer.from(claro, "base64").toString("utf8")) as Credencial;
    } catch {
      /*
       * Descifró pero no es lo que esperábamos: fichero de otra versión, o
       * medio escrito. Es recuperable —se vuelve a activar— y decirlo así
       * ahorra una reinstalación.
       */
      throw new ErrorDeCredencial(
        "CREDENCIAL_ILEGIBLE",
        "La credencial guardada no se entiende. Vuelve a activar el dispositivo."
      );
    }
  }

  async guardar(c: Credencial): Promise<void> {
    const claro = Buffer.from(JSON.stringify(c), "utf8").toString("base64");
    const cifrado = await powershell(guion("proteger"), claro);

    fs.mkdirSync(path.dirname(this.#ruta), { recursive: true });
    /*
     * Se escribe a un temporal y se renombra. Un corte de luz a mitad de un
     * `writeFileSync` deja un fichero a medias, y eso es una credencial
     * ilegible que obliga a reactivar el escáner.
     */
    const temporal = `${this.#ruta}.tmp`;
    fs.writeFileSync(temporal, cifrado, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporal, this.#ruta);
  }

  async borrar(): Promise<void> {
    try {
      fs.unlinkSync(this.#ruta);
    } catch {
      // No existía. No es un error: borrar dos veces tiene que dar lo mismo.
    }
  }

  descripcion(): string {
    return `cifrada con DPAPI (cuenta de Windows actual) en ${this.#ruta}`;
  }
}

/**
 * El almacén que toca según dónde corra.
 *
 * Fuera de Windows **no adivina**: falla diciendo qué pasa. El agente es de
 * Windows; que arrancara en un Mac guardando el secreto en claro sería la peor
 * forma de descubrir que no era el sitio.
 */
export function almacenDelSistema(raiz: string): AlmacenDeCredencial {
  if (process.platform !== "win32") {
    throw new ErrorDeCredencial(
      "PLATAFORMA_NO_SOPORTADA",
      "El agente de AutoScan guarda su credencial con DPAPI y solo corre en Windows. " +
        "Para desarrollo, usa AlmacenEnMemoria."
    );
  }
  return new AlmacenDpapi(raiz);
}
