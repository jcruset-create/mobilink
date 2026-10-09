import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { motivoFotoNoValida } from "../flanco/index.ts";
import { LectorSerieIA, type LectorSerie } from "./lectorEtiqueta.ts";
import { clasificarLectura } from "./serie.ts";
import { seriesDeCodigoDeBarras } from "./codigoBarras.ts";
import sharp from "sharp";

/** Los bytes de la foto: del data: URI o de nuestro bucket (ya validado). */
async function bytesDeFoto(imagenUrl: string): Promise<Uint8Array | null> {
  try {
    if (imagenUrl.startsWith("data:image/")) {
      const coma = imagenUrl.indexOf(",");
      return coma > 0 ? new Uint8Array(Buffer.from(imagenUrl.slice(coma + 1), "base64")) : null;
    }
    const r = await fetch(imagenUrl, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length > 15 * 1024 * 1024 ? null : b;
  } catch {
    return null;
  }
}

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
      const imagenUrl = String(req.body?.imagen_url ?? "").trim();
      const malaFoto = motivoFotoNoValida(imagenUrl);
      if (malaFoto) return res.status(malaFoto.estado).json({ error: malaFoto.error });

      const responder = (leido: { numero_serie: string | null; confianza: number | null; aviso: string | null },
                         origen: "codigo_barras" | "ia") => {
        const lectura = clasificarLectura(leido, leido.confianza);
        // 200 aunque no se haya leído nada: una foto que no da no es un error
        // del servidor. El panel enseña el aviso y deja escribirlo a mano.
        return res.json({
          serie: lectura.serie, confianza: lectura.confianza, dudoso: lectura.dudoso,
          estado: lectura.estado, aviso: lectura.aviso, origen,
        });
      };

      // ── 1. El código de barras de la pegatina ──────────────────────────
      // Es el mismo número que va impreso debajo, y leerlo no es adivinar: o
      // sale exacto o no sale. No necesita IA, así que va antes de mirar si
      // hay clave de OpenAI.
      const bytes = await bytesDeFoto(imagenUrl);
      if (bytes) {
        const series = await seriesDeCodigoDeBarras(bytes).catch(() => [] as string[]);
        if (series.length === 1) {
          return responder({ numero_serie: series[0], confianza: 1, aviso: null }, "codigo_barras");
        }
        // Varios códigos distintos (dos gomas en la foto): no se elige a ojo,
        // se le deja a la IA, que sabe qué goma está en primer plano.
      }

      // ── 2. La IA, para lo que no tiene código legible ──────────────────
      if (!hayIA()) {
        return res.status(503).json({ error: "Lectura por foto no disponible (falta OPENAI_API_KEY)" });
      }
      let leido = await lector.leer(imagenUrl);

      // Una pegatina girada 90° es justo la que el modelo más da por ilegible.
      // Si no ha leído nada, se le enseña la foto enderezada en las dos
      // direcciones antes de rendirse.
      if (!leido.numero_serie && bytes) {
        for (const grados of [90, 270]) {
          const girada = await sharp(bytes).rotate(grados).jpeg({ quality: 90 }).toBuffer().catch(() => null);
          if (!girada) break;
          const otra = await lector.leer(`data:image/jpeg;base64,${girada.toString("base64")}`);
          if (otra.numero_serie) { leido = otra; break; }
        }
      }
      return responder(leido, "ia");
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido leer el número" });
    }
  });
}
