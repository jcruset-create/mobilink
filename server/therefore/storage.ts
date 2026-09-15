/**
 * Dónde viven los PDF que llegan por correo.
 *
 * Copia de `server/cash/storage.ts` y por los mismos motivos: bucket
 * **privado** con enlaces firmados que caducan, porque un albarán de proveedor
 * lleva sus referencias, sus precios de compra y su escala de descuentos. Con
 * un bucket público, una URL reenviada abre las condiciones de compra a quien
 * la reciba, sin sesión y para siempre.
 *
 * Sin Supabase configurado —desarrollo y pruebas— se guarda en disco bajo
 * `server/uploads/therefore`. No es para producción: el contenedor de Render es
 * efímero y ahí los ficheros se perderían.
 *
 * `THEREFORE_STORAGE_LOCAL=1` fuerza el disco aunque haya credenciales. Lo
 * necesitan las pruebas: la CI define un Supabase FICTICIO para que las suites
 * carguen, y sin este interruptor intentarían subir a un host que no existe.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BUCKET = process.env.THEREFORE_DOCUMENTS_BUCKET || "therefore-documents";
const CADUCIDAD_ENLACE_S = 60 * 15;
const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "therefore");

function haySupabase(): boolean {
  if (process.env.THEREFORE_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

/**
 * El cliente de Supabase se carga tarde y no en la cabecera del fichero:
 * `server/supabase.ts` revienta al importarse si no hay credenciales.
 */
async function cliente() {
  const { supabase } = await import("../supabase.ts");
  return supabase;
}

async function asegurarBucket(): Promise<void> {
  if (bucketListo || !haySupabase()) return;
  try {
    const sb = await cliente();
    const { data } = await sb.storage.getBucket(BUCKET);
    if (!data) {
      await sb.storage.createBucket(BUCKET, { public: false });
      console.log(`Therefore: creado el bucket privado ${BUCKET}`);
    }
  } catch (e) {
    console.warn("Therefore: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

/** El hash del contenido. Es la identidad del fichero en todo el módulo. */
export function hashDeFichero(contenido: Buffer): string {
  return crypto.createHash("sha256").update(contenido).digest("hex");
}

/**
 * La ruta: `<empresa>/<hash[0:2]>/<hash>.<ext>`.
 *
 * Por el hash y no por el correo, a propósito: el mismo PDF adjunto en diez
 * reclamaciones se guarda UNA vez. Los dos primeros caracteres reparten los
 * ficheros en carpetas para que ninguna crezca sin límite.
 */
export function rutaDocumento(empresaId: string, hash: string, extension = ".pdf"): string {
  return `${empresaId}/${hash.slice(0, 2)}/${hash}${extension}`;
}

export async function guardarDocumento(
  ruta: string,
  contenido: Buffer,
  mime = "application/pdf"
): Promise<{ ruta: string; tamanoBytes: number }> {
  if (!haySupabase()) {
    const destino = path.join(DIR_LOCAL, ruta);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    return { ruta, tamanoBytes: contenido.length };
  }

  await asegurarBucket();
  const sb = await cliente();
  // `upsert: true` porque la ruta ES el hash: subir otra vez el mismo fichero
  // escribe exactamente los mismos bytes, y fallar ahí sería fallar por nada.
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(ruta, contenido, { contentType: mime, upsert: true });
  if (error) {
    console.error("Therefore: error subiendo el documento:", error.message);
    throw new Error("No se ha podido guardar el documento adjunto.");
  }
  return { ruta, tamanoBytes: contenido.length };
}

export async function leerDocumento(ruta: string): Promise<Buffer | null> {
  if (!haySupabase()) {
    const origen = path.join(DIR_LOCAL, ruta);
    return fs.existsSync(origen) ? fs.readFileSync(origen) : null;
  }
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).download(ruta);
  if (error || !data) {
    console.warn("Therefore: no se ha podido leer el documento:", ruta, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Enlace temporal para abrir el PDF desde el visor. */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!haySupabase()) return `/uploads/therefore/${ruta}`;
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD_ENLACE_S);
  if (error || !data) {
    console.warn("Therefore: no se ha podido firmar el enlace:", error?.message);
    return null;
  }
  return data.signedUrl;
}
