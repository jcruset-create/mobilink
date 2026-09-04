/**
 * Preparación única de la base de datos para las pruebas de integración.
 *
 * Vitest ejecuta cada fichero de pruebas en su propio proceso y en paralelo.
 * Si cada uno crea el esquema por su cuenta, el `ALTER TABLE` de uno toma un
 * bloqueo exclusivo sobre tablas que el otro está consultando, y el segundo
 * recibe errores esporádicos: una de cada tres ejecuciones sobre una base
 * recién creada fallaba, siempre en un sitio distinto.
 *
 * Con `globalSetup` el esquema se crea UNA vez, antes de arrancar ningún
 * proceso de pruebas. Después, los ficheros solo leen y escriben datos.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada: las pruebas unitarias no tocan la base.
 */
export async function setup(): Promise<void> {
  if (process.env.RUN_DB_TESTS !== "1" || !process.env.DATABASE_URL) return;

  const { initDb } = await import("./server/db.ts");
  const { initConnect } = await import("./server/connect/schema.ts");
  const { initTacografos } = await import("./server/tacografos/schema.ts");
  const { initSatisfaction } = await import("./server/satisfaction/schema.ts");
  await initDb();
  await initConnect();
  await initTacografos();
  await initSatisfaction();

  const db = (await import("./server/db.ts")).default;
  await db.end().catch(() => {});
}
