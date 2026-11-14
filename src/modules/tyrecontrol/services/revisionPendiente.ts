/**
 * Qué cuenta como «pendiente de revisar», en un solo sitio.
 *
 * Esto vivía dentro de `presenciaVista.ts`, junto al resto de lo que ordena
 * la pantalla «Vehículos en bases». El criterio tenía que compartirlo el
 * PDF de la hoja del patio, que lo arma el SERVIDOR: si allí se copiara,
 * el papel y el panel acabarían discrepando el día que alguien añada un
 * estado de periodicidad, y entonces la hoja impresa dice una cosa y la
 * pantalla otra delante del cliente.
 *
 * Y está en su propio fichero, no importado de `presenciaVista.ts`, por una
 * razón de compilación que conviene dejar escrita: `presenciaVista` arrastra
 * los tipos de `presenciaBases`, que lee `import.meta.env` y el cliente de
 * Supabase del navegador. Al importarlo desde `server/` el typecheck del
 * backend —que no tiene `lib: DOM`— se llenaba de errores sobre `window` y
 * `document`. Un módulo hoja no arrastra nada.
 *
 * `presenciaVista.ts` lo reexporta, así que quien ya lo importaba de allí
 * sigue igual.
 */

import type { RevisionEstado } from "../types";

/**
 * Prioridad de una revisión: cuanto menor, más arriba.
 *
 * Nunca revisado va antes que vencida, y vencida antes que próxima. El nunca
 * revisado primero no es un capricho: de ese no se sabe ni cómo está, y es el
 * que más se arriesga a irse de la base sin que nadie le haya mirado nada.
 */
export function prioridadRevision(estado: string | undefined): number {
  if (estado === "sin_revision") return 0;
  if (estado === "vencida") return 1;
  if (estado === "proxima") return 2;
  return 3;
}

/** ¿Tiene este vehículo algo pendiente que justifique cogerlo ahora? */
export function tieneRevisionPendiente(rev: RevisionEstado | undefined): boolean {
  return rev?.estado === "sin_revision" || rev?.estado === "vencida" || rev?.estado === "proxima";
}
