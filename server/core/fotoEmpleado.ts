/**
 * La foto del empleado: una sola, en Core, para todos los módulos.
 *
 * Se guarda YA normalizada (`fotoNormalizar.ts`) en el bucket privado de Core,
 * el mismo de los DNI, y en `sea_employees.foto_url` queda su ruta dentro del
 * bucket (no una dirección). Quien la enseña pide una dirección firmada, que
 * caduca: una foto de una persona no tiene por qué tener un enlace público.
 *
 * La foto original no se guarda en ningún sitio: se recorta en memoria y lo
 * que se sube es el resultado.
 *
 * ## Quién la pone
 *
 *  · El trabajador, en el enlace de alta (`altaOperarioRouter.ts`), donde es
 *    obligatoria para enviar el formulario.
 *  · Un administrador, desde la ficha de Core (este router). Él sí puede
 *    «usarla igualmente» cuando la comprobación dice que no hay una cara: a
 *    veces la foto buena es la que hay.
 *
 * ## La IA
 *
 * Para saber dónde está la cabeza se le pregunta al mismo modelo que ya
 * recorta los DNI. Se le pide un recuadro y si se ve bien; no que diga quién
 * es ni cómo es. Sin IA configurada, o si falla, la foto se recorta al centro
 * y se guarda igual.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";

import db from "../db.ts";
import { supabase, SUPABASE_STORAGE_BUCKET } from "../supabase.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { normalizarFoto, type Localizador, type Mirada } from "./fotoNormalizar.ts";
import { rutaEnBucket } from "./fotosFirmadas.ts";
import { hayIA, pedirIA } from "./openaiService.ts";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Bucket PRIVADO de Core: el mismo de los documentos del alta. */
export const BUCKET_CORE = process.env.SUPABASE_CORE_DOCS_BUCKET || "core-documentos";

/** Una foto de móvil con la cámara al máximo no pasa de aquí. */
const MAX_BYTES = 8 * 1024 * 1024;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Lo que dura una dirección firmada. Las pantallas la vuelven a pedir al recargar. */
const CADUCIDAD_URL_S = 12 * 3600;

/**
 * Dónde se guarda una foto. Cada foto nueva va a una ruta NUEVA (lleva la
 * hora), y la anterior se borra.
 *
 * Es lo que permite que la dirección de una foto sea estable: mientras la
 * foto no cambie, su ruta tampoco, y las pantallas que recargan cada pocos
 * segundos (las TV del taller) no tienen que volver a descargarla. Y cuando
 * cambia, cambia la ruta, así que nadie se queda viendo la vieja de su caché.
 */
export const rutaDeFoto = (employeeId: string, ahoraMs = Date.now()) => `empleados/${employeeId}/foto-${ahoraMs}.jpg`;

/** Dónde se guardan las fotos. En las pruebas, uno de mentira. */
export type Almacen = {
  subir(ruta: string, jpeg: Buffer): Promise<void>;
  borrar(ruta: string): Promise<void>;
  /** Dirección firmada de cada ruta; la que no se pueda firmar no aparece. */
  firmar(rutas: string[]): Promise<Record<string, string>>;
};

export const almacenSupabase: Almacen = {
  async subir(ruta, jpeg) {
    const { error } = await supabase.storage.from(BUCKET_CORE).upload(ruta, jpeg, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`No se ha podido guardar la foto: ${error.message}`);
  },
  async borrar(ruta) {
    const { error } = await supabase.storage.from(BUCKET_CORE).remove([ruta]);
    if (error) throw new Error(`No se ha podido borrar la foto: ${error.message}`);
  },
  async firmar(rutas) {
    const urls: Record<string, string> = {};
    const ahora = Date.now();
    const porFirmar: string[] = [];
    for (const ruta of new Set(rutas)) {
      const ya = firmadas.get(ruta);
      if (ya && ya.hastaMs > ahora) urls[ruta] = ya.url;
      else porFirmar.push(ruta);
    }
    if (porFirmar.length === 0) return urls;
    const { data, error } = await supabase.storage.from(BUCKET_CORE).createSignedUrls(porFirmar, CADUCIDAD_URL_S);
    if (error || !data) return urls;
    for (const d of data) {
      if (!d.path || !d.signedUrl || d.error) continue;
      urls[d.path] = d.signedUrl;
      firmadas.set(d.path, { url: d.signedUrl, hastaMs: ahora + REUSAR_URL_MS });
    }
    return urls;
  },
};

