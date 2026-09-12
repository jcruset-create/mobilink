/**
 * API de la conciliación telemática.
 *
 * ── Por qué vive aquí y no en el router del Integration Hub ─────────────────
 *
 * El Hub resuelve su tenant con `tenantOf(req)`, que lee `x-tenant-id`, el
 * cuerpo o la query, y lo protege con una credencial global de administrador.
 * Ese modelo funciona para un panel de integraciones que maneja un
 * administrador de la casa, pero no vale aquí: la conciliación la usa un
 * administrador DE UN CLIENTE, y aceptar la empresa que venga en una cabecera
 * le dejaría conciliar la flota de otro. Cambiar `tenantOf` afectaría a todos
 * los endpoints del Hub y no toca en esta fase.
 *
 * Así que la empresa se deriva de la sesión de TyreControl, exactamente igual
 * que hacen los endpoints de gestión de usuarios de `server/index.ts`: se
 * valida el token contra Supabase, se lee el perfil de `tc_usuarios`, y un
 * administrador normal solo opera sobre su empresa. Un super-admin puede
 * nombrar otra, y solo él.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { normalizarMatricula } from "../matricula.ts";
import { conciliarFlota } from "../../integration-hub/application/services/VehicleReconciliationService.ts";
import { listIgnoredExternals, nextCorrelationId } from "../../integration-hub/infrastructure/repositories.ts";
import { leerFlotaInterna } from "./flota.ts";
import { leerEstado } from "./estado.ts";
import { METODOS_VINCULO, type MetodoVinculo } from "../../integration-hub/domain/reconciliation.ts";
import {
  crearPendiente,
  crearPendientesLote,
  darDeBaja,
  dejarDeIgnorar,
  desvincular,
  ErrorConciliacion,
  ignorar,
  ignorarLote,
  vincular,
  vincularLote,
  type Ambito,
} from "./acciones.ts";

/** Perfil del que llama, resuelto contra la base. Nunca contra la petición. */
export interface Solicitante {
  usuarioId: string;
  empresaPropia: string;
  esSuperadmin: boolean;
}

export async function resolverSolicitante(req: Request): Promise<Solicitante | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: perfil } = await supabase
    .from("tc_usuarios")
    .select("id, rol, empresa_id, es_superadmin, activo")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!perfil || (perfil as any).activo === false) return null;

  const esSuperadmin = (perfil as any).es_superadmin === true;
  // La conciliación crea vehículos y da de baja: es cosa de administradores.
  if (!esSuperadmin && (perfil as any).rol !== "administrador") return null;

  return {
    usuarioId: String((perfil as any).id),
    empresaPropia: String((perfil as any).empresa_id ?? ""),
    esSuperadmin,
  };
}

/**
 * Qué empresa se va a tocar.
 *
 * Un administrador normal: la suya, y punto — lo que pida en la petición se
 * ignora, no se rechaza, porque no hay nada que negociar. Un super-admin puede
 * nombrar otra, y si no nombra ninguna se usa la suya.
 */
export function empresaDe(solicitante: Solicitante, pedida: unknown): string | null {
  if (!solicitante.esSuperadmin) return solicitante.empresaPropia || null;
  const p = String(pedida ?? "").trim();
  return p || solicitante.empresaPropia || null;
}

/**
 * La petición después del guarda.
 *
 * El perfil se resuelve una vez, en el middleware, y viaja aquí. Tiparlo evita
 * repartir `(req as any)` por cada endpoint, que además de feo esconde el día
 * en que alguien lea el perfil en una ruta que no pasa por el guarda.
 */
