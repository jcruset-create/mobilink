/**
 * API interna de Self Storage: `/api/self-storage/admin/*`.
 *
 * Encadenado: `authenticate` (sesión unificada de Supabase de un EMPLEADO) →
 * `requireModule("self-storage")` (licencia vigente) → `cargarPermisos` (rol
 * en `app_usuario_modulos`). Un cliente que alquila un trastero no tiene fila
 * en `app_usuarios`, así que `authenticate` ya lo rechaza aquí: el portal del
 * cliente tendrá su propio prefijo y su propia guarda (fase 4).
 *
 * La empresa sale SIEMPRE de la sesión (`req.authCtx`), nunca del cuerpo. El
 * superadministrador puede elegir con qué empresa trabaja (`auth/empresa.ts`):
 * lo valida el servidor y sólo a él.
 */

import { Router } from "express";
import { authenticate, requireModule } from "../core/auth.ts";
import { cargarPermisos, exigirPermiso, MODULO } from "./auth/permissions.ts";
import { empresaActiva, empresasConSelfStorage, nombreEmpresa } from "./auth/empresa.ts";
import { actorDe, esUuid, ruta } from "./http.ts";
import { pool } from "./shared/db.ts";
import { listarCentros } from "./modules/centros/service.ts";
import { routerCentros } from "./modules/centros/router.ts";
import { routerTrasteros } from "./modules/trasteros/router.ts";
import { routerPlano } from "./modules/plano/router.ts";
import { routerClientes } from "./modules/clientes/router.ts";
import { routerImportacion } from "./modules/importacion/router.ts";
import { routerDashboard } from "./modules/dashboard/router.ts";
import { routerContratos } from "./modules/contratos/router.ts";
import { routerFacturacion } from "./modules/facturas/router.ts";
import { routerAccesos } from "./modules/accesos/router.ts";
import { routerCallCenter } from "./modules/callcenter/router.ts";
import { routerIncidencias } from "./modules/incidencias/router.ts";
import {
  CONTRACT_STATUSES,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  ETIQUETA_CONTRACT_STATUS,
  ETIQUETA_CUSTOMER_STATUS,
  ETIQUETA_CUSTOMER_TYPE,
  ETIQUETA_UNIT_STATUS,
  ETIQUETA_INVOICE_STATUS,
  ETIQUETA_ITEM_TYPE,
  ETIQUETA_PAYMENT_METHOD,
  ETIQUETA_PAYMENT_STATUS,
  ETIQUETA_BLOCK_REASON,
  ETIQUETA_ACCESS_REASON,
  ETIQUETA_ACCESS_METHOD,
  ETIQUETA_DOOR_TYPE,
  ETIQUETA_CONNECTION_TYPE,
  ETIQUETA_CALL_STATUS,
  ETIQUETA_CALL_HANDLER,
  ETIQUETA_CALL_DIRECTION,
  ETIQUETA_PRIORITY,
  ETIQUETA_INCIDENT_TYPE,
  ETIQUETA_INCIDENT_STATUS,
  UNIT_STATUSES,
} from "../../src/modules/self-storage/types/enums.ts";

export function createSelfStorageAdminRouter(): Router {
  const r = Router();
  r.use(authenticate, empresaActiva(pool), requireModule(MODULO), cargarPermisos(pool));

  r.get(
    "/bootstrap",
    ruta(async (req, res) => {
      const actor = actorDe(req);
      res.json({
        empresa: { id: actor.empresaId, nombre: (await nombreEmpresa(pool, actor.empresaId)) ?? "" },
        // Sólo el superadministrador elige empresa; al resto no se le enseña la lista.
        empresas: req.authCtx?.esSuperadmin ? await empresasConSelfStorage(pool) : null,
        rol: req.ssRol ?? null,
        permisos: req.ssPermisos ?? [],
        usuario: { id: actor.userId, nombre: actor.nombre },
        centros: (await listarCentros(actor)).map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status })),
        // El vocabulario lo manda el servidor: el panel no guarda otra copia.
        vocabulario: {
          unitStatuses: UNIT_STATUSES,
          customerStatuses: CUSTOMER_STATUSES,
          customerTypes: CUSTOMER_TYPES,
          contractStatuses: CONTRACT_STATUSES,
          etiquetas: {
            unitStatus: ETIQUETA_UNIT_STATUS,
            customerStatus: ETIQUETA_CUSTOMER_STATUS,
            customerType: ETIQUETA_CUSTOMER_TYPE,
            contractStatus: ETIQUETA_CONTRACT_STATUS,
            invoiceStatus: ETIQUETA_INVOICE_STATUS,
            itemType: ETIQUETA_ITEM_TYPE,
            paymentMethod: ETIQUETA_PAYMENT_METHOD,
            paymentStatus: ETIQUETA_PAYMENT_STATUS,
            blockReason: ETIQUETA_BLOCK_REASON,
            accessReason: ETIQUETA_ACCESS_REASON,
            accessMethod: ETIQUETA_ACCESS_METHOD,
            doorType: ETIQUETA_DOOR_TYPE,
            connectionType: ETIQUETA_CONNECTION_TYPE,
            callStatus: ETIQUETA_CALL_STATUS,
            callHandler: ETIQUETA_CALL_HANDLER,
            callDirection: ETIQUETA_CALL_DIRECTION,
            priority: ETIQUETA_PRIORITY,
            incidentType: ETIQUETA_INCIDENT_TYPE,
            incidentStatus: ETIQUETA_INCIDENT_STATUS,
          },
        },
      });
    })
  );

  r.use(routerDashboard());
  r.use(routerCentros());
  r.use(routerTrasteros());
  r.use(routerPlano());
  r.use(routerClientes());
  r.use(routerImportacion());
  r.use(routerContratos());
  r.use(routerFacturacion());
  r.use(routerAccesos());
  r.use(routerIncidencias());
  r.use(routerCallCenter());

  r.get(
    "/audit",
    exigirPermiso("ss.audit.view"),
    ruta(async (req, res) => {
      const actor = actorDe(req);
      const vals: unknown[] = [actor.empresaId];
      const cond = ["empresa_id = $1"];
      if (typeof req.query.entityType === "string" && /^[a-z_]{1,40}$/.test(req.query.entityType)) {
        vals.push(req.query.entityType);
        cond.push(`entity_type = $${vals.length}`);
      }
      if (esUuid(req.query.entityId)) {
        vals.push(req.query.entityId);
        cond.push(`entity_id = $${vals.length}`);
      }
      const { rows } = await pool.query(
        `SELECT id, occurred_at AS "occurredAt", actor_type AS "actorType", actor_name AS "actorName", action,
                entity_type AS "entityType", entity_id AS "entityId", before, after
           FROM self_storage_audit_logs WHERE ${cond.join(" AND ")}
          ORDER BY occurred_at DESC LIMIT 200`,
        vals
      );
      res.json(rows);
    })
  );

  return r;
}
