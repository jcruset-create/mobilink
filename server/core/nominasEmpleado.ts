/**
 * Las nóminas guardadas en la ficha de cada empleado.
 *
 * Al importar el PDF del mes (`importarNominas.ts`) se puede pedir que cada
 * nómina se guarde en la ficha de su persona. El PDF se parte por páginas y a
 * cada uno se le guarda SOLO la suya: nadie tiene en su ficha el sueldo de
 * otro.
 *
 * ## Quién las ve
 *
 * Solo el superadministrador. Una nómina lleva el sueldo, la retención y a
 * veces una baja médica: no es algo que tenga que ver quien administra las
 * fichas. Guardarlas sí puede hacerlo quien importa el PDF —ya lo tiene en la
 * mano—, pero listarlas, abrirlas y borrarlas, no.
 *
 * Hay dos cierres, y hacen falta los dos:
 *
 *  · estas rutas exigen `requireSuperadmin`;
 *  · la tabla `sea_employee_payslips` tiene la seguridad de fila activada y
 *    SIN políticas (`core_nominas_empleado.sql`), así que tampoco se puede
 *    leer desde el navegador con Supabase, que es como la web lee el resto de
 *    la ficha.
 *
 * ## Cómo se abren
 *
 * El PDF lo entrega el servidor, con la sesión delante. No se da una
 * dirección firmada: una dirección se puede copiar y reenviar, y aquí cada
 * apertura queda apuntada con quién la hizo.
 *
 * ## Lo que no se guarda
 *
 * Ningún importe. De cada nómina se apunta el periodo y los días, que están en
 * la cabecera; el cuerpo solo está dentro del PDF. Y no pasan por la IA.
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { PDFDocument } from "pdf-lib";

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { authenticate, requireSuperadmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { BUCKET_CORE } from "./fotoEmpleado.ts";
import { mesDePeriodo, type NominaDePersona } from "./nominasLeer.ts";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Dónde se guardan los PDF. En las pruebas, uno de mentira. */
export type AlmacenNominas = {
  subir(ruta: string, pdf: Buffer): Promise<void>;
  bajar(ruta: string): Promise<Buffer | null>;
  borrar(ruta: string): Promise<void>;
};

export const almacenNominasSupabase: AlmacenNominas = {
  async subir(ruta, pdf) {
    const { error } = await supabase.storage.from(BUCKET_CORE).upload(ruta, pdf, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`No se ha podido guardar la nómina: ${error.message}`);
  },
  async bajar(ruta) {
    const { data, error } = await supabase.storage.from(BUCKET_CORE).download(ruta);
    return error || !data ? null : Buffer.from(await data.arrayBuffer());
  },
  async borrar(ruta) {
    const { error } = await supabase.storage.from(BUCKET_CORE).remove([ruta]);
    if (error) throw new Error(`No se ha podido borrar la nómina: ${error.message}`);
  },
};

export type Dependencias = { consultor?: Consultor; almacen?: AlmacenNominas };

export class ErrorNomina extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** ¿Está creada la tabla? Mientras no, ni se ofrece guardar ni se enseña la pestaña. */
export async function hayNominas(cx: Consultor = db): Promise<boolean> {
  const { rows } = await cx.query(`SELECT to_regclass('sea_employee_payslips') IS NOT NULL AS hay`);
  return rows[0]?.hay === true;
}

/** Un PDF nuevo con solo esas páginas (contadas desde 1) del original. */
export async function partirPdf(original: Buffer, paginas: number[]): Promise<Buffer> {
  const origen = await PDFDocument.load(original);
  const nuevo = await PDFDocument.create();
  const copiadas = await nuevo.copyPages(origen, paginas.map((p) => p - 1));
  for (const p of copiadas) nuevo.addPage(p);
  return Buffer.from(await nuevo.save());
}

export type NominaParaGuardar = { employeeId: string; nomina: NominaDePersona };
export type Quien = { userId: string | null; nombre: string | null };

/**
 * Guarda cada nómina en la ficha de su empleado.
 *
 * Volver a subir el mismo periodo SUSTITUYE a la que había (la gestoría a
 * veces rehace una nómina): se sube la nueva, se apunta en la fila y se borra
 * el fichero viejo. En ese orden, para que un fallo a medias deje un fichero
 * de más y no una ficha apuntando a un PDF que ya no existe.
 */
