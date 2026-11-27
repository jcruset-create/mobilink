/**
 * La lectura de la documentación de un alta: cuál se enseña y cuándo se hace.
 *
 * La IA lee las fotos del DNI y del carnet (número, caducidad, clases con su
 * fecha) y lo leído se guarda en el ENVÍO —la fila de `sea_employee_invites`—
 * con el que llegaron. A la ficha no pasa hasta que alguien pulsa «Pasar a la
 * ficha»: la IA informa, la persona decide. Eso no cambia aquí.
 *
 * ## Lo que se arregla
 *
 * 1. **Una lectura no desaparece porque se mande otro enlace.** La ficha
 *    miraba solo el último envío. Al pedir una actualización se crea un envío
 *    nuevo, sin leer, y la lectura del anterior —que sigue en la base— dejaba
 *    de verse: parecía que se había borrado. Ahora se enseña la más reciente
 *    que haya, diciendo si es de un envío anterior (por si han cambiado las
 *    fotos y conviene volver a leer).
 *
 * 2. **Se lee sola al recibir la ficha.** Antes había que acordarse de pulsar
 *    «Leer documentación». Ahora se lanza cuando el trabajador envía el
 *    formulario, DESPUÉS de contestarle: él no espera a la IA ni se entera si
 *    falla. Si falla, queda «sin leer» y el botón de siempre sigue ahí.
 *
 * Este fichero no sabe de IA ni de rutas: recibe con qué consultar y con qué
 * leer. Así se prueba contra Postgres con una lectura de mentira.
 */

import type { Lectura } from "./altaOperario.ts";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type LecturaVigente = {
  lectura: Lectura;
  leidoAt: string | null;
  /** No es del último envío: desde entonces se ha mandado otro enlace. */
  deEnvioAnterior: boolean;
};

const aIso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/**
 * La lectura que hay que enseñar de un empleado: la más reciente que exista,
 * sea del envío que sea. `null` si nunca se ha leído nada.
 */
export async function lecturaVigente(cx: Consultor, employeeId: string): Promise<LecturaVigente | null> {
  const { rows } = await cx.query(
    `SELECT i.lectura, i.leido_at,
            i.id <> (SELECT u.id FROM sea_employee_invites u
                      WHERE u.employee_id = $1
                      ORDER BY u.enviado_at DESC LIMIT 1) AS de_envio_anterior
       FROM sea_employee_invites i
      WHERE i.employee_id = $1 AND i.lectura IS NOT NULL
      ORDER BY i.enviado_at DESC
      LIMIT 1`,
    [employeeId]
  );
  const fila = rows[0];
  if (!fila?.lectura) return null;
  return {
    lectura: fila.lectura as Lectura,
    leidoAt: aIso(fila.leido_at),
    deEnvioAnterior: fila.de_envio_anterior === true,
  };
}

/** Apunta lo leído en un envío concreto. */
export async function guardarLectura(cx: Consultor, invitacionId: string, lectura: Lectura): Promise<void> {
  await cx.query(`UPDATE sea_employee_invites SET lectura = $2, leido_at = now() WHERE id = $1`, [
    invitacionId,
    JSON.stringify(lectura),
  ]);
}

export type ResultadoLectura = "leida" | "sin_ia" | "fallo";

/**
 * Lee la documentación de un envío recién recibido y la apunta EN ESE envío
 * (no «en el último»: mientras la IA lee puede haberse mandado otro enlace).
 *
 * Nunca lanza: se llama sin esperar, después de contestar al trabajador, y un
 * fallo aquí no puede tirar nada. Lo que no se haya leído se lee con el botón.
 */
export async function leerAlRecibir(
  cx: Consultor,
  envio: { employeeId: string; invitacionId: string },
  deps: { hayIA: () => boolean; leer: (employeeId: string) => Promise<Lectura> }
): Promise<ResultadoLectura> {
  try {
    if (!deps.hayIA()) return "sin_ia";
    const lectura = await deps.leer(envio.employeeId);
    await guardarLectura(cx, envio.invitacionId, lectura);
    return "leida";
  } catch (e) {
    console.error("[alta] no se ha podido leer la documentación al recibirla:", e instanceof Error ? e.message : e);
    return "fallo";
  }
}
