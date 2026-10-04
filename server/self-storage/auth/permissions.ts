/**
 * Permisos internos de Self Storage.
 *
 * No se estrena un sistema de usuarios (ARCHITECTURE.md §4): el empleado es un
 * usuario de `app_usuarios` con una fila en `app_usuario_modulos` para el
 * módulo `self-storage`, cuyo `rol` se traduce aquí a permisos finos. Mismo
 * patrón que Recepciones, Therefore y Cash.
 *
 * Los CLIENTES que alquilan trasteros no pasan nunca por aquí: no están en
 * `app_usuarios` (su identidad vive en `self_storage_customers.auth_user_id`)
 * y tendrán su propia guarda, la del portal, en la fase 4.
 *
 * Sin caché: quitarle el rol a alguien surte efecto en la siguiente petición.
 */

import type { RequestHandler } from "express";
import type { StaffRole } from "../../../src/modules/self-storage/types/enums.ts";

export const MODULO = "self-storage";

export const PERMISOS = [
  /** Dashboard, centros, zonas, tipos, trasteros y plano (sin datos de clientes). */
  "ss.view",
  /** Ver clientes y quién ocupa cada trastero. */
  "ss.customers.view",
  /** Alta y modificación de clientes y de sus teléfonos. */
  "ss.customers.manage",
  /** Poner o quitar un trastero en mantenimiento / bloqueado. */
  "ss.units.status",
  /** Alta y edición de trasteros, tipos y precios. */
  "ss.units.manage",
  /** Alta y edición de centros y zonas. */
  "ss.centers.manage",
  /** Subir el plano y vincular formas con trasteros. */
  "ss.floorplan.manage",
  /** Importar trasteros desde CSV. */
  "ss.import",
  /** Consultar la auditoría. */
  "ss.audit.view",
  /** Ver contratos y su historial. */
  "ss.contracts.view",
  /** Crear, editar en borrador, emitir, firmar en presencia, cobrar, suspender y cancelar. */
  "ss.contracts.manage",
  /** Lo sensible: activar sin cobro (excepción), finalizar, levantar bloqueos de seguridad. */
  "ss.contracts.admin",
  /** Ver facturas, pagos e impagos. */
  "ss.billing.view",
  /** Facturas manuales, registrar pagos en efectivo/transferencia. */
  "ss.billing.manage",
  /** Anular (rectificar) facturas, catálogo de conceptos. */
  "ss.billing.admin",
  /** Configuración del módulo (emisor, series, plazos, condiciones). */
  "ss.settings.manage",
  /** Fase 3 · ver puertas y dispositivos con su estado (sin datos de clientes). */
  "ss.doors.view",
  /** Fase 3 · «Probar conexión» de un dispositivo. */
  "ss.devices.test",
  /** Fase 3 · eventos de acceso, permisos, personas autorizadas y temporales (con datos de clientes). */
  "ss.access.view",
  /** Fase 3 · abrir una puerta desde el panel (apertura administrativa, auditada). */
  "ss.access.open",
  /** Fase 3 · personas autorizadas, permisos manuales y accesos temporales. */
  "ss.access.manage",
  /** Fase 3 · alta y configuración de dispositivos, salidas y puertas; sincronizar. */
  "ss.devices.manage",
  /** Call Center · ver: dashboard, llamadas, ficha MÍNIMA de quien llama, centro, disponibilidad, logs. */
  "ss.callcenter.view",
  /** Call Center · registrar llamadas nuevas. */
  "ss.callcenter.create",
  /** Call Center · resultado, resumen, notas, seguimiento y cierre de una llamada. */
  "ss.callcenter.edit",
  /** Call Center · escalar una llamada a la empresa (TLC u otra). */
  "ss.callcenter.escalate",
  /** Call Center · catálogo de motivos y resultados. */
  "ss.callcenter.configure",
  /** Incidencias (única entidad del módulo) · ver, abrir y gestionar. */
  "ss.incidents.view",
  "ss.incidents.create",
  "ss.incidents.manage",
  /** Asistente IA · ver su dashboard y sesiones y usar la consola de prueba. */
  "ss.ai.view",
  /** Asistente IA · configuración, proveedores y reglas. */
  "ss.ai.configure",
  /** Asistente IA · base de conocimiento. */
  "ss.ai.knowledge.manage",
  /** Asistente IA · activar herramientas y su confirmación. */
  "ss.ai.tools.manage",
  /** Asistente IA · logs de herramientas y errores. */
  "ss.ai.logs.view",
  /** Asistente IA · revisión de calidad de las sesiones. */
  "ss.ai.review",
] as const;

