/**
 * Importar a Core los trabajadores que aparecen en las nóminas del mes.
 *
 * Dos pasos, los dos con el PDF delante:
 *
 *  1. ANALIZAR — se lee el PDF, se compara con Core y se devuelve qué pasaría.
 *     No escribe nada.
 *  2. APLICAR  — se vuelve a mandar el PDF con lo que el administrador ha
 *     marcado (los NIF a crear y a actualizar). El servidor lo relee: lo que
 *     entra en Core sale del PDF, no de lo que diga el navegador.
 *
 * De cada página solo se LEE la cabecera (`nominasLeer.ts`): los importes no
 * pasan de ahí. El PDF entero no se guarda nunca. Lo que sí se puede pedir es
 * que cada nómina se guarde, suelta, en la ficha de su persona
 * (`nominasEmpleado.ts`), donde solo la ve el superadministrador.
 *
 * ## Con quién se compara
 *
 * Por NIF, que es lo único que identifica a la persona en los dos lados. Si un
 * empleado de Core no tiene DNI puesto, se intenta por nombre (mismas
 * palabras, en cualquier orden): «MIGENS AVILA, LOURDES» es «Lourdes Migens
 * Avila». Ese emparejado se dice en pantalla y, al actualizar, se le pone el
 * DNI de la nómina.
 *
 * ## Qué se hace con cada uno
 *
 *  · NUEVO — no está en Core. Se crea con sus datos y en `pendiente`, para
 *    mandarle después el enlace de alta (móvil, dirección, foto…).
 *  · A ACTUALIZAR — está en Core pero su número de trabajador no es el código
 *    de la nómina, o le falta algún dato que la nómina trae (DNI, Seguridad
 *    Social, fecha de alta, categoría). Lo que ya está puesto en Core NO se
 *    pisa: solo el número, que es justo lo que se quiere igualar.
 *  · IGUAL — nada que hacer.
 *  · DE BAJA EN CORE — sale en la nómina pero en Core está de baja. No se
 *    crea otro: se avisa.
 *  · YA NO SALE EN LA NÓMINA — activo en Core y ausente del PDF. Puede ser una
 *    baja o alguien que no cobra por esta empresa. Solo se avisa: una baja
 *    quita accesos en todos los módulos y la decide una persona.
 *
 * El centro de la nómina («553 TARRAGONA») solo se usa para los nuevos. A los
 * que ya están no se les compara: el centro donde alguien trabaja (un inhouse,
 * por ejemplo) no es el centro de coste por el que cobra.
 *
 * `codigo_operario` no se toca nunca: es el usuario con el que se entra en
 * ToolControl, no el número de la gestoría.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";

import db from "../db.ts";
import { DocumentoIlegible, leerDocumento } from "../therefore/documentos/texto.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { hayCore } from "./hayCore.ts";
import {
  compararConCore,
  elegirEmpresa,
  type Comparacion,
  type EmpleadoCore,
  type Empresa,
} from "./nominasComparar.ts";
import { guardarNominas, hayNominas, type AlmacenNominas, type NominaParaGuardar, type Quien } from "./nominasEmpleado.ts";
import { leerNominas, normalizarDocumento } from "./nominasLeer.ts";
import { normalizarNombre } from "./vinculoTecnicos.ts";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type Ejecutor = { query: Consulta; connect?: () => Promise<{ query: Consulta; release: () => void }>; release?: () => void };

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGINAS = 400;

export class ErrorImportacion extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/* ── La base ─────────────────────────────────────────────────────────────── */

async function empresasDeCore(q: Consulta): Promise<(Empresa & { cif: string | null })[]> {
  const { rows } = await q(`SELECT id::text AS id, nombre, cif FROM sea_companies WHERE activa ORDER BY nombre`);
  return rows;
}

