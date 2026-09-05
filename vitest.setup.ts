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
 * ── Y se crea ENTERO, en el mismo orden que el arranque ─────────────────────
 *
 * Aquí faltaban módulos —`initDocumentos`, `initExcepciones`, `initCash`…— y
 * eso hacía que sus columnas existieran solo si algún otro fichero de pruebas
 * las creaba antes por su cuenta. La suite dependía del ORDEN de los ficheros:
 * en local pasaba y en la CI fallaba `assistMirror.integration.test.ts` con
 * «column a.costeFinal does not exist», porque allí le tocaba correr antes que
 * a las pruebas de excepciones. Añadir un fichero cambiaba el orden y con él
 * el resultado.
 *
 * La lista replica la cadena de `server/index.ts`, incluido su orden, que NO es
 * arbitrario: `initExcepciones` indexa por «estadoAdmin», que crea
 * `initDocumentos`.
 *
 * ── Las dos que NO están, y por qué ─────────────────────────────────────────
 *
 * `initMapeoEmpresas` e `initTyreControlAssist` se quedan fuera a propósito.
 * Con sus tablas creadas, el enganche de cierre da la asistencia por vinculada
 * a TyreControl y llama a Supabase DE VERDAD: los pasos siguientes —el diario
 * y Satisfaction— se quedan esperando a que la red conteste, y una suite que
 * depende de que haya salida a internet no es una suite. Las pruebas que sí
 * necesitan ese esquema lo preparan ellas.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada: las pruebas unitarias no tocan la base.
 */
export async function setup(): Promise<void> {
  if (process.env.RUN_DB_TESTS !== "1" || !process.env.DATABASE_URL) return;

  const { initDb } = await import("./server/db.ts");
  const { initIntegrationHub } = await import("./server/integration-hub/infrastructure/schema.ts");
  const { initLicenses } = await import("./server/licenses/schema.ts");
  const { initConnect } = await import("./server/connect/schema.ts");
  const { initDispatch } = await import("./server/dispatch/schema.ts");
  const { initEventLog } = await import("./server/eventlog/schema.ts");
  const { initDocumentos } = await import("./server/documentos/schema.ts");
  const { initCorreo } = await import("./server/correo/schema.ts");
  const { initExcepciones } = await import("./server/excepciones/schema.ts");
  const { initCash } = await import("./server/cash/schema.ts");
  const { initCentral } = await import("./server/central/schema.ts");
  const { initTacografos } = await import("./server/tacografos/schema.ts");
  const { initSatisfaction } = await import("./server/satisfaction/schema.ts");
  const { initAuditoria } = await import("./server/core/auditoriaSchema.ts");

  await initDb();
  await initIntegrationHub();
  await initLicenses();
  await initConnect();
  await initDispatch();
  await initEventLog();
  await initDocumentos();
  await initCorreo();
  await initExcepciones();
  await initCash();
  await initCentral();
  await initTacografos();
  await initSatisfaction();
  // No está en la cadena del arranque —la auditoría la prepara su propio
  // módulo— pero varias pruebas escriben en ella y no deben depender de quién
  // corra primero, que es justo el fallo que arregla este fichero.
  await initAuditoria();

  const db = (await import("./server/db.ts")).default;
  await db.end().catch(() => {});
}
