/**
 * Dónde viven los escaneos: el fichero que sube el usuario y cada página
 * separada.
 *
 * Copia de `server/recepciones/storage.ts`, por los mismos motivos: bucket
 * **privado** con enlaces firmados, porque una OR lleva matrícula, cliente y
 * lo que se hizo en el vehículo. Y la ruta ES el hash del contenido, así que
 * la misma hoja subida dos veces se guarda una sola vez.
 *
 * Sin Supabase configurado —desarrollo y pruebas— se guarda en disco bajo
 * `server/uploads/or-manuales`. `OR_MANUALES_STORAGE_LOCAL=1` fuerza el disco
 * aunque haya credenciales: lo necesita la CI, que define un Supabase ficticio.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BUCKET = process.env.OR_MANUALES_DOCUMENTS_BUCKET || "or-manuales-documentos";
const CADUCIDAD_ENLACE_S = 60 * 15;
const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "or-manuales");

function haySupabase(): boolean {
  if (process.env.OR_MANUALES_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

/** El cliente se carga tarde: `server/supabase.ts` revienta al importarse sin credenciales. */
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
      console.log(`OR Manuales: creado el bucket privado ${BUCKET}`);
    }
  } catch (e) {
    console.warn("OR Manuales: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

/** El hash del contenido. Es la identidad del fichero en todo el módulo. */
export function hashDeFichero(contenido: Buffer): string {
  return crypto.createHash("sha256").update(contenido).digest("hex");
}

/**
 * `<empresa>/<carpeta>/<hash[0:2]>/<hash>.pdf`.
 *
 * La carpeta separa lo que sube el usuario (`originales`) de las páginas ya
 * partidas (`paginas`). El encargo habla de una estructura
 * `OR_MANUALES/BLOC_002_1026_1050/OR_1026.pdf`; esa jerarquía es LÓGICA y vive
 * en la base —bloc → OR → documento— porque aquí la ruta tiene que ser el hash
 * para que el mismo fichero no se guarde dos veces, y porque una hoja puede
 * cambiar de bloc al reasignarla y mover objetos de sitio en el bucket para
 * eso sería pedir un fallo. El nombre bonito se conserva en `nombre_archivo`
 * y es el que se ve y con el que se descarga.
 */
export function rutaDocumento(
  empresaId: string,
  hash: string,
  carpeta: "originales" | "paginas" = "paginas",
  extension = ".pdf"
): string {
  return `${empresaId}/${carpeta}/${hash.slice(0, 2)}/${hash}${extension}`;
}

/** La extensión que le toca a un tipo MIME de los que admite el módulo. */
export function extensionDe(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  return ".pdf";
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
  const { error } = await sb.storage.from(BUCKET).upload(ruta, contenido, { contentType: mime, upsert: true });
  if (error) {
    console.error("OR Manuales: error subiendo el documento:", error.message);
    throw new Error("No se ha podido guardar el documento.");
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
    console.warn("OR Manuales: no se ha podido leer el documento:", ruta, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Enlace temporal, para abrir el documento desde el visor del sistema. */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!haySupabase()) return `/uploads/or-manuales/${ruta}`;
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD_ENLACE_S);
  if (error || !data) {
    console.warn("OR Manuales: no se ha podido firmar el enlace:", error?.message);
    return null;
  }
  return data.signedUrl;
}
