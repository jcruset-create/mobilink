/**
 * API de kilómetros mensuales para el panel de TyreControl.
 *
 * Dos cosas, con dos permisos distintos:
 *
 *   · LEER los km de un vehículo: cualquier usuario que pueda ver la empresa
 *     del vehículo (`puedeVerEmpresa`, el mismo criterio que el resto de TC).
 *     Lee de nuestra base. NUNCA llama al proveedor: abrir una ficha no puede
 *     costar una petición a Movertis.
 *
 *   · SINCRONIZAR a mano: solo administradores, sobre su empresa (un
 *     super-admin puede nombrar otra), mes a mes y con tope. Es la forma de
 *     hacer la prueba controlada —dos vehículos, un mes— y de rehacer un mes
 *     concreto. La credencial la resuelve el Hub; aquí no entra ni sale.
 *
 * La empresa se deriva de la sesión, igual que en la conciliación. Ver la
 * cabecera de `conciliacion/router.ts` para por qué no se usa `tenantOf`.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { puedeVerEmpresa } from "../empresaAcceso.ts";
import { empresaDe, resolverSolicitante, type Solicitante } from "../conciliacion/router.ts";
import { listMonthlyMileage, getSyncState, listConnectorConfigs } from "../../integration-hub/infrastructure/repositories.ts";
import { syncMonthlyMileage } from "../../integration-hub/application/services/MonthlyMileageSyncService.ts";
import { entidadSyncDe } from "../../integration-hub/application/services/MonthlyMileageSyncService.ts";
import { compararMeses, mesDe, mesesEntre, ZONA_HORARIA_POR_DEFECTO, type Mes } from "../../integration-hub/domain/meses.ts";
import { resumirKilometraje } from "./resumen.ts";

/** Cuántos meses se pueden pedir de golpe a mano. Más es un job, no un botón. */
const MAX_MESES_MANUAL = 12;

type Peticion = Request & { solicitante?: Solicitante };

/** Sesión → usuario. Sin rol: para leer basta con poder ver la empresa. */
async function usuarioDe(req: Request): Promise<{ userId: string; esSuperadmin: boolean } | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await supabase
    .from("tc_usuarios").select("es_superadmin, activo").eq("id", data.user.id).maybeSingle();
  if (!perfil || (perfil as any).activo === false) return null;
  return { userId: data.user.id, esSuperadmin: (perfil as any).es_superadmin === true };
}

function fallo(res: Response, e: unknown) {
  console.error("[km-mensual] error:", (e as any)?.message ?? e);
  return res.status(500).json({ error: "Error en los kilómetros mensuales" });
}

