/**
 * API canónica de MC Central (`/api/central/v1`).
 *
 * Es la que consumen los programas, no las personas: se autentica con un
 * testigo de `client_credentials` y no con la sesión de un usuario.
 *
 * **Versionada en la ruta desde el primer día.** Un integrador que no controlas
 * no se actualiza cuando tú quieres, así que la primera vez que haga falta
 * cambiar la forma de una respuesta habrá que servir las dos a la vez. Meter el
 * `v1` ahora no cuesta nada; ponerlo después obliga a romper a quien ya
 * integraba.
 *
 * Lo que NO es: un servidor de autorización con códigos, refresco y
 * consentimiento. Ver `clients.ts` sobre por qué eso no aplica sin usuario
 * delante.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";
import { resolverTestigo, emitirTestigo, type ContextoApi } from "./clients.ts";
import { cajasEnRed, posicionGlobal, jornadasEnRed } from "../queries.ts";

declare module "express-serve-static-core" {
  interface Request {
    apiCtx?: ContextoApi;
  }
}

/** Respuestas de error con la forma del estándar, que es lo que esperan. */
function fallo(res: Response, estado: number, error: string, descripcion: string) {
  res.status(estado).json({ error, error_description: descripcion });
}

const autenticar: RequestHandler = async (req, res, next) => {
  const cabecera = String(req.headers.authorization || "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return fallo(res, 401, "invalid_request", "Falta el testigo.");

  const ctx = await resolverTestigo(token);
  if (!ctx) return fallo(res, 401, "invalid_token", "El testigo no vale o ha caducado.");

  req.apiCtx = ctx;
  next();
};

function exigirAlcance(alcance: string): RequestHandler {
  return (req, res, next) => {
    if (!req.apiCtx?.alcances.includes(alcance)) {
      return fallo(res, 403, "insufficient_scope", `Hace falta el alcance ${alcance}.`);
    }
    next();
  };
}

const ruta =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res) => {
    fn(req, res).catch((e) => {
      console.error("[MC Central API]", e);
      fallo(res, 500, "server_error", "Error interno.");
    });
  };

export function createCentralApiRouter(): Router {
  const r = Router();

  /**
   * Emisión de testigo.
   *
   * Acepta las credenciales en el cuerpo, que es lo que hacen la mayoría de
   * clientes. Sin `authenticate` delante, evidentemente: es la puerta.
   */
  r.post(
    "/oauth/token",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      if (b.grant_type !== "client_credentials") {
        return fallo(
          res,
          400,
          "unsupported_grant_type",
          "Solo se admite client_credentials: aquí no hay ningún usuario delante."
        );
      }

      const testigo = await emitirTestigo(String(b.client_id ?? ""), String(b.client_secret ?? ""));
      // Un fallo indistinguible para credenciales malas y cliente inexistente:
      // distinguirlos permitiría enumerar clientes válidos.
      if (!testigo) return fallo(res, 401, "invalid_client", "Credenciales no válidas.");

      // Un testigo no se guarda en ninguna caché intermedia.
      res.set("cache-control", "no-store");
      res.json(testigo);
    })
  );

  r.use(autenticar);

  /** Posición de efectivo de la red. */
  r.get(
    "/network/position",
    exigirAlcance("read:network"),
    ruta(async (req, res) => {
      res.json(await posicionGlobal(req.apiCtx!.empresaId));
    })
  );

  /** Las cajas y su estado. */
  r.get(
    "/network/registers",
    exigirAlcance("read:network"),
    ruta(async (req, res) => {
      res.json({ cajas: await cajasEnRed(req.apiCtx!.empresaId) });
    })
  );

  /** Jornadas, para cuadrar contra la contabilidad de fuera. */
  r.get(
    "/sessions",
    exigirAlcance("read:sessions"),
    ruta(async (req, res) => {
      const { desde, hasta } = req.query;
      res.json({
        jornadas: await jornadasEnRed(req.apiCtx!.empresaId, {
          desde: typeof desde === "string" ? desde : undefined,
          hasta: typeof hasta === "string" ? hasta : undefined,
        }),
      });
    })
  );

  /** Quién soy: para que un integrador compruebe su configuración sin datos. */
  r.get(
    "/whoami",
    ruta(async (req, res) => {
      res.json({
        clientId: req.apiCtx!.clientId,
        empresaId: req.apiCtx!.empresaId,
        alcances: req.apiCtx!.alcances,
      });
    })
  );

  return r;
}
