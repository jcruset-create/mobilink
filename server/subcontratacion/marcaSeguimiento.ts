/**
 * Asistencias subcontratadas: la marca «sin seguimiento» y la autorización.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * El flujo operativo de Assist tiene ocho estados y los va marcando el operario
 * desde la APK. Cuando el servicio lo hace un taller subcontratado no hay
 * operario nuestro: nadie manda esos estados y la asistencia se queda en
 * «Asignada» para siempre. Comprobado que el flujo NO distingue subcontratadas
 * —server/cierre/ no menciona proveedorTallerId—, así que hoy dependen de que
 * alguien las mueva a mano paso por paso, o se quedan colgadas.
 *
 * ── Por qué una marca y no un estado ───────────────────────────────────────
 *
 * «Sin seguimiento» NO entra en ROADSIDE_ASSISTANCE_STATUS_FLOW. Un estado
 * nuevo tocaría los contadores de la pantalla, el PDF, el espejo económico de
 * Connect y la página pública de seguimiento. Una marca ortogonal no toca
 * ninguno de los cuatro: el estado operativo sigue siendo el que era y esto
 * solo dice que nadie lo va a ir moviendo.
 *
 * Es además el mismo principio que ya sigue el expediente administrativo, que
 * lleva escrito en su propia pantalla «Independiente del estado del servicio».
 *
 * Las funciones de aquí son puras a propósito: se prueban sin PostgreSQL.
 */

/** Lo que hace falta saber de una asistencia para decidir sobre la marca. */
export type AsistenciaParaMarca = {
  status?: string | null;
  proveedorTallerId?: number | null;
  sinSeguimiento?: boolean | null;
  finishedAtMs?: number | null;
  cancelledAtMs?: number | null;
};

/** Estados en los que el servicio ya no está en curso. */
const CERRADOS = new Set([
  "finalizada",
  "en_camino_base",
  "llegada_taller",
  "cancelada",
  "redirigida",
]);

export type Veredicto = { ok: true } | { ok: false; motivo: string };

function estaCerrada(a: AsistenciaParaMarca): boolean {
  return a.finishedAtMs != null || CERRADOS.has(String(a.status ?? ""));
}

/**
 * ¿Se puede marcar «sin seguimiento»?
 *
 * Solo en subcontratadas: en una propia hay un operario con la APK, y quitarle
 * el seguimiento sería esconder información que sí existe.
 *
 * Y solo mientras el servicio está en curso. Marcarla cuando ya está cerrada no
 * cambia nada y deja el dato mintiendo sobre cómo se gestionó.
 */
export function puedeMarcarSinSeguimiento(a: AsistenciaParaMarca): Veredicto {
  if (a.proveedorTallerId == null) {
    return {
      ok: false,
      motivo:
        "Solo las asistencias con taller subcontratado pueden ir sin seguimiento.",
    };
  }
  if (a.cancelledAtMs != null) {
    return { ok: false, motivo: "La asistencia está cancelada." };
  }
  if (estaCerrada(a)) {
    return { ok: false, motivo: "El servicio ya está cerrado." };
  }
  return { ok: true };
}

/**
 * ¿Se puede quitar la marca?
 *
 * Se puede, y a propósito: se marca por error, o el taller acaba pasándole el
 * servicio a un operario nuestro. Irreversible obligaría a borrar la asistencia
 * y rehacerla, que es peor que el problema.
 *
 * Con el servicio ya cerrado no: reabrir el seguimiento de algo terminado no
 * sirve para nada y confunde a quien lo mire después.
 */
export function puedeQuitarSinSeguimiento(a: AsistenciaParaMarca): Veredicto {
  if (a.sinSeguimiento !== true) {
    return { ok: false, motivo: "La asistencia ya tiene seguimiento." };
  }
  if (estaCerrada(a)) {
    return { ok: false, motivo: "El servicio ya está cerrado." };
  }
  return { ok: true };
}

/**
 * El número de autorización que se le da al taller subcontratado.
 *
 * Sale del número de asistencia y NO de un contador propio: inventar una
 * segunda numeración obliga a reconciliar dos series, y el nº de asistencia ya
 * es único, corto, lo ve el operador en pantalla y viaja en el PDF.
 *
 * Aun así se guarda en su propia columna en vez de derivarlo del id cada vez.
 * El día que haya que autorizar dos veces el mismo servicio a dos talleres, o
 * que un proveedor exija su formato, una columna se amplía y un id no. Y hace
 * falta poder BUSCAR por él cuando llegue la factura con ese número escrito.
 *
 * El prefijo distingue de un vistazo esta autorización —la que damos NOSOTROS
 * al taller— de `solicitanteAutorizacion`, que es la que nos dan a nosotros la
 * aseguradora o el gestor de flota. Son dos cosas distintas y confundirlas es
 * un lío de facturación.
 */
export function autorizacionParaTaller(assistanceId: number): string {
  return `A-${assistanceId}`;
}