type PeticionConciliacion = Request & { solicitante: Solicitante };

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorConciliacion) {
    return res.status(e.estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[conciliacion] error:", (e as any)?.message ?? e);
  return res.status(500).json({ error: "Error en la conciliación" });
}

/**
 * El método del enlace, filtrado.
 *
 * Llegaba del cuerpo tal cual, así que un cliente podía declarar cualquier
 * procedencia —incluido `automatic_plate_exact`, que solo debería escribir el
 * repaso, o `created_from_provider`, que solo debería escribir un alta—. No es
 * un agujero de permisos, pero sí de trazabilidad: el `match_method` existe
 * para poder contestar «¿de dónde salió este vínculo?», y si el navegador lo
 * dicta, contesta lo que le convenga.
 *
 * Por la red solo se admiten los dos que una persona puede elegir de verdad en
 * la pantalla. Cualquier otra cosa cae a `manual`, que es lo que de hecho está
 * pasando: alguien lo está enlazando a mano.
 */
function metodoPedido(valor: unknown): MetodoVinculo {
  return valor === METODOS_VINCULO.MATRICULA_EXACTA
    ? METODOS_VINCULO.MATRICULA_EXACTA
    : METODOS_VINCULO.MANUAL;
}

/** Ámbito común a todas las acciones, ya validado. */
function ambitoDe(empresaId: string, body: any): Ambito {
  const connectorKey = String(body?.connectorKey ?? "").trim();
  const accountKey = String(body?.accountKey ?? "").trim();
  if (!connectorKey) {
    throw new ErrorConciliacion("SIN_CONECTOR", "Falta el proveedor telemático.");
  }
  // La cuenta NO cae a 'default' por su cuenta: con varias cuentas, adivinar
  // significa escribir el enlace en la plataforma equivocada.
  if (!accountKey) {
    throw new ErrorConciliacion("SIN_CUENTA", "Falta la cuenta del proveedor.");
  }
  return { empresaId, connectorKey, accountKey };
}

export function createConciliacionRouter(): Router {
  const router = Router();
  router.use(json({ limit: "256kb" }));

  // Todo lo de aquí exige sesión de administrador de TyreControl.
  router.use(async (req, res, next) => {
    try {
      const solicitante = await resolverSolicitante(req);
      if (!solicitante) {
        return res.status(401).json({ error: "Solo un administrador de TyreControl puede conciliar" });
      }
      (req as PeticionConciliacion).solicitante = solicitante;
      next();
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Cuentas telemáticas disponibles para la empresa.
   *
   * La pantalla la necesita para poder elegir, y para no asumir 'default'
   * cuando hay más de una.
   */
  router.get("/cuentas", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.query.empresa);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });

      const { resolveTelematicsConnectors } = await import(
        "../../integration-hub/connectors/ConnectorRegistry.ts"
      );
      const cuentas = await resolveTelematicsConnectors(empresaId);
      res.json({
        empresaId,
        cuentas: cuentas.map((c) => ({
          connectorKey: c.key,
          accountKey: c.accountKey,
          nombre: c.nombre,
        })),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Contadores de la ÚLTIMA conciliación guardada. No pregunta al proveedor.
   *
   * Es lo que alimenta el distintivo del menú, y por eso tiene que ser barato:
   * conciliar de verdad descarga la flota entera del proveedor, y eso no puede
   * pasar cada vez que alguien abre una pantalla cualquiera del panel.
   */
  router.get("/pendientes", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.query.empresa);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });

      const estado = await leerEstado(empresaId);
      if (!estado) {
        return res.json({ empresaId, hayDatos: false, total: 0 });
      }
      const total =
        estado.pendientes.soloProveedor +
        estado.pendientes.soloTyreControl +
        estado.pendientes.discrepancias;
      res.json({
        empresaId,
        hayDatos: true,
        total,
        pendientes: estado.pendientes,
        status: estado.status,
        ejecutadoMs: estado.ejecutadoMs,
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  /** La conciliación. Solo lee TyreControl; lo único que escribe es last_seen. */
  router.get("/", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.query.empresa);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });

      const connectorKey = req.query.connector ? String(req.query.connector) : undefined;
      const accountKey = req.query.cuenta ? String(req.query.cuenta) : undefined;

      const resultado = await conciliarFlota(
        { tenantId: empresaId, correlationId: await nextCorrelationId() },
        { connectorKey, accountKey, leerFlotaInterna, normalizarMatricula },
      );

      // Los ignorados no salen en los cuadrantes, pero la pantalla tiene que
      // poder enseñarlos para que «dejar de ignorar» sea alcanzable.
      const ignorados = connectorKey && accountKey
        ? await listIgnoredExternals({
            tenantId: empresaId,
            entityType: "vehicle",
            system: connectorKey,
            accountKey,
          })
        : [];

      res.json({
        empresaId,
        ...resultado,
        ignorados: ignorados.map((i) => ({
          externalVehicleId: i.external_code,
          motivo: i.reason,
          desde: i.created_at_ms,
        })),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/vincular", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const enlace = await vincular(ambito, {
        tcVehicleId: String(req.body?.tcVehicleId ?? ""),
        externalVehicleId: String(req.body?.externalVehicleId ?? ""),
        matchMethod: metodoPedido(req.body?.matchMethod),
        externalPlate: req.body?.externalPlate ?? null,
        externalName: req.body?.externalName ?? null,
      });
      res.json({ ok: true, enlace });
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Vincula de golpe todas las coincidencias exactas de matrícula.
   *
   * NO recibe la lista: la recalcula el servidor. Lo que llega del navegador es
   * solo cuántas creía ver, para poder rechazar una pantalla desfasada.
   */
  router.post("/vincular-lote", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const esperados =
        req.body?.esperados === undefined ? undefined : Number(req.body.esperados);
      res.json({ ok: true, ...(await vincularLote(ambito, { esperados })) });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/desvincular", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const enlace = await desvincular(ambito, {
        tcVehicleId: String(req.body?.tcVehicleId ?? ""),
        externalVehicleId: String(req.body?.externalVehicleId ?? ""),
      });
      res.json({ ok: true, enlace });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/ignorar", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const fila = await ignorar(ambito, {
        externalVehicleId: String(req.body?.externalVehicleId ?? ""),
        motivo: req.body?.motivo ?? null,
      });
      res.json({ ok: true, ignorado: fila });
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Ignorar en bloque los que se hayan marcado en la pantalla.
   *
   * Aquí la lista SÍ viene del navegador, y no es lo mismo que en
   * `/vincular-lote`: allí el servidor decide qué enlazar y no admite que se lo
   * digan; aquí es el usuario quien elige uno a uno cuáles aparta, y lo único
   * que llegan son identificadores.
   */
  router.post("/ignorar-lote", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      res.json(await ignorarLote(ambito, {
        externalVehicleIds: req.body?.externalVehicleIds,
        motivo: req.body?.motivo ?? null,
      }));
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Crear en bloque los que se hayan marcado.
   *
   * De la petición se toman los identificadores y nada más: la matrícula, el
   * bastidor y el nombre con los que se da el alta salen de lo que el proveedor
   * está devolviendo en este momento.
   */
  router.post("/crear-vehiculos-lote", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      res.json(await crearPendientesLote(ambito, {
        externalVehicleIds: req.body?.externalVehicleIds,
      }));
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/dejar-de-ignorar", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      res.json(await dejarDeIgnorar(ambito, {
        externalVehicleId: String(req.body?.externalVehicleId ?? ""),
      }));
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/crear-vehiculo", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const r = await crearPendiente(ambito, {
        externalVehicleId: String(req.body?.externalVehicleId ?? ""),
        matricula: String(req.body?.matricula ?? ""),
        bastidor: req.body?.bastidor ?? null,
        numeroUnidad: req.body?.numeroUnidad ?? null,
        externalName: req.body?.externalName ?? null,
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/dar-de-baja", async (req, res) => {
    try {
      const { solicitante } = req as PeticionConciliacion;
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });
      const ambito = ambitoDe(empresaId, req.body);
      const r = await darDeBaja(ambito, {
        tcVehicleId: String(req.body?.tcVehicleId ?? ""),
        neumaticosMontadosVistos: Number(req.body?.neumaticosMontadosVistos ?? -1),
        desvincularTambien: req.body?.desvincularTambien === true,
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
