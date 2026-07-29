/**
 * Informe de asistencia de Assist Central Pro (PDF).
 *
 * Mismo papel que el informe de cierre de Mobilink Assist, pero construido
 * con los datos de Connect, así que sirve igual para un taller FULL, LITE o
 * EXTERNAL. Deja constancia de la trazabilidad: qué taller, qué operario y
 * qué furgoneta hicieron el servicio, con la línea temporal y los tiempos.
 */

import PDFDocument from "pdfkit";
import path from "node:path";
import fs from "node:fs";
import db from "../db.ts";
import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../supabase.ts";
import { computeLiteKpis, LITE_STATUS_LABELS, SERVICE_RESULT_LABELS } from "./liteRules.ts";

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

/** Descarga una imagen para incrustarla; si falla, se omite sin romper el PDF. */
async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildConnectReportPdf(assistanceId: number): Promise<{ buffer: Buffer; assistance: any }> {
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

  const [historia, ficheros, firma, comunicaciones] = await Promise.all([
    db.query(
      `SELECT "fromStatus", "toStatus", "actorType", reason, "occurredAtMs"
         FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [assistanceId],
    ),
    db.query(
      `SELECT category, url, "createdAtMs" FROM connect_assistance_files
        WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL AND category <> 'report'
        ORDER BY id LIMIT 8`,
      [assistanceId],
    ),
    db.query(
      `SELECT "signerName", "signerDocument", url, "signedAtMs"
         FROM connect_assistance_signatures WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 1`,
      [assistanceId],
    ),
    db.query(
      `SELECT channel, direction, body, "byName", "createdAtMs"
         FROM connect_communications WHERE "assistanceId" = $1 ORDER BY id LIMIT 20`,
      [assistanceId],
    ),
  ]);

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
    doc.fillColor(AZUL).fontSize(11).font("Helvetica-Bold").text(t, M, doc.y);
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
      doc.fillColor(GRIS).fontSize(8).font("Helvetica").text(k, x, y, { width: colW, lineBreak: false });
      doc.fillColor("#000000").fontSize(9.5).font("Helvetica-Bold")
        .text(v, x, y + 8, { width: colW, height: 12, ellipsis: true, lineBreak: false });
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
      .text(String(a.description), M, doc.y, { width: anchoUtil });
    doc.moveDown(0.4);
  }

  // ── Línea temporal ──
  titulo("Línea temporal");
  for (const h of historia.rows) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const etiqueta = (LITE_STATUS_LABELS as Record<string, string>)[h.toStatus] ?? h.toStatus;
    doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
      .text(fecha(Number(h.occurredAtMs)), M, doc.y, { width: 105, lineBreak: false });
    doc.fillColor("#000000").fontSize(9.5).font("Helvetica-Bold")
      .text(etiqueta, M + 110, doc.y, { width: 130, lineBreak: false });
    doc.fillColor(GRIS).fontSize(8.5).font("Helvetica")
      .text(h.reason ? String(h.reason).slice(0, 90) : `(${h.actorType})`, M + 245, doc.y,
        { width: anchoUtil - 245, lineBreak: false });
    doc.y += 14;
  }
  doc.x = M;

  // ── Tiempos ──
  titulo("Tiempos del servicio");
  const min = (v: number | null) => (typeof v === "number" ? `${v} min` : "-");
  datos([
    ["Asignación → aceptación", min(kpis.acceptMin)],
    ["Aceptación → en camino", min(kpis.acceptToEnRouteMin)],
    ["Desplazamiento", min(kpis.travelMin)],
    ["Asignación → llegada", min(kpis.assignToArrivalMin)],
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
      ["Coste", a.finalCost != null ? `${Number(a.finalCost).toFixed(2)} ${a.costCurrency ?? "EUR"}`
        : a.estimatedCost != null ? `${Number(a.estimatedCost).toFixed(2)} ${a.costCurrency ?? "EUR"} (estimado)` : "-"],
    ]);
    if (a.resolutionNotes) {
      doc.fillColor("#000000").fontSize(9.5).font("Helvetica")
        .text(String(a.resolutionNotes), M, doc.y, { width: anchoUtil });
      doc.moveDown(0.4);
    }
  }

  // ── Evidencias ──
  if (ficheros.rows.length) {
    titulo(`Evidencias (${ficheros.rows.length})`);
    let x = M;
    let y = doc.y;
    const lado = 105;
    for (const f of ficheros.rows) {
      const img = await fetchImage(f.url);
      if (!img) continue;
      if (x + lado > M + anchoUtil) { x = M; y += lado + 16; }
      if (y + lado > doc.page.height - 70) { doc.addPage(); x = M; y = doc.y; }
      try {
        doc.image(img, x, y, { fit: [lado, lado], align: "center" });
        doc.fillColor(GRIS).fontSize(7.5).font("Helvetica")
          .text(String(f.category ?? ""), x, y + lado + 2, { width: lado, lineBreak: false });
      } catch { /* imagen no soportada */ }
      x += lado + 10;
    }
    doc.y = y + lado + 18;
    doc.x = M;
  }

  // ── Firma ──
  if (firma.rows[0]) {
    if (doc.y > doc.page.height - 170) doc.addPage();
    titulo("Conformidad del cliente");
    const s = firma.rows[0];
    const img = await fetchImage(s.url);
    if (img) {
      try { doc.image(img, M, doc.y, { fit: [170, 70] }); } catch { /* firma no legible */ }
    }
    doc.fillColor(GRIS).fontSize(8).font("Helvetica").text("Firmante", M + 200, doc.y);
    doc.fillColor("#000000").fontSize(10).font("Helvetica-Bold").text(s.signerName, M + 200, doc.y + 10);
    if (s.signerDocument) {
      doc.fillColor(GRIS).fontSize(8.5).font("Helvetica").text(s.signerDocument, M + 200, doc.y + 4);
    }
    doc.fillColor(GRIS).fontSize(8.5).font("Helvetica").text(fecha(Number(s.signedAtMs)), M + 200, doc.y + 2);
    doc.y += 80;
    doc.x = M;
  }

  // ── Comunicaciones ──
  if (comunicaciones.rows.length) {
    titulo("Comunicaciones");
    for (const c of comunicaciones.rows) {
      if (doc.y > doc.page.height - 70) doc.addPage();
      doc.fillColor(GRIS).fontSize(8).font("Helvetica")
        .text(`${fecha(Number(c.createdAtMs))} · ${c.byName ?? c.channel}`, M, doc.y, { width: anchoUtil });
      doc.fillColor("#000000").fontSize(9).font("Helvetica")
        .text(String(c.body).slice(0, 300), M, doc.y, { width: anchoUtil });
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
 * categoría "report"). Idempotente: regenerarlo sustituye la URL anterior.
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
