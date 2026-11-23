/**
 * El número de trabajador: la clave con la que se reconoce a una persona de
 * la plantilla en todos los módulos.
 *
 * Es un número INTERNO de cada empresa (`sea_employees.company_id`), que el
 * administrador pone a mano. Dos empresas pueden tener cada una su «15»; dentro
 * de una misma empresa, no.
 *
 * ## Por qué no es `codigo_operario`
 *
 * `codigo_operario` ya existe, pero es único en TODA la base y es el usuario
 * con el que se entra en ToolControl. Usarlo para esto obligaría a cambiar
 * códigos de acceso que la gente ya se sabe. Son dos datos distintos.
 *
 * ## Para qué sirve (y para qué no)
 *
 * El número sirve para ENCONTRAR a la persona cuando se enlaza un módulo con
 * Core. Lo que se guarda en el módulo es `employee_id`, nunca el número: si se
 * copiara, habría dos sitios con el mismo dato y tarde o temprano no
 * coincidirían. Ver `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`.
 *
 * ## Si la migración aún no está ejecutada
 *
 * La columna la crea `supabase/migrations/core_numero_trabajador.sql`, que se
 * ejecuta a mano. Hasta entonces la lectura dice `disponible: false` y la
 * escritura responde 503 con lo que falta, en vez de romper la pantalla.
 */

import { Router, json, type Request, type Response, type RequestHandler } from "express";

import db from "../db.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";

/** Lo justo para hacer consultas: el pool o una conexión suelta (pruebas). */
type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const LARGO_MAXIMO = 20;

/** Error con el código HTTP que le toca. */
export class ErrorNumero extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/**
 * Cómo se guarda un número: sin espacios y en mayúsculas.
 *
 * Los ceros a la izquierda se RESPETAN: «007» y «7» son números distintos,
 * porque en nóminas se escriben de las dos maneras y no nos toca decidir cuál
 * es la buena. Vacío → `null` (quitar el número).
 */
export function normalizarNumeroTrabajador(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const v = String(valor).replace(/\s+/g, "").toUpperCase();
  return v === "" ? null : v;
}

/** Qué le pasa a un número ya normalizado, o `null` si vale. */
export function errorDeNumeroTrabajador(numero: string): string | null {
  if (numero.length > LARGO_MAXIMO) {
    return `El número de trabajador tiene como mucho ${LARGO_MAXIMO} caracteres.`;
  }
  if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(numero)) {
    return "El número de trabajador solo admite letras, cifras, punto, barra y guion.";
  }
  return null;
}

/** ¿El error de Postgres es que la columna todavía no existe? */
function faltaLaColumna(err: unknown): boolean {
  return (err as { code?: string })?.code === "42703";
}

const SIN_MIGRAR =
  "Falta ejecutar supabase/migrations/core_numero_trabajador.sql en Supabase.";

function nombreCompleto(e: { nombre?: string | null; apellidos?: string | null }): string {
  return [e.nombre, e.apellidos].filter(Boolean).join(" ").trim();
}

/**
 * Pone, cambia o quita (`valor` vacío) el número de un empleado.
 *
 * Si choca con otro, el mensaje dice con quién: ese otro es SIEMPRE de la
 * misma empresa, porque la búsqueda va por `company_id`. De otra empresa no se
 * llega a mirar nada.
 */
