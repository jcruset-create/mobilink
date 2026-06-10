/**
 * Sincroniza el build de dist-tecnicos/ al proyecto android-tecnicos/
 * Equivalente a `cap sync android` pero para el proyecto de técnicos.
 *
 * Uso: node scripts/sync-tecnicos.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SRC = path.join(ROOT, "dist-tecnicos");
const DEST = path.join(ROOT, "android-tecnicos", "app", "src", "main", "assets", "public");

if (!fs.existsSync(SRC)) {
  console.error("❌  dist-tecnicos/ no existe. Ejecuta primero: npm run tecnicos:build");
  process.exit(1);
}

// Limpiar destino
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

// Copiar recursivamente
copyDir(SRC, DEST);

console.log("✅  dist-tecnicos → android-tecnicos/app/src/main/assets/public");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
