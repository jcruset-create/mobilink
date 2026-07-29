import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
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
    // El build de Render corre con la RAM del plan del servicio (Starter =
    // 512 MB). Un único bundle de 2,5 MB agota la memoria al minificar, así
    // que las librerías pesadas van en trozos aparte: baja el pico de memoria
    // y además el navegador solo descarga lo que usa cada pantalla.
    rollupOptions: {
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