export async function guardarNominas(
  pdf: Buffer,
  lista: NominaParaGuardar[],
  quien: Quien,
  deps: Dependencias = {}
): Promise<{ guardadas: number; fichas: number; sinPeriodo: number }> {
  const cx = deps.consultor ?? db;
  const almacen = deps.almacen ?? almacenNominasSupabase;
  let guardadas = 0;
  let sinPeriodo = 0;
  const fichas = new Set<string>();

  for (const { employeeId, nomina } of lista) {
    const mes = mesDePeriodo(nomina.periodo);
    if (!mes) {
      // Sin saber de qué mes es no se puede archivar: se cuenta y se sigue.
      sinPeriodo += 1;
      continue;
    }
    const trozo = await partirPdf(pdf, [nomina.pagina]);
    const ruta = `empleados/${employeeId}/nominas/${mes.anio}-${String(mes.mes).padStart(2, "0")}-${randomUUID()}.pdf`;
    await almacen.subir(ruta, trozo);

    const { rows: previa } = await cx.query(
      `SELECT storage_path FROM sea_employee_payslips WHERE employee_id = $1 AND periodo = $2`,
      [employeeId, nomina.periodo]
    );
    await cx.query(
      `INSERT INTO sea_employee_payslips
         (employee_id, anio, mes, periodo, dias, storage_path, bytes, subida_por, subida_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (employee_id, periodo) DO UPDATE SET
         anio = EXCLUDED.anio, mes = EXCLUDED.mes, dias = EXCLUDED.dias,
         storage_path = EXCLUDED.storage_path, bytes = EXCLUDED.bytes,
         subida_at = now(), subida_por = EXCLUDED.subida_por, subida_nombre = EXCLUDED.subida_nombre,
         -- Es otro documento: quien vio la anterior no ha visto esta.
         vista_at = NULL, vista_nombre = NULL`,
      [employeeId, mes.anio, mes.mes, nomina.periodo, nomina.dias, ruta, trozo.length, quien.userId && esUuid(quien.userId) ? quien.userId : null, quien.nombre]
    );
    if (previa[0]?.storage_path) {
      await almacen.borrar(String(previa[0].storage_path)).catch((e) => console.error("[Core nóminas]", e instanceof Error ? e.message : e));
    }
    guardadas += 1;
    fichas.add(employeeId);
  }
  return { guardadas, fichas: fichas.size, sinPeriodo };
}

export type NominaListada = {
  id: string;
  anio: number;
  mes: number;
  periodo: string;
  dias: number | null;
  subidaAt: string;
  subidaNombre: string | null;
  vistaAt: string | null;
  vistaNombre: string | null;
};

export async function listarNominas(employeeId: string, cx: Consultor = db): Promise<NominaListada[]> {
  if (!esUuid(employeeId)) throw new ErrorNomina(404, "Ese empleado no existe.");
  const { rows } = await cx.query(
    `SELECT id::text AS id, anio, mes, periodo, dias, subida_at, subida_nombre, vista_at, vista_nombre
       FROM sea_employee_payslips
      WHERE employee_id = $1
      ORDER BY anio DESC, mes DESC, periodo DESC`,
    [employeeId]
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({
    id: r.id,
    anio: Number(r.anio),
    mes: Number(r.mes),
    periodo: r.periodo,
    dias: r.dias === null ? null : Number(r.dias),
    subidaAt: iso(r.subida_at)!,
    subidaNombre: r.subida_nombre ?? null,
    vistaAt: iso(r.vista_at),
    vistaNombre: r.vista_nombre ?? null,
  }));
}

async function filaDeNomina(employeeId: string, nominaId: string, cx: Consultor) {
  // La nómina se busca SIEMPRE con su empleado: el id de una no abre la de otro.
  if (!esUuid(employeeId) || !esUuid(nominaId)) throw new ErrorNomina(404, "Esa nómina no existe.");
  const { rows } = await cx.query(
    `SELECT n.id::text AS id, n.storage_path, n.anio, n.mes, e.nombre, e.apellidos
       FROM sea_employee_payslips n
       JOIN sea_employees e ON e.id = n.employee_id
      WHERE n.id = $1 AND n.employee_id = $2`,
    [nominaId, employeeId]
  );
  if (!rows[0]) throw new ErrorNomina(404, "Esa nómina no existe.");
  return rows[0];
}

