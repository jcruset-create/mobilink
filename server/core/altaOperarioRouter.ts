/**
 * Las rutas del alta por enlace: las del encargado y las del operario.
 *
 * Van en dos routers porque son dos mundos distintos y se montan en dos
 * sitios distintos:
 *
 *  · `/api/core/alta` — con sesión y solo para administradores. Crea el
 *    enlace y lo manda.
 *  · `/api/public/alta` — sin sesión ninguna. Quien abre el enlace no es
 *    nadie del sistema todavía; lo único que le da derecho a ver algo es
 *    el token, y el token no se guarda ni se registra en claro.
 *
 * Mezclarlos en un router con un `if` por ruta es la forma conocida de que
 * una ruta nueva se quede sin la comprobación que le tocaba.
 */

import { Router, json, type Request, type Response } from "express";
import multer from "multer";

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { clienteTwilio, hayCredencialesTwilio } from "./twilio.ts";
import {
  CAMPOS_TALLA,
  caducidadDesde,
  esTipoDocumento,
  faltaParaEnviar,
  hashToken,
  motivoCerrado,
  movilValido,
  nuevoToken,
  textoSms,
  urlDeAlta,
  validarFicha,
  type Consentimiento,
} from "./altaOperario.ts";

/** Bucket PRIVADO. Hay que crearlo a mano en Supabase, sin marcar «Public». */
const BUCKET = process.env.SUPABASE_CORE_DOCS_BUCKET || "core-documentos";

/** Una foto de móvil con la cámara al máximo no pasa de aquí. */
const MAX_BYTES = 8 * 1024 * 1024;

const subidaFoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** El cuerpo de un formulario de texto. La foto va por multipart, aparte. */
const MAX_CUERPO = "256kb";

const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * El dominio que se mete en el SMS.
 *
 * Mismo criterio que la valoración: `PUBLIC_APP_URL` si es un dominio de
 * verdad, y si no el canónico. Nunca el nombre interno del servicio de
 * Render: un enlace a `onrender.com` parece una estafa, y con razón.
 */
const INTERNO = /onrender\.com|localhost|127\.0\.0\.1|tu-app/i;
function baseUrlPublica(): string {
  const configurada = String(process.env.PUBLIC_APP_URL ?? "").trim();
  if (/^https?:\/\//i.test(configurada) && !INTERNO.test(configurada)) {
    return configurada.replace(/\/+$/, "");
  }
  return "https://mobilink-solutions.com";
}

// ── Un límite por IP, para una ruta sin sesión ─────────────────────────────
//
// Pequeño y en memoria, como el de la valoración: en Render hay varias
// instancias, así que esto no es una muralla, es lo que impide que alguien
// pruebe tokens a mano desde una consola.

type Limite = { peticiones: number; ventanaMs: number };
const LIMITE_LECTURA: Limite = { peticiones: 120, ventanaMs: 10 * 60_000 };
const LIMITE_ESCRITURA: Limite = { peticiones: 90, ventanaMs: 10 * 60_000 };
const marcas = new Map<string, { cuenta: number; expiraEnMs: number }>();

function consumir(clave: string, limite: Limite): boolean {
  const ahora = Date.now();
  if (marcas.size > 20_000) {
    for (const [k, m] of marcas) if (m.expiraEnMs <= ahora) marcas.delete(k);
  }
  const marca = marcas.get(clave);
  if (!marca || marca.expiraEnMs <= ahora) {
    marcas.set(clave, { cuenta: 1, expiraEnMs: ahora + limite.ventanaMs });
    return true;
  }
  marca.cuenta += 1;
  return marca.cuenta <= limite.peticiones;
}

function pasaLimite(req: Request, res: Response, sufijo: string, limite: Limite): boolean {
  const ip = String(req.ip ?? req.socket.remoteAddress ?? "");
  if (consumir(`${sufijo}:${ip}`, limite)) return true;
  res.status(429).json({ error: "Demasiadas peticiones. Inténtalo dentro de un rato." });
  return false;
}

// ── Consultas compartidas ──────────────────────────────────────────────────

type FilaInvitacion = {
  id: string;
  employee_id: string;
  estado: "enviado" | "abierto" | "recibida" | "anulada";
  caduca_at: string;
  empresa_id: string | null;
  nombre: string;
  apellidos: string | null;
};

async function invitacionPorToken(token: string): Promise<FilaInvitacion | null> {
  if (!token || token.length > 128) return null;
  const { rows } = await db.query(
    `SELECT i.id, i.employee_id, i.estado, i.caduca_at,
            e.company_id AS empresa_id, e.nombre, e.apellidos
       FROM sea_employee_invites i
       JOIN sea_employees e ON e.id = i.employee_id
      WHERE i.token_hash = $1`,
    [hashToken(token)]
  );
  return (rows[0] as FilaInvitacion) ?? null;
}

