/**
 * Dónde viven los justificantes escaneados.
 *
 * Bucket **privado** y enlaces firmados que caducan, a diferencia del bucket
 * público que el proyecto usa para avatares y logotipos. La diferencia importa:
 * un logo puede verlo cualquiera, pero estos ficheros son las facturas de los
 * clientes y de los proveedores. Con un bucket público, una URL reenviada por
 * WhatsApp abre la facturación del día a quien la reciba, sin sesión y para
 * siempre.
 *
 * El bucket se crea solo la primera vez, como el resto del esquema del módulo:
 * quien despliega no tiene que acordarse de nada.
 *
 * Sin Supabase configurado —desarrollo y pruebas— se guarda en disco bajo
 * `server/uploads/cash`. No es para producción, y por eso avisa al arrancar:
 * el contenedor de Render es efímero y ahí los ficheros se perderían.
 */

import fs from "node:fs";
import path from "node:path";
import { ErrorCaja } from "./repository.ts";

const BUCKET = process.env.CASH_DOCUMENTS_BUCKET || "cash-documents";
const CADUCIDAD_ENLACE_S = 60 * 15;

const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "cash");

/**
 * Se decide en cada llamada y no una vez al cargar el módulo.
 *
 * `CASH_STORAGE_LOCAL` fuerza el disco aunque haya credenciales, que es lo que
 * necesitan las pruebas: la CI define un Supabase FICTICIO
 * (`http://supabase.invalid`) para que las suites carguen, y sin este
 * interruptor las de justificantes intentarían subir a un host que no existe.
 */
function haySupabase(): boolean {
  if (process.env.CASH_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

/**
 * El cliente de Supabase se carga tarde y no en la cabecera del fichero.
 *
 * `server/supabase.ts` revienta al importarse si no hay credenciales, así que
 * importarlo arriba haría que el módulo entero —incluidas las pruebas contra
 * PostgreSQL, que no necesitan almacenamiento— no arrancara sin Supabase.
 */
async function cliente() {
  const { supabase } = await import("../supabase.ts");
  return supabase;
}

/** Crea el bucket privado si no existe. Idempotente y silencioso si ya está. */
async function asegurarBucket(): Promise<void> {
  if (bucketListo || !haySupabase()) return;
  try {
    const sb = await cliente();
    const { data } = await sb.storage.getBucket(BUCKET);
    if (!data) {
      await sb.storage.createBucket(BUCKET, { public: false });
      console.log(`Mobilink Cash: creado el bucket privado ${BUCKET}`);
    }
  } catch (e) {
    // Si el bucket ya existía por otra vía, getBucket puede fallar y no pasa
    // nada; lo que no puede es impedir la subida.
    console.warn("Mobilink Cash: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

export type DocumentoGuardado = { ruta: string; tamanoBytes: number };

export async function guardarDocumento(
  ruta: string,
  contenido: Buffer,
  mime: string
): Promise<DocumentoGuardado> {
  if (!haySupabase()) {
    const destino = path.join(DIR_LOCAL, ruta);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    return { ruta, tamanoBytes: contenido.length };
  }

  await asegurarBucket();
  const sb = await cliente();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(ruta, contenido, { contentType: mime, upsert: false });

  if (error) {
    console.error("Mobilink Cash: error subiendo el documento:", error);
    throw new ErrorCaja(
      "SUBIDA_FALLIDA",
      "No se ha podido guardar el documento. La operación sí está registrada: vuelve a adjuntarlo desde el histórico.",
      502
    );
  }
  return { ruta, tamanoBytes: contenido.length };
}

/** Enlace temporal para abrir el documento desde la interfaz. */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!haySupabase()) return `/uploads/cash/${ruta}`;

  const sb = await cliente();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(ruta, CADUCIDAD_ENLACE_S);
  if (error || !data) {
    console.warn("Mobilink Cash: no se ha podido firmar el enlace:", error);
    return null;
  }
  return data.signedUrl;
}

/** Bytes del documento. Lo usa el informe de cierre para incrustarlo. */
export async function leerDocumento(ruta: string): Promise<Buffer | null> {
  if (!haySupabase()) {
    const origen = path.join(DIR_LOCAL, ruta);
    return fs.existsSync(origen) ? fs.readFileSync(origen) : null;
  }

  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).download(ruta);
  if (error || !data) {
    console.warn("Mobilink Cash: no se ha podido leer el documento:", ruta, error);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Ruta dentro del bucket. Lleva la empresa y la jornada por delante para que
 * un vistazo al almacenamiento diga de quién es cada cosa, y un sufijo de
 * tiempo para que dos escaneos del mismo documento no se pisen.
 */
export function rutaDocumento(
  empresaId: string,
  sessionId: number,
  /** null = documento de la jornada entera, no de una operación. */
  operationId: number | null,
  extension: string,
  ahora: number
): string {
  return `${empresaId}/${sessionId}/${operationId ?? "jornada"}_${ahora}${extension}`;
}
