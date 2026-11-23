/**
 * Enlazar trabajadores: decir, módulo por módulo, qué persona de Core es cada
 * usuario u operario que ese módulo tiene dado de alta por su cuenta.
 *
 * El administrador busca a la persona por su número de trabajador (Fase A) y
 * confirma. Lo único que se escribe es `employee_id` en la tabla del módulo:
 * ni el número ni el nombre se copian a ningún sitio (un dato, un sitio).
 * Ver `PROMPT_NUMERO_TRABAJADOR_CORE.md` y `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`.
 *
 * ## Qué se queda fuera
 *
 * · Cash: ya enlaza sus personas con su propia lógica
 *   (`server/cash/expenseclaims/empleados.ts`), y está entero.
 * · Clientes de TyreControl: no son plantilla. Solo se listan `administrador`
 *   y `operador`.
 * · Connect Pro / Lite y usuarios del panel de taller: no son plantilla.
 *
 * ## Empresas
 *
 * Las tablas que llevan la empresa cliente de la plataforma (`empresa_id` en
 * `app_usuarios` y `rcp_operarios`) se filtran por la del administrador, salvo
 * para el superadministrador. `techs`, `perfiles_usuario` y `tc_usuarios` no
 * tienen esa columna (la de `tc_usuarios` es la empresa CLIENTE de
 * TyreControl, otra cosa), así que se listan enteras, como hoy en sus módulos.
 */

import { Router, json, type Request, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { proponerVinculos } from "./vinculoTecnicos.ts";

type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type ClaveModulo = "taller" | "administracion" | "almacen" | "recepciones" | "tyrecontrol";

type DefinicionModulo = {
  clave: ClaveModulo;
  nombre: string;
  tabla: string;
  /** Cómo se llama a la fila en el módulo (SQL sobre el alias `m`). */
  etiqueta: string;
  /** Un dato más para distinguir dos filas que se llamen igual. */
  detalle: string;
  /** Qué filas cuentan: las activas, y en TyreControl solo la plantilla. */
  filtro: string;
  /** Columna con la empresa cliente de la plataforma, si la tiene. */
  columnaEmpresa?: string;
  /** Migración que crea `employee_id` en esta tabla. */
  migracion: string;
};

/** El orden es el de la pantalla. Las expresiones son fijas: nada viene de fuera. */
export const MODULOS: readonly DefinicionModulo[] = [
  {
    clave: "taller",
    nombre: "Taller",
    tabla: "techs",
    etiqueta: "m.name",
    detalle: "NULL::text",
    filtro: "m.blocked = false",
    migracion: "010_techs_employee_id.sql",
  },
  {
    clave: "administracion",
    nombre: "Administración",
    tabla: "app_usuarios",
    etiqueta: "COALESCE(NULLIF(m.nombre, ''), m.username)",
    detalle: "m.username",
    filtro: "m.activo = true",
    columnaEmpresa: "empresa_id",
    migracion: "administracion_fase11_usuarios_unificados.sql",
  },
  {
    clave: "almacen",
    nombre: "Almacén",
    tabla: "perfiles_usuario",
    etiqueta: "COALESCE(NULLIF(m.nombre, ''), m.email)",
    detalle: "m.rol::text",
    filtro: "m.activo IS NOT FALSE",
    migracion: "core_enlace_modulos.sql",
  },
  {
    clave: "recepciones",
    nombre: "Recepciones",
    tabla: "rcp_operarios",
    etiqueta: "m.nombre",
    detalle: "NULL::text",
    filtro: "m.activo = true",
    columnaEmpresa: "empresa_id",
    migracion: "core_enlace_modulos.sql",
  },
  {
    clave: "tyrecontrol",
    nombre: "TyreControl",
    tabla: "tc_usuarios",
    etiqueta: "m.nombre",
    detalle: "m.rol::text",
    filtro: "m.activo = true AND m.rol::text IN ('administrador', 'operador')",
    migracion: "core_enlace_modulos.sql",
  },
];

export class ErrorEnlace extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export type EmpleadoEnlazable = {
  id: string;
  nombre: string;
  numeroTrabajador: string | null;
  companyId: string | null;
  empresa: string | null;
};

export type FilaModulo = {
  id: string;
  etiqueta: string;
  detalle: string | null;
  empleado: EmpleadoEnlazable | null;
  /** Pista por nombre para las que no están enlazadas. Se revisa siempre. */
  sugerencia: { employeeId: string; nombre: string; numeroTrabajador: string | null } | null;
};

export type EstadoModulo = {
  clave: ClaveModulo;
  nombre: string;
  /** `ok`, la tabla no está en esta base, o le falta la columna `employee_id`. */
  estado: "ok" | "no_instalado" | "sin_migrar";
  migracion: string;
  filas: FilaModulo[];
};

/** Lo que ve quien llama: su empresa, y si puede ver todas. */
export type Alcance = { empresaId: string; esSuperadmin: boolean };

const codigo = (err: unknown) => (err as { code?: string })?.code;

function nombreCompleto(e: { nombre?: string | null; apellidos?: string | null }): string {
  return [e.nombre, e.apellidos].filter(Boolean).join(" ").trim();
}

export function definicion(clave: string): DefinicionModulo | undefined {
  return MODULOS.find((m) => m.clave === clave);
}

/** Los empleados activos de Core, con su número: entre ellos se elige. */
export async function listarEmpleadosEnlazables(cx: Consultor = db): Promise<EmpleadoEnlazable[]> {
  const { rows } = await cx.query(
    `SELECT e.id::text AS id, e.nombre, e.apellidos, e.numero_trabajador,
            e.company_id::text AS company_id, c.nombre AS empresa
       FROM sea_employees e
       LEFT JOIN sea_companies c ON c.id = e.company_id
      WHERE e.activo = true
      ORDER BY e.nombre, e.apellidos`
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: nombreCompleto(r),
    numeroTrabajador: r.numero_trabajador ?? null,
    companyId: r.company_id ?? null,
    empresa: r.empresa ?? null,
  }));
}

