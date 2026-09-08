/**
 * El panel local: lo que la bandeja de Windows enseña y manda.
 *
 * El agente no tiene ventana propia. La bandeja es un icono de PowerShell
 * —`NotifyIcon`, que viene con Windows— y todo lo que necesita saber o hacer lo
 * pide por HTTP a este servidor, que vive dentro del propio proceso del agente.
 *
 * Así se cumple el requisito de **nada de Electron ni Tauri** sin renunciar a
 * tener una pantalla de estado: el icono lo pinta .NET, que ya está instalado, y
 * la ventana de estado es el navegador que el usuario ya tiene.
 *
 * ## Esto es una puerta abierta en el PC de recepción, y se trata como tal
 *
 * Un servidor HTTP en la máquina donde entran las facturas es exactamente el
 * tipo de cosa que se hace mal. Tres medidas, y las tres hacen falta:
 *
 * **Escucha solo en 127.0.0.1.** Sin esto, `listen(puerto)` se abre a todas las
 * interfaces y cualquiera del wifi del taller —incluido el del cliente que
 * espera en el mostrador— podría ver la lista de facturas escaneadas y
 * reactivar el dispositivo.
 *
 * **Todo pide token**, incluido leer el estado: el estado dice el nombre del
 * centro y los nombres de los ficheros escaneados. El token se genera en cada
 * arranque y se escribe en un fichero de la carpeta del agente. Quien puede
 * leer ese fichero ya es el dueño del PC.
 *
 * **Se rechaza cualquier petición con `Origin`.** Es lo que impide que una web
 * abierta en el navegador del mostrador haga peticiones a `127.0.0.1` y
 * conduzca el agente por detrás. La bandeja no manda `Origin`; una página web,
 * siempre. Un token que no se puede usar desde una web vale mucho más que uno
 * largo.
 *
 * ## Lo que este servidor NO devuelve nunca
 *
 * La credencial del dispositivo. Ni entera, ni por el principio, ni por el
 * final. El panel dice «activado» o «sin activar» y eso es todo lo que hace
 * falta saber: enseñar el secreto en una pantalla que se abre con un clic
 * derecho lo convertiría en algo que se ve por encima del hombro.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Config } from "./config.ts";

/** Lo que el panel enseña. Sale de quien lo monta; aquí no se calcula nada. */
export type Estado = {
  version: string;
  activado: boolean;
  centro: string | null;
  /** Última vez que el servidor contestó al latido. */
  ultimoLatidoMs: number | null;
  pendientes: number;
  subiendo: number;
  rechazadas: number;
  archivadas: number;
  vigilados: number;
  /** Escaneos vacíos que llevan demasiado tiempo así. */
  atascados: string[];
  /** Último problema que merezca contarse, ya en castellano. */
  ultimoError: string | null;
  carpetas: { inbox: string; sent: string; failed: string; logs: string };
};

export type Acciones = {
  estado: () => Estado;
  /** Vuelve a poner en cola lo apartado. Devuelve cuántas. */
  reintentarRechazadas: () => number;
  /** Fuerza un barrido y un ciclo de subida ya, sin esperar al temporizador. */
  sincronizarAhora: () => Promise<void>;
  /** Canjea un código de activación. Lanza si no vale. */
  activar: (codigo: string) => Promise<void>;
};

/** El puerto por defecto. Alto y poco usado, y se puede cambiar por entorno. */
export const PUERTO_POR_DEFECTO = 47_913;

export class Panel {
  readonly #cfg: Config;
  readonly #acciones: Acciones;
  readonly #log: (m: string) => void;
  readonly #token: string;
  #servidor: http.Server | null = null;

  constructor(cfg: Config, acciones: Acciones, log: (m: string) => void = () => {}) {
    this.#cfg = cfg;
    this.#acciones = acciones;
    this.#log = log;
    /*
     * Token nuevo en cada arranque, y no uno guardado: si alguna vez se escapa
     * —queda en el historial del navegador al abrir la pantalla de estado—,
     * deja de valer en cuanto se reinicia el agente.
     */
    this.#token = crypto.randomBytes(24).toString("hex");
  }