async function empleadosDeCore(q: Consulta, conNumero: boolean): Promise<EmpleadoCore[]> {
  const { rows } = await q(
    `SELECT id::text AS id, nombre, apellidos, dni_nie, num_seguridad_social,
            to_char(fecha_alta, 'YYYY-MM-DD') AS fecha_alta, cargo,
            ${conNumero ? "numero_trabajador" : "NULL::text AS numero_trabajador"},
            activo, company_id::text AS company_id
       FROM sea_employees`
  );
  return rows.map((r) => ({ ...r, activo: r.activo !== false }));
}

/** Lee el PDF. Los errores salen ya con el mensaje para la pantalla. */
export function leerPdfDeNominas(pdf: Buffer) {
  let paginas: string[][];
  try {
    const doc = leerDocumento(pdf, { maxPaginas: MAX_PAGINAS, maxBytes: MAX_BYTES });
    paginas = doc.paginas.map((p) => p.lineas.map((l) => l.texto));
  } catch (err) {
    if (err instanceof DocumentoIlegible) throw new ErrorImportacion(400, err.message, "ILEGIBLE");
    throw err;
  }
  const lectura = leerNominas(paginas);
  if (lectura.personas.length === 0) {
    throw new ErrorImportacion(
      400,
      "En este PDF no se ha reconocido ninguna nómina. ¿Es el PDF de nóminas de la gestoría? Si es un escaneado (una foto), no se puede leer.",
      "SIN_NOMINAS"
    );
  }
  if (lectura.empresas.length > 1) {
    throw new ErrorImportacion(
      400,
      `El PDF trae nóminas de varias empresas (${lectura.empresas.map((e) => e.nombre).join(", ")}). Súbelas por separado.`,
      "VARIAS_EMPRESAS"
    );
  }
  return lectura;
}

export type Analisis = Comparacion & {
  /** La empresa de Core con la que se compara, o null si hay que elegirla. */
  empresa: Empresa | null;
  empresaDelPdf: { cif: string; nombre: string };
  empresas: Empresa[];
  paginasNoReconocidas: number[];
  /** `numero_trabajador` existe: se puede igualar con el código de la nómina. */
  conNumero: boolean;
  /** Está la tabla de nóminas: se puede ofrecer guardarlas en las fichas. */
  nominasDisponible: boolean;
};

/** Paso 1: qué pasaría. No escribe. */
export async function analizarNominas(pdf: Buffer, companyId: string | null, cx: Ejecutor = db as unknown as Ejecutor): Promise<Analisis> {
  const lectura = leerPdfDeNominas(pdf);
  const q: Consulta = (s, p) => cx.query(s, p);
  const { core, numero } = await hayCore({ query: q });
  if (!core) throw new ErrorImportacion(503, "Core no está instalado en esta base.", "SIN_CORE");

  const empresas = await empresasDeCore(q);
  const empresaDelPdf = lectura.empresas[0] ?? { cif: "", nombre: "" };
  const elegida = companyId
    ? empresas.find((e) => e.id === companyId) ?? null
    : elegirEmpresa(empresas, empresaDelPdf);
  if (companyId && !elegida) throw new ErrorImportacion(404, "Esa empresa no existe en Core.");

  const lista = empresas.map((e) => ({ id: e.id, nombre: e.nombre }));
  const comun = {
    empresaDelPdf,
    empresas: lista,
    paginasNoReconocidas: lectura.paginasNoReconocidas,
    conNumero: numero,
    nominasDisponible: await hayNominas({ query: q }),
  };
  // Sin empresa no se puede decir quién falta ni a qué empresa van los nuevos.
  if (!elegida) return { ...comun, empresa: null, filas: [], noEnNomina: [] };

  const comparacion = compararConCore(lectura.personas, await empleadosDeCore(q, numero), elegida.id, numero);
  return { ...comun, empresa: { id: elegida.id, nombre: elegida.nombre }, ...comparacion };
}

