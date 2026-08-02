/**
 * Evidencias de una asistencia de Central Pro, vengan de donde vengan.
 *
 * Hay dos orígenes según el producto del taller y nadie debería tener que
 * saberlo para verlas:
 *   · `connect_assistance_files`  → APK Lite, capturas de WhatsApp e informes.
 *   · `roadside_assistance_files` → fotos y firma del técnico de Mobilink
 *     Assist, que trabaja sobre la asistencia del core.
 *
 * Este módulo las unifica para el seguimiento, la ficha y el informe.
 */

import db from "../db.ts";

export interface Evidencia {
  id: string;
  origen: "connect" | "assist";
  category: string;
  label: string;
  url: string;
  fileName: string | null;
  createdAtMs: number;
  /** Solo para imágenes: sirve para decidir si se incrusta en el PDF. */
  esImagen: boolean;
}

export interface Firma {
  signerName: string | null;
  signerDocument: string | null;
  url: string;
  signedAtMs: number | null;
  origen: "connect" | "assist";
}

/** Nombre legible de los tipos de archivo del core. */
const ETIQUETAS_CORE: Record<string, string> = {
  foto_averia: "Avería",
  foto_reparacion: "Trabajo realizado",
  foto_extra: "Fotografía",
  foto_or: "Orden de reparación",
  matricula_camion: "Matrícula",
  matricula_remolque: "Matrícula del remolque",
  firma: "Firma",
  whatsapp: "WhatsApp",
  whatsapp_image: "WhatsApp · imagen",
  whatsapp_video: "WhatsApp · vídeo",
  whatsapp_audio: "WhatsApp · audio",
  whatsapp_document: "WhatsApp · documento",
};

/** Nombre legible de las categorías propias de Connect (APK Lite). */
const ETIQUETAS_CONNECT: Record<string, string> = {
  arrival: "Vehículo al llegar",
  damage: "Daño o avería",
  work: "Trabajo realizado",
  part: "Pieza sustituida",
  finished: "Vehículo finalizado",
  document: "Documento",
  signature: "Firma",
  report: "Informe",
  other: "Otros",
};

const NO_IMAGEN = /\.(mp4|mov|webm|m4a|mp3|ogg|opus|oga|pdf|doc|docx)(\?|$)/i;

function esImagenUrl(url: string, mime?: string | null): boolean {
  if (mime) return mime.startsWith("image/");
  return !NO_IMAGEN.test(url);
}

/**
 * Todas las evidencias de la asistencia, ordenadas por fecha.
 * `incluirInformes` en false deja fuera los PDF de informe (no son evidencia
 * del servicio y no deben salir dentro del propio informe).
 */
export async function evidenciasDeAsistencia(
  assistanceId: number,
  opts: { incluirInformes?: boolean } = {},
): Promise<Evidencia[]> {
  const a = await db.query(
    `SELECT "coreAssistanceId" FROM connect_assistances WHERE id = $1`,
    [assistanceId],
  );
  if (!a.rows[0]) return [];
  const coreId = a.rows[0].coreAssistanceId;

  const propias = await db.query(
    `SELECT id, category, url, "fileName", "mimeType", "createdAtMs"
       FROM connect_assistance_files
      WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL
      ORDER BY id`,
    [assistanceId],
  );

  const evidencias: Evidencia[] = propias.rows
    .filter((f: any) => opts.incluirInformes || f.category !== "report")
    .map((f: any) => ({
      id: `c${f.id}`,
      origen: "connect" as const,
      category: f.category,
      label: ETIQUETAS_CONNECT[f.category] ?? f.category,
      url: f.url,
      fileName: f.fileName ?? null,
      createdAtMs: Number(f.createdAtMs),
      esImagen: esImagenUrl(f.url, f.mimeType),
    }));

  if (coreId) {
    const core = await db.query(
      `SELECT id, kind, url, "fileName", "createdAtMs"
         FROM roadside_assistance_files
        WHERE "assistanceId" = $1 AND kind <> 'firma'
        ORDER BY id`,
      [coreId],
    );
    for (const f of core.rows) {
      evidencias.push({
        id: `a${f.id}`,
        origen: "assist",
        category: f.kind,
        label: ETIQUETAS_CORE[f.kind] ?? f.kind,
        url: f.url,
        fileName: f.fileName ?? null,
        createdAtMs: Number(f.createdAtMs),
        esImagen: esImagenUrl(f.url),
      });
    }
  }

  return evidencias.sort((x, y) => x.createdAtMs - y.createdAtMs);
}

/**
 * Firma del cliente: la de Connect (APK Lite) o, si no hay, la que dejó el
 * técnico en Mobilink Assist.
 */
export async function firmaDeAsistencia(assistanceId: number): Promise<Firma | null> {
  const propia = await db.query(
    `SELECT "signerName", "signerDocument", url, "signedAtMs"
       FROM connect_assistance_signatures WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 1`,
    [assistanceId],
  );
  if (propia.rows[0]) {
    return {
      signerName: propia.rows[0].signerName,
      signerDocument: propia.rows[0].signerDocument,
      url: propia.rows[0].url,
      signedAtMs: propia.rows[0].signedAtMs ? Number(propia.rows[0].signedAtMs) : null,
      origen: "connect",
    };
  }

  const a = await db.query(`SELECT "coreAssistanceId" FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const coreId = a.rows[0]?.coreAssistanceId;
  if (!coreId) return null;

  const core = await db.query(
    `SELECT f.url, f."createdAtMs", ra."customerName"
       FROM roadside_assistance_files f
       JOIN roadside_assistances ra ON ra.id = f."assistanceId"
      WHERE f."assistanceId" = $1 AND f.kind = 'firma' ORDER BY f.id DESC LIMIT 1`,
    [coreId],
  );
  if (!core.rows[0]) return null;
  return {
    signerName: core.rows[0].customerName || null,
    signerDocument: null,
    url: core.rows[0].url,
    signedAtMs: Number(core.rows[0].createdAtMs),
    origen: "assist",
  };
}