function mesDeCuerpo(v: unknown): Mes | null {
  const year = Number((v as any)?.year);
  const month = Number((v as any)?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function createKilometrajeMensualRouter(): Router {
  const router = Router();
  router.use(json({ limit: "64kb" }));

  /**
   * Los km mensuales de un vehículo, desde nuestra base.
   *
   * El vehículo dice a qué empresa pertenece; la sesión dice si se puede ver.
   * La respuesta ya trae el año en curso y la media calculados: la ficha no
   * suma nada, y así los dos números salen iguales en todas las pantallas.
   */
  router.get("/vehiculo/:id", async (req, res) => {
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });

      const vehiculoId = String(req.params.id ?? "").trim();
      const { data: v } = await supabase
        .from("tc_vehiculos").select("id, empresa_id").eq("id", vehiculoId).maybeSingle();
      // Mismo mensaje para «no existe» y «no es tuyo»: no se confirma nada.
      if (!v) return res.status(404).json({ error: "Vehículo no encontrado" });
      const empresaId = String((v as any).empresa_id ?? "");
      const puede = await puedeVerEmpresa({ userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, empresaId);
      if (!puede) return res.status(404).json({ error: "Vehículo no encontrado" });

      // ¿Tiene la empresa alguna cuenta de telemática? Sin ella, la ficha no
      // enseña el bloque; con ella y sin filas, enseña «todavía sin datos».
      const configs = await listConnectorConfigs(empresaId);
      const hayTelemetria = configs.some((c: any) => c.enabled && ["movertis", "webfleet"].includes(c.connector_key));

      const filas = await listMonthlyMileage({ tenantId: empresaId, mobilinkId: vehiculoId });
      const zona = String((configs.find((c: any) => c.enabled)?.config as any)?.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO);
      res.json({ vehiculoId, empresaId, hayTelemetria, ...resumirKilometraje(filas, mesDe(new Date(), zona)) });
    } catch (e) {
      fallo(res, e);
    }
  });

  // ── Lo de abajo exige administrador ──────────────────────────────────────
  router.use(async (req, res, next) => {
    try {
      const solicitante = await resolverSolicitante(req);
      if (!solicitante) return res.status(401).json({ error: "Solo un administrador de TyreControl puede sincronizar" });
      (req as Peticion).solicitante = solicitante;
      next();
    } catch (e) {
      fallo(res, e);
    }
  });

  /** La última auditoría de cada cuenta de la empresa. Para el informe. */
  router.get("/estado", async (req, res) => {
    try {
      const empresaId = empresaDe((req as Peticion).solicitante!, req.query.empresa);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const { resolveTelematicsConnectors } = await import("../../integration-hub/connectors/ConnectorRegistry.ts");
      const cuentas = await resolveTelematicsConnectors(empresaId);
      const estados = await Promise.all(cuentas.map(async (c) => {
        const s = await getSyncState(empresaId, entidadSyncDe(c.key, c.accountKey));
        let detalle: unknown = null;
        try { detalle = s?.detail ? JSON.parse(String(s.detail)) : null; } catch { detalle = null; }
        return {
          connectorKey: c.key, accountKey: c.accountKey, nombre: c.nombre,
          ultimaMs: s?.last_sync_ms == null ? null : Number(s.last_sync_ms),
          status: s?.status ?? null, detalle,
        };
      }));
      res.json({ empresaId, cuentas: estados });
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Sincronizar a mano.
   *
   * Cuerpo: { empresaId?, connectorKey, accountKey, desde?, hasta?, vehiculoIds?, forzar? }.
   * Sin `desde`/`hasta`: el mes en curso. Con ellos: cada mes del rango, uno a
   * uno, con tope de 12. `vehiculoIds` acota a esos vehículos de TyreControl.
   */
  router.post("/sincronizar", async (req, res) => {
    try {
      const empresaId = empresaDe((req as Peticion).solicitante!, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const connectorKey = String(req.body?.connectorKey ?? "").trim();
      const accountKey = String(req.body?.accountKey ?? "").trim();
      if (!connectorKey || !accountKey) return res.status(400).json({ error: "Falta el proveedor o la cuenta" });

      let meses: Mes[] | undefined;
      if (req.body?.desde || req.body?.hasta) {
        const desde = mesDeCuerpo(req.body?.desde ?? req.body?.hasta);
        const hasta = mesDeCuerpo(req.body?.hasta ?? req.body?.desde);
        if (!desde || !hasta) return res.status(400).json({ error: "Mes inválido: se espera {year, month}" });
        if (compararMeses(desde, hasta) > 0) return res.status(400).json({ error: "«desde» es posterior a «hasta»" });
        meses = mesesEntre(desde, hasta);
        if (meses.length > MAX_MESES_MANUAL) {
          return res.status(400).json({ error: `Como mucho ${MAX_MESES_MANUAL} meses de una vez; has pedido ${meses.length}` });
        }
        // Un mes futuro no tiene kilómetros: se rechaza en vez de gastar cupo.
        const actual = mesDe(new Date());
        if (compararMeses(hasta, actual) > 0) return res.status(400).json({ error: "No se puede pedir un mes futuro" });
      } else {
        meses = [mesDe(new Date())];
      }

      const vehiculoIds = Array.isArray(req.body?.vehiculoIds)
        ? req.body.vehiculoIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
        : undefined;

      const r = await syncMonthlyMileage({
        tenantId: empresaId, connectorKey, accountKey, meses,
        mobilinkIds: vehiculoIds?.length ? vehiculoIds : undefined,
        forzar: req.body?.forzar === true,
      });
      res.json(r);
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
