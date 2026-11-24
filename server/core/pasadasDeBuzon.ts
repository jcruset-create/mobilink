/**
 * ¿Merece la pena guardar esta pasada de un buzón?
 *
 * Los buzones de Therefore y de Recepciones se miran cada 5 minutos, y cada
 * pasada guardaba su fila aunque no hubiera llegado nada: unas 290 filas al
 * día por buzón diciendo «0 correos», más la actualización de cada una.
 *
 * Una pasada se guarda cuando cuenta algo:
 *   - la ha pedido una persona («Revisar ahora», el histórico): se enseña
 *     siempre, es la respuesta a lo que pidió;
 *   - han llegado correos;
 *   - es la primera, o el buzón ha cambiado de estado: empieza a fallar, falla
 *     por OTRA cosa, o vuelve a funcionar. Esa última importa: la pantalla dice
 *     «el buzón no se está leyendo» si la última pasada guardada fue un error,
 *     y sin guardar la buena lo diría para siempre.
 *
 * Lo demás —otra vez nada, u otra vez el mismo fallo— solo se apunta en
 * memoria, para que la pantalla diga cuándo se miró por última vez.
 *
 * Sin base: se prueba en `pasadasDeBuzon.test.ts`.
 */

export type OrigenPasada = "temporizador" | "manual" | "historico" | "eml";

export function hayQueGuardarPasada(
  pasada: { origen: OrigenPasada; correos: number; error: string | null },
  ultimaGuardada: { error: string | null } | null
): boolean {
  if (pasada.origen !== "temporizador") return true;
  if (pasada.correos > 0) return true;
  if (!ultimaGuardada) return true;
  return (pasada.error ?? null) !== (ultimaGuardada.error ?? null);
}

/** Lo que se sabe de la última vez que se miró, aunque no se guardara: por empresa. */
export type Comprobacion = { at: number; error: string | null };
