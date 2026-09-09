/**
 * Las dos rutas públicas de la valoración.
 *
 * Sin autenticación y sin taller: quien abre el enlace no es nadie del sistema.
 * Lo único que le da derecho a ver algo es el token, y el token entra por la
 * URL, se convierte en su sha256 y no se registra en ningún sitio.
 *
 * ── Lo que este fichero NO hace ─────────────────────────────────────────────
 *
 *  · **No emite tokens.** Un GET valida uno ya emitido; nunca crea ni rota.
 *    Si lo hiciera, cualquiera que adivinara una URL se fabricaría el acceso.
 *  · **No valida respuestas.** Eso es de `completarSurvey`, que además lo hace
 *    dentro de su transacción. Repetirlo aquí sería tener dos reglas que se
 *    separan con el tiempo.
 *  · **No cuenta por qué no.** Token inexistente, mal formado o de una
 *    encuesta cancelada dan respuestas que no permiten distinguirlos.
 */

import { Router, json, type Request, type Response } from "express";

import { ErrorSatisfaction, completarSurvey } from "./servicio.ts";
import {
  instanciaPorToken, marcarAbierta, resolverSurveyPublica,
} from "./publico.ts";
import {
  LIMITE_ENVIO, LIMITE_LECTURA, LIMITE_POR_ENCUESTA, consumir, type Limite,
} from "./rateLimit.ts";
import { hashToken } from "./servicio.ts";
import { ipDe } from "./ipCliente.ts";

/**
 * El cuerpo más grande que tiene sentido.
 *
 * La respuesta más larga posible son seis preguntas y un comentario de 2.000
 * caracteres (`MAX_COMENTARIO`). 16 kB deja sitio de sobra y a la vez impide
 * que alguien mande un megabyte a una ruta sin autenticar. El límite global de
 * la aplicación es de 10 MB, que aquí sería una barbaridad.
 */
const MAX_CUERPO = "16kb";

/** Aplica un límite y contesta 429 si toca. Devuelve `true` si se puede seguir. */
function pasaLimite(req: Request, res: Response, sufijo: string, limite: Limite): boolean {
  const v = consumir(`${sufijo}:${ipDe(req)}`, limite);
  if (v.permitido) return true;
  res.setHeader("Retry-After", String(v.reintentarEnS));
  // Nada de detalles: ni cuántas van, ni de qué límite se trata.
  res.status(429).json({ error: "Demasiadas peticiones. Inténtalo dentro de un rato." });
  return false;
}

/**
 * Límite por encuesta, sin guardar el token.
 *
 * La clave es el hash, que es lo que ya está en la base: el valor en claro no
 * se queda en memoria ni aparece en ninguna estructura.
 */
function pasaLimitePorEncuesta(req: Request, res: Response, token: string): boolean {
  const v = consumir(`encuesta:${hashToken(token)}`, LIMITE_POR_ENCUESTA);
  if (v.permitido) return true;
  res.setHeader("Retry-After", String(v.reintentarEnS));
  res.status(429).json({ error: "Demasiadas peticiones. Inténtalo dentro de un rato." });
  return false;
}

export function createSatisfactionPublicRouter(): Router {
  const router = Router();
  router.use(json({ limit: MAX_CUERPO }));

  /**
   * Lo que hay que enseñar para este token.
   *
   * Siempre 200, incluso cuando no se puede contestar: el estado va dentro. Un
   * 404 obligaría a la página a distinguir «no existe» de «no hay red», y al
   * que responde le daría una pantalla de error del navegador en vez de un
   * mensaje que se entiende.
   */
  router.get("/:token", async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "sat-get", LIMITE_LECTURA)) return;
    const token = String(req.params.token ?? "");
    if (!pasaLimitePorEncuesta(req, res, token)) return;

    try {
      const r = await resolverSurveyPublica(token);
      // Solo se anota la apertura de lo que de verdad se puede contestar.
      if (r.estado === "ACTIVE") {
        await marcarAbierta(token).catch(() => { /* apuntarlo no es esencial */ });
      }
      res.json(r);
    } catch (e) {
      // Ni el mensaje de la base ni la consulta: al que responde no le sirven
      // y a quien esté probando la ruta le dirían demasiado.
      console.error("[Satisfaction] error resolviendo el token:", (e as Error)?.message);
      res.status(500).json({ error: "No se ha podido cargar la encuesta." });
    }
  });

  /**
   * Guarda la valoración.
   *
   * Todo lo de negocio —estado, caducidad, validación, reglas de calidad— pasa
   * dentro de `completarSurvey`, en una transacción. Aquí solo se traduce el
   * resultado a algo que la página pueda pintar.
   */
  router.post("/:token/complete", async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "sat-post", LIMITE_ENVIO)) return;
    const token = String(req.params.token ?? "");
    if (!pasaLimitePorEncuesta(req, res, token)) return;

    const instancia = await instanciaPorToken(token).catch(() => null);
    if (!instancia) return res.status(404).json({ estado: "INVALID" });

    const respuestas = Array.isArray(req.body?.respuestas) ? req.body.respuestas : null;
    if (!respuestas) {
      return res.status(400).json({ estado: "ERROR", error: "Faltan las respuestas." });
    }

    try {
      await completarSurvey({
        instanceId: instancia.id,
        // El ámbito sale de la fila, NUNCA del cliente: quien responde no
        // manda un tenant y no podría.
        ambito: instancia.ambito,
        respuestas,
        actor: { tipo: "public" },
      });
      /*
       * Se contesta solo que ha ido bien. Si la respuesta ha abierto un
       * expediente de calidad, eso no se cuenta: al que valora se le agradece
       * igual, y saber que su queja ha abierto un caso interno no es asunto
       * de esta pantalla.
       */
      return res.json({ estado: "COMPLETED" });
    } catch (e) {
      if (e instanceof ErrorSatisfaction) {
        switch (e.codigo) {
          case "ya_completada":
            // No es un error: es el segundo clic de alguien con mala cobertura.
            return res.json({ estado: "COMPLETED", yaEstaba: true });
          case "caducada":
            return res.status(410).json({ estado: "EXPIRED" });
          case "estado_no_admite_respuesta":
            return res.status(409).json({ estado: "UNAVAILABLE" });
          case "respuesta_invalida":
            return res.status(400).json({
              estado: "ERROR",
              error: "Hay respuestas que no son válidas.",
              // Los códigos de pregunta sí, para que la página los marque; el
              // detalle interno no.
              campos: (e.errores ?? []).map((x) => x.code),
            });
          case "instancia_no_encontrada":
            return res.status(404).json({ estado: "INVALID" });
        }
      }
      console.error("[Satisfaction] error completando:", (e as Error)?.message);
      return res.status(500).json({ estado: "ERROR", error: "No se ha podido guardar." });
    }
  });

  return router;
}