/**
 * Las direcciones ya firmadas, para no pedir una nueva en cada recarga.
 *
 * `GET /api/techs` se llama cada 15 segundos desde cada pantalla abierta: sin
 * esto sería una llamada a Supabase por recarga y una dirección distinta cada
 * vez. Se reutiliza durante la mitad de lo que vale, así que la que se entrega
 * siempre tiene horas por delante. No hace falta invalidar nada: una foto
 * nueva tiene otra ruta.
 */
const REUSAR_URL_MS = (CADUCIDAD_URL_S * 1000) / 2;
const firmadas = new Map<string, { url: string; hastaMs: number }>();

/* ── La mirada de la IA ──────────────────────────────────────────────────── */

const INSTRUCCIONES = `Es la foto que una persona se ha hecho para su ficha de empleado.
No digas quién es ni describas sus rasgos: solo hay que encuadrarla.

Devuelve:
- "caras": cuántas caras de personas reales se ven en la foto (0, 1, 2…).
- "cara": el recuadro de la CABEZA de la persona principal, desde lo alto del pelo hasta la barbilla y de oreja a oreja. "x" e "y" son la esquina superior izquierda y "w" y "h" el ancho y el alto, todo en proporción de la foto, de 0 a 1. Si no hay ninguna cara, pon los cuatro a 0.
- "seVeBien": true si la cara se ve entera, de frente o casi, enfocada, con luz suficiente y sin nada que la tape (gafas de sol, mascarilla, gorra calada, una mano).
- "motivo": si seVeBien es false, por qué, en una frase corta en español y hablándole de tú («Llevas gafas de sol», «Hay poca luz»). Si es true, cadena vacía.`;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caras", "cara", "seVeBien", "motivo"],
  properties: {
    caras: { type: "integer" },
    cara: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "w", "h"],
      properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
    },
    seVeBien: { type: "boolean" },
    motivo: { type: "string" },
  },
} as const;

/** Le pregunta al modelo dónde está la cabeza. `null` si no hay IA o no contesta. */
export const localizarConIA: Localizador = async (jpeg) => {
  if (!hayIA()) return null;
  const r = await pedirIA<Mirada>({
    operacion: "core.foto.encuadrar",
    proposito: "documento",
    prompt: INSTRUCCIONES,
    imagenes: [{ url: `data:image/jpeg;base64,${jpeg.toString("base64")}` }],
    esquema: { nombre: "encuadre_foto", schema: ESQUEMA as unknown as Record<string, unknown> },
    maxTokens: 300,
    timeoutMs: 45_000,
  });
  return r.ok && r.datos ? r.datos : null;
};

/* ── Guardar, quitar, enseñar ────────────────────────────────────────────── */

export class ErrorFoto extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export type Dependencias = { consultor?: Consultor; almacen?: Almacen; localizar?: Localizador | null };

export type FotoGuardada = { url: string | null; aviso: string | null };

/**
 * Normaliza la foto y la deja como LA foto del empleado.
 *
 * @param forzar  guardarla aunque no se vea una sola cara. Solo desde la ficha.
 */
export async function ponerFoto(
  employeeId: string,
  fichero: { buffer: Buffer; mimetype: string } | undefined,
  opciones: { forzar?: boolean } = {},
  deps: Dependencias = {}
): Promise<FotoGuardada> {
  const cx = deps.consultor ?? db;
  const almacen = deps.almacen ?? almacenSupabase;
  const localizar = deps.localizar === undefined ? localizarConIA : deps.localizar;

  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new ErrorFoto(404, "Ese empleado no existe.");
  if (!fichero) throw new ErrorFoto(400, "No ha llegado la foto.");
  if (!MIMES.has(fichero.mimetype)) throw new ErrorFoto(400, "La foto tiene que ser JPG, PNG o WEBP.");
  const { rows } = await cx.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [employeeId]);
  if (!rows[0]) throw new ErrorFoto(404, "Ese empleado no existe.");
  const anterior = rows[0].foto_url ? String(rows[0].foto_url) : "";

  const r = await normalizarFoto(fichero.buffer, localizar, { forzar: opciones.forzar });
  if (r.ok === false) throw new ErrorFoto(422, r.motivo, "FOTO_NO_VALE");

  const ruta = rutaDeFoto(employeeId);
  await almacen.subir(ruta, r.jpeg);
  await cx.query(`UPDATE sea_employees SET foto_url = $2, updated_at = now() WHERE id = $1`, [employeeId, ruta]);
  // La anterior ya no la apunta nadie. Si no se puede borrar, queda un
  // fichero huérfano: molesta, pero la ficha está bien.
  if (anterior && anterior !== ruta) {
    await almacen.borrar(anterior).catch((e) => console.error("[Core foto]", e instanceof Error ? e.message : e));
  }
  return { url: (await almacen.firmar([ruta]))[ruta] ?? null, aviso: r.aviso };
}

