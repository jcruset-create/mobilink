/**
 * Quién es quién: las personas de Cash y las fichas de empleado.
 *
 * Una liquidación es de un TRABAJADOR, y el trabajador es `sea_employees.id`.
 * Dentro de Cash lo representa un destino PERSONA (`cash_expense_targets`), el
 * mismo al que se imputan las dietas en la estadística. Aquí se ata lo uno a
 * lo otro: una persona de Cash, una ficha de empleado, y al revés.
 *
 * ## Lo que se propone no se aplica solo
 *
 * El emparejado por nombre es `proponerVinculos` de `core/vinculoTecnicos.ts`,
 * el mismo que empareja a los técnicos del taller, y con el mismo criterio:
 * «José» puede ser José García o José Martín, y atribuir los gastos de uno al
 * otro es peor que pedir que alguien lo confirme. Se PROPONE con su grado de
 * certeza; lo aplica una persona.
 *
 * ## Dos límites que no son de este módulo
 *
 * · `sea_employees` la crean las migraciones de Supabase: en una base sin
 *   ellas no existe, y entonces esto dice que no hay fichas en vez de fallar.
 * · `sea_employees` no tiene empresa. Con varias empresas en la misma
 *   instalación, se enseñan las que no estén ligadas a un usuario de OTRA
 *   empresa (`app_usuarios.employee_id`), que es la única atadura que existe.
 *   Riesgo documentado en `docs/PROMPT_gastos_trabajadores.md` (B.5).
 */

import pool from "../../db.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { type Certeza, proponerVinculos } from "../../core/vinculoTecnicos.ts";
import { ErrorCaja } from "../errors.ts";
import { enTransaccion } from "../repository.ts";
import type { Contexto } from "../service.ts";

export type Empleado = {
  id: string;
  nombre: string;
  apellidos: string | null;
  codigo: string | null;
  /** La persona de Cash que lo representa, si ya está vinculado. */
  destinoId: number | null;
  destinoNombre: string | null;
};

type FilaEmpleado = { id: string; nombre: string; apellidos: string | null; codigo_operario: string | null };

/** 42P01 = la tabla no existe. */
const noExiste = (e: unknown) => (e as { code?: string })?.code === "42P01";

async function empleadosActivos(empresaId: string): Promise<FilaEmpleado[] | null> {
  const columnas = `e.id::text AS id, e.nombre, e.apellidos, e.codigo_operario`;
  try {
    const { rows } = await pool.query(
      `SELECT ${columnas} FROM sea_employees e
        WHERE e.activo
          AND NOT EXISTS (SELECT 1 FROM app_usuarios u WHERE u.employee_id = e.id AND u.empresa_id <> $1)
        ORDER BY e.nombre, e.apellidos`,
      [empresaId]
    );
    return rows;
  } catch (e) {
    if (!noExiste(e)) throw e;
  }
  /*
   * Sin `app_usuarios` —una base del módulo sin el SaaS— no hay con qué
   * separar empresas: se enseñan todas. Sin `sea_employees`, ninguna.
   */
  try {
    const { rows } = await pool.query(
      `SELECT ${columnas} FROM sea_employees e WHERE e.activo ORDER BY e.nombre, e.apellidos`
    );
    return rows;
  } catch (e) {
    if (noExiste(e)) return null;
    throw e;
  }
}

/** Los empleados activos, con la persona de Cash que los representa si la hay. */
export async function listarEmpleados(empresaId: string): Promise<{ disponible: boolean; empleados: Empleado[] }> {
  const filas = await empleadosActivos(empresaId);
  if (filas == null) return { disponible: false, empleados: [] };
  const { rows: destinos } = await pool.query(
    `SELECT id, nombre, employee_id::text AS employee_id FROM cash_expense_targets
      WHERE empresa_id = $1 AND employee_id IS NOT NULL`,
    [empresaId]
  );
  const porEmpleado = new Map<string, { id: number; nombre: string }>(
    destinos.map((d: { id: number; nombre: string; employee_id: string }) => [d.employee_id, { id: d.id, nombre: d.nombre }])
  );
  return {
    disponible: true,
    empleados: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      apellidos: f.apellidos,
      codigo: f.codigo_operario,
      destinoId: porEmpleado.get(f.id)?.id ?? null,
      destinoNombre: porEmpleado.get(f.id)?.nombre ?? null,
    })),
  };
}

export type PropuestaVinculo = {
  destinoId: number;
  destinoNombre: string;
  certeza: Certeza;
  employeeId: string | null;
  employeeNombre: string | null;
  candidatos: { id: string; nombre: string }[];
};

/**
 * «García, José» → «José García». Así se da de alta a una persona creada desde
 * su ficha, y así la escribe mucha gente a mano; `proponerVinculos` compara
 * «nombre apellidos».
 */
function enOrdenNatural(nombre: string): string | null {
  const i = nombre.indexOf(",");
  if (i < 0) return null;
  const apellidos = nombre.slice(0, i).trim();
  const pila = nombre.slice(i + 1).trim();
  return apellidos && pila ? `${pila} ${apellidos}` : null;
}

/**
 * Para cada persona de Cash SIN vincular, a qué empleado se parece.
 *
 * Solo se proponen empleados que tampoco estén vinculados: uno ya atado a otra
 * persona de Cash no puede estarlo a dos.
 */
