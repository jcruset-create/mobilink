/**
 * Qué cambia al editar una OTF: SOLO los campos que llegan.
 *
 * La ruta de edición escribía todos los campos de golpe, con null en los que
 * no venían: cambiar la base sin mandar el operario dejaba la OTF sin
 * operario, y sin notas, y sin fecha. Ahora un campo que no viene en el cuerpo
 * se queda como estaba, y uno que viene a null se vacía a propósito.
 */

/** Campo del cuerpo → columna, y cómo se limpia el valor. */
const CAMPOS: Record<string, { columna: string; valor: (v: unknown) => unknown }> = {
  clientName: { columna: `"clientName"`, valor: textoONulo },
  knownPlaceId: { columna: `"knownPlaceId"`, valor: numeroONulo },
  baseName: { columna: `"baseName"`, valor: textoONulo },
  direccion: { columna: `direccion`, valor: textoONulo },
  lat: { columna: `lat`, valor: numeroONulo },
  lng: { columna: `lng`, valor: numeroONulo },
  fechaProgramadaMs: { columna: `"fechaProgramadaMs"`, valor: numeroONulo },
  status: { columna: `status`, valor: textoONulo },
  assignedTechName: { columna: `"assignedTechName"`, valor: textoONulo },
  assignedVehicleName: { columna: `"assignedVehicleName"`, valor: textoONulo },
  webfleetVehicleId: { columna: `"webfleetVehicleId"`, valor: textoONulo },
  notas: { columna: `notas`, valor: textoONulo },
};

function textoONulo(v: unknown) {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

function numeroONulo(v: unknown) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * El UPDATE para los campos presentes en `body`; null si no hay nada que
 * cambiar. Las columnas salen de la lista de arriba, nunca del cuerpo. El
 * cliente no puede quedar vacío: una OTF sin cliente no se distingue en la
 * lista.
 */
export function sqlActualizarOtf(
  id: number,
  body: Record<string, unknown>,
  ahoraMs: number
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [campo, def] of Object.entries(CAMPOS)) {
    if (!Object.prototype.hasOwnProperty.call(body, campo)) continue;
    const valor = def.valor(body[campo]);
    if (campo === "clientName" && valor == null) continue;
    params.push(valor);
    sets.push(`${def.columna} = $${params.length}`);
  }
  if (sets.length === 0) return null;
  params.push(ahoraMs);
  sets.push(`"updatedAtMs" = $${params.length}`);
  return { sql: `UPDATE otf SET ${sets.join(", ")} WHERE id = $1`, params };
}

/**
 * Cambiar el estado de un trabajo de OTF desde la tablet, con su tiempo:
 * «Empezar» fija el inicio (la primera vez), «Finalizar» y «No realizado» el
 * final, y volver a «pendiente» borra los dos. El motivo solo se guarda con
 * «No realizado».
 */
export const ESTADOS_TRABAJO = ["pendiente", "en_proceso", "finalizado", "no_realizado"] as const;

export function sqlEstadoTrabajo(
  tid: number,
  status: string,
  motivo: unknown,
  ahoraMs: number
): { sql: string; params: unknown[] } {
  const m = status === "no_realizado" ? String(motivo ?? "").trim() || null : null;
  return {
    sql: `UPDATE otf_trabajos SET status = $2::text, "updatedAtMs" = $3::bigint,
         "iniciadoAtMs" = CASE
           WHEN $2::text = 'pendiente' THEN NULL
           WHEN $2::text = 'en_proceso' THEN COALESCE("iniciadoAtMs", $3::bigint)
           ELSE "iniciadoAtMs" END,
         "finalizadoAtMs" = CASE WHEN $2::text IN ('finalizado', 'no_realizado') THEN $3::bigint ELSE NULL END,
         "motivoNoRealizado" = $4::text
       WHERE id = $1 RETURNING *`,
    params: [tid, status, ahoraMs, m],
  };
}