export type Permiso = (typeof PERMISOS)[number];

/**
 * · maintenance — el box y su estado; nada de clientes.
 * · employee    — mostrador: clientes y estados.
 * · call_center — atención telefónica: llamadas, ficha mínima, incidencias y
 *                 escalado. Nada de precios, contratos, pagos ni usuarios.
 * · admin       — todo lo del módulo.
 * · superadmin  — el superadministrador de Mobilink (`es_superadmin`).
 */
const POR_ROL: Record<StaffRole, readonly Permiso[]> = {
  maintenance: ["ss.view", "ss.units.status", "ss.doors.view", "ss.devices.test", "ss.incidents.view", "ss.incidents.manage"],
  // Mínimo privilegio: ni `ss.view` (trasteros con precio) ni clientes completos.
  call_center: [
    "ss.callcenter.view",
    "ss.callcenter.create",
    "ss.callcenter.edit",
    "ss.callcenter.escalate",
    "ss.incidents.view",
    "ss.incidents.create",
    "ss.ai.view",
  ],
  employee: [
    "ss.view",
    "ss.customers.view",
    "ss.customers.manage",
    "ss.units.status",
    "ss.contracts.view",
    "ss.contracts.manage",
    "ss.billing.view",
    "ss.billing.manage",
    "ss.doors.view",
    "ss.devices.test",
    "ss.access.view",
    "ss.access.open",
    "ss.access.manage",
    "ss.callcenter.view",
    "ss.callcenter.create",
    "ss.callcenter.edit",
    "ss.callcenter.escalate",
    "ss.incidents.view",
    "ss.incidents.create",
    "ss.incidents.manage",
    "ss.ai.view",
    "ss.ai.logs.view",
    "ss.ai.review",
  ],
  admin: PERMISOS,
  superadmin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as StaffRole] ?? [];
}

declare module "express-serve-static-core" {
  interface Request {
    ssRol?: StaffRole | null;
    ssPermisos?: readonly Permiso[];
  }
}

/** Rol del usuario en el módulo. Un superadmin de Mobilink lo es aquí sin fila. */
export async function rolDeSelfStorage(
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: { rol: string }[] }> },
  userId: string,
  esSuperadmin: boolean
): Promise<StaffRole | null> {
  if (esSuperadmin) return "superadmin";
  const { rows } = await db.query(`SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = $2`, [userId, MODULO]);
  const rol = rows[0]?.rol ?? null;
  // Un rol que no es de este módulo (p. ej. un «superadmin» escrito a mano en
  // la fila) no da nada: el superadmin sale de app_usuarios, no de aquí.
  return rol === "admin" || rol === "employee" || rol === "maintenance" || rol === "call_center" ? rol : null;
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export function cargarPermisos(db: Parameters<typeof rolDeSelfStorage>[0]): RequestHandler {
  return async (req, res, next) => {
    const ctx = req.authCtx;
    if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
    try {
      const rol = await rolDeSelfStorage(db, ctx.userId, ctx.esSuperadmin);
      req.ssRol = rol;
      req.ssPermisos = permisosDeRol(rol);
      if (!rol) {
        return res.status(403).json({ error: "Tu usuario no tiene acceso a Self Storage.", code: "SIN_ACCESO" });
      }
      next();
    } catch (e) {
      console.error("[Self Storage] error cargando permisos:", e);
      res.status(500).json({ error: "Error comprobando permisos" });
    }
  };
}

export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.ssPermisos?.includes(permiso)) {
      return res.status(403).json({ error: "No tienes permiso para hacer esto en Self Storage.", code: "PERMISO_DENEGADO", permiso });
    }
    next();
  };
}