/** El PDF de una nómina. Deja apuntado quién la ha abierto. */
export async function abrirNomina(
  employeeId: string,
  nominaId: string,
  quien: Quien,
  deps: Dependencias = {}
): Promise<{ pdf: Buffer; nombreFichero: string }> {
  const cx = deps.consultor ?? db;
  const fila = await filaDeNomina(employeeId, nominaId, cx);
  const pdf = await (deps.almacen ?? almacenNominasSupabase).bajar(String(fila.storage_path));
  if (!pdf) throw new ErrorNomina(404, "No se encuentra el PDF de esa nómina. Vuelve a importar las nóminas de ese mes.", "SIN_FICHERO");
  await cx.query(`UPDATE sea_employee_payslips SET vista_at = now(), vista_nombre = $2 WHERE id = $1`, [nominaId, quien.nombre]);
  // Solo ASCII: va en una cabecera HTTP, y una «ñ» ahí rompe la respuesta.
  const persona =
    [fila.apellidos, fila.nombre].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[^A-Za-z0-9]+/g, "_") ||
    "empleado";
  return { pdf, nombreFichero: `Nomina_${fila.anio}-${String(fila.mes).padStart(2, "0")}_${persona}.pdf` };
}

export async function borrarNomina(employeeId: string, nominaId: string, deps: Dependencias = {}): Promise<void> {
  const cx = deps.consultor ?? db;
  const fila = await filaDeNomina(employeeId, nominaId, cx);
  await cx.query(`DELETE FROM sea_employee_payslips WHERE id = $1`, [nominaId]);
  await (deps.almacen ?? almacenNominasSupabase)
    .borrar(String(fila.storage_path))
    .catch((e) => console.error("[Core nóminas]", e instanceof Error ? e.message : e));
}

/** `/api/core/empleados/:id/nominas…`: solo el superadministrador. */
export function createNominasEmpleadoRouter(
  opciones: { autenticar?: RequestHandler } & Dependencias = {}
): Router {
  const r = Router();
  const guardias = [opciones.autenticar ?? authenticate, requireSuperadmin];
  const deps: Dependencias = { consultor: opciones.consultor, almacen: opciones.almacen };
  const cx = opciones.consultor ?? db;
  const quien = (req: Request): Quien => ({ userId: req.authCtx!.userId ?? null, nombre: req.authCtx!.nombre ?? null });

  const responder = (res: Response, err: unknown, donde: string) => {
    if (err instanceof ErrorNomina) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(`${donde}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: "No se han podido leer las nóminas." });
  };

  r.get("/:employeeId/nominas", ...guardias, async (req: Request, res: Response) => {
    try {
      // Sin la migración no hay tabla: se dice, en vez de dar un error.
      if (!(await hayNominas(cx))) return res.json({ disponible: false, nominas: [] });
      res.json({ disponible: true, nominas: await listarNominas(String(req.params.employeeId ?? ""), cx) });
    } catch (err) {
      responder(res, err, "GET nominas");
    }
  });

  r.get("/:employeeId/nominas/:nominaId/pdf", ...guardias, async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    const nominaId = String(req.params.nominaId ?? "");
    try {
      const { pdf, nombreFichero } = await abrirNomina(employeeId, nominaId, quien(req), deps);
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.nomina.abrir",
        entidad: "sea_employee_payslips",
        entidadId: nominaId,
        detalle: { employeeId },
        ip: req.ip,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${nombreFichero}"`);
      // Que no se quede en ninguna caché intermedia ni en la del navegador.
      res.setHeader("Cache-Control", "no-store");
      res.send(pdf);
    } catch (err) {
      responder(res, err, "GET nomina pdf");
    }
  });

  r.delete("/:employeeId/nominas/:nominaId", ...guardias, async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    const nominaId = String(req.params.nominaId ?? "");
    try {
      await borrarNomina(employeeId, nominaId, deps);
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.nomina.borrar",
        entidad: "sea_employee_payslips",
        entidadId: nominaId,
        detalle: { employeeId },
        ip: req.ip,
      });
      res.json({ ok: true });
    } catch (err) {
      responder(res, err, "DELETE nomina");
    }
  });

  return r;
}
