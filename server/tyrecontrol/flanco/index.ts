import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { LectorFlancoIA, type LectorFlanco } from "./lectorFlanco.ts";

/**
 * Identificar un neumático por la foto de su flanco, durante una revisión.
 *
 * Este endpoint SOLO PROPONE. No crea neumáticos, no toca el catálogo y no
 * corrige ningún montaje: devuelve lo que se lee en la foto para que el
 * técnico lo confirme o lo corrija. Guardar es cosa de las funciones de la
 * base de datos, que piden una confirmación explícita.
 *
 * Sigue el molde del asistente: un /estado para que el APK sepa si puede
 * ofrecer el botón, y una llamada que hace el trabajo.
 */
/**
 * Qué fotos se aceptan para leer.
 *
 * Solo la que el APK acaba de subir a Storage, o una que venga dentro de la
 * propia petición. Aceptar cualquier URL convertiría estos endpoints en un
 * descargador de lo que le pidan desde fuera.
 *
 * Está aquí y exportada porque la usan dos endpoints —el flanco y el
 * etiquetado— y dos validadores que se separan acaban aceptando cosas
 * distintas.
 */
export function motivoFotoNoValida(imagenUrl: string): { estado: number; error: string } | null {
  if (!imagenUrl) return { estado: 400, error: "Falta la foto" };
  const esDataUri = imagenUrl.startsWith("data:image/");
  const esNuestra = /^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(imagenUrl);
  if (!esDataUri && !esNuestra) {
    return { estado: 400, error: "La foto tiene que estar subida a Mobilink" };
  }
  if (esDataUri && imagenUrl.length > 12_000_000) {
    return { estado: 413, error: "La foto es demasiado grande" };
  }
  return null;
}

export function mountFlanco(app: Express, ...guards: RequestHandler[]): void {
  const lector: LectorFlanco = new LectorFlancoIA();

  // El APK lo consulta al abrir la ficha de la rueda: sin IA configurada no
  // enseña "Identificar con foto" en vez de ofrecer un botón que falla.
  app.get("/api/tyrecontrol/flanco/estado", ...guards, (_req, res) => {
    res.json({ disponible: hayIA() });
  });

  app.post("/api/tyrecontrol/flanco/leer", ...guards, async (req, res) => {
    try {
      if (!hayIA()) {
        return res.status(503).json({ error: "Identificación por foto no disponible (falta OPENAI_API_KEY)" });
      }
      const imagenUrl = String(req.body?.imagen_url ?? "").trim();
      const malaFoto = motivoFotoNoValida(imagenUrl);
      if (malaFoto) return res.status(malaFoto.estado).json({ error: malaFoto.error });

      const propuesta = await lector.leer(imagenUrl);
      // 200 aunque no se haya podido leer: no es un error del servidor, es una
      // foto que no da. El APK enseña el aviso y deja seguir a mano.
      res.json(propuesta);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido leer el flanco" });
    }
  });
}