async function filasDeModulo(
  m: DefinicionModulo,
  alcance: Alcance,
  cx: Consultor
): Promise<{ estado: EstadoModulo["estado"]; filas: Omit<FilaModulo, "sugerencia">[] }> {
  const params: unknown[] = [];
  let porEmpresa = "";
  if (m.columnaEmpresa && !alcance.esSuperadmin) {
    params.push(alcance.empresaId);
    porEmpresa = ` AND m.${m.columnaEmpresa}::text = $1`;
  }
  try {
    const { rows } = await cx.query(
      `SELECT m.id::text AS id, ${m.etiqueta} AS etiqueta, ${m.detalle} AS detalle,
              m.employee_id::text AS employee_id,
              e.nombre AS e_nombre, e.apellidos AS e_apellidos,
              e.numero_trabajador AS e_numero, e.company_id::text AS e_company,
              c.nombre AS e_empresa
         FROM ${m.tabla} m
         LEFT JOIN sea_employees e ON e.id = m.employee_id
         LEFT JOIN sea_companies c ON c.id = e.company_id
        WHERE ${m.filtro}${porEmpresa}
        ORDER BY 2`,
      params
    );
    return {
      estado: "ok",
      filas: rows.map((r) => ({
        id: r.id,
        etiqueta: String(r.etiqueta ?? "").trim() || "(sin nombre)",
        detalle: r.detalle ?? null,
        empleado: r.employee_id
          ? {
              id: r.employee_id,
              nombre: nombreCompleto({ nombre: r.e_nombre, apellidos: r.e_apellidos }),
              numeroTrabajador: r.e_numero ?? null,
              companyId: r.e_company ?? null,
              empresa: r.e_empresa ?? null,
            }
          : null,
      })),
    };
  } catch (err) {
    if (codigo(err) === "42P01") return { estado: "no_instalado", filas: [] };
    if (codigo(err) === "42703") return { estado: "sin_migrar", filas: [] };
    throw err;
  }
}

/** Todos los módulos, con su estado, sus filas y una pista por nombre. */
export async function listarEnlaces(
  alcance: Alcance,
  cx: Consultor = db
): Promise<{ modulos: EstadoModulo[]; empleados: EmpleadoEnlazable[] }> {
  const empleados = await listarEmpleadosEnlazables(cx);
  const porId = new Map(empleados.map((e) => [e.id, e]));
  // proponerVinculos quiere nombre y apellidos por separado; con el nombre
  // completo en `nombre` encaja igual (lo trata como «nombre entero»).
  const paraProponer = empleados.map((e) => ({ id: e.id, nombre: e.nombre, apellidos: null }));

  const modulos: EstadoModulo[] = [];
  for (const m of MODULOS) {
    const { estado, filas } = await filasDeModulo(m, alcance, cx);
    const sinEnlazar = filas.filter((f) => !f.empleado);
    const propuestas = proponerVinculos(
      sinEnlazar.map((f) => f.etiqueta),
      paraProponer
    );
    const sugerencias = new Map<string, FilaModulo["sugerencia"]>();
    sinEnlazar.forEach((f, i) => {
      const p = propuestas[i];
      if (p?.employeeId && (p.certeza === "exacta" || p.certeza === "unica")) {
        sugerencias.set(f.id, {
          employeeId: p.employeeId,
          nombre: p.employeeNombre ?? "",
          numeroTrabajador: porId.get(p.employeeId)?.numeroTrabajador ?? null,
        });
      }
    });
    modulos.push({
      clave: m.clave,
      nombre: m.nombre,
      estado,
      migracion: m.migracion,
      filas: filas.map((f) => ({ ...f, sugerencia: sugerencias.get(f.id) ?? null })),
    });
  }
  return { modulos, empleados };
}

/**
 * Enlaza (o desenlaza, con `employeeId` null) una fila de un módulo.
 *
 * Una persona solo puede ser UN usuario de cada módulo: si ya está enlazada
 * con otro, 409 diciendo con cuál. Es el mismo criterio que ya tenía el taller.
 */