export async function asignarNumeroTrabajador(
  employeeId: string,
  valor: unknown,
  cx: Consultor = db
): Promise<{ id: string; numeroTrabajador: string | null; anterior: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new ErrorNumero(404, "Ese empleado no existe.");

  const numero = normalizarNumeroTrabajador(valor);
  if (numero) {
    const problema = errorDeNumeroTrabajador(numero);
    if (problema) throw new ErrorNumero(400, problema, "FORMATO");
  }

  let empleado: { id: string; company_id: string | null; numero_trabajador: string | null } | undefined;
  try {
    const { rows } = await cx.query(
      `SELECT id, company_id, numero_trabajador FROM sea_employees WHERE id = $1`,
      [employeeId]
    );
    empleado = rows[0];
  } catch (err) {
    if (faltaLaColumna(err)) throw new ErrorNumero(503, SIN_MIGRAR, "SIN_MIGRAR");
    throw err;
  }
  if (!empleado) throw new ErrorNumero(404, "Ese empleado no existe.");

  const anterior = empleado.numero_trabajador ?? null;

  if (numero) {
    if (!empleado.company_id) {
      throw new ErrorNumero(
        400,
        "Este empleado no tiene empresa. Asígnale una antes de darle número: el número es por empresa.",
        "SIN_EMPRESA"
      );
    }
    const { rows: choques } = await cx.query(
      `SELECT id, nombre, apellidos
         FROM sea_employees
        WHERE company_id = $1 AND numero_trabajador = $2 AND id <> $3
        LIMIT 1`,
      [empleado.company_id, numero, employeeId]
    );
    if (choques[0]) {
      throw new ErrorNumero(
        409,
        `El número ${numero} ya lo tiene ${nombreCompleto(choques[0]) || "otro empleado"} en esta empresa.`,
        "REPETIDO"
      );
    }
  }

  try {
    await cx.query(
      `UPDATE sea_employees SET numero_trabajador = $2, updated_at = now() WHERE id = $1`,
      [employeeId, numero]
    );
  } catch (err) {
    // Dos administradores a la vez con el mismo número: lo para el índice.
    if ((err as { code?: string })?.code === "23505") {
      throw new ErrorNumero(409, `El número ${numero} ya lo tiene otro empleado de esta empresa.`, "REPETIDO");
    }
    throw err;
  }

  return { id: employeeId, numeroTrabajador: numero, anterior };
}

/**
 * Los números de toda la plantilla, para la lista de empleados.
 *
 * Va aparte de la consulta que la pantalla hace a Supabase para que, si la
 * columna aún no existe, la lista siga saliendo igual y solo falte el número.
 */
export async function listarNumerosTrabajador(
  cx: Consultor = db
): Promise<{ disponible: boolean; numeros: Record<string, string> }> {
  try {
    const { rows } = await cx.query(
      `SELECT id, numero_trabajador FROM sea_employees WHERE numero_trabajador IS NOT NULL`
    );
    const numeros: Record<string, string> = {};
    for (const r of rows) numeros[String(r.id)] = String(r.numero_trabajador);
    return { disponible: true, numeros };
  } catch (err) {
    if (faltaLaColumna(err)) return { disponible: false, numeros: {} };
    throw err;
  }
}

/**
 * `/api/core/empleados`: solo administradores.
 *
 * `autenticar` se puede cambiar en las pruebas; `requireAdmin` va siempre, que
 * es la comprobación que importa aquí.
 */
export function createNumeroTrabajadorRouter(
  opciones: { autenticar?: RequestHandler; consultor?: Consultor } = {}
): Router {
  const r = Router();
  const cx = opciones.consultor ?? db;
  r.use(opciones.autenticar ?? authenticate, requireAdmin);

  r.get("/numeros-trabajador", async (_req: Request, res: Response) => {
    try {
      res.json(await listarNumerosTrabajador(cx));
    } catch (err) {
      console.error("GET /api/core/empleados/numeros-trabajador:", err);
      res.status(500).json({ error: "No se han podido leer los números de trabajador." });
    }
  });

  r.put("/:employeeId/numero-trabajador", json(), async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    try {
      const hecho = await asignarNumeroTrabajador(employeeId, req.body?.numeroTrabajador, cx);
      if (hecho.anterior !== hecho.numeroTrabajador) {
        await registrarAuditoria({
          empresaId: req.authCtx!.empresaId,
          userId: req.authCtx!.userId,
          accion: "core.empleado.numero_trabajador",
          entidad: "sea_employees",
          entidadId: employeeId,
          detalle: { antes: hecho.anterior, despues: hecho.numeroTrabajador },
          ip: req.ip,
        });
      }
      res.json({ id: hecho.id, numeroTrabajador: hecho.numeroTrabajador });
    } catch (err) {
      if (err instanceof ErrorNumero) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error("PUT /api/core/empleados/:id/numero-trabajador:", err);
      res.status(500).json({ error: "No se ha podido guardar el número de trabajador." });
    }
  });

  return r;
}