async function enTransaccion<T>(cx: Ejecutor, trabajo: (q: Consulta) => Promise<T>): Promise<T> {
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

export type Seleccion = { crear: string[]; actualizar: string[] };

/** Qué ha pasado con las nóminas, si se pidió guardarlas en las fichas. */
export type NominasGuardadas = {
  guardadas: number;
  fichas: number;
  /** De quién no se ha guardado, y por qué. */
  noGuardadas: { nombre: string; motivo: string }[];
  /** No se han podido guardar (los empleados sí se han importado). */
  error?: string;
};

export type ResultadoImportacion = {
  creados: { id: string; nombre: string; numeroTrabajador: string | null }[];
  actualizados: { id: string; nombre: string; cambios: string[] }[];
  /** `null` si no se pidió guardar las nóminas. */
  nominas: NominasGuardadas | null;
};

export type OpcionesDeNominas = {
  /** Guardar cada nómina en la ficha de su trabajador. */
  guardarNominas?: boolean;
  quien?: Quien;
  almacen?: AlmacenNominas;
};

/**
 * Paso 2: crea los nuevos marcados y actualiza los marcados. Todo o nada.
 *
 * La comparación se rehace aquí dentro, con la base como esté AHORA: si entre
 * el análisis y el «Importar» alguien dio de alta a esa persona a mano, deja
 * de ser «nueva» y no se duplica.
 */
export async function aplicarNominas(
  pdf: Buffer,
  companyId: string,
  seleccion: Seleccion,
  cx: Ejecutor = db as unknown as Ejecutor,
  opciones: OpcionesDeNominas = {}
): Promise<ResultadoImportacion> {
  const lectura = leerPdfDeNominas(pdf);
  const crear = new Set(seleccion.crear.map(normalizarDocumento));
  const actualizar = new Set(seleccion.actualizar.map(normalizarDocumento));
  // Guardar las nóminas del mes sin dar de alta ni tocar a nadie es lo normal
  // casi todos los meses: no hace falta marcar a nadie para eso.
  if (crear.size === 0 && actualizar.size === 0 && !opciones.guardarNominas) {
    throw new ErrorImportacion(400, "No has marcado a nadie.");
  }

  const importado = await enTransaccion(cx, async (q) => {
    const { core, numero } = await hayCore({ query: q });
    if (!core) throw new ErrorImportacion(503, "Core no está instalado en esta base.", "SIN_CORE");
    const { rows: emp } = await q(`SELECT id::text AS id, nombre FROM sea_companies WHERE id::text = $1`, [companyId]);
    if (!emp[0]) throw new ErrorImportacion(404, "Esa empresa no existe en Core.");

    const { filas } = compararConCore(lectura.personas, await empleadosDeCore(q, numero), companyId, numero);
    const { rows: centros } = await q(
      `SELECT id::text AS id, nombre FROM sea_work_centers WHERE company_id::text = $1 AND activo`,
      [companyId]
    );
    const centroDe = (nombre: string) => {
      const clave = normalizarNombre(nombre);
      const iguales = centros.filter((c) => normalizarNombre(c.nombre) === clave);
      return iguales.length === 1 ? (iguales[0].id as string) : null;
    };

    const resultado: Omit<ResultadoImportacion, "nominas"> = { creados: [], actualizados: [] };
    try {
      // 1. Los que ya están. Primero se les QUITA el número a todos los que lo
      //    cambian y luego se pone el nuevo: si no, al dar el «2» a una persona
      //    mientras otra todavía lo tiene, el índice único lo rechazaría.
      const aActualizar = filas.filter((f) => f.tipo === "actualizar" && f.empleadoId && actualizar.has(f.nif));
      const cambianNumero = aActualizar.filter((f) => f.cambios.some((c) => c.campo === "numero_trabajador"));
      if (cambianNumero.length) {
        await q(`UPDATE sea_employees SET numero_trabajador = NULL WHERE id::text = ANY($1::text[])`, [
          cambianNumero.map((f) => f.empleadoId),
        ]);
      }
      for (const f of aActualizar) {
        const sets = f.cambios.map((c, i) => `${c.campo} = $${i + 2}${c.campo === "fecha_alta" ? "::date" : ""}`);
        await q(`UPDATE sea_employees SET ${sets.join(", ")}, updated_at = now() WHERE id::text = $1`, [
          f.empleadoId,
          ...f.cambios.map((c) => c.nuevo),
        ]);
        resultado.actualizados.push({
          id: f.empleadoId!,
          nombre: f.empleadoNombre ?? `${f.nombre} ${f.apellidos}`,
          cambios: f.cambios.map((c) => c.etiqueta),
        });
      }

      // 2. Los nuevos, en `pendiente`: les falta el enlace de alta.
      for (const f of filas.filter((x) => x.tipo === "nuevo" && crear.has(x.nif))) {
        const columnas = ["company_id", "work_center_id", "nombre", "apellidos", "dni_nie", "num_seguridad_social", "fecha_alta", "cargo", "estado_alta"];
        const valores: unknown[] = [companyId, centroDe(f.centro), f.nombre, f.apellidos, f.nif, f.nass || null, f.antiguedad, f.grupo || null, "pendiente"];
        if (numero && f.codigo) {
          columnas.push("numero_trabajador");
          valores.push(f.codigo);
        }
        const { rows } = await q(
          `INSERT INTO sea_employees (${columnas.join(", ")})
           VALUES (${valores.map((_, i) => `$${i + 1}`).join(", ")})
           RETURNING id::text AS id`,
          valores
        );
        resultado.creados.push({
          id: rows[0].id,
          nombre: `${f.nombre} ${f.apellidos}`,
          numeroTrabajador: numero ? f.codigo || null : null,
        });
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        throw new ErrorImportacion(
          409,
          "Un número de trabajador de la nómina ya lo tiene otra persona en Core. Marca también «actualizar» en quien lo tiene ahora, o cámbiaselo en su ficha, y vuelve a importar. No se ha guardado nada.",
          "NUMERO_REPETIDO"
        );
      }
      if (code === "42703") {
        throw new ErrorImportacion(503, "A la tabla de empleados le falta alguna columna: hay migraciones de Core sin ejecutar en Supabase.", "SIN_MIGRAR");
      }
      throw err;
    }
    return resultado;
  });

  if (!opciones.guardarNominas) return { ...importado, nominas: null };
  return { ...importado, nominas: await guardarNominasDelPdf(pdf, lectura, companyId, cx, opciones) };
}

/**
 * Cada nómina, a la ficha de su persona. Va DESPUÉS de la importación y fuera
 * de su transacción: los nuevos ya existen (y a quien le faltaba el DNI ya lo
 * tiene), y si esto falla los empleados no se pierden; se dice y se repite.
 *
 * Solo se guarda a quien se reconoce por NIF. A quien solo se reconoce por el
 * nombre —porque en Core no tiene DNI— no: una nómina en la ficha de otra
 * persona es justo lo que no puede pasar.
 */
async function guardarNominasDelPdf(
  pdf: Buffer,
  lectura: ReturnType<typeof leerPdfDeNominas>,
  companyId: string,
  cx: Ejecutor,
  opciones: OpcionesDeNominas
): Promise<NominasGuardadas> {
  const q: Consulta = (s, p) => cx.query(s, p);
  const noGuardadas: NominasGuardadas["noGuardadas"] = [];
  if (!(await hayNominas({ query: q }))) {
    return { guardadas: 0, fichas: 0, noGuardadas, error: "Falta ejecutar supabase/migrations/core_nominas_empleado.sql en Supabase." };
  }
  try {
    const { numero } = await hayCore({ query: q });
    const { filas } = compararConCore(lectura.personas, await empleadosDeCore(q, numero), companyId, numero);
    const lista: NominaParaGuardar[] = [];
    for (const f of filas) {
      const nombre = `${f.nombre} ${f.apellidos}`.trim();
      if (!f.empleadoId) noGuardadas.push({ nombre, motivo: "no tiene ficha en Core" });
      else if (f.porNombre) noGuardadas.push({ nombre, motivo: "en Core no tiene DNI; actualízale y vuelve a importar" });
      else {
        const persona = lectura.personas.find((p) => p.nif === f.nif);
        for (const nomina of persona?.nominas ?? []) lista.push({ employeeId: f.empleadoId, nomina });
      }
    }
    const hecho = await guardarNominas(pdf, lista, opciones.quien ?? { userId: null, nombre: null }, {
      consultor: { query: q },
      almacen: opciones.almacen,
    });
    if (hecho.sinPeriodo > 0) {
      noGuardadas.push({ nombre: `${hecho.sinPeriodo} nómina(s)`, motivo: "no se entiende de qué mes son" });
    }
    return { guardadas: hecho.guardadas, fichas: hecho.fichas, noGuardadas };
  } catch (err) {
    console.error("[Core nóminas] no se han podido guardar:", err instanceof Error ? err.message : err);
    return { guardadas: 0, fichas: 0, noGuardadas, error: "No se han podido guardar las nóminas en las fichas. Vuelve a importar el PDF." };
  }
}

/* ── Rutas ───────────────────────────────────────────────────────────────── */

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

function listaDeNif(valor: unknown): string[] {
  try {
    const v = typeof valor === "string" ? JSON.parse(valor) : valor;
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** `/api/core/empleados/importar-nominas/*`: solo administradores. */
export function createImportarNominasRouter(
  opciones: { autenticar?: RequestHandler; ejecutor?: Ejecutor; almacen?: AlmacenNominas } = {}
): Router {
  const r = Router();
  const guardias = [opciones.autenticar ?? authenticate, requireAdmin, subida.single("pdf")];

  const responderError = (res: Response, err: unknown, donde: string) => {
    if (err instanceof ErrorImportacion) return res.status(err.status).json({ error: err.message, code: err.code });
    // Ni el PDF ni su contenido van al registro: solo dónde ha fallado.
    console.error(`${donde}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: "No se han podido leer las nóminas." });
  };

  r.post("/importar-nominas/analizar", ...guardias, async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Falta el PDF de las nóminas." });
    try {
      const companyId = String(req.body?.companyId ?? "").trim() || null;
      res.json(await analizarNominas(req.file.buffer, companyId, opciones.ejecutor));
    } catch (err) {
      responderError(res, err, "POST importar-nominas/analizar");
    }
  });

  r.post("/importar-nominas/aplicar", ...guardias, async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Falta el PDF de las nóminas." });
    const companyId = String(req.body?.companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ error: "Falta la empresa." });
    try {
      const hecho = await aplicarNominas(
        req.file.buffer,
        companyId,
        { crear: listaDeNif(req.body?.crear), actualizar: listaDeNif(req.body?.actualizar) },
        opciones.ejecutor,
        {
          guardarNominas: req.body?.guardarNominas === "1",
          quien: { userId: req.authCtx!.userId ?? null, nombre: req.authCtx!.nombre ?? null },
          almacen: opciones.almacen,
        }
      );
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.empleados.importar_nominas",
        entidad: "sea_employees",
        // Quién se ha creado o tocado; ningún dato de la nómina.
        detalle: {
          companyId,
          creados: hecho.creados.map((c) => c.id),
          actualizados: hecho.actualizados.map((a) => a.id),
          nominasGuardadas: hecho.nominas?.guardadas ?? 0,
        },
        ip: req.ip,
      });
      res.json(hecho);
    } catch (err) {
      responderError(res, err, "POST importar-nominas/aplicar");
    }
  });

  return r;
}
