import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { LectorParteIA, type LectorParte } from "./lectorParte.ts";

/**
 * Parte de servicio a partir de fotografías.
 *
 * SOLO PROPONE. No crea vehículos, no monta neumáticos y no toca el catálogo:
 * devuelve lo leído para que el técnico lo confirme o lo corrija. Guardar es
 * cosa de las funciones de la base de datos, que ya existen y piden una
 * confirmación explícita.
 *
 * Las fotos NO se guardan aquí: llegan ya subidas al Storage de Mobilink y el
 * servidor solo pasa sus URL al modelo.
 */

/** Tope de fotos por parte. Un parte son la matrícula, el cuentakilómetros,
 *  el vehículo y sus ruedas: con 24 va sobrado, y sin tope una petición podría
 *  costar lo que quisiera quien la lance. */
const MAX_FOTOS = 24;

export function mountParte(app: Express, ...guards: RequestHandler[]): void {
  const lector: LectorParte = new LectorParteIA();

  app.get("/api/tyrecontrol/parte/estado", ...guards, (_req, res) => {
    res.json({ disponible: hayIA(), max_fotos: MAX_FOTOS });
  });

  app.post("/api/tyrecontrol/parte/leer", ...guards, async (req, res) => {
    try {
      if (!hayIA()) {
        return res.status(503).json({ error: "Lectura de partes no disponible (falta OPENAI_API_KEY)" });
      }
      const brutas = req.body?.imagenes;
      if (!Array.isArray(brutas) || brutas.length === 0) {
        return res.status(400).json({ error: "Hacen falta las fotografías" });
      }
      if (brutas.length > MAX_FOTOS) {
        return res.status(400).json({ error: `Demasiadas fotografías (máximo ${MAX_FOTOS})` });
      }

      const imagenes = brutas.map((x: unknown) => String(x ?? "").trim()).filter(Boolean);
      // Solo lo que esté subido a Mobilink o venga dentro de la petición.
      // Aceptar cualquier URL convertiría esto en un descargador de lo que le
      // pidan desde fuera.
      for (const url of imagenes) {
        const esDataUri = url.startsWith("data:image/");
        const esNuestra = /^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(url);
        if (!esDataUri && !esNuestra) {
          return res.status(400).json({ error: "Las fotos tienen que estar subidas a Mobilink" });
        }
        if (esDataUri && url.length > 12_000_000) {
          return res.status(413).json({ error: "Alguna fotografía es demasiado grande" });
        }
      }

      const parte = await lector.leer(imagenes);
      // 200 aunque no se haya podido leer: unas fotos que no dan no son un
      // error del servidor. El APK enseña los avisos y deja seguir a mano.
      res.json(parte);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido leer el parte" });
    }
  });
}
