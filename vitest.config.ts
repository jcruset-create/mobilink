/**
 * Configuración de las pruebas, aparte de `vite.config.ts`.
 *
 * Va en su propio fichero porque el `defineConfig` de vitest tipa el `build`
 * de Rollup de forma más estricta que el de vite y choca con los `manualChunks`
 * del bundle. Separarlo evita tener que relajar tipos en la configuración de
 * producción para poder configurar las pruebas.
 *
 * No hay pruebas de componentes React, así que aquí no hacen falta plugins.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * El esquema se crea UNA vez, antes de arrancar los procesos de pruebas.
     * Si lo creara cada fichero, sus ALTER TABLE tomarían bloqueos exclusivos
     * sobre tablas que otro fichero está consultando. Sin RUN_DB_TESTS no hace
     * nada.
     */
    globalSetup: ["./vitest.setup.ts"],

    /*
     * Con base de datos, los ficheros van de uno en uno: comparten una única
     * base y en paralelo se pisan. Fallaba una de cada tres ejecuciones,
     * siempre en un sitio distinto, que es la peor clase de prueba: la que
     * nadie se cree y acaba ignorándose.
     *
     * Sin base de datos se mantiene el paralelismo: las unitarias no comparten
     * nada y no hay motivo para ralentizarlas.
     */
    fileParallelism: process.env.RUN_DB_TESTS !== "1",
  },
});
