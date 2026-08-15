/**
 * Informe de asistencia de Assist Central Pro (PDF).
 *
 * Mismo papel que el informe de cierre de Mobilink Assist, pero construido
 * con los datos de Connect, así que sirve igual para un taller FULL, LITE o
 * EXTERNAL. Deja constancia de la trazabilidad: qué taller, qué operario y
 * qué furgoneta hicieron el servicio, con la línea temporal y los tiempos.
 */

import PDFDocument from "pdfkit";
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import db from "../db.ts";
import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../supabase.ts";
import { computeLiteKpis, LITE_STATUS_LABELS, SERVICE_RESULT_LABELS } from "./liteRules.ts";
import { evidenciasDeAsistencia, firmaDeAsistencia } from "./evidence.ts";

const M = 40;
const AZUL = "#101a33";
const GRIS = "#64748b";
const LINEA = "#e2e8f0";

function fecha(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(Number(ms)).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
  });
}

function safeParse(v: unknown): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? {}); } catch { return {}; }
}

const EQUIVALENCIAS: Record<string, string> = {
  "→": ">", "←": "<", "↔": "-", "⇒": ">", "•": "·", "✓": "OK", "✗": "X",
  "⚠": "!", "≈": "~", "≤": "<=", "≥": ">=", "×": "x",
};

/**
 * Las fuentes estándar del PDF usan WinAnsi: cualquier carácter fuera de ese
 * juego (flechas, símbolos, emojis) sale como basura tipo "!'". Se sustituyen
 * los habituales y se descarta el resto en vez de imprimir ruido.
 */
function txt(v: unknown): string {
  return String(v ?? "")
    .replace(/[→←↔⇒•✓✗⚠≈≤≥×]/g, (c) => EQUIVALENCIAS[c] ?? "")
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF–—‘’“”…€]/g, "");
}

/**
 * Descarga una imagen y la normaliza para incrustarla; si falla, se omite sin
 * romper el PDF.
 *
 * Se reencodean con sharp: corrige la orientación EXIF, limpia metadatos y
 * deja un JPEG base sin submuestreo de color. Se reducen a 1200 px porque en
 * el papel no pasan de 150 pt y así el informe no se va a decenas de MB.
 *
 * OJO con la versión de PDFKit: la 0.19.0 leía mal la cabecera SOF del JPEG
 * (tomaba el identificador del primer componente en lugar del número de
 * componentes) y declaraba cualquier foto a color como /DeviceGray, así que
 * el visor la pintaba en gris y con bandas. Está corregido a partir de la
 * 0.19.1, que es la que fija el package.json.
 */