export async function quitarFoto(employeeId: string, deps: Dependencias = {}): Promise<void> {
  const cx = deps.consultor ?? db;
  const almacen = deps.almacen ?? almacenSupabase;
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new ErrorFoto(404, "Ese empleado no existe.");
  const { rows } = await cx.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [employeeId]);
  if (!rows[0]) throw new ErrorFoto(404, "Ese empleado no existe.");
  // Primero la ficha: si el borrado del fichero falla, queda un fichero
  // huérfano, que es mejor que una ficha apuntando a una foto que no existe.
  await cx.query(`UPDATE sea_employees SET foto_url = NULL, updated_at = now() WHERE id = $1`, [employeeId]);
  if (rows[0].foto_url) await almacen.borrar(String(rows[0].foto_url)).catch((e) => console.error("[Core foto]", e instanceof Error ? e.message : e));
}

/** ¿Tiene foto? Para exigirla al enviar el alta. */
export async function tieneFoto(employeeId: string, cx: Consultor = db): Promise<boolean> {
  const { rows } = await cx.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [employeeId]);
  return Boolean(rows[0]?.foto_url);
}

/** La dirección firmada de la foto de un empleado, o `null`. */
export async function urlDeFoto(employeeId: string, deps: Dependencias = {}): Promise<string | null> {
  const cx = deps.consultor ?? db;
  const { rows } = await cx.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [employeeId]);
  const ruta = rows[0]?.foto_url ? String(rows[0].foto_url) : "";
  if (!ruta) return null;
  return (await (deps.almacen ?? almacenSupabase).firmar([ruta]))[ruta] ?? null;
}

/** Las de todos los que tienen: { idEmpleado: dirección }. Para las listas. */
export async function urlsDeFotos(deps: Dependencias = {}): Promise<Record<string, string>> {
  const cx = deps.consultor ?? db;
  const { rows } = await cx.query(`SELECT id::text AS id, foto_url FROM sea_employees WHERE foto_url IS NOT NULL AND foto_url <> ''`);
  const firmadas = await (deps.almacen ?? almacenSupabase).firmar(rows.map((r) => String(r.foto_url)));
  const porEmpleado: Record<string, string> = {};
  for (const r of rows) if (firmadas[r.foto_url]) porEmpleado[r.id] = firmadas[r.foto_url];
  return porEmpleado;
}

/* ── Las fotos que ya había en Taller ────────────────────────────────────── */

/** De dónde sacar el fichero de una foto de Taller. `null` = no se puede. */
export type OrigenTaller = (avatar: string) => Promise<{ buffer: Buffer; mimetype: string } | null>;

/**
 * Las fotos de Taller están en el bucket del panel y en `techs.avatar` queda
 * su dirección pública. Se baja con la clave del servidor a partir de la RUTA
 * dentro de ese bucket: no se hace ninguna petición a una dirección sacada de
 * la base, así que una fila con una dirección rara no hace que el servidor
 * llame a donde no debe. Lo que no sea de ese bucket, se salta.
 */
export const origenTallerSupabase: OrigenTaller = async (avatar) => {
  const ruta = rutaEnBucket(avatar, SUPABASE_STORAGE_BUCKET);
  if (!ruta) return null;
  const { data, error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).download(ruta);
  if (error || !data) return null;
  return { buffer: Buffer.from(await data.arrayBuffer()), mimetype: data.type || "image/jpeg" };
};

const CANDIDATOS_DE_TALLER = `
  FROM techs t
  JOIN sea_employees e ON e.id = t.employee_id
 WHERE COALESCE(t.avatar, '') <> ''
   AND COALESCE(e.foto_url, '') = ''`;

/** Cuántos técnicos enlazados tienen foto en Taller y todavía no en Core. */
export async function fotosPendientesDeTaller(cx: Consultor = db): Promise<number> {
  try {
    const { rows } = await cx.query(`SELECT count(*)::int AS n ${CANDIDATOS_DE_TALLER}`);
    return Number(rows[0]?.n ?? 0);
  } catch {
    // Sin taller en esta base (o sin `employee_id`): no hay nada que traer.
    return 0;
  }
}

