import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/*
 * La versión del `package.json`, incrustada en el bundle.
 *
 * Sin esto no hay forma de saber qué build está sirviendo el navegador, y
 * "sigue sin funcionar" puede ser tanto un fallo como una caché vieja. Con el
 * número a la vista se distingue en dos segundos.
 */
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [react(), tailwindcss()],

  server: {
    host: true,
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/server/*.json", "**/server/**/*.json"],
    },
  },

  preview: {
    host: true,
    port: 4173,
  },

  build: {
    chunkSizeWarningLimit: 1000,

    /*
     * El build llegó a caerse en Render con "JavaScript heap out of memory":
     * la entrega #55 murió a los 3m44s y dejó en producción el código de la
     * anterior, así que un arreglo ya subido y probado no llegó al mostrador.
     *
     * `reportCompressedSize` comprime en memoria CADA chunk solo para escribir
     * la columna «gzip» del resumen; con un chunk de 1,4 MB y otro de 736 kB
     * eso es memoria y tiempo a cambio de un dato que no cambia el resultado.
     */
    reportCompressedSize: false,
    // El build de Render corre con la RAM del plan del servicio (Starter =
    // 512 MB). Un único bundle de 2,5 MB agota la memoria al minificar, así
    // que las librerías pesadas van en trozos aparte: baja el pico de memoria
    // y además el navegador solo descarga lo que usa cada pantalla.
    rollupOptions: {
      /*
       * Cuántos ficheros procesa Rollup a la vez (20 por defecto). Bajarlo
       * alarga un poco el build y recorta el pico de memoria, que es justo el
       * cambio que interesa cuando el techo es la RAM y no el reloj.
       */
      maxParallelFileOps: 3,
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          excel: ["xlsx"],
          maps: ["leaflet", "react-leaflet"],
          icons: ["lucide-react"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});