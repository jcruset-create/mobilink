/**
 * Lee un «Fleetcheck Report» de TIRETASK y devuelve lo que trae.
 *
 * Solo lee: abre el PDF con `mupdf` (que no corre en el navegador) y le pasa
 * las líneas al lector, que es código puro y vive en `src/` junto al panel
 * que lo usa (`services/fleetcheck.ts`). No consulta ni escribe nada en la
 * base: la importación la hace el panel con la sesión de quien importa, igual
 * que el Excel de revisiones, así que las reglas de la base siguen mandando.
 */
import type { Express, RequestHandler } from "express";
import multer from "multer";

import { leerFleetcheck } from "../../src/modules/tyrecontrol/services/fleetcheck.ts";
import { lineasDeInforme } from "./tacografo/informePdf.ts";

/** Un informe de cien vehículos ronda los 500 KB. */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

export function mountTcFleetcheck(app: Express, ...guards: RequestHandler[]): void {
  app.post("/api/tyrecontrol/fleetcheck/leer", ...guards, subida.single("archivo"), async (req, res) => {
    try {
      const archivo = (req as { file?: { buffer: Buffer } }).file;
      if (!archivo?.buffer?.length) return res.status(400).json({ error: "Falta el fichero" });
      if (archivo.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return res.status(400).json({ error: "Eso no es un PDF" });
      }
      const lineas = await lineasDeInforme(archivo.buffer);
      const lectura = leerFleetcheck(lineas);
      if (lectura.vehiculos.length === 0) {
        return res.status(422).json({ error: lectura.avisos[0] ?? "No se ha encontrado ningún vehículo en el PDF" });
      }
      res.json(lectura);
    } catch (error) {
      console.error("POST /api/tyrecontrol/fleetcheck/leer error:", error);
      res.status(500).json({ error: "No se ha podido leer el PDF" });
    }
  });
}