export type FotosTraidas = { pasadas: string[]; saltadas: { tecnico: string; motivo: string }[] };

/**
 * Pasa a Core, normalizadas, las fotos que los técnicos enlazados tienen en
 * Taller. Solo a quien no tiene ya foto en Core: no pisa nada.
 *
 * Se fuerzan: son fotos que alguien ya eligió para ese técnico, y lo que se
 * busca es no perderlas. Si no se les encuentra la cara, se recortan al centro.
 * `techs.avatar` no se toca: sigue ahí por si se desenlaza.
 */
export async function traerFotosDeTaller(deps: Dependencias & { origen?: OrigenTaller } = {}): Promise<FotosTraidas> {
  const cx = deps.consultor ?? db;
  const origen = deps.origen ?? origenTallerSupabase;
  const { rows } = await cx.query(`SELECT t.name, t.avatar, e.id::text AS employee_id ${CANDIDATOS_DE_TALLER} ORDER BY t.name`);

  const hecho: FotosTraidas = { pasadas: [], saltadas: [] };
  for (const t of rows) {
    const tecnico = String(t.name);
    try {
      const fichero = await origen(String(t.avatar));
      if (!fichero) {
        hecho.saltadas.push({ tecnico, motivo: "su foto no está en el almacén del panel" });
        continue;
      }
      await ponerFoto(t.employee_id, fichero, { forzar: true }, deps);
      hecho.pasadas.push(tecnico);
    } catch (e) {
      hecho.saltadas.push({ tecnico, motivo: e instanceof ErrorFoto ? e.message : "no se ha podido leer la foto" });
    }
  }
  return hecho;
}

/* ── Rutas de la ficha ───────────────────────────────────────────────────── */

export const subidaDeFoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** `/api/core/empleados/fotos` y `/:id/foto`: solo administradores. */
export function createFotoEmpleadoRouter(
  opciones: { autenticar?: RequestHandler; origen?: OrigenTaller } & Dependencias = {}
): Router {
  const r = Router();
  const guardias = [opciones.autenticar ?? authenticate, requireAdmin];
  const deps: Dependencias = { consultor: opciones.consultor, almacen: opciones.almacen, localizar: opciones.localizar };

  const responder = (res: Response, err: unknown, donde: string) => {
    if (err instanceof ErrorFoto) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(`${donde}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: "No se ha podido guardar la foto." });
  };

  r.get("/fotos", ...guardias, async (_req: Request, res: Response) => {
    try {
      res.json({
        fotos: await urlsDeFotos(deps),
        // Para ofrecer «Traer fotos de Taller» solo mientras haga falta.
        pendientesDeTaller: await fotosPendientesDeTaller(deps.consultor),
      });
    } catch (err) {
      console.error("GET /api/core/empleados/fotos:", err instanceof Error ? err.message : err);
      // Sin fotos la lista sale igual, con las iniciales.
      res.json({ fotos: {}, pendientesDeTaller: 0 });
    }
  });

  r.post("/fotos/traer-de-taller", ...guardias, async (req: Request, res: Response) => {
    try {
      const hecho = await traerFotosDeTaller({ ...deps, origen: opciones.origen });
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.empleado.foto.traer_de_taller",
        entidad: "sea_employees",
        detalle: { pasadas: hecho.pasadas.length, saltadas: hecho.saltadas.length },
        ip: req.ip,
      });
      res.json(hecho);
    } catch (err) {
      responder(res, err, "POST /api/core/empleados/fotos/traer-de-taller");
    }
  });

  r.post("/:employeeId/foto", ...guardias, subidaDeFoto.single("foto"), async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    try {
      const hecha = await ponerFoto(employeeId, req.file, { forzar: req.body?.forzar === "1" }, deps);
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.empleado.foto.poner",
        entidad: "sea_employees",
        entidadId: employeeId,
        detalle: { forzada: req.body?.forzar === "1" },
        ip: req.ip,
      });
      res.json(hecha);
    } catch (err) {
      responder(res, err, "POST /api/core/empleados/:id/foto");
    }
  });

  r.delete("/:employeeId/foto", ...guardias, async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    try {
      await quitarFoto(employeeId, deps);
      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "core.empleado.foto.quitar",
        entidad: "sea_employees",
        entidadId: employeeId,
        ip: req.ip,
      });
      res.json({ ok: true });
    } catch (err) {
      responder(res, err, "DELETE /api/core/empleados/:id/foto");
    }
  });

  return r;
}