async function documentosDe(employeeId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT tipo FROM sea_employee_documents WHERE employee_id = $1`,
    [employeeId]
  );
  return rows.map((r: { tipo: string }) => r.tipo);
}

/** Sube el fichero al bucket privado y devuelve su ruta. */
async function guardarEnStorage(
  employeeId: string,
  nombre: string,
  buffer: Buffer,
  mime: string
): Promise<string> {
  const ruta = `empleados/${employeeId}/${nombre}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, buffer, { contentType: mime, upsert: true });
  if (error) throw new Error(`No se ha podido guardar el fichero: ${error.message}`);
  return ruta;
}

// ── Router del encargado ───────────────────────────────────────────────────

export function createAltaOperarioAdminRouter(): Router {
  const r = Router();
  r.use(json({ limit: MAX_CUERPO }));
  r.use(authenticate, requireAdmin);

  /**
   * Manda (o vuelve a mandar) el enlace.
   *
   * Cada envío anula los anteriores: si alguien pide el enlace dos veces,
   * el primero deja de abrir. Dos enlaces vivos para la misma ficha serían
   * dos formas de entrar y una sola de quitarlas.
   */
  r.post("/invitar", async (req: Request, res: Response) => {
    const employeeId = String(req.body?.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Falta el empleado." });
    }

    const { rows } = await db.query(
      `SELECT e.id, e.nombre, e.apellidos, e.telefono, e.company_id, c.nombre AS empresa
         FROM sea_employees e
         LEFT JOIN sea_companies c ON c.id = e.company_id
        WHERE e.id = $1`,
      [employeeId]
    );
    const empleado = rows[0];
    if (!empleado) return res.status(404).json({ error: "Ese empleado no existe." });

    const movil = movilValido(String(req.body?.telefono ?? empleado.telefono ?? ""));
    if (!movil) {
      return res.status(400).json({ error: "El empleado no tiene un móvil español válido." });
    }

    if (!hayCredencialesTwilio() || !process.env.TWILIO_SMS_FROM) {
      return res.status(503).json({
        error: "Falta configurar el envío de SMS (TWILIO_SMS_FROM). Avisa a sistemas.",
        code: "SMS_NO_CONFIGURADO",
      });
    }

    const token = nuevoToken();
    const caduca = caducidadDesde(Date.now());
    const cliente = await db.connect();
    let invitacionId: string;
    try {
      await cliente.query("BEGIN");
      await cliente.query(
        `UPDATE sea_employee_invites SET estado = 'anulada'
          WHERE employee_id = $1 AND estado IN ('enviado', 'abierto')`,
        [employeeId]
      );
      const { rows: creada } = await cliente.query(
        `INSERT INTO sea_employee_invites (employee_id, token_hash, telefono, canal, estado, caduca_at, enviado_por)
         VALUES ($1, $2, $3, 'sms', 'enviado', $4, $5)
         RETURNING id`,
        [employeeId, hashToken(token), movil, caduca.toISOString(), req.authCtx!.userId]
      );
      invitacionId = creada[0].id;
      await cliente.query(
        `UPDATE sea_employees SET estado_alta = 'enviado', telefono = COALESCE(telefono, $2) WHERE id = $1`,
        [employeeId, movil]
      );
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const cuerpo = textoSms({
      empresa: String(empleado.empresa ?? "Mobilink"),
      nombre: String(empleado.nombre ?? "").split(" ")[0],
      url: urlDeAlta(baseUrlPublica(), token),
    });

    try {
      const mensaje = await clienteTwilio().messages.create({
        from: String(process.env.TWILIO_SMS_FROM),
        to: movil,
        body: cuerpo,
      });
      await db.query(`UPDATE sea_employee_invites SET mensaje_sid = $2 WHERE id = $1`, [
        invitacionId,
        mensaje.sid,
      ]);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "error desconocido";
      // La invitación se anula: dejarla viva daría un enlace que nadie ha
      // recibido y una ficha que dice «enviado» sin serlo.
      await db.query(
        `UPDATE sea_employee_invites SET estado = 'anulada', error = $2 WHERE id = $1`,
        [invitacionId, motivo]
      );
      await db.query(`UPDATE sea_employees SET estado_alta = 'pendiente' WHERE id = $1`, [employeeId]);
      return res.status(502).json({ error: `No se ha podido mandar el SMS: ${motivo}` });
    }

    await registrarAuditoria({
      empresaId: req.authCtx!.empresaId,
      userId: req.authCtx!.userId,
      accion: "core.alta.invitar",
      entidad: "sea_employees",
      entidadId: employeeId,
      detalle: { canal: "sms", caduca: caduca.toISOString() },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, estado: "enviado", caducaAt: caduca.toISOString() });
  });

  return r;
}

// ── Router del operario ────────────────────────────────────────────────────

export function createAltaOperarioPublicRouter(): Router {
  const r = Router();
  r.use(json({ limit: MAX_CUERPO }));

  /**
   * Lo que hay que pintar para este token.
   *
   * Siempre 200, también cuando no se puede rellenar: el estado va dentro.
   * Un 404 le daría al operario la pantalla de error del navegador en vez
   * de una frase que se entiende, y encima distinguiría «no existe» de
   * «caducado» para quien fuera probando tokens.
   */
  r.get("/:token", async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "alta-get", LIMITE_LECTURA)) return;

    const invitacion = await invitacionPorToken(String(req.params.token ?? ""));
    const cerrado = motivoCerrado(invitacion);
    if (cerrado) return res.json({ abierto: false, motivo: cerrado });

    const inv = invitacion!;
    if (inv.estado === "enviado") {
      await db.query(
        `UPDATE sea_employee_invites SET estado = 'abierto', abierto_at = now() WHERE id = $1`,
        [inv.id]
      );
      await db.query(
        `UPDATE sea_employees SET estado_alta = 'abierto' WHERE id = $1 AND estado_alta = 'enviado'`,
        [inv.employee_id]
      );
    }

    const { rows } = await db.query(
      `SELECT e.nombre, e.apellidos, e.dni_nie, e.fecha_nacimiento, e.nacionalidad,
              e.num_seguridad_social, e.telefono, e.email, e.direccion, e.codigo_postal,
              e.poblacion, e.provincia, e.carnet_numero, e.carnet_clases, e.carnet_caducidad,
              e.cap_numero, e.cap_caducidad, e.emergencia_nombre, e.emergencia_telefono,
              c.nombre AS empresa, w.nombre AS centro
         FROM sea_employees e
         LEFT JOIN sea_companies c ON c.id = e.company_id
         LEFT JOIN sea_work_centers w ON w.id = e.work_center_id
        WHERE e.id = $1`,
      [inv.employee_id]
    );
    const { rows: tallas } = await db.query(
      `SELECT ${CAMPOS_TALLA.join(", ")} FROM sea_employee_clothing WHERE employee_id = $1`,
      [inv.employee_id]
    );

    res.json({
      abierto: true,
      empresa: rows[0]?.empresa ?? null,
      centro: rows[0]?.centro ?? null,
      ficha: rows[0] ?? {},
      tallas: tallas[0] ?? {},
      documentos: await documentosDe(inv.employee_id),
    });
  });

  /** Guarda lo tecleado hasta ahora. Se llama según escribe. */
  r.put("/:token", async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "alta-put", LIMITE_ESCRITURA)) return;

    const invitacion = await invitacionPorToken(String(req.params.token ?? ""));
    if (motivoCerrado(invitacion)) return res.status(409).json({ error: "El enlace ya no vale." });

    const { ficha, errores } = validarFicha(req.body);
    await guardarFicha(invitacion!.employee_id, ficha);
    res.json({ ok: true, errores });
  });

  /** Una de las cuatro fotos. Volver a mandarla sustituye a la anterior. */
  r.post("/:token/documento", subidaFoto.single("foto"), async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "alta-doc", LIMITE_ESCRITURA)) return;

    const invitacion = await invitacionPorToken(String(req.params.token ?? ""));
    if (motivoCerrado(invitacion)) return res.status(409).json({ error: "El enlace ya no vale." });

    const tipo = String(req.body?.tipo ?? "");
    if (!esTipoDocumento(tipo)) return res.status(400).json({ error: "Ese documento no se pide." });

    const fichero = req.file;
    if (!fichero) return res.status(400).json({ error: "No ha llegado la foto." });
    if (!MIMES.has(fichero.mimetype)) {
      return res.status(400).json({ error: "La foto tiene que ser JPG, PNG o WEBP." });
    }

    const extension = fichero.mimetype === "image/png" ? "png" : fichero.mimetype === "image/webp" ? "webp" : "jpg";
    const ruta = await guardarEnStorage(
      invitacion!.employee_id,
      `${tipo}.${extension}`,
      fichero.buffer,
      fichero.mimetype
    );

    await db.query(
      `INSERT INTO sea_employee_documents (employee_id, tipo, storage_path, mime, bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, tipo) DO UPDATE
         SET storage_path = EXCLUDED.storage_path, mime = EXCLUDED.mime,
             bytes = EXCLUDED.bytes, subido_at = now()`,
      [invitacion!.employee_id, tipo, ruta, fichero.mimetype, fichero.size]
    );

    res.json({ ok: true, tipo, documentos: await documentosDe(invitacion!.employee_id) });
  });

  /** La envía. A partir de aquí el enlace deja de abrir. */
  r.post("/:token/enviar", async (req: Request, res: Response) => {
    if (!pasaLimite(req, res, "alta-enviar", LIMITE_ESCRITURA)) return;

    const invitacion = await invitacionPorToken(String(req.params.token ?? ""));
    if (motivoCerrado(invitacion)) return res.status(409).json({ error: "El enlace ya no vale." });
    const inv = invitacion!;

    const { ficha, errores } = validarFicha(req.body, true);
    const consentimientos = leerConsentimientos(req.body?.consentimientos);
    const firma = String(req.body?.firma ?? "");
    const falta = faltaParaEnviar({
      documentos: await documentosDe(inv.employee_id),
      consentimientos,
      firma: firma.startsWith("data:image/"),
    });

    const problemas = [...errores, ...falta];
    if (problemas.length > 0) return res.status(400).json({ error: problemas[0], problemas });

    await guardarFicha(inv.employee_id, ficha);

    const firmaRuta = await guardarEnStorage(
      inv.employee_id,
      `firma-${Date.now()}.png`,
      Buffer.from(firma.slice(firma.indexOf(",") + 1), "base64"),
      "image/png"
    );

    const ip = String(req.ip ?? "");
    const dispositivo = String(req.headers["user-agent"] ?? "").slice(0, 300);

    /*
     * Los consentimientos y la firma van a las tablas que Core ya tiene
     * para eso (`sea_consents` y `sea_signatures`), no a una columna nueva.
     * Un segundo sitio donde mirar quién aceptó qué es un sitio que algún
     * día dirá otra cosa que el primero.
     */
    for (const [clave, tipo] of TIPOS_CONSENTIMIENTO) {
      await db.query(
        `INSERT INTO sea_consents (employee_id, tipo, aceptado, fecha, dispositivo, ip, firma_url)
         VALUES ($1, $2, $3, now(), $4, $5, $6)`,
        [inv.employee_id, tipo, consentimientos[clave] === true, dispositivo, ip, firmaRuta]
      );
    }
    await db.query(
      `INSERT INTO sea_signatures (employee_id, modulo, referencia_id, tipo, firma_url, dispositivo, ip)
       VALUES ($1, 'core', $2, 'alta_operario', $3, $4, $5)`,
      [inv.employee_id, inv.id, firmaRuta, dispositivo, ip]
    );

    await db.query(
      `UPDATE sea_employee_invites
          SET estado = 'recibida', recibida_at = now(), firma_path = $2, firmado_at = now()
        WHERE id = $1`,
      [inv.id, firmaRuta]
    );
    await db.query(`UPDATE sea_employees SET estado_alta = 'recibida' WHERE id = $1`, [inv.employee_id]);

    res.json({ ok: true });
  });

  return r;
}