  get token(): string {
    return this.#token;
  }

  /**
   * Arranca el panel y deja el token donde la bandeja pueda leerlo.
   *
   * El fichero se escribe con permisos 0600. En Windows no significa gran cosa
   * —lo manda la ACL de la carpeta— pero en el Linux donde corren las pruebas y
   * el desarrollo sí, y no cuesta nada.
   */
  async arrancar(puerto = PUERTO_POR_DEFECTO): Promise<number> {
    const servidor = http.createServer((req, res) => this.#atender(req, res));
    this.#servidor = servidor;

    await new Promise<void>((listo, falla) => {
      servidor.once("error", falla);
      /* Segundo argumento: SOLO el bucle local. Es la medida que más importa. */
      servidor.listen(puerto, "127.0.0.1", () => {
        servidor.removeListener("error", falla);
        listo();
      });
    });

    const direccion = servidor.address();
    const puertoReal = typeof direccion === "object" && direccion ? direccion.port : puerto;

    fs.mkdirSync(this.#cfg.raiz, { recursive: true });
    fs.writeFileSync(
      path.join(this.#cfg.raiz, "panel.json"),
      JSON.stringify({ puerto: puertoReal, token: this.#token }),
      { mode: 0o600 }
    );

    this.#log(`[panel] escuchando en 127.0.0.1:${puertoReal}`);
    return puertoReal;
  }

  async parar(): Promise<void> {
    const s = this.#servidor;
    this.#servidor = null;
    if (!s) return;
    await new Promise<void>((listo) => s.close(() => listo()));
    /* El token deja de valer: que no se quede el fichero diciendo que sí. */
    try {
      fs.unlinkSync(path.join(this.#cfg.raiz, "panel.json"));
    } catch {
      /* Si no está, mejor. */
    }
  }

  async #atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (!this.#autorizado(req, url)) {
        /*
         * 404 y no 401: un 401 confirma que aquí hay algo. Quien tiene el token
         * no llega nunca a esta rama, y a quien no lo tiene no hay por qué
         * decirle qué puerto ha acertado.
         */
        return responder(res, 404, { error: "No encontrado." });
      }

      if (req.method === "GET" && url.pathname === "/") {
        return paginaDeEstado(res, this.#token);
      }
      if (req.method === "GET" && url.pathname === "/estado") {
        return responder(res, 200, this.#acciones.estado());
      }
      if (req.method === "POST" && url.pathname === "/reintentar") {
        return responder(res, 200, { reencoladas: this.#acciones.reintentarRechazadas() });
      }
      if (req.method === "POST" && url.pathname === "/sincronizar") {
        await this.#acciones.sincronizarAhora();
        return responder(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/activar") {
        const cuerpo = await leerJson(req);
        const codigo = typeof cuerpo.codigo === "string" ? cuerpo.codigo : "";
        if (!codigo.trim()) return responder(res, 400, { error: "Falta el código." });
        await this.#acciones.activar(codigo);
        /*
         * Se contesta `ok` y nada más. Ni el secreto, ni el código: el código
         * ya está gastado, pero devolverlo lo dejaría en el historial y en
         * cualquier registro del navegador para nada.
         */
        return responder(res, 200, { ok: true });
      }

      return responder(res, 404, { error: "No encontrado." });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "Ha fallado algo en el panel.";
      this.#log(`[panel] ${mensaje}`);
      return responder(res, 500, { error: mensaje });
    }
  }

  #autorizado(req: http.IncomingMessage, url: URL): boolean {
    /*
     * Cualquier `Origin` es un navegador llamando desde una página, y ninguna
     * página tiene por qué hablar con el agente. La pantalla de estado que
     * servimos nosotros navega directa, sin `Origin`, y sus fetch van al mismo
     * sitio con `same-origin` — que sí manda Origin, así que se admite el
     * nuestro y solo el nuestro.
     */
    const origen = req.headers.origin;
    if (typeof origen === "string" && origen && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origen)) {
      return false;
    }

    const cabecera = req.headers["x-autoscan-panel"];
    const dado = typeof cabecera === "string" ? cabecera : (url.searchParams.get("t") ?? "");
    return comparaSegura(dado, this.#token);
  }
}

/**
 * Comparación en tiempo constante.
 *
 * Contra un token de 24 bytes en el bucle local, adivinar byte a byte por
 * tiempos es poco realista. Se hace igual porque cuesta una línea y porque la
 * versión con `===` es la que alguien copia después a un sitio donde sí importa.
 */
function comparaSegura(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function responder(res: http.ServerResponse, codigo: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    /* Que nadie meta esto en un iframe ni adivine tipos. */
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(texto);
}

/** Cuerpo JSON con tope: nadie manda un megabyte a este panel. */
async function leerJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const trozo of req) {
    total += (trozo as Buffer).length;
    if (total > 64 * 1024) throw new Error("Petición demasiado grande.");
    trozos.push(trozo as Buffer);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(trozos).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("El cuerpo no es JSON.");
  }
}

/**
 * La pantalla de estado.
 *
 * Va aquí dentro, en una plantilla, y no como fichero suelto: el instalador
 * copia un ejecutable y una carpeta, y un `.html` que se puede editar en el PC
 * de recepción es un `.html` que alguien acaba editando.
 */
function paginaDeEstado(res: http.ServerResponse, token: string): void {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Mobilink AutoScan</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:16px;background:#0f172a;color:#e2e8f0;font:14px system-ui,Segoe UI,sans-serif}
 h1{font-size:18px;margin:0 0 12px}
 .rejilla{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px}
 .caja{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px}
 .caja b{display:block;font-size:22px}
 .et{font-size:10px;text-transform:uppercase;color:#94a3b8;letter-spacing:.04em}
 .mal{color:#fca5a5} .bien{color:#86efac}
 button{background:#0284c7;color:#fff;border:0;border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer;margin-right:6px}
 button:disabled{opacity:.5;cursor:default}
 ul{padding-left:18px} li{margin:2px 0;color:#fca5a5}
 code{color:#94a3b8;font-size:12px;word-break:break-all}
</style></head><body>
<h1>Mobilink AutoScan</h1>
<div id="cuerpo">Cargando…</div>
<script>
const T=new URLSearchParams(location.search).get("t")||${JSON.stringify(token)};
const H={"x-autoscan-panel":T};
const esc=s=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
async function pinta(){
  const e=await (await fetch("/estado",{headers:H})).json();
  document.getElementById("cuerpo").innerHTML=
   '<div class="rejilla">'
   +caja("En cola",e.pendientes)+caja("Subiendo",e.subiendo)
   +caja("Entregadas",e.archivadas)+caja("Apartadas",e.rechazadas,e.rechazadas>0?"mal":"")
   +'</div>'
   +'<p>'+(e.activado?'<span class="bien">Activado</span>'+(e.centro?" · "+esc(e.centro):"")
                    :'<span class="mal">Sin activar</span>')
   +' · versión '+esc(e.version)+'</p>'
   +(e.ultimoError?'<p class="mal">'+esc(e.ultimoError)+'</p>':'')
   +(e.atascados.length?'<p>Escaneos vacíos, seguramente cortados:</p><ul>'
      +e.atascados.map(a=>"<li>"+esc(a)+"</li>").join("")+'</ul>':'')
   +'<p><button onclick="accion(\\'/sincronizar\\')">Sincronizar ahora</button>'
   +'<button onclick="accion(\\'/reintentar\\')" '+(e.rechazadas?"":"disabled")+'>Reintentar apartadas</button></p>'
   +'<p class="et">Carpeta vigilada</p><code>'+esc(e.carpetas.inbox)+'</code>';
}
function caja(t,v,c){return '<div class="caja"><span class="et">'+t+'</span><b class="'+(c||"")+'">'+v+'</b></div>'}
async function accion(r){await fetch(r,{method:"POST",headers:H});pinta()}
pinta(); setInterval(pinta,3000);
</script></body></html>`;
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
  });
  res.end(html);
}
