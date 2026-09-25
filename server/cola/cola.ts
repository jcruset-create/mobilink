/**
 * La cola de los operarios, contra la base de datos.
 *
 * La REGLA de la cola vive en `src/modules/colaEspera.ts`, compartida con el
 * panel y probada aparte.
 * Aquí está lo único que necesita hablar con PostgreSQL: mirar qué lleva un
 * operario para decidir detrás de qué entra lo nuevo, y soltar a los que
 * esperaban cuando la de delante se cierra.
 */

import db from "../db.ts";
import { comoEntraria, type AsistenciaEnCola } from "../../src/modules/colaEspera.ts";

/**
 * Las asistencias de un operario, con lo justo para situar la cola.
 *
 * Se piden TODAS las suyas sin filtrar por estado: la regla necesita ver
 * también las cerradas para saber que una que espera detrás de una cerrada ya
 * no espera. Se exporta porque el listado de la APK la usa para marcar cuál
 * está en espera, y ese listado esconde las cerradas.
 */
export async function asistenciasDelOperarioParaCola(
  tecnico: string
): Promise<AsistenciaEnCola[]> {
  const { rows } = await db.query(
    `SELECT id, "assignedTechName", status, "esperaTrasId"
       FROM roadside_assistances
      WHERE "assignedTechName" = $1
      ORDER BY id`,
    [tecnico]
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    assignedTechName: r.assignedTechName ?? null,
    status: r.status ?? null,
    esperaTrasId: r.esperaTrasId != null ? Number(r.esperaTrasId) : null,
  }));
}

/**
 * Detrás de qué asistencia entra ésta si se le asigna a ese operario.
 *
 * `null` si entra directa: el operario está libre, o la que lleva es ella
 * misma. Lo decide el SERVIDOR y no quien llama, a propósito: el panel puede
 * tener el listado de hace un minuto, y dos personas asignando a la vez desde
 * dos pantallas tendrían cada una su idea de quién está ocupado.
 *
 * Sin operario no hay cola: una asistencia sin asignar no espera a nadie.
 */
export async function trasQueEspera(
  asistenciaId: number | null,
  tecnico: string | null | undefined
): Promise<number | null> {
  const nombre = String(tecnico ?? "").trim();
  if (!nombre) return null;
  const entrada = comoEntraria(
    asistenciaId,
    nombre,
    await asistenciasDelOperarioParaCola(nombre)
  );
  return entrada.directa === false ? entrada.trasId : null;
}

/**
 * Suelta a las que esperaban detrás de una asistencia que acaba de cerrarse.
 *
 * Es limpieza, no lógica: quien mira si algo está en espera ya deduce que una
 * asistencia detrás de otra cerrada NO espera, así que si esto falla no cambia
 * nada de lo que se ve. Por eso puede ir en el enganche del cierre, que traga
 * sus errores, sin que un fallo deje a nadie esperando para siempre.
 *
 * Devuelve los ids que se han soltado, para poder anotarlo.
 */
export async function soltarCola(asistenciaId: number): Promise<number[]> {
  const { rows } = await db.query(
    `UPDATE roadside_assistances
        SET "esperaTrasId" = NULL, "updatedAtMs" = $2
      WHERE "esperaTrasId" = $1
      RETURNING id`,
    [asistenciaId, Date.now()]
  );
  return rows.map((r: any) => Number(r.id));
}
