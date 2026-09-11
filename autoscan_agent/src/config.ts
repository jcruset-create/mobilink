/**
 * Dónde vive todo y cada cuánto pasa cada cosa.
 *
 * Un solo sitio, y ninguna constante suelta por el resto del código: el día que
 * un taller tenga la carpeta en otra unidad o una conexión mala, se toca aquí y
 * no se busca por dieciséis ficheros.
 *
 * ## Lo que NO está aquí
 *
 * La credencial del dispositivo. No es configuración: es un secreto, lo entrega
 * el servidor al activar y vive cifrado con DPAPI (`credencial.ts`). Meterla en
 * un fichero de configuración es exactamente lo que este módulo evita —un
 * `.json` en texto plano en el PC de recepción, legible por cualquiera que pase
 * por delante—.
 *
 * ## Orden de precedencia
 *
 * Variable de entorno → fichero de configuración → valor por defecto. Las
 * variables mandan para poder arrancar una instalación rara sin editar nada, y
 * el fichero es lo que deja el instalador.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Raíz de todo lo del agente en el PC.
 *
 * `C:\MobilinkAutoScan` y no `%APPDATA%` a propósito: la carpeta que vigila el
 * agente es la MISMA que configura el perfil de ScanSnap Home, y esa la teclea
 * una persona en un diálogo. Una ruta corta y predecible se dicta por teléfono;
 * `C:\Users\recepcion\AppData\Roaming\…` no.
 */
const RAIZ_POR_DEFECTO = process.platform === "win32" ? "C:\\MobilinkAutoScan" : path.join(process.cwd(), ".autoscan");

export type Config = {
  /** Raíz de trabajo. Debajo cuelgan Inbox, Sent, Failed, data y logs. */
  raiz: string;
  /** La que vigila el agente. La misma que escribe el perfil de ScanSnap. */
  inbox: string;
  /** A donde va el PDF cuando el servidor confirma que lo tiene. */
  sent: string;
  /** Lo que el servidor rechaza por lo que es, no por un fallo pasajero. */
  failed: string;
  /** La cola. Un fichero SQLite. */
  baseDatos: string;
  logs: string;

  /** Raíz de la API, sin barra final. Ej: https://sea-tarragona.onrender.com */
  servidor: string;

  /** Cada cuánto se manda el latido. */
  latidoMs: number;
  /** Cada cuánto se vuelve a mirar la carpeta entera, además del watcher. */
  reconciliacionMs: number;
  /** Cuánto tiene que estar quieto un fichero para considerarlo terminado. */
  estabilidadMs: number;
  /** Cada cuánto se comprueba el tamaño mientras se espera a que se estabilice. */
  muestreoMs: number;
  /** Techo del backoff entre reintentos de subida. */
  reintentoMaximoMs: number;

  /** Lo que acepta el servidor. Se comprueba ANTES de subir para no gastar red. */
  tamanoMaximoBytes: number;
  /** Extensiones que el agente se molesta en mirar. */
  extensiones: string[];
};

/**
 * 15 MB, el mismo número que el servidor.
 *
 * Está duplicado a sabiendas, y por eso lleva este comentario: el agente lo usa
 * para no gastar una subida que va a acabar en 400, pero **la autoridad es el
 * servidor**. Si algún día allí sube a 25, aquí seguirá rechazando a los 15
 * hasta que alguien lo cambie — que es el fallo seguro y no el peligroso.
 *
 * Importa en la práctica: un lote multipágina del iX1500 a color y 600 ppp pasa
 * de 15 MB con pocas hojas. Cuando ocurre, la respuesta correcta NO es
 * reintentar: es bajar la calidad del perfil de ScanSnap. El agente lo dice y
 * deja el fichero en Failed.
 */
export const TAMANO_MAXIMO_BYTES = 15 * 1024 * 1024;

const numero = (v: string | undefined, porDefecto: number): number => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

/**
 * Lee la configuración: fichero si lo hay, variables de entorno por encima.
 *
 * No lanza si el fichero no existe. Una instalación recién hecha todavía no lo
 * tiene y el agente tiene que poder arrancar igual para que alguien pueda
 * activarlo desde la bandeja.
 */
export function cargarConfig(raizForzada?: string): Config {
  const raiz = raizForzada ?? process.env.MOBILINK_AUTOSCAN_RAIZ ?? RAIZ_POR_DEFECTO;

  let delFichero: Partial<Config> = {};
  const ruta = path.join(raiz, "config.json");
  try {
    if (fs.existsSync(ruta)) {
      delFichero = JSON.parse(fs.readFileSync(ruta, "utf8")) as Partial<Config>;
    }
  } catch {
    /*
     * Un config.json roto no puede impedir arrancar: sin agente no hay bandeja
     * donde avisar de que el config.json está roto. Se sigue con los valores
     * por defecto y el problema se ve en el log.
     */
  }

  const servidor = (
    process.env.MOBILINK_AUTOSCAN_SERVIDOR ??
    delFichero.servidor ??
    ""
  ).replace(/\/+$/, "");

  return {
    raiz,
    inbox: path.join(raiz, "Inbox"),
    sent: path.join(raiz, "Sent"),
    failed: path.join(raiz, "Failed"),
    baseDatos: path.join(raiz, "data", "agent.db"),
    logs: path.join(raiz, "logs"),
    servidor,

    latidoMs: numero(process.env.MOBILINK_AUTOSCAN_LATIDO_MS, delFichero.latidoMs ?? 60_000),
    reconciliacionMs: numero(
      process.env.MOBILINK_AUTOSCAN_RECONCILIACION_MS,
      delFichero.reconciliacionMs ?? 5 * 60_000
    ),
    /*
     * 5 segundos quieto. El iX1500 escribe el PDF de un lote entero de una vez
     * al terminar, pero ScanSnap Home lo mueve y lo renombra después; con menos
     * margen se coge un fichero a medio escribir y se sube un PDF truncado, que
     * es peor que tardar cinco segundos más.
     */
    estabilidadMs: numero(process.env.MOBILINK_AUTOSCAN_ESTABILIDAD_MS, delFichero.estabilidadMs ?? 5_000),
    muestreoMs: numero(process.env.MOBILINK_AUTOSCAN_MUESTREO_MS, delFichero.muestreoMs ?? 1_000),
    reintentoMaximoMs: numero(
      process.env.MOBILINK_AUTOSCAN_REINTENTO_MAX_MS,
      delFichero.reintentoMaximoMs ?? 15 * 60_000
    ),

    tamanoMaximoBytes: TAMANO_MAXIMO_BYTES,
    /*
     * PDF es lo operativo; JPG y PNG entran porque el servidor los acepta y
     * alguien acabará dejando una foto del móvil en la carpeta. Todo lo demás
     * se ignora en silencio: en esa carpeta aparecen Thumbs.db y ficheros
     * temporales del propio ScanSnap, y no son errores que enseñar.
     */
    extensiones: delFichero.extensiones ?? [".pdf", ".jpg", ".jpeg", ".png"],
  };
}

/** Crea las carpetas que el agente necesita. Idempotente. */
export function prepararCarpetas(c: Config): void {
  for (const d of [c.inbox, c.sent, c.failed, path.dirname(c.baseDatos), c.logs]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
