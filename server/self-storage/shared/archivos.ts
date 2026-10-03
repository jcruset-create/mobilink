/**
 * Ficheros del módulo (PDF de contratos y facturas) en Supabase Storage,
 * bucket PRIVADO `self-storage`. Nunca se publica una URL: la API comprueba a
 * quién pertenece el documento y lo sirve ella.
 *
 * Rutas:
 *   invoices/{customer_id}/{year}/{invoice_number}.pdf
 *   contracts/{customer_id}/{contract_number}/{tipo}-v{n}.pdf
 *
 * Sin credenciales de Supabase (o con SELF_STORAGE_STORAGE_LOCAL=1, que es lo
 * que usan las pruebas) se guarda en disco, bajo server/uploads/self-storage.
 * Mismo molde que recepciones/storage.ts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BUCKET = process.env.SELF_STORAGE_BUCKET || "self-storage";
const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "self-storage");

function haySupabase(): boolean {
  if (process.env.SELF_STORAGE_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

async function cliente() {
  const { supabase } = await import("../../supabase.ts");
  return supabase;
}

async function asegurarBucket(): Promise<void> {
  if (bucketListo || !haySupabase()) return;
  try {
    const sb = await cliente();
    const { data } = await sb.storage.getBucket(BUCKET);
    if (!data) await sb.storage.createBucket(BUCKET, { public: false });
  } catch (e) {
    console.warn("Self Storage: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

export const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** Una ruta no puede salirse de su carpeta. */
function rutaSegura(ruta: string): string {
  if (ruta.includes("..") || ruta.startsWith("/") || !/^[\w./-]+$/.test(ruta)) throw new Error(`Ruta de fichero no válida: ${ruta}`);
  return ruta;
}

export async function guardar(ruta: string, contenido: Buffer, tipo = "application/pdf"): Promise<void> {
  rutaSegura(ruta);
  if (haySupabase()) {
    await asegurarBucket();
    const sb = await cliente();
    const { error } = await sb.storage.from(BUCKET).upload(ruta, contenido, { contentType: tipo, upsert: false });
    // Ya existe: el nombre lleva la huella del contrato o el número de una
    // factura emitida (inmutable), así que es el mismo documento. No se pisa.
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`No se ha podido guardar ${ruta}: ${error.message}`);
    return;
  }
  const destino = path.join(DIR_LOCAL, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, contenido);
}

export async function leer(ruta: string): Promise<Buffer | null> {
  rutaSegura(ruta);
  if (haySupabase()) {
    const sb = await cliente();
    const { data, error } = await sb.storage.from(BUCKET).download(ruta);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  const origen = path.join(DIR_LOCAL, ruta);
  return fs.existsSync(origen) ? fs.readFileSync(origen) : null;
}
