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

import { Router, json, type Request, type Response } from "express";

import db from "../db.ts";
import { registrarAuditoria } from "../core/auth.ts";

import { ErrorTyreControl, resolverVehiculo, resolverVehiculoDeCliente } from "./vehiculos.ts";
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
  router.use(json({ limit: "256kb" }));
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

      /*
       * Con cliente se pasa por el mapeo, que es lo que quita la ambigüedad.
       * Sin cliente se busca en toda la base y puede salir ambigua: es
       * información honesta, no un fallo.
       */
      const clienteId = Number(req.query.clienteId ?? "");
      const r = Number.isInteger(clienteId) && clienteId > 0
        ? await resolverVehiculoDeCliente(plate, clienteId, String(req.query.tallerId ?? "") || null)
        : await resolverVehiculo(plate, { empresaId });

      if (r.estado === "NOT_FOUND") return res.json({ estado: "NOT_FOUND" });
      if (r.estado === "AMBIGUOUS") return res.json({ estado: "AMBIGUOUS", candidatos: r.candidatos });
      if (r.estado === "MAPPING_ERROR") {
        return res.json({ estado: "MAPPING_ERROR", motivo: r.motivo, tcEmpresaId: r.tcEmpresaId });
      }

      const estado = await estadoDeVehiculo(r.vehiculo);
      const ms = Date.now() - t0;
      if (ms > 1500) console.warn(`[TyreControl] estado de ${plate} tardó ${ms} ms`);
      return res.json({ estado: "FOUND", origenEmpresa: r.origenEmpresa, ...estado!, msConsulta: ms });
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
      const clienteId = Number(req.query.clienteId ?? "");
      const r = Number.isInteger(clienteId) && clienteId > 0
        ? await resolverVehiculoDeCliente(plate, clienteId, String(req.query.tallerId ?? "") || null)
        : await resolverVehiculo(plate, { empresaId: String(req.query.empresaId ?? "").trim() || null });
      res.json(r);
    } catch (e) {
      fallo(res, e);
    }
  });

  /* ── Mapeo cliente Assist ↔ empresa TyreControl ────────────────────────── */
  /*
   * Es configuración de oficina. No aparece en la pantalla del técnico y no le
   * añade ningún paso: quien mapea es quien administra, una vez por cliente.
   */

  router.get("/empresas", async (_req, res) => {
    try {
      const { empresasDeTyreControl } = await import("./empresas.ts");
      res.json({ data: await empresasDeTyreControl() });
    } catch (e) { fallo(res, e); }
  });

  router.get("/mapeos", async (req: any, res) => {
    try {
      const { listarMapeos } = await import("./empresas.ts");
      res.json({ data: await listarMapeos(req.assistPanelUser?.tallerId ?? null) });
    } catch (e) { fallo(res, e); }
  });

  router.put("/mapeos", async (req: any, res) => {
    try {
      const { ErrorMapeo, guardarMapeo } = await import("./empresas.ts");
      try {
        const m = await guardarMapeo({
          clienteId: Number(req.body?.clienteId),
          tcEmpresaId: String(req.body?.tcEmpresaId ?? ""),
          activo: req.body?.activo !== false,
          tenantId: req.assistPanelUser?.tallerId ?? null,
          porQuien: req.authCtx?.nombre ?? null,
        });
        // La auditoría que ya existe en Assist; no se estrena otra.
        await registrarAuditoria({
          empresaId: req.authCtx?.empresaId ?? "assist",
          userId: req.authCtx?.userId,
          accion: "tyrecontrol.mapeo.guardar", entidad: "connect_clients",
          entidadId: String(m.clienteId), detalle: { tcEmpresaId: m.tcEmpresaId },
          ip: req.ip,
        }).catch(() => {});
        res.json(m);
      } catch (e: any) {
        if (e instanceof ErrorMapeo) {
          return res.status(e.estado).json({ error: e.message, code: e.codigo });
        }
        throw e;
      }
    } catch (e) { fallo(res, e); }
  });

  router.delete("/mapeos/:clienteId", async (req: any, res) => {
    try {
      const { ErrorMapeo, borrarMapeo } = await import("./empresas.ts");
      try {
        await borrarMapeo(Number(req.params.clienteId), req.assistPanelUser?.tallerId ?? null);
        await registrarAuditoria({
          empresaId: req.authCtx?.empresaId ?? "assist",
          userId: req.authCtx?.userId,
          accion: "tyrecontrol.mapeo.borrar", entidad: "connect_clients",
          entidadId: String(req.params.clienteId), ip: req.ip,
        }).catch(() => {});
        res.json({ ok: true });
      } catch (e: any) {
        if (e instanceof ErrorMapeo) {
          return res.status(e.estado).json({ error: e.message, code: e.codigo });
        }
        throw e;
      }
    } catch (e) { fallo(res, e); }
  });

  /* ── Estado del canal ──────────────────────────────────────────────────── */

  /** Sin token ni contraseña: solo si hay sesión y a nombre de quién. */
  router.get("/canal", async (_req, res) => {
    try {
      const { estadoSesionTc } = await import("./sesion.ts");
      const { escrituraHabilitada, probarCanal } = await import("./conector.ts");
      const sesion = estadoSesionTc();
      if (!sesion.hayCredenciales) {
        return res.json({
          ok: false, sesion, escrituraHabilitada: escrituraHabilitada(),
          mensaje: "Falta configurar el usuario de integración de TyreControl.",
        });
      }
      res.json({ ...(await probarCanal()), sesion });
    } catch (e) { fallo(res, e); }
  });

  /**
   * Lo que se le mandaría a TyreControl al cerrar una asistencia. NO envía nada.
   */
  router.get("/simulacro/asistencia/:id", async (req, res) => {
    try {
      const { simulacroCierre } = await import("./cierreAsistencia.ts");
      const sobre = await simulacroCierre(Number(req.params.id));
      if (!sobre) return res.status(404).json({ error: "Asistencia no encontrada" });
      res.json(sobre);
    } catch (e) { fallo(res, e); }
  });

  /**
   * Marca qué operación de neumático fue esta asistencia y sobre qué rueda.
   *
   * Endpoint propio y no un campo más del PUT de asistencias: es una lista
   * blanca de cinco campos con valores acotados, y meterlo en un PUT de ciento
   * cuarenta líneas lo escondería.
   */
  router.patch("/asistencias/:id/marca", async (req, res) => {
    try {
      const { OPERACIONES_ASSIST, esResultadoReparacion, esTipoReparacion } =
        await import("./reparacion.ts");
      const b = req.body ?? {};

      const operacion = b.tcOperacion == null || b.tcOperacion === ""
        ? null : String(b.tcOperacion);
      if (operacion && !(OPERACIONES_ASSIST as readonly string[]).includes(operacion)) {
        return res.status(422).json({ error: "Operación desconocida", code: "operacion_invalida" });
      }
      const tipo = b.tcTipoReparacion == null || b.tcTipoReparacion === ""
        ? null : String(b.tcTipoReparacion);
      if (tipo && !esTipoReparacion(tipo)) {
        return res.status(422).json({ error: "Tipo de reparación desconocido", code: "tipo_invalido" });
      }
      const resultado = b.tcResultadoReparacion == null || b.tcResultadoReparacion === ""
        ? null : String(b.tcResultadoReparacion);
      if (resultado && !esResultadoReparacion(resultado)) {
        return res.status(422).json({ error: "Resultado desconocido", code: "resultado_invalido" });
      }

      const r = await db.query(
        `UPDATE roadside_assistances
            SET "tcOperacion" = $2, "tcTipoReparacion" = $3, "tcResultadoReparacion" = $4,
                "tcPosicionCodigo" = $5, "tcNeumaticoId" = $6, "updatedAtMs" = $7
          WHERE id = $1
        RETURNING id, "tcOperacion", "tcTipoReparacion", "tcResultadoReparacion",
                  "tcPosicionCodigo", "tcNeumaticoId"`,
        [Number(req.params.id), operacion, tipo, resultado,
         b.tcPosicionCodigo == null || b.tcPosicionCodigo === "" ? null : String(b.tcPosicionCodigo),
         b.tcNeumaticoId == null || b.tcNeumaticoId === "" ? null : String(b.tcNeumaticoId),
         Date.now()],
      );
      if (!r.rows.length) return res.status(404).json({ error: "Asistencia no encontrada" });
      res.json(r.rows[0]);
    } catch (e) { fallo(res, e); }
  });

  /* ── Sincronización de reparaciones ────────────────────────────────────── */

  /** Cómo va la sincronización de una asistencia, para la oficina. */
  router.get("/sync/asistencia/:id", async (req, res) => {
    try {
      const { operacionExistente, correlacionReparacion } = await import("./outbox.ts");
      const r = await db.query(
        `SELECT "tcSyncEstado", "tcSyncMotivo", "tcSyncAtMs", "tcOperacionTcId",
                "tcIncidenciaId", "tcPosicionCodigo", "tcNeumaticoId"
           FROM roadside_assistances WHERE id = $1`,
        [Number(req.params.id)],
      );
      const a = r.rows[0];
      if (!a) return res.status(404).json({ error: "Asistencia no encontrada" });

      const ref = String(a.tcPosicionCodigo ?? a.tcNeumaticoId ?? "").trim();
      const correlationId = ref ? correlacionReparacion(Number(req.params.id), ref) : null;
      const op = correlationId ? await operacionExistente(correlationId) : null;

      res.json({
        estado: a.tcSyncEstado ?? null,
        motivo: a.tcSyncMotivo ?? null,
        cuandoMs: a.tcSyncAtMs == null ? null : Number(a.tcSyncAtMs),
        operacionTcId: a.tcOperacionTcId ?? null,
        incidenciaId: a.tcIncidenciaId ?? null,
        correlationId,
        // Del outbox solo lo que sirve para diagnosticar: nunca el payload, que
        // lleva identificadores del cliente.
        outbox: op ? {
          status: op.status, intentos: Number(op.retry_count ?? 0),
          error: op.error_message ?? null, codigo: op.error_code ?? null,
        } : null,
      });
    } catch (e) { fallo(res, e); }
  });

  /**
   * Reintento a mano de lo que quedó en error o en revisión.
   *
   * Vuelve a pasar por el mismo camino, o sea que repite la lectura previa: no
   * reenvía el RPC a ciegas, porque entre el fallo y ahora la rueda puede haber
   * cambiado otra vez.
   */
  router.post("/sync/reintentar", async (req, res) => {
    try {
      const correlationId = String(req.body?.correlationId ?? "");
      if (!correlationId) {
        return res.status(422).json({ error: "Indica la referencia de la sincronización" });
      }
      const { reintentarAMano } = await import("./outbox.ts");
      res.json({ estado: await reintentarAMano(correlationId) });
    } catch (e) { fallo(res, e); }
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