export async function enlazar(
  clave: string,
  filaId: string,
  employeeId: unknown,
  alcance: Alcance,
  cx: Consultor = db
): Promise<{ modulo: ClaveModulo; id: string; employeeId: string | null; anterior: string | null }> {
  const m = definicion(clave);
  if (!m) throw new ErrorEnlace(404, "Ese módulo no existe.");
  if (!filaId) throw new ErrorEnlace(404, "Ese usuario no existe.");

  const destino = employeeId === null || employeeId === undefined || employeeId === "" ? null : String(employeeId);
  if (destino !== null && !/^[0-9a-f-]{36}$/i.test(destino)) {
    throw new ErrorEnlace(404, "Ese empleado no existe.");
  }

  const params: unknown[] = [filaId];
  let porEmpresa = "";
  if (m.columnaEmpresa && !alcance.esSuperadmin) {
    params.push(alcance.empresaId);
    porEmpresa = ` AND m.${m.columnaEmpresa}::text = $2`;
  }

  let anterior: string | null;
  try {
    // Mismo filtro que la lista: no se puede enlazar lo que no se ve en ella
    // (un cliente de TyreControl, un usuario de otra empresa, uno de baja).
    const { rows } = await cx.query(
      `SELECT m.employee_id::text AS employee_id
         FROM ${m.tabla} m
        WHERE m.id::text = $1 AND ${m.filtro}${porEmpresa}`,
      params
    );
    if (!rows[0]) throw new ErrorEnlace(404, "Ese usuario no existe en este módulo.");
    anterior = rows[0].employee_id ?? null;
  } catch (err) {
    if (err instanceof ErrorEnlace) throw err;
    if (codigo(err) === "42P01") throw new ErrorEnlace(404, `${m.nombre} no está instalado en esta base.`);
    if (codigo(err) === "42703") {
      throw new ErrorEnlace(503, `Falta ejecutar supabase/migrations/${m.migracion} en Supabase.`, "SIN_MIGRAR");
    }
    throw err;
  }

  if (destino) {
    const { rows: emp } = await cx.query(
      `SELECT id, activo FROM sea_employees WHERE id = $1`,
      [destino]
    );
    if (!emp[0]) throw new ErrorEnlace(404, "Ese empleado no existe.");
    if (emp[0].activo === false) {
      throw new ErrorEnlace(400, "Ese empleado está de baja en Core: no se le puede enlazar.", "INACTIVO");
    }
    const { rows: ocupado } = await cx.query(
      `SELECT ${m.etiqueta} AS etiqueta FROM ${m.tabla} m
        WHERE m.employee_id = $1 AND m.id::text <> $2 LIMIT 1`,
      [destino, filaId]
    );
    if (ocupado[0]) {
      throw new ErrorEnlace(
        409,
        `Esa persona ya está enlazada con «${String(ocupado[0].etiqueta ?? "").trim()}» en ${m.nombre}.`,
        "OCUPADO"
      );
    }
  }

  await cx.query(`UPDATE ${m.tabla} SET employee_id = $2 WHERE id::text = $1`, [filaId, destino]);
  return { modulo: m.clave, id: filaId, employeeId: destino, anterior };
}

/** `/api/core/enlaces`: solo administradores. */
export function createEnlaceTrabajadoresRouter(
  opciones: { autenticar?: RequestHandler; consultor?: Consultor } = {}
): Router {
  const r = Router();
  const cx = opciones.consultor ?? db;
  r.use(opciones.autenticar ?? authenticate, requireAdmin);

  const alcance = (req: Request): Alcance => ({
    empresaId: req.authCtx!.empresaId,
    esSuperadmin: Boolean(req.authCtx!.esSuperadmin),
  });

  r.get("/", async (req: Request, res: Response) => {
    try {
      res.json(await listarEnlaces(alcance(req), cx));
    } catch (err) {
      console.error("GET /api/core/enlaces:", err);
      res.status(500).json({ error: "No se han podido leer los usuarios de los módulos." });
    }
  });

  r.put("/:modulo/:id", json(), async (req: Request, res: Response) => {
    try {
      const hecho = await enlazar(
        String(req.params.modulo ?? ""),
        String(req.params.id ?? ""),
        req.body?.employeeId,
        alcance(req),
        cx
      );
      if (hecho.anterior !== hecho.employeeId) {
        await registrarAuditoria({
          empresaId: req.authCtx!.empresaId,
          userId: req.authCtx!.userId,
          accion: "core.enlace_trabajador",
          entidad: hecho.modulo,
          entidadId: hecho.id,
          detalle: { antes: hecho.anterior, despues: hecho.employeeId },
          ip: req.ip,
        });
      }
      res.json({ modulo: hecho.modulo, id: hecho.id, employeeId: hecho.employeeId });
    } catch (err) {
      if (err instanceof ErrorEnlace) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error("PUT /api/core/enlaces/:modulo/:id:", err);
      res.status(500).json({ error: "No se ha podido guardar el enlace." });
    }
  });

  return r;
}
