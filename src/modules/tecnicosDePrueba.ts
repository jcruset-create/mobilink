/**
 * Los técnicos que no son técnicos.
 *
 * «PROVA», «Prova Taller Tarragona», «Test»… existen para probar la app y
 * nunca han trabajado en nada. Operativo 2 los escondía con una expresión
 * suelta; Ausencias no, y salían en el cuadro de vacaciones con treinta días
 * pendientes cada uno, sumando al total del taller. Una sola regla para todas
 * las listas.
 */
export function esTecnicoDePrueba(nombre: unknown): boolean {
  return /prova|prueba|\btest\b/i.test(String(nombre ?? ""));
}
