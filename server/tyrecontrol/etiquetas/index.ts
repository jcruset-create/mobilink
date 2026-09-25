import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { motivoFotoNoValida } from "../flanco/index.ts";
import { LectorSerieIA, type LectorSerie } from "./lectorEtiqueta.ts";
import { clasificarLectura } from "./serie.ts";

/**
 * Leer el número de serie de una goma nueva para etiquetarla.
 *
 * Mismo servicio de IA y mismo bucket de fotos que el resto: lo que cambia es
 * la PREGUNTA. Durante una revisión se lee el flanco entero —marca, medida,
 * índices, DOT— para buscar en el catálogo. Aquí se pide un solo dato, y se le
 * dice al modelo que en una goma nueva ese número suele venir impreso en una
 * pegatina con código de barras, no estampado en el caucho. Ver
 * `lectorEtiqueta.ts`: con la instrucción del flanco, esas etiquetas se
 * quedaban sin leer.
 *
 * ESTO NO CREA NEUMÁTICOS. Ni los da de alta, ni mueve stock, ni genera coste:
 * propone un número para que una persona lo confirme. Los lotes y las fotos
 * los guarda la tablet contra la base de datos con su propia sesión, y ahí
 * mandan la RLS y los checks de `tyrecontrol_etiquetas.sql`.
 *
 * La clave de OpenAI no sale de aquí: la APK manda la foto y recibe el número.
 * Tampoco se registra la foto, ni el número, ni la matrícula en los logs.
 */
export function mountEtiquetas(app: Express, ...guards: RequestHandler[]): void {
  const lector: LectorSerie = new LectorSerieIA();

  // La tablet lo consulta al abrir el menú: sin IA configurada, el etiquetado
  // se hace escribiendo el número a mano, y no se ofrece un botón que falla.
  app.get("/api/tyrecontrol/etiquetas/estado", ...guards, (_req, res) => {
    res.json({ disponible: hayIA() });
  });

  app.post("/api/tyrecontrol/etiquetas/leer", ...guards, async (req, res) => {
    try {
      if (!hayIA()) {
        return res.status(503).json({ error: "Lectura por foto no disponible (falta OPENAI_API_KEY)" });
      }
      const imagenUrl = String(req.body?.imagen_url ?? "").trim();
      const malaFoto = motivoFotoNoValida(imagenUrl);
      if (malaFoto) return res.status(malaFoto.estado).json({ error: malaFoto.error });

      const leido = await lector.leer(imagenUrl);
      const lectura = clasificarLectura(leido, leido.confianza);

      // 200 aunque no se haya leído nada: una foto que no da no es un error
      // del servidor. La tablet enseña el aviso y deja escribirlo a mano.
      res.json({
        serie: lectura.serie,
        confianza: lectura.confianza,
        dudoso: lectura.dudoso,
        estado: lectura.estado,
        aviso: lectura.aviso,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido leer el número" });
    }
  });
}
