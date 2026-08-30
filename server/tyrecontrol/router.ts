/**
 * API de lectura de TyreControl para Assist.
 *
 * Solo lectura, y en esta fase a propósito: no hay ni una escritura hacia TC en
 * todo el módulo.
 *
 * ── Los códigos de estado ───────────────────────────────────────────────────
 *
 * «No está en TyreControl» y «esa matrícula está en dos empresas» son
 * respuestas NORMALES, no errores: se contestan con 200 y un `estado` dentro.
 * Devolver 404 o 500 obligaría a cada pantalla a distinguir un fallo de red de
 * un vehículo que sencillamente no está en TC, y acabarían enseñando «error»
 * cuando no lo hay.
 *
 * El 502 se reserva para lo que sí es un fallo: no poder hablar con TC.
 */

import { Router, type Request, type Response } from "express";

import { ErrorTyreControl, resolverVehiculo } from "./vehiculos.ts";
import { estadoDeVehiculo } from "./estadoVehiculo.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorTyreControl) {
    return res.status(e.estado).json({ estado: "ERROR", code: e.codigo, error: e.message });
  }
  // Al panel no le llega el detalle de Supabase ni la consulta; al log, sí.
  console.error("[TyreControl] error:", (e as any)?.message);
  return res.status(500).json({ estado: "ERROR", code: "server_error", error: "Error consultando TyreControl" });
}

export function createTyreControlRouter(guarda: any): Router {
  const router = Router();
  router.use(guarda);

  /**
   * Estado técnico de un vehículo, por matrícula o por id de TC.
   *
   * `estado`: FOUND | NOT_FOUND | AMBIGUOUS | ERROR.
   */
  router.get("/vehicle-state", async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const tcVehicleId = String(req.query.tcVehicleId ?? "").trim();
      const plate = String(req.query.plate ?? "").trim();
      const empresaId = String(req.query.empresaId ?? "").trim() || null;

      if (!tcVehicleId && !plate) {
        return res.status(422).json({
          estado: "ERROR", code: "missing_query",
          error: "Indica una matrícula (plate) o un tcVehicleId",
        });
      }

      // Por id no hay ambigüedad posible: se salta la resolución.
      if (tcVehicleId) {
        const estado = await estadoDeVehiculo(tcVehicleId);
        if (!estado) return res.json({ estado: "NOT_FOUND" });
        return res.json({ estado: "FOUND", ...estado, msConsulta: Date.now() - t0 });
      }

      const r = await resolverVehiculo(plate, { empresaId });
      if (r.estado === "NOT_FOUND") return res.json({ estado: "NOT_FOUND" });
      if (r.estado === "AMBIGUOUS") {
        return res.json({ estado: "AMBIGUOUS", candidatos: r.candidatos });
      }

      const estado = await estadoDeVehiculo(r.vehiculo);
      const ms = Date.now() - t0;
      if (ms > 1500) console.warn(`[TyreControl] estado de ${plate} tardó ${ms} ms`);
      return res.json({ estado: "FOUND", ...estado!, msConsulta: ms });
    } catch (e) {
      fallo(res, e);
    }
  });

  /** Solo la resolución, sin el estado técnico: más barata para un listado. */
  router.get("/resolve", async (req: Request, res: Response) => {
    try {
      const plate = String(req.query.plate ?? "").trim();
      if (!plate) {
        return res.status(422).json({ estado: "ERROR", code: "missing_query", error: "Indica una matrícula" });
      }
      const r = await resolverVehiculo(plate, {
        empresaId: String(req.query.empresaId ?? "").trim() || null,
      });
      res.json(r.estado === "FOUND" ? { estado: "FOUND", vehiculo: r.vehiculo } : r);
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Sonda de autenticación. NO escribe nada en TyreControl.
   *
   * Está detrás del mismo guarda que el resto y cuenta qué es Assist para TC,
   * nunca con qué credencial: ni tokens, ni contraseñas, ni la clave de
   * servicio salen por aquí.
   */
  router.get("/auth-probe", async (_req: Request, res: Response) => {
    try {
      const { sondaCompleta } = await import("./auth.ts");
      res.json(await sondaCompleta());
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
