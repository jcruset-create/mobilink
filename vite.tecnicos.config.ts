import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  root: ".",
  build: {
    outDir: "dist-tecnicos",
    emptyOutDir: true,
    rollupOptions: {
      input: "index-tecnicos.html",
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },

  define: {
    "import.meta.env.VITE_NATIVE_MOBILE_APP": JSON.stringify("true"),
    // URL del servidor de producción — la app nativa apunta aquí
    "import.meta.env.VITE_API_BASE": JSON.stringify(
      process.env.VITE_API_BASE || "https://sea-tarragona.onrender.com"
    ),
  },
});