/** Cómo se llama cada consentimiento en `sea_consents`. */
const TIPOS_CONSENTIMIENTO: ReadonlyArray<[Consentimiento, string]> = [
  ["normativa", "normativa_interna"],
  ["whatsapp", "whatsapp"],
  ["datos", "proteccion_datos"],
];

function leerConsentimientos(valor: unknown): Partial<Record<Consentimiento, boolean>> {
  const v = (valor ?? {}) as Record<string, unknown>;
  return { normativa: v.normativa === true, whatsapp: v.whatsapp === true, datos: v.datos === true };
}

/** Escribe la ficha y las tallas. Solo las columnas que han venido. */
async function guardarFicha(
  employeeId: string,
  ficha: { empleado: Record<string, string | null>; tallas: Record<string, string | null> }
): Promise<void> {
  const campos = Object.keys(ficha.empleado);
  if (campos.length > 0) {
    const sets = campos.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await db.query(
      `UPDATE sea_employees SET ${sets}, updated_at = now() WHERE id = $1`,
      [employeeId, ...campos.map((c) => ficha.empleado[c])]
    );
  }

  const tallas = Object.keys(ficha.tallas);
  if (tallas.length > 0) {
    const columnas = ["employee_id", ...tallas];
    const valores = [employeeId, ...tallas.map((c) => ficha.tallas[c])];
    const marcadores = columnas.map((_, i) => `$${i + 1}`).join(", ");
    const actualiza = tallas.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
    await db.query(
      `INSERT INTO sea_employee_clothing (${columnas.join(", ")}) VALUES (${marcadores})
       ON CONFLICT (employee_id) DO UPDATE SET ${actualiza}`,
      valores
    );
  }
}
