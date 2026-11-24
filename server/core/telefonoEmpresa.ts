/**
 * El teléfono de empresa: el que la empresa le ha asignado a una persona.
 *
 * Vive en la ficha de Core (`sea_employees.telefono_empresa`) y es el que
 * enseñan los módulos. El `telefono` de siempre es el personal.
 *
 * ## Qué teléfono enseña el taller de un técnico
 *
 * Si el técnico está enlazado con Core y la columna existe, manda Core:
 *
 *  · el de empresa, si tiene;
 *  · si no, el personal de Core, pero SOLO para un administrador del panel;
 *  · si no, ninguno.
 *
 * El personal no se enseña a las pantallas ni a los demás roles, y nunca al
 * cliente: en la página de seguimiento de una asistencia solo sale el de
 * empresa. Un móvil personal no se publica porque alguien lo apuntó en una
 * ficha de recursos humanos.
 *
 * `techs.phone` solo vale ya para los técnicos SIN enlazar (y para todos
 * mientras `core_telefono_empresa.sql` no esté ejecutada, que es además la
 * que pasa esos teléfonos a Core). Para un enlazado no se usa de respaldo:
 * si no, quitarle el teléfono en Core haría reaparecer el viejo del taller.
 */

import { Router, json, type Request, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { hayCore } from "./hayCore.ts";

type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export class ErrorTelefono extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/**
 * Cómo se guarda: sin espacios, puntos, guiones ni paréntesis. Se conserva el
 * `+` del prefijo. Vacío → `null` (quitar el teléfono).
 */
export function normalizarTelefono(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const v = String(valor).replace(/[\s.()-]/g, "");
  return v === "" ? null : v;
}

/**
 * Qué le pasa a un teléfono ya normalizado, o `null` si vale. Se admite
 * cualquier número razonable (un móvil, un fijo con prefijo, una extensión
 * corta): no solo móviles españoles, que es lo que exige el alta por enlace.
 */
export function errorDeTelefono(telefono: string): string | null {
  if (!/^\+?\d+$/.test(telefono)) return "El teléfono solo puede llevar cifras y, delante, el + del prefijo.";
  const cifras = telefono.replace("+", "").length;
  if (cifras < 3 || cifras > 15) return "El teléfono tiene que tener entre 3 y 15 cifras.";
  return null;
}

export type OrigenTelefono = "empresa" | "personal" | "taller";

/**
 * El teléfono que vale para un técnico, a partir de su fila (la de
 * `GET /api/techs`, con `core_tel_empresa` y `core_tel_personal` si hay Core).
 *
 * @param mandaCore  el técnico está enlazado y la columna existe
 * @param esAdmin    quien pregunta es administrador del panel
 */
export function telefonoDeTecnico(
  fila: { phone?: unknown; core_tel_empresa?: unknown; core_tel_personal?: unknown },
  mandaCore: boolean,
  esAdmin: boolean
): { telefono: string | null; origen: OrigenTelefono | null } {
  const limpio = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (!mandaCore) {
    const taller = limpio(fila.phone);
    return { telefono: taller, origen: taller ? "taller" : null };
  }
  const empresa = limpio(fila.core_tel_empresa);
  if (empresa) return { telefono: empresa, origen: "empresa" };
  const personal = esAdmin ? limpio(fila.core_tel_personal) : null;
  return { telefono: personal, origen: personal ? "personal" : null };
}

/**
 * El teléfono del técnico que puede ver un CLIENTE (página de seguimiento):
 * el de empresa si está enlazado con Core, el del taller si no. Nunca el
 * personal.
 */
export async function telefonoDeTecnicoParaCliente(techName: string, cx: Consultor = db): Promise<string | null> {
  const { core, telefonoEmpresa } = await hayCore(cx);
  if (!core || !telefonoEmpresa) {
    const { rows } = await cx.query(`SELECT phone FROM techs WHERE name = $1 LIMIT 1`, [techName]);
    return telefonoDeTecnico(rows[0] ?? {}, false, false).telefono;
  }
  const { rows } = await cx.query(
    `SELECT t.phone, (e.id IS NOT NULL) AS enlazado, e.telefono_empresa AS core_tel_empresa
       FROM techs t
       LEFT JOIN sea_employees e ON e.id = t.employee_id
      WHERE t.name = $1 LIMIT 1`,
    [techName]
  );
  if (!rows[0]) return null;
  return telefonoDeTecnico(rows[0], rows[0].enlazado === true, false).telefono;
}

/** Pone, cambia o quita (`valor` vacío) el teléfono de empresa de un empleado. */
export async function guardarTelefonoEmpresa(
  employeeId: string,
  valor: unknown,
  cx: Consultor = db
): Promise<{ id: string; telefonoEmpresa: string | null; anterior: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new ErrorTelefono(404, "Ese empleado no existe.");

  const telefono = normalizarTelefono(valor);
  if (telefono) {
    const problema = errorDeTelefono(telefono);
    if (problema) throw new ErrorTelefono(400, problema, "FORMATO");
  }

  const { core, telefonoEmpresa } = await hayCore(cx);
  if (!core || !telefonoEmpresa) {
    throw new ErrorTelefono(503, "Falta ejecutar supabase/migrations/core_telefono_empresa.sql en Supabase.", "SIN_MIGRAR");
  }

  const { rows } = await cx.query(`SELECT telefono_empresa FROM sea_employees WHERE id = $1`, [employeeId]);
  if (!rows[0]) throw new ErrorTelefono(404, "Ese empleado no existe.");
  const anterior = rows[0].telefono_empresa ?? null;

  await cx.query(`UPDATE sea_employees SET telefono_empresa = $2, updated_at = now() WHERE id = $1`, [
    employeeId,
    telefono,
  ]);
  return { id: employeeId, telefonoEmpresa: telefono, anterior };
}

/** `/api/core/empleados/:id/telefono-empresa`: solo administradores. */
export function createTelefonoEmpresaRouter(
  opciones: { autenticar?: RequestHandler; consultor?: Consultor } = {}
): Router {
  const r = Router();
  const cx = opciones.consultor ?? db;

  r.put(
    "/:employeeId/telefono-empresa",
    opciones.autenticar ?? authenticate,
    requireAdmin,
    json(),
    async (req: Request, res: Response) => {
      const employeeId = String(req.params.employeeId ?? "");
      try {
        const hecho = await guardarTelefonoEmpresa(employeeId, req.body?.telefonoEmpresa, cx);
        if (hecho.anterior !== hecho.telefonoEmpresa) {
          await registrarAuditoria({
            empresaId: req.authCtx!.empresaId,
            userId: req.authCtx!.userId,
            accion: "core.empleado.telefono_empresa",
            entidad: "sea_employees",
            entidadId: employeeId,
            // El número no se apunta: basta con saber que cambió y quién lo hizo.
            detalle: { tenia: hecho.anterior !== null, tiene: hecho.telefonoEmpresa !== null },
            ip: req.ip,
          });
        }
        res.json({ id: hecho.id, telefonoEmpresa: hecho.telefonoEmpresa });
      } catch (err) {
        if (err instanceof ErrorTelefono) {
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        console.error("PUT /api/core/empleados/:id/telefono-empresa:", err);
        res.status(500).json({ error: "No se ha podido guardar el teléfono de empresa." });
      }
    }
  );

  return r;
}
