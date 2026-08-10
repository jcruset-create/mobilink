// Qué versión de una APK es la más reciente.
//
// El build number lo pone la CI con `github.run_number` (los tres workflows de
// APK lo hacen igual: build-tyrecontrol-apk.yml, build-assist-apk.yml y
// build-lite-apk.yml). Ese número **solo sube**, así que es el único dato
// fiable para saber qué se publicó después.
//
// El NOMBRE, en cambio, se calcula subiendo el último tramo del pubspec de la
// rama que se compila. Como cada rama parte de su propio punto, puede ir hacia
// atrás entre builds: 0.33.2+60 se publicó el 5 de agosto y 0.32.9+65 el día 7.
// Ordenando por nombre, la página de descargas ofrecía la del día 5 —dos días
// más vieja— porque 0.33.2 > 0.32.9.
//
// Por eso manda el build y el nombre solo desempata (dos assets del mismo
// build, que no debería pasar, pero así el orden es total y determinista).

/** Build number de "0.33.4+67" → 67. Sin "+", 0. */
export function buildDeVersion(v: string): number {
  return parseInt(v.split("+")[1] ?? "0", 10) || 0;
}

/** Tramos del nombre: "0.33.4+67" → [0, 33, 4]. */
export function nombreDeVersion(v: string): number[] {
  return (v.split("+")[0] ?? "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/**
 * Comparador para `sort`: deja la versión más reciente la primera.
 *
 * Manda el build number (el nº de ejecución del workflow, que solo sube) y el
 * nombre solo desempata.
 */
export function masNuevaPrimero(a: string, b: string): number {
  const db = buildDeVersion(b) - buildDeVersion(a);
  if (db !== 0) return db;

  const na = nombreDeVersion(a);
  const nb = nombreDeVersion(b);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    if ((nb[i] || 0) !== (na[i] || 0)) return (nb[i] || 0) - (na[i] || 0);
  }
  return 0;
}