export async function proponerVinculosDePersonas(empresaId: string): Promise<{
  disponible: boolean;
  propuestas: PropuestaVinculo[];
}> {
  const { disponible, empleados } = await listarEmpleados(empresaId);
  if (!disponible) return { disponible, propuestas: [] };
  const libres = empleados.filter((e) => e.destinoId == null).map((e) => ({ ...e, codigo_operario: e.codigo }));

  const { rows: sueltas } = await pool.query(
    `SELECT id, nombre FROM cash_expense_targets
      WHERE empresa_id = $1 AND tipo = 'PERSONA' AND employee_id IS NULL AND activo
      ORDER BY nombre`,
    [empresaId]
  );
  return {
    disponible,
    propuestas: sueltas.map((d: { id: number; nombre: string }) => {
      let p = proponerVinculos([d.nombre], libres)[0];
      const natural = enOrdenNatural(d.nombre);
      if (p.certeza === "sin_candidato" && natural) p = proponerVinculos([natural], libres)[0];
      return {
        destinoId: d.id,
        destinoNombre: d.nombre,
        certeza: p.certeza,
        employeeId: p.employeeId,
        employeeNombre: p.employeeNombre,
        candidatos: p.candidatos,
      };
    }),
  };
}

/**
 * Ata una persona de Cash a una ficha de empleado, o la desata (`null`).
 *
 * Al atarla, las liquidaciones de esa persona que todavía no sabían de qué
 * empleado eran lo pasan a saber: son de la misma persona, y dejarlas sin
 * identidad haría que el autoservicio futuro no las encontrara. Al desatarla
 * no se toca ninguna: lo que se tramitó con una identidad, con ella se queda.
 */
export async function vincularPersona(
  ctx: Contexto,
  destinoId: number,
  employeeId: string | null
): Promise<{ destinoId: number; employeeId: string | null; liquidacionesActualizadas: number }> {
  const hecho = await enTransaccion(async (client) => {
    const { rows } = await client.query(
      `SELECT id, nombre, tipo, employee_id::text AS employee_id FROM cash_expense_targets
        WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [destinoId, ctx.empresaId]
    );
    const d = rows[0];
    if (!d) throw new ErrorCaja("DESTINO_NO_ENCONTRADO", "Esa persona no existe en Cash.", 404);
    if (d.tipo !== "PERSONA") {
      throw new ErrorCaja("DESTINO_NO_ES_PERSONA", `«${d.nombre}» es un centro de coste, no una persona.`, 400);
    }

    if (employeeId) {
      const empleados = await empleadosActivos(ctx.empresaId);
      if (empleados == null) {
        throw new ErrorCaja("EMPLEADOS_NO_DISPONIBLES", "Esta instalación no tiene la ficha de empleados.", 409);
      }
      if (!empleados.some((e) => e.id === employeeId)) {
        throw new ErrorCaja("EMPLEADO_NO_ENCONTRADO", "Ese empleado no existe o está dado de baja.", 404);
      }
      const { rows: otro } = await client.query(
        `SELECT id, nombre FROM cash_expense_targets
          WHERE empresa_id = $1 AND employee_id = $2 AND id <> $3`,
        [ctx.empresaId, employeeId, destinoId]
      );
      if (otro[0]) {
        throw new ErrorCaja(
          "EMPLEADO_YA_VINCULADO",
          `Ese empleado ya es «${otro[0].nombre}» en Cash. Una persona, una ficha.`,
          409,
          { destinoId: otro[0].id }
        );
      }
    }

    try {
      await client.query(
        `UPDATE cash_expense_targets SET employee_id = $3, updated_at_ms = $4 WHERE id = $1 AND empresa_id = $2`,
        [destinoId, ctx.empresaId, employeeId, Date.now()]
      );
    } catch (e) {
      /*
       * Dos pantallas vinculando el mismo empleado a la vez: la comprobación de
       * arriba no lo ve, el índice único sí. 23505 = clave duplicada.
       */
      if ((e as { code?: string })?.code === "23505") {
        throw new ErrorCaja("EMPLEADO_YA_VINCULADO", "Ese empleado ya está vinculado a otra persona de Cash.", 409);
      }
      throw e;
    }
    let actualizadas = 0;
    if (employeeId) {
      const r = await client.query(
        `UPDATE cash_expense_claims SET employee_id = $3, updated_at_ms = $4
          WHERE empresa_id = $1 AND expense_target_id = $2 AND employee_id IS NULL`,
        [ctx.empresaId, destinoId, employeeId, Date.now()]
      );
      actualizadas = r.rowCount ?? 0;
    }
    return { antes: d.employee_id as string | null, nombre: d.nombre as string, actualizadas };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: employeeId ? "cash.expense_target.link_employee" : "cash.expense_target.unlink_employee",
    entidad: "cash_expense_targets",
    entidadId: String(destinoId),
    detalle: {
      persona: hecho.nombre,
      antes: hecho.antes,
      ahora: employeeId,
      liquidacionesActualizadas: hecho.actualizadas,
    },
    ip: ctx.ip,
  });
  return { destinoId, employeeId, liquidacionesActualizadas: hecho.actualizadas };
}