async function fetchImage(url: string, lado = 1200): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    try {
      return await sharp(raw)
        .rotate()
        .resize({ width: lado, height: lado, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82, chromaSubsampling: "4:4:4", progressive: false })
        .toBuffer();
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/**
 * @param opciones.incluirImportes  Si se imprime el coste del servicio.
 *
 * Por defecto NO se imprime. El informe archivado se sube al almacenamiento
 * con URL pública y se adjunta al expediente del taller, y desde que el motor
 * de tarifas rellena `finalCost` ese número es el precio de VENTA: lo que la
 * central le cobra a su cliente. Imprimirlo ahí le enseñaría al taller —y a
 * quien reciba el enlace— el margen de la central. El informe cuenta lo que
 * pasó; el dinero va en la factura.
 *
 * La ruta autenticada del panel sí lo pide, porque ahí quien mira es de la
 * central y tiene el permiso.
 */
export async function buildConnectReportPdf(
  assistanceId: number,
  opciones: { incluirImportes?: boolean } = {},
): Promise<{ buffer: Buffer; assistance: any }> {
  const r = await db.query(
    `SELECT ca.*, w.name AS "workshopName", w.phone AS "workshopPhone", w."integrationType",
            pc.name AS "providerName", cl.name AS "clientDisplayName", p.name AS "partnerName",
            ra."assignedTechName" AS "coreTech", ra."assignedVehicleName" AS "coreVehicle"
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
       LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
       LEFT JOIN connect_partners p ON p.id = ca."partnerId"
       LEFT JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
      WHERE ca.id = $1`,
    [assistanceId],
  );
  const a = r.rows[0];
  if (!a) throw new Error("Asistencia no encontrada");

  // Las evidencias vienen de los dos orígenes (APK Lite / WhatsApp y las
  // fotos del técnico de Mobilink Assist en el core), ya unificadas.
  const [historia, evidencias, firma, comunicaciones] = await Promise.all([
    db.query(
      `SELECT "fromStatus", "toStatus", "actorType", reason, "occurredAtMs"
         FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [assistanceId],
    ),
    evidenciasDeAsistencia(assistanceId),
    firmaDeAsistencia(assistanceId),
    db.query(
      `SELECT channel, direction, body, "byName", "createdAtMs"
         FROM connect_communications WHERE "assistanceId" = $1 ORDER BY id LIMIT 20`,
      [assistanceId],
    ),
  ]);
  const fotos = evidencias.filter((e) => e.esImagen).slice(0, 12);

  const vehicle = safeParse(a.vehicle);
  const requester = safeParse(a.requester);
  const loc = safeParse(a.locationDetails);
  const kpis = computeLiteKpis(
    historia.rows.map((h: any) => ({ toStatus: h.toStatus, occurredAtMs: Number(h.occurredAtMs) })),
    {
      acceptedAtMs: a.acceptedAtMs ? Number(a.acceptedAtMs) : null,
      slaDeadlineAtMs: a.slaDeadlineAtMs ? Number(a.slaDeadlineAtMs) : null,
    },
  );

  const doc = new PDFDocument({ margin: M, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const terminado = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const anchoUtil = doc.page.width - M * 2;

  function cabecera() {
    doc.rect(0, 0, doc.page.width, 62).fill(AZUL);
    try {
      const logo = path.join(process.cwd(), "public", "logo_horizontal.png");
      if (fs.existsSync(logo)) doc.image(logo, M, 14, { height: 34 });
    } catch { /* sin logo */ }
    doc.fillColor("#ffffff").fontSize(12).font("Helvetica-Bold")
      .text(`Informe de asistencia ${a.expedientNumber ?? `#${a.id}`}`, 280, 18,
        { width: doc.page.width - 280 - M, align: "right", lineBreak: false });
    doc.fillColor("#cbd5e1").fontSize(9).font("Helvetica")
      .text(fecha(a.createdAtMs), 280, 35, { width: doc.page.width - 280 - M, align: "right", lineBreak: false });
    doc.fillColor("#000000");
    doc.x = M;
    doc.y = 74;
  }
  cabecera();
  doc.on("pageAdded", cabecera);

  function titulo(t: string) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(AZUL).fontSize(11).font("Helvetica-Bold").text(txt(t), M, doc.y);
    doc.moveTo(M, doc.y + 2).lineTo(M + anchoUtil, doc.y + 2).lineWidth(0.8).stroke(LINEA);
    doc.moveDown(0.5);
    doc.fillColor("#000000").fontSize(9.5).font("Helvetica");
  }

  /** Dos columnas de pares etiqueta/valor. */
  function datos(lineas: [string, string][]) {
    const visibles = lineas.filter(([, v]) => v && v !== "-");
    if (!visibles.length) return;
    const colW = anchoUtil / 2 - 6;
    let y = doc.y;
    visibles.forEach(([k, v], i) => {
      const col = i % 2;
      const x = M + col * (colW + 12);
      if (col === 0 && i > 0) y += 16;
      if (y > doc.page.height - 90) { doc.addPage(); y = doc.y; }
      doc.fillColor(GRIS).fontSize(8).font("Helvetica").text(txt(k), x, y, { width: colW, lineBreak: false });
      doc.fillColor("#000000").fontSize(9.5).font("Helvetica-Bold")
        .text(txt(v), x, y + 8, { width: colW, height: 12, ellipsis: true, lineBreak: false });
    });
    doc.y = y + 22;
    doc.x = M;
  }

  // ── Estado y cliente ──
  titulo("Servicio");
  datos([
    // La vuelta al taller es detalle operativo del taller: en el informe, un
    // servicio que ya llegó al taller está sencillamente finalizado.
    ["Estado final", a.status === "at_workshop"
      ? "Finalizada (unidad de vuelta en el taller)"
      : (LITE_STATUS_LABELS as Record<string, string>)[a.status] ?? a.status],
    ["Tipo de asistencia", String(a.serviceType ?? "-")],
    ["Prioridad", a.priority === "urgente" ? "URGENTE" : "Normal"],
    ["Referencia externa", a.externalReference ?? "-"],
    ["Cliente / compañía", a.clientDisplayName ?? a.clientName ?? a.partnerName ?? "-"],
    ["Origen", String(a.origin ?? "-")],
  ]);

  titulo("Cliente y solicitante");
  datos([
    ["Cliente final", a.customerName || "-"],
    ["Teléfono", a.customerPhone || "-"],
    ["Solicitante", requester.name ?? "-"],
    ["Tel. solicitante", requester.phone ?? "-"],
    ["Email", requester.email ?? "-"],
    ["Idioma", requester.language ?? "-"],
  ]);

  // ── Trazabilidad: el bloque que pedía el negocio ──
  titulo("Quién ha hecho la asistencia");
  datos([
    ["Empresa de asistencia", a.providerName ?? "-"],
    ["Taller", a.workshopName ?? "-"],
    ["Teléfono del taller", a.workshopPhone ?? "-"],
    ["Producto", a.integrationType === "lite" ? "Mobilink Assist Lite"
      : a.integrationType === "external" ? "Taller externo" : "Mobilink Assist"],
    ["Operario", a.assignedTechName ?? a.liteUserName ?? a.coreTech ?? "-"],
    ["Furgoneta", [a.assignedVehicleName ?? a.coreVehicle, a.assignedVehiclePlate].filter(Boolean).join(" · ") || "-"],
  ]);

  titulo("Vehículo asistido");
  datos([
    ["Tipo", vehicle.type ?? "-"],
    ["Marca y modelo", [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "-"],
    ["Matrícula", vehicle.plate ?? "-"],
    ["VIN", vehicle.vin ?? "-"],
    ["Remolque", vehicle.trailer ? "Sí" : "-"],
    ["Mercancía peligrosa", vehicle.dangerousGoods ? "Sí" : "-"],
  ]);

  titulo("Ubicación");
  datos([
    ["Dirección", a.address || "-"],
    ["Coordenadas", a.latitude != null ? `${Number(a.latitude).toFixed(5)}, ${Number(a.longitude).toFixed(5)}` : "-"],
    ["Carretera / km", [loc.road, loc.km ? `km ${loc.km}` : null].filter(Boolean).join(" · ") || "-"],
    ["Sentido", loc.direction ?? "-"],
    ["Referencia", loc.placeRef ?? "-"],
  ]);

  if (a.description) {
    titulo("Incidencia");
    doc.fillColor("#000000").fontSize(9.5).font("Helvetica")
      .text(txt(a.description), M, doc.y, { width: anchoUtil });
    doc.moveDown(0.4);
  }

  // ── Línea temporal ──
  // Una fila por evento, todas alineadas en las mismas tres columnas. Ojo:
  // cada doc.text() avanza doc.y por su cuenta, así que la y de la fila se
  // fija antes de pintar y se restaura después (era lo que descolocaba y
  // estiraba la tabla).
  titulo("Línea temporal");
  const COL_FECHA = 100;
  const COL_ESTADO = 130;
  const ALTO_FILA = 13;
  doc.fillColor(GRIS).fontSize(7.5).font("Helvetica-Bold");
  const yEnc = doc.y;
  doc.text("FECHA Y HORA", M, yEnc, { width: COL_FECHA, lineBreak: false });
  doc.text("ESTADO", M + COL_FECHA + 8, yEnc, { width: COL_ESTADO, lineBreak: false });
  doc.text("DETALLE", M + COL_FECHA + COL_ESTADO + 16, yEnc,
    { width: anchoUtil - COL_FECHA - COL_ESTADO - 16, lineBreak: false });
  let yFila = yEnc + 11;
  for (const h of historia.rows) {
    if (yFila > doc.page.height - 70) { doc.addPage(); yFila = doc.y; }
    const etiqueta = (LITE_STATUS_LABELS as Record<string, string>)[h.toStatus] ?? h.toStatus;
    const detalle = h.reason ? String(h.reason) : `(${h.actorType})`;
    doc.fillColor(GRIS).fontSize(8).font("Helvetica")
      .text(fecha(Number(h.occurredAtMs)), M, yFila, { width: COL_FECHA, lineBreak: false });
    doc.fillColor("#0f172a").fontSize(8.5).font("Helvetica-Bold")
      .text(txt(etiqueta), M + COL_FECHA + 8, yFila, { width: COL_ESTADO, lineBreak: false, ellipsis: true });
    doc.fillColor(GRIS).fontSize(8).font("Helvetica")
      .text(txt(detalle), M + COL_FECHA + COL_ESTADO + 16, yFila,
        { width: anchoUtil - COL_FECHA - COL_ESTADO - 16, height: 10, lineBreak: false, ellipsis: true });
    doc.moveTo(M, yFila + ALTO_FILA - 3).lineTo(M + anchoUtil, yFila + ALTO_FILA - 3)
      .lineWidth(0.4).stroke(LINEA);
    yFila += ALTO_FILA;
  }
  doc.x = M;
  doc.y = yFila + 4;
  doc.fillColor("#000000");

  // ── Tiempos ──
  titulo("Tiempos del servicio");
  const min = (v: number | null) => (typeof v === "number" ? `${v} min` : "-");
  datos([
    ["Tiempo hasta la aceptación", min(kpis.acceptMin)],
    ["De la aceptación a la salida", min(kpis.acceptToEnRouteMin)],
    ["Desplazamiento", min(kpis.travelMin)],
    ["De la asignación a la llegada", min(kpis.assignToArrivalMin)],
    ["Tiempo de trabajo", min(kpis.workMin)],
    ["Tiempo total", min(kpis.totalMin)],
    ["Vuelta al taller", min(kpis.returnMin)],
    ["Ciclo completo", min(kpis.cycleMin)],
    ["SLA de llegada", kpis.slaMet == null ? "-" : kpis.slaMet ? "Cumplido" : "Incumplido"],
    ["Límite SLA", fecha(a.slaDeadlineAtMs)],
  ]);

  // ── Cierre ──
  if (a.resultCode || a.resolutionNotes || a.odometerKm != null) {
    titulo("Cierre del servicio");
    datos([
      ["Resultado", SERVICE_RESULT_LABELS[String(a.resultCode)] ?? a.resultCode ?? "-"],
      ["Kilómetros", a.odometerKm != null ? String(a.odometerKm) : "-"],
      ["Tiempo trabajado", a.workedMinutes != null ? `${a.workedMinutes} min` : "-"],
      ...(opciones.incluirImportes
        ? [["Coste", a.finalCost != null ? `${Number(a.finalCost).toFixed(2)} ${a.costCurrency ?? "EUR"}`
            : a.estimatedCost != null ? `${Number(a.estimatedCost).toFixed(2)} ${a.costCurrency ?? "EUR"} (estimado)` : "-"]]
        : []) as [string, string][],
    ]);
    if (a.resolutionNotes) {
      doc.fillColor("#000000").fontSize(9.5).font("Helvetica")
        .text(txt(a.resolutionNotes), M, doc.y, { width: anchoUtil });
      doc.moveDown(0.4);
    }
  }

  // ── Evidencias ──
  if (fotos.length) {
    titulo(`Evidencias (${fotos.length}${evidencias.length > fotos.length ? ` de ${evidencias.length}` : ""})`);
    // Cuadrícula de 3 columnas: cada foto entera, con su proporción original,
    // centrada dentro de un marco uniforme y con la etiqueta encima.
    const hueco = 8;
    const columnas = 3;
    const anchoCelda = (anchoUtil - hueco * (columnas - 1)) / columnas;
    const altoFoto = 150;
    const altoCelda = altoFoto + 22;
    let col = 0;
    let filaY = doc.y;
    let dibujadas = 0;
    for (const f of fotos) {
      const img = await fetchImage(f.url);
      if (!img) continue;
      if (col === 0 && filaY + altoCelda > doc.page.height - 60) { doc.addPage(); filaY = doc.y; }
      const x0 = M + col * (anchoCelda + hueco);
      doc.fillColor(GRIS).fontSize(6.5).font("Helvetica-Bold")
        .text(txt(f.label).toUpperCase(), x0, filaY, { width: anchoCelda, lineBreak: false, ellipsis: true });
      doc.roundedRect(x0, filaY + 10, anchoCelda, altoFoto, 3).lineWidth(0.8).stroke(LINEA);
      try {
        doc.image(img, x0 + 3, filaY + 13, {
          fit: [anchoCelda - 6, altoFoto - 6], align: "center", valign: "center",
        });
        dibujadas++;
      } catch { /* formato no soportado por el PDF */ }
      col = (col + 1) % columnas;
      if (col === 0) filaY += altoCelda;
    }
    doc.x = M;
    doc.y = (col === 0 ? filaY : filaY + altoCelda) + 4;
    doc.fillColor("#000000");

    // Lo que no es imagen (audios, vídeos, documentos) se lista con su enlace
    const otras = evidencias.filter((e) => !e.esImagen);
    if (otras.length) {
      doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
        .text(txt(`Otros adjuntos: ${otras.map((o) => o.label).join(", ")}`), M, doc.y, { width: anchoUtil });
      doc.moveDown(0.4);
    }
    if (dibujadas === 0) {
      doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
        .text("No se han podido incrustar las imágenes.", M, doc.y, { width: anchoUtil });
    }
  }

  // ── Firma ──
  if (firma) {
    if (doc.y > doc.page.height - 170) doc.addPage();
    titulo("Conformidad del cliente");
    const s = firma;
    // Igual que en la línea temporal: la y del bloque se fija antes de pintar,
    // porque cada doc.text() la va empujando hacia abajo.
    const yFirma = doc.y;
    const img = await fetchImage(s.url, 700);
    if (img) {
      try { doc.image(img, M, yFirma, { fit: [170, 70] }); } catch { /* firma no legible */ }
    }
    let yDatos = yFirma + 6;
    doc.fillColor(GRIS).fontSize(8).font("Helvetica")
      .text("Firmante", M + 200, yDatos, { lineBreak: false });
    yDatos += 11;
    doc.fillColor("#000000").fontSize(10).font("Helvetica-Bold")
      .text(txt(s.signerName ?? a.customerName ?? "-"), M + 200, yDatos,
        { width: anchoUtil - 200, lineBreak: false, ellipsis: true });
    yDatos += 14;
    if (s.signerDocument) {
      doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
        .text(txt(s.signerDocument), M + 200, yDatos, { lineBreak: false });
      yDatos += 12;
    }
    doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
      .text(fecha(s.signedAtMs), M + 200, yDatos, { lineBreak: false });
    doc.x = M;
    doc.y = yFirma + 84;
    doc.fillColor("#000000");
  }

  // ── Comunicaciones ──
  if (comunicaciones.rows.length) {
    titulo("Comunicaciones");
    for (const c of comunicaciones.rows) {
      if (doc.y > doc.page.height - 70) doc.addPage();
      doc.fillColor(GRIS).fontSize(8).font("Helvetica")
        .text(txt(`${fecha(Number(c.createdAtMs))} · ${c.byName ?? c.channel}`), M, doc.y, { width: anchoUtil });
      doc.fillColor("#000000").fontSize(9).font("Helvetica")
        .text(txt(String(c.body).slice(0, 300)), M, doc.y, { width: anchoUtil });
      doc.moveDown(0.3);
    }
  }

  doc.fillColor(GRIS).fontSize(7.5).font("Helvetica")
    .text(
      `Informe generado por Mobilink Assist Central Pro el ${fecha(Date.now())} · Asistencia #${a.id}`,
      M, doc.page.height - 55, { width: anchoUtil, align: "center" },
    );

  doc.end();
  return { buffer: await terminado, assistance: a };
}

/**
 * Genera el informe y lo guarda en la ficha de la asistencia (evidencia de
 * categoría "report"). Idempotente de verdad: la copia anterior se retira del
 * almacenamiento y de la ficha, así que solo queda un informe vigente y nunca
 * se sirve uno con un formato antiguo.
 */
export async function generarYGuardarInforme(assistanceId: number): Promise<string | null> {
  try {
    const { buffer } = await buildConnectReportPdf(assistanceId);
    const ruta = `connect-lite/${assistanceId}/informe_${Date.now()}.pdf`;
    const { error } = await supabase.storage
      .from(SUPABASE_ROADSIDE_BUCKET)
      .upload(ruta, buffer, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(error.message);
    const { data: pub } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(ruta);
    const now = Date.now();

    // Se retiran los informes anteriores antes de dejar el nuevo: primero de la
    // ficha (lo que ve la central) y luego del almacenamiento. Si el borrado
    // del fichero falla no se aborta nada: el informe vigente ya es el nuevo.
    const previos = await db.query(
      `UPDATE connect_assistance_files SET "deletedAtMs" = $2
        WHERE "assistanceId" = $1 AND category = 'report' AND "deletedAtMs" IS NULL
        RETURNING "storagePath"`,
      [assistanceId, now],
    );
    const rutasViejas = previos.rows.map((f: any) => f.storagePath).filter(Boolean);
    if (rutasViejas.length) {
      try { await supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).remove(rutasViejas); }
      catch { /* el fichero huérfano no impide nada */ }
    }

    await db.query(
      `UPDATE connect_assistances SET "reportUrl" = $1, "reportAtMs" = $2 WHERE id = $3`,
      [pub.publicUrl, now, assistanceId],
    );
    const ws = await db.query(`SELECT "workshopId" FROM connect_assistances WHERE id = $1`, [assistanceId]);
    await db.query(
      `INSERT INTO connect_assistance_files
         ("assistanceId", "workshopId", category, url, "storagePath", "fileName", "mimeType", "sizeBytes", "createdAtMs")
       VALUES ($1,$2,'report',$3,$4,$5,'application/pdf',$6,$7)`,
      [assistanceId, ws.rows[0]?.workshopId ?? null, pub.publicUrl, ruta,
       `Informe asistencia ${assistanceId}.pdf`, buffer.length, now],
    );
    return pub.publicUrl;
  } catch (err: any) {
    console.error(`[Connect] informe de la asistencia ${assistanceId}:`, err?.message);
    return null;
  }
}
