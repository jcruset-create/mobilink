/**
 * Quién recibe cada encuesta.
 *
 * ── El conductor y el cliente no son la misma persona ───────────────────────
 *
 * Y sin embargo en una asistencia de carretera muy a menudo comparten número:
 * quien llama suele ser el que está en el arcén. Por eso aquí NO se coge
 * `customerPhone` como respaldo del conductor. Ese campo es «el teléfono de
 * contacto de la asistencia», y usarlo para la encuesta de conductor
 * significaría, la mitad de las veces, mandarle al gestor de flota un
 * formulario que le pregunta qué tal le trataron en la cuneta.
 *
 * Cuando no hay teléfono de conductor, la respuesta es que no lo hay. Una
 * encuesta sin destinatario fiable es peor que ninguna encuesta.
 */

import db from "../db.ts";
import { normalizarTelefono } from "./telefonos.ts";

export { mismoTelefono, normalizarTelefono } from "./telefonos.ts";

/* ── Resolución ──────────────────────────────────────────────────────────── */

export type Destinatario =
  | { hay: true; telefono: string; normalizado: string; fuente: string }
  | { hay: false; motivo: "missing_recipient" | "assistance_not_found" | "otro_tenant" };

const SIN = (motivo: "missing_recipient" | "assistance_not_found" | "otro_tenant"): Destinatario =>
  ({ hay: false, motivo });

/**
 * ¿Es de este taller?
 *
 * Una asistencia sin `tallerId` es de la instalación de siempre y la ve
 * cualquiera: hay asistencias anteriores al multi-taller y dejarlas fuera
 * escondería histórico real.
 */
function esDelTaller(filaTallerId: unknown, tenantId: string | number | null | undefined): boolean {
  if (tenantId == null) return true;
  if (filaTallerId == null) return true;
  return String(filaTallerId) === String(tenantId);
}

/**
 * El teléfono del conductor.
 *
 * Fuente única: `roadside_backoffice.conductorTelefono`. Es dato que rellena la
 * oficina, así que puede faltar — y cuando falta se dice, no se inventa.
 */
export async function resolverDestinatarioConductor(
  assistanceId: number, tenantId: string | number | null,
): Promise<Destinatario> {
  const r = await db.query(
    `SELECT a."tallerId", b."conductorTelefono"
       FROM roadside_assistances a
       LEFT JOIN roadside_backoffice b ON b."assistanceId" = a.id
      WHERE a.id = $1`,
    [assistanceId],
  );
  const f = r.rows[0];
  if (!f) return SIN("assistance_not_found");
  if (!esDelTaller(f.tallerId, tenantId)) return SIN("otro_tenant");

  const normalizado = normalizarTelefono(f.conductorTelefono);
  if (!normalizado) return SIN("missing_recipient");
  return {
    hay: true,
    telefono: String(f.conductorTelefono).trim(),
    normalizado,
    fuente: "roadside_backoffice.conductorTelefono",
  };
}

/**
 * El teléfono del cliente que factura.
 *
 * Sale de `connect_clients.contactPhone` a través de `clienteFacturacionId`, no
 * de `customerPhone`: ése es el contacto de la asistencia, que en carretera es
 * casi siempre el conductor. Confundirlos es exactamente el error que este
 * módulo tiene que evitar.
 */
export async function resolverDestinatarioCliente(
  assistanceId: number, tenantId: string | number | null,
): Promise<Destinatario> {
  const r = await db.query(
    `SELECT a."tallerId", c."contactPhone"
       FROM roadside_assistances a
       LEFT JOIN connect_clients c ON c.id = a."clienteFacturacionId"
      WHERE a.id = $1`,
    [assistanceId],
  );
  const f = r.rows[0];
  if (!f) return SIN("assistance_not_found");
  if (!esDelTaller(f.tallerId, tenantId)) return SIN("otro_tenant");

  const normalizado = normalizarTelefono(f.contactPhone);
  if (!normalizado) return SIN("missing_recipient");
  return {
    hay: true,
    telefono: String(f.contactPhone).trim(),
    normalizado,
    fuente: "connect_clients.contactPhone",
  };
}
