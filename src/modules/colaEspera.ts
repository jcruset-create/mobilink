/**
 * La cola de un operario: qué asistencia lleva ahora y cuál espera turno.
 *
 * Vive en `src/modules` porque la usan los dos lados: el panel, para pintar la
 * que espera y avisar antes de asignar, y el servidor, para decidir detrás de
 * quién entra. Es el sitio donde este proyecto ya pone las reglas compartidas
 * —`recepcionVehiculo.ts`, que importa `server/recepcionVehiculos/router.ts`—
 * y así la cola no se calcula de dos maneras distintas según quién mire.
 *
 * Sin dependencias, además, por lo mismo que `server/cierre/elegibilidad.ts`:
 * lo que habla con la base importa `db.ts`, que revienta al cargarse sin
 * `DATABASE_URL`. Esta regla es pura y se prueba en CI sin levantar nada.
 *
 * ── La decisión de diseño que sostiene todo esto ──────────────────────────
 *
 * «Estar en espera» NO se guarda. Lo que se guarda es DETRÁS DE QUÉ se espera
 * —`esperaTrasId`— y lo demás se deduce: una asistencia está en espera si
 * aquella por la que espera sigue abierta.
 *
 * La alternativa era una marca booleana que alguien tuviera que apagar al
 * cerrar la anterior, con un enganche posterior al cierre. Pero esos enganches
 * están hechos para no tumbar la petición: si uno falla, se anota en el log y
 * se sigue. Aplicado a esto, un fallo dejaría la asistencia en espera PARA
 * SIEMPRE, y el operario sin trabajo sin que nadie se entere.
 *
 * Deduciéndolo no hay nada que pueda quedarse a medias: en cuanto la anterior
 * se cierra, la siguiente deja de estar en espera sola, la mire quien la mire.
 * Lo único que hace el enganche del cierre es limpiar la columna, y si ese
 * limpiado falla no cambia nada de lo que se ve.
 */

/** Lo que hace falta saber de una asistencia para situarla en la cola. */
export type AsistenciaEnCola = {
  id: number;
  assignedTechName?: string | null;
  status?: string | null;
  /** Detrás de qué asistencia espera. `null` si no espera a nadie. */
  esperaTrasId?: number | null;
};

/**
 * Estados en los que una asistencia ya no ocupa a su operario.
 *
 * Ojo con «finalizada»: NO está en la lista. El operario sigue con ella hasta
 * que llega al taller —tiene que cargar, volver y dejar el material— así que
 * darle la siguiente al finalizar sería darle dos a la vez.
 */
const CERRADOS = new Set(["llegada_taller", "cancelada", "redirigida"]);

/**
 * ¿Un estado de éstos deja libre al operario?
 *
 * Se exporta aparte de `estaCerrada` para que el panel pueda preguntarlo con
 * solo el estado en la mano, y así los dos lados no tengan cada uno su lista.
 */
export function estadoCerrado(status: string | null | undefined): boolean {
  return CERRADOS.has(String(status ?? ""));
}

/** ¿Esta asistencia ya no ocupa al operario? */
export function estaCerrada(a: AsistenciaEnCola): boolean {
  return estadoCerrado(a.status);
}

/**
 * ¿Está esperando turno?
 *
 * Solo si espera detrás de una que SIGUE ABIERTA. Si aquélla se cerró —o se
 * canceló, o se redirigió a otro— esta asistencia deja de estar en espera
 * automáticamente, aunque nadie haya tocado la columna.
 *
 * `todas` es el conjunto donde buscar a la que bloquea. Si no aparece, se
 * considera que ya no bloquea: preferimos soltar la cola a dejarla presa por
 * una asistencia que no se puede ni consultar.
 */
export function enEspera(a: AsistenciaEnCola, todas: AsistenciaEnCola[]): boolean {
  const tras = a.esperaTrasId;
  if (tras == null) return false;
  if (estaCerrada(a)) return false;
  const bloquea = todas.find((o) => o.id === tras);
  if (!bloquea) return false;
  return !estaCerrada(bloquea);
}

/**
 * La asistencia que un operario lleva AHORA, si lleva alguna.
 *
 * La que tiene asignada, no está cerrada y no espera a nadie. Puede haber más
 * de una si alguien las asignó a mano sin cola —el servidor nunca lo ha
 * impedido— y en ese caso se devuelve la más antigua: es la que lleva más
 * tiempo abierta y la que de verdad está ocupando al operario.
 */
export function enCursoDe(
  tecnico: string,
  todas: AsistenciaEnCola[],
): AsistenciaEnCola | null {
  const suyas = todas
    .filter(
      (a) =>
        String(a.assignedTechName ?? "") === tecnico &&
        !estaCerrada(a) &&
        !enEspera(a, todas),
    )
    .sort((x, y) => x.id - y.id);
  return suyas[0] ?? null;
}

/**
 * Las que ese operario tiene esperando, de la primera a la última.
 *
 * Por id, que es el orden en que se dieron de alta: quien primero entró en la
 * cola, primero sale. Cualquier otro criterio —prioridad, cercanía— tendría
 * que decidirlo una persona, y para eso está «Adelantar ahora».
 */
export function colaDe(tecnico: string, todas: AsistenciaEnCola[]): AsistenciaEnCola[] {
  return todas
    .filter((a) => String(a.assignedTechName ?? "") === tecnico && enEspera(a, todas))
    .sort((x, y) => x.id - y.id);
}

/**
 * ¿Puede asignarse esta asistencia a ese operario, y cómo?
 *
 * Devuelve detrás de qué asistencia quedaría —o `null` si entra directa. Es lo
 * que el panel necesita para avisar antes de guardar: «Anthoni está en la
 * #145, ésta quedará en espera».
 *
 * Nunca se pone en espera detrás de sí misma: al reasignar una asistencia que
 * ya era la que estaba en curso, entra directa.
 */
export function comoEntraria(
  asistenciaId: number | null,
  tecnico: string,
  todas: AsistenciaEnCola[],
): { directa: true } | { directa: false; trasId: number } {
  const actual = enCursoDe(tecnico, todas);
  if (!actual || actual.id === asistenciaId) return { directa: true };
  return { directa: false, trasId: actual.id };
}
