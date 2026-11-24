/**
 * Dar de baja (o volver a dar de alta) a un empleado en Core.
 *
 * ## La baja en Core es la baja en todos los módulos
 *
 * En el mismo paso, y en la misma transacción, la persona queda de baja en
 * cada módulo donde esté enlazada (`employee_id`):
 *
 *  · Taller (`techs`): igual que la baja de la pantalla Técnicos — deja de
 *    ofrecerse para asignar, se le libera el trabajo en curso y se le retiran
 *    los PIN de la tablet. El histórico se conserva.
 *  · Almacén (`perfiles_usuario`), TyreControl (`tc_usuarios`) y su usuario
 *    de acceso web (`app_usuarios`): `activo = false`.
 *
 * Recepciones, Presencia, Safety y ToolControl no se tocan: ya leen la baja
 * directamente de Core. Cash tampoco: la persona sigue existiendo para la
 * contabilidad de sus gastos.
 *
 * ## Por qué se escribe en cada módulo, y no «se lee de Core»
 *
 * Cada módulo decide quién entra mirando SU `activo`: políticas RLS de
 * Supabase, logins de APK, el `authenticate` del servidor. Reescribir todo eso
 * para que mire a Core es mucho más cambio y más riesgo que desactivar a la
 * persona donde cada módulo ya sabe mirar. No es una copia de datos ni un
 * trigger: es la misma acción, «dar de baja», hecha en todos los sitios a la
 * vez, a petición de un administrador y con su apunte en la auditoría.
 *
 * ## La vuelta no es automática
 *
 * Volver a dar de alta en Core NO reactiva los módulos: no se puede saber en
 * cuáles estaba de baja a propósito, y a Taller habría que volver a ponerle
 * los PIN. Se reactiva a mano en cada uno; la respuesta dice en cuáles sigue
 * de baja.
 */

