/**
 * Back office de la asistencia en Central Pro (contactos, empresas,
 * operativa, vehículo y facturación).
 *
 * Una sola verdad por asistencia: si la asistencia está inyectada en el core
 * (taller con Mobilink Assist), se lee y escribe la MISMA fila que usa el
 * back office de Assist (`roadside_backoffice`), de modo que lo que rellena
 * la central lo ve el taller y al revés. Las asistencias sin core (Lite,
 * externas o manuales sin asignar) usan su propia tabla.
 */

import db from "../db.ts";

/** Campos del back office, en el mismo orden que en Mobilink Assist. */
export const BACKOFFICE_FIELDS = [
  // Contactos
  "solicitanteNombre", "solicitanteTelefono", "solicitanteWhatsapp", "solicitanteEmail",
  "conductorTelefono", "responsableNombre", "responsableTelefono", "responsableCargo",
  "autorizadorNombre", "autorizadorTelefono", "autorizadorCargo",
  // Empresas
  "empresaSolicitanteNombre", "empresaSolicitanteTelefono", "empresaSolicitanteEmail",
  "empresaServicioNombre", "empresaServicioCif", "empresaServicioTelefono",
  "empresaFacturacionNombre", "empresaFacturacionCif", "empresaFacturacionEmail",
  "expedienteExterno", "referenciaCliente", "referenciaAutorizacion",
  // Operativa
  "tiposAsistencia", "tipoVehiculo", "estadoVehiculo", "ubicacionIncidencia",
  // Vehículo
  "marca", "modelo", "color", "vin", "kilometraje", "medidaNeumatico",
  "ejeAfectado", "posicionRueda", "vehiculoCargado", "mercancia", "adr",
  // Facturación
  "facturable", "pendienteAutorizacion", "garantia", "interna",
  "importeAcordado", "observacionesFacturacion",
] as const;

export type BackofficeField = (typeof BACKOFFICE_FIELDS)[number];

const NUMERICOS = new Set(["kilometraje", "importeAcordado"]);
const BOOLEANOS = new Set(["vehiculoCargado", "adr", "facturable", "pendienteAutorizacion", "garantia", "interna"]);

/** Dónde vive el back office de esta asistencia. */
async function destino(assistanceId: number): Promise<
  { tabla: "roadside_backoffice"; clave: number } | { tabla: "connect_assistance_backoffice"; clave: number } | null
> {
  const r = await db.query(`SELECT "coreAssistanceId" FROM connect_assistances WHERE id = $1`, [assistanceId]);
  if (!r.rows[0]) return null;
  const coreId = r.rows[0].coreAssistanceId;
  return coreId
    ? { tabla: "roadside_backoffice", clave: Number(coreId) }
    : { tabla: "connect_assistance_backoffice", clave: assistanceId };
}

function normalizar(fila: any): Record<string, any> | null {
  if (!fila) return null;
  const salida: Record<string, any> = {};
  for (const campo of BACKOFFICE_FIELDS) {
    let v = fila[campo];
    if (campo === "tiposAsistencia" && typeof v === "string") {
      try { v = JSON.parse(v); } catch { v = v ? [v] : []; }
    }
    if (campo === "importeAcordado" && v != null) v = Number(v);
    salida[campo] = v ?? null;
  }
  salida.updatedAtMs = fila.updatedAtMs ? Number(fila.updatedAtMs) : null;
  return salida;
}

export async function leerBackoffice(assistanceId: number): Promise<{ data: Record<string, any> | null; origen: string } | null> {
  const d = await destino(assistanceId);
  if (!d) return null;
  const r = await db.query(`SELECT * FROM ${d.tabla} WHERE "assistanceId" = $1`, [d.clave]);
  return {
    data: normalizar(r.rows[0]),
    origen: d.tabla === "roadside_backoffice" ? "assist" : "connect",
  };
}

/** ¿Trae algo aprovechable? Evita crear filas vacías. */
export function tieneDatos(b: any): boolean {
  if (!b || typeof b !== "object") return false;
  for (const [k, v] of Object.entries(b)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length > 0) return true; continue; }
    if (typeof v === "string") { if (v.trim() !== "") return true; continue; }
    if (typeof v === "boolean") { if (k !== "facturable" && v) return true; continue; }
    if (typeof v === "number") return true;
  }
  return false;
}

export async function guardarBackoffice(assistanceId: number, entrada: Record<string, any>): Promise<Record<string, any> | null> {
  const d = await destino(assistanceId);
  if (!d) return null;

  const valores: Record<string, any> = {};
  for (const campo of BACKOFFICE_FIELDS) {
    if (!(campo in entrada)) continue;
    let v = entrada[campo];
    if (campo === "tiposAsistencia") v = JSON.stringify(Array.isArray(v) ? v : []);
    else if (NUMERICOS.has(campo)) v = v === "" || v == null ? null : Number(v);
    else if (BOOLEANOS.has(campo)) v = typeof v === "boolean" ? v : null;
    else v = v === "" ? null : v;
    valores[campo] = v;
  }
  if (Object.keys(valores).length === 0) return (await leerBackoffice(assistanceId))?.data ?? null;

  const now = Date.now();
  const existe = await db.query(`SELECT id FROM ${d.tabla} WHERE "assistanceId" = $1`, [d.clave]);

  if (!existe.rows[0]) {
    if (!tieneDatos(entrada)) return null;
    const columnas = Object.keys(valores);
    const marcas = columnas.map((_, i) => `$${i + 2}`);
    await db.query(
      `INSERT INTO ${d.tabla} ("assistanceId", ${columnas.map((c) => `"${c}"`).join(", ")}, "createdAtMs", "updatedAtMs")
       VALUES ($1, ${marcas.join(", ")}, $${columnas.length + 2}, $${columnas.length + 2})`,
      [d.clave, ...columnas.map((c) => valores[c]), now],
    );
  } else {
    const columnas = Object.keys(valores);
    const sets = columnas.map((c, i) => `"${c}" = $${i + 2}`);
    await db.query(
      `UPDATE ${d.tabla} SET ${sets.join(", ")}, "updatedAtMs" = $${columnas.length + 2} WHERE "assistanceId" = $1`,
      [d.clave, ...columnas.map((c) => valores[c]), now],
    );
  }
  return (await leerBackoffice(assistanceId))?.data ?? null;
}