import { Router, json, type Request, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
/** El pool (se abre transacción en un cliente suyo) o un cliente ya cogido. */
type Ejecutor = { query: Consulta; connect?: () => Promise<{ query: Consulta; release: () => void }>; release?: () => void };

export class ErrorBaja extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

type Modulo = {
  clave: "taller" | "almacen" | "tyrecontrol" | "acceso";
  nombre: string;
  tabla: string;
  /** Cómo se llama a la fila en el módulo. */
  etiqueta: string;
  /** Qué significa estar de alta en el módulo (sobre la tabla sin alias). */
  deAlta: string;
  /** El SET de la baja. `$2` es la hora, en milisegundos. */
  baja: string;
};

/**
 * La baja del técnico es la misma que la de `PUT /api/techs/:name/activo`
 * (server/index.ts): si allí se retira algo más al dar de baja, aquí también.
 */
const MODULOS: readonly Modulo[] = [
  {
    clave: "taller",
    nombre: "Taller",
    tabla: "techs",
    etiqueta: "name",
    deAlta: "activo IS DISTINCT FROM false",
    baja: `activo = false, status = 'baja', blocked = true, "currentJobId" = NULL,
           "roadsideOperatorCode" = NULL, "workshopPin" = NULL, "statusChangedAtMs" = $2`,
  },
  {
    clave: "almacen",
    nombre: "Almacén",
    tabla: "perfiles_usuario",
    etiqueta: "COALESCE(NULLIF(nombre, ''), email)",
    deAlta: "activo IS DISTINCT FROM false",
    baja: "activo = false",
  },
  {
    clave: "tyrecontrol",
    nombre: "TyreControl",
    tabla: "tc_usuarios",
    etiqueta: "nombre",
    deAlta: "activo IS DISTINCT FROM false",
    baja: "activo = false",
  },
  {
    clave: "acceso",
    nombre: "Acceso web",
    tabla: "app_usuarios",
    etiqueta: "username",
    deAlta: "activo IS DISTINCT FROM false",
    baja: "activo = false, updated_at = now()",
  },
];

export type EfectoModulo = { clave: Modulo["clave"]; nombre: string; usuarios: string[] };

export type ResultadoBaja = {
  id: string;
  nombre: string;
  activo: boolean;
  /** Al dar de baja: dónde se le ha dado de baja además de en Core. */
  bajaEn: EfectoModulo[];
  /** Al volver a dar de alta: dónde sigue de baja y hay que reactivarle a mano. */
  sigueDeBajaEn: EfectoModulo[];
};

/** ¿La tabla del módulo existe y ya tiene `employee_id`? Si no, se salta. */
async function enlazable(q: Consulta, tabla: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT to_regclass($1) IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_name = $1 AND column_name = 'employee_id'
                 AND table_schema = ANY (current_schemas(false))
            ) AS ok`,
    [tabla]
  );
  return rows[0]?.ok === true;
}

async function enTransaccion<T>(cx: Ejecutor, trabajo: (q: Consulta) => Promise<T>): Promise<T> {
  // Con el pool hay que coger UN cliente: BEGIN y COMMIT sueltos irían cada
  // uno por una conexión distinta.
  const cliente = cx.release || !cx.connect ? null : await cx.connect();
  const q: Consulta = cliente ? (s, p) => cliente.query(s, p) : (s, p) => cx.query(s, p);
  await q("BEGIN");
  try {
    const r = await trabajo(q);
    await q("COMMIT");
    return r;
  } catch (err) {
    await q("ROLLBACK");
    throw err;
  } finally {
    cliente?.release();
  }
}

/**
 * Da de baja o de alta a un empleado.
 *
 * @param quienUserId  quien lo pide: no puede darse de baja a sí mismo (se
 *                     quedaría sin acceso en el acto).
 */
export async function cambiarActivoEmpleado(
  employeeId: string,
  activo: boolean,
  quienUserId: string | null,
  cx: Ejecutor = db as unknown as Ejecutor
): Promise<ResultadoBaja> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new ErrorBaja(404, "Ese empleado no existe.");

  return enTransaccion(cx, async (q) => {
    const { rows } = await q(
      `SELECT id::text AS id, nombre, apellidos, activo FROM sea_employees WHERE id = $1 FOR UPDATE`,
      [employeeId]
    );
    const empleado = rows[0];
    if (!empleado) throw new ErrorBaja(404, "Ese empleado no existe.");
    const nombre = [empleado.nombre, empleado.apellidos].filter(Boolean).join(" ").trim();

    const tablas: Modulo[] = [];
    for (const m of MODULOS) if (await enlazable(q, m.tabla)) tablas.push(m);

    if (!activo && quienUserId && tablas.some((m) => m.clave === "acceso")) {
      const { rows: yo } = await q(
        `SELECT 1 FROM app_usuarios WHERE employee_id = $1 AND id::text = $2`,
        [employeeId, quienUserId]
      );
      if (yo[0]) {
        throw new ErrorBaja(409, "No puedes darte de baja a ti mismo: te quedarías sin acceso. Que lo haga otro administrador.", "UNO_MISMO");
      }
    }

    // `fecha_baja` se pone si no la tenía y se quita al volver: es la fecha de
    // ESTA baja, no un histórico.
    await q(
      `UPDATE sea_employees
          SET activo = $2,
              fecha_baja = CASE WHEN $2 THEN NULL ELSE COALESCE(fecha_baja, CURRENT_DATE) END,
              updated_at = now()
        WHERE id = $1`,
      [employeeId, activo]
    );

    const bajaEn: EfectoModulo[] = [];
    const sigueDeBajaEn: EfectoModulo[] = [];
    for (const m of tablas) {
      if (!activo) {
        const params: unknown[] = [employeeId];
        if (m.baja.includes("$2")) params.push(Date.now());
        const { rows: hechos } = await q(
          `UPDATE ${m.tabla} SET ${m.baja}
            WHERE employee_id = $1 AND ${m.deAlta}
        RETURNING ${m.etiqueta} AS etiqueta`,
          params
        );
        if (hechos.length) bajaEn.push({ clave: m.clave, nombre: m.nombre, usuarios: hechos.map((h) => String(h.etiqueta ?? "")) });
      } else {
        const { rows: parados } = await q(
          `SELECT ${m.etiqueta} AS etiqueta FROM ${m.tabla} WHERE employee_id = $1 AND NOT (${m.deAlta})`,
          [employeeId]
        );
        if (parados.length) {
          sigueDeBajaEn.push({ clave: m.clave, nombre: m.nombre, usuarios: parados.map((h) => String(h.etiqueta ?? "")) });
        }
      }
    }

    return { id: employeeId, nombre, activo, bajaEn, sigueDeBajaEn };
  });
}

/** `/api/core/empleados/:id/activo`: solo administradores. */
export function createBajaEmpleadoRouter(
  opciones: { autenticar?: RequestHandler; ejecutor?: Ejecutor } = {}
): Router {
  const r = Router();

  r.put(
    "/:employeeId/activo",
    opciones.autenticar ?? authenticate,
    requireAdmin,
    json(),
    async (req: Request, res: Response) => {
      const employeeId = String(req.params.employeeId ?? "");
      if (typeof req.body?.activo !== "boolean") {
        return res.status(400).json({ error: "Falta decir si queda activo o de baja." });
      }
      try {
        const hecho = await cambiarActivoEmpleado(
          employeeId,
          req.body.activo,
          req.authCtx!.userId ?? null,
          opciones.ejecutor
        );
        await registrarAuditoria({
          empresaId: req.authCtx!.empresaId,
          userId: req.authCtx!.userId,
          accion: hecho.activo ? "core.empleado.alta" : "core.empleado.baja",
          entidad: "sea_employees",
          entidadId: employeeId,
          detalle: { bajaEn: hecho.bajaEn, sigueDeBajaEn: hecho.sigueDeBajaEn },
          ip: req.ip,
        });
        res.json(hecho);
      } catch (err) {
        if (err instanceof ErrorBaja) {
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        console.error("PUT /api/core/empleados/:id/activo:", err);
        res.status(500).json({ error: "No se ha podido cambiar el alta del empleado." });
      }
    }
  );

  return r;
}
