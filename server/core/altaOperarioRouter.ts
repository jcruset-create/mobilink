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
import sharp from "sharp";

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { registrarAuditoria } from "./auditoria.ts";
import { clienteTwilio, hayCredencialesTwilio } from "./twilio.ts";
import { hayIA, pedirIA } from "./openaiService.ts";
import {
  CAMPOS_TALLA,
  CAMPOS_VERIFICABLES,
  ESQUEMA_LECTURA,
  ESQUEMA_RECORTE,
  ESQUEMA_VERIFICACION,
  INSTRUCCIONES_LECTURA,
  INSTRUCCIONES_RECORTE,
  INSTRUCCIONES_VERIFICACION,
  caducidadDesde,
  esTipoDocumento,
  faltaParaEnviar,
  hashToken,
  motivoCerrado,
  movilValido,
  nuevoToken,
  textoSms,
  estadoTrasInvitar,
  motivoDeInvitacion,
  textoSmsActualizacion,
  urlDeAlta,
  validarFicha,
  certificacionesDeLectura,
  fichaDeLectura,
  recorteEnPixeles,
  type Consentimiento,
  type Lectura,
  type LecturaRecorte,
  type MotivoInvitacion,
  type Verificacion,
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
      `SELECT e.id, e.nombre, e.apellidos, e.telefono, e.estado_alta, e.company_id, c.nombre AS empresa
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

    /*
     * Alta o actualización. Por defecto lo decide el estado de la ficha —a
     * quien ya está completo se le pide que repase, no que se dé de alta—,
     * pero la pantalla puede forzarlo: «pedir corrección» sobre una ficha
     * recién recibida es una actualización, aunque el alta no esté cerrada.
     */
    const motivo: MotivoInvitacion =
      req.body?.motivo === "actualizacion" || req.body?.motivo === "alta"
        ? req.body.motivo
        : motivoDeInvitacion(empleado.estado_alta);
    const nota = String(req.body?.nota ?? "").trim().slice(0, 160) || null;
    const estadoNuevo = estadoTrasInvitar(motivo);
    const estadoPrevio = String(empleado.estado_alta ?? "pendiente");

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
        `INSERT INTO sea_employee_invites (employee_id, token_hash, telefono, canal, estado, caduca_at, enviado_por, motivo)
         VALUES ($1, $2, $3, 'sms', 'enviado', $4, $5, $6)
         RETURNING id`,
        [employeeId, hashToken(token), movil, caduca.toISOString(), req.authCtx!.userId, motivo]
      );
      invitacionId = creada[0].id;
      await cliente.query(
        `UPDATE sea_employees SET estado_alta = $3, telefono = COALESCE(telefono, $2) WHERE id = $1`,
        [employeeId, movil, estadoNuevo]
      );
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const comun = {
      empresa: String(empleado.empresa ?? "Mobilink"),
      nombre: String(empleado.nombre ?? "").split(" ")[0],
      url: urlDeAlta(baseUrlPublica(), token),
    };
    const cuerpo =
      motivo === "actualizacion" ? textoSmsActualizacion({ ...comun, nota }) : textoSms(comun);

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
      await db.query(`UPDATE sea_employees SET estado_alta = $2 WHERE id = $1`, [employeeId, estadoPrevio]);
      return res.status(502).json({ error: `No se ha podido mandar el SMS: ${motivo}` });
    }

    await registrarAuditoria({
      empresaId: req.authCtx!.empresaId,
      userId: req.authCtx!.userId,
      accion: "core.alta.invitar",
      entidad: "sea_employees",
      entidadId: employeeId,
      detalle: { canal: "sms", motivo, caduca: caduca.toISOString() },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, estado: estadoNuevo, motivo, caducaAt: caduca.toISOString() });
  });

  /**
   * Todo lo que hace falta para revisar una ficha recién recibida.
   *
   * Las fotos salen con URL firmada de una hora y no públicas: el bucket es
   * privado justo para que el DNI de un trabajador no viva en una URL que
   * cualquiera pueda reenviar.
   */
  r.get("/:employeeId", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }

    const { rows: emp } = await db.query(
      `SELECT estado_alta FROM sea_employees WHERE id = $1`,
      [employeeId]
    );
    if (emp.length === 0) return res.status(404).json({ error: "Ese empleado no existe." });

    const { rows: inv } = await db.query(
      `SELECT id, estado, motivo, enviado_at, abierto_at, recibida_at, caduca_at,
              firmado_at, firma_path, verificacion, verificado_at, lectura, leido_at
         FROM sea_employee_invites
        WHERE employee_id = $1
        ORDER BY enviado_at DESC
        LIMIT 1`,
      [employeeId]
    );
    const { rows: consentimientos } = await db.query(
      `SELECT tipo, aceptado, fecha FROM sea_consents
        WHERE employee_id = $1 ORDER BY fecha DESC LIMIT 6`,
      [employeeId]
    );

    const invitacion = inv[0] ?? null;
    res.json({
      estadoAlta: emp[0].estado_alta,
      invitacion: invitacion && {
        estado: invitacion.estado,
        motivo: invitacion.motivo,
        enviadoAt: invitacion.enviado_at,
        abiertoAt: invitacion.abierto_at,
        recibidaAt: invitacion.recibida_at,
        caducaAt: invitacion.caduca_at,
        firmadoAt: invitacion.firmado_at,
        verificadoAt: invitacion.verificado_at,
        leidoAt: invitacion.leido_at,
      },
      documentos: await documentosConUrl(employeeId),
      firma: invitacion?.firma_path ? await urlFirmada(invitacion.firma_path) : null,
      verificacion: invitacion?.verificacion ?? null,
      lectura: invitacion?.lectura ?? null,
      certificacionesPropuestas: certificacionesDeLectura(invitacion?.lectura ?? null),
      consentimientos,
      puedeVerificar: hayIA(),
    });
  });

  /**
   * Contrasta lo que tecleó el trabajador con sus fotos.
   *
   * Se lanza a mano desde la pantalla de revisión, y no al recibir la ficha,
   * por una razón práctica: si el modelo está caído o la clave caducada, el
   * trabajador no tiene por qué enterarse ni quedarse esperando. El encargado
   * sí, porque es quien va a decidir.
   */
  r.post("/:employeeId/verificar", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }
    if (!hayIA()) {
      return res.status(503).json({
        error: "La comprobación automática no está configurada en este servidor.",
      });
    }

    try {
      const verificacion = await verificarConIA(employeeId);
      await db.query(
        `UPDATE sea_employee_invites SET verificacion = $2, verificado_at = now()
          WHERE id = (SELECT id FROM sea_employee_invites WHERE employee_id = $1
                       ORDER BY enviado_at DESC LIMIT 1)`,
        [employeeId, JSON.stringify(verificacion)]
      );
      res.json({ ok: true, verificacion });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "error desconocido";
      res.status(502).json({ error: `No se ha podido comprobar: ${motivo}` });
    }
  });

  /**
   * Subir una foto desde la ficha, sin pasar por el trabajador.
   *
   * Hace falta porque la mitad de las veces el DNI llega al mostrador en la
   * mano: el trabajador se planta allí con el documento y no tiene sentido
   * mandarle un SMS para que se haga una foto a sí mismo delante de ti.
   */
  r.post("/:employeeId/documento", subidaFoto.single("foto"), async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    const tipo = String(req.body?.tipo ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }
    if (!esTipoDocumento(tipo)) return res.status(400).json({ error: "Ese documento no se pide." });

    const fichero = req.file;
    if (!fichero) return res.status(400).json({ error: "No ha llegado la foto." });
    if (!MIMES.has(fichero.mimetype)) {
      return res.status(400).json({ error: "La foto tiene que ser JPG, PNG o WEBP." });
    }

    const { rows } = await db.query(`SELECT 1 FROM sea_employees WHERE id = $1`, [employeeId]);
    if (rows.length === 0) return res.status(404).json({ error: "Ese empleado no existe." });

    const ruta = await guardarDocumento(employeeId, tipo, fichero);
    // Aquí sí se espera al recorte: el encargado está mirando la pantalla y
    // lo que quiere ver al soltar la foto es cómo ha quedado.
    await mejorarDocumento(employeeId, tipo, ruta).catch(() => false);

    await registrarAuditoria({
      empresaId: req.authCtx!.empresaId,
      userId: req.authCtx!.userId,
      accion: "core.alta.documento",
      entidad: "sea_employees",
      entidadId: employeeId,
      detalle: { tipo },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, tipo, documentos: await documentosConUrl(employeeId) });
  });

  /**
   * Leer lo que ponen los documentos.
   *
   * Distinto de `verificar`: aquello compara lo tecleado con la foto, esto
   * saca datos que no tiene nadie —las clases del carnet y la fecha de cada
   * una, que es la tabla del reverso—. Lo leído NO se escribe en la ficha:
   * se guarda, se enseña y lo pasa el que revisa.
   */
  r.post("/:employeeId/leer", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }
    if (!hayIA()) {
      return res.status(503).json({ error: "La lectura automática no está configurada." });
    }

    try {
      const lectura = await leerDocumentos(employeeId);
      await db.query(
        `UPDATE sea_employee_invites SET lectura = $2, leido_at = now()
          WHERE id = (SELECT id FROM sea_employee_invites WHERE employee_id = $1
                       ORDER BY enviado_at DESC LIMIT 1)`,
        [employeeId, JSON.stringify(lectura)]
      );
      res.json({ ok: true, lectura, certificaciones: certificacionesDeLectura(lectura) });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "error desconocido";
      res.status(502).json({ error: `No se ha podido leer: ${motivo}` });
    }
  });

  /**
   * Pasar lo leído a la ficha.
   *
   * El botón que separa «la IA informa» de «la IA decide». Escribe solo los
   * campos que se han leído —lo vacío no borra nada de lo que ya hubiera— y
   * anota una certificación por clase, cada una con su fecha.
   */
  r.post("/:employeeId/aplicar-lectura", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }

    const { rows } = await db.query(
      `SELECT lectura FROM sea_employee_invites
        WHERE employee_id = $1 AND lectura IS NOT NULL
        ORDER BY enviado_at DESC LIMIT 1`,
      [employeeId]
    );
    const lectura = rows[0]?.lectura as Lectura | undefined;
    if (!lectura) return res.status(409).json({ error: "Todavía no se ha leído la documentación." });

    const campos = fichaDeLectura(lectura);
    const nombres = Object.keys(campos);
    if (nombres.length > 0) {
      const sets = nombres.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await db.query(
        `UPDATE sea_employees SET ${sets}, updated_at = now() WHERE id = $1`,
        [employeeId, ...nombres.map((c) => campos[c])]
      );
    }

    const anotadas: string[] = [];
    for (const c of certificacionesDeLectura(lectura)) {
      const { rows: ya } = await db.query(
        `SELECT 1 FROM sea_employee_certifications
          WHERE employee_id = $1 AND nombre = $2 AND fecha_caducidad = $3`,
        [employeeId, c.nombre, c.caducidad]
      );
      if (ya.length > 0) continue;
      await db.query(
        `INSERT INTO sea_employee_certifications
           (employee_id, nombre, entidad_emisora, fecha_caducidad, numero_certificado)
         VALUES ($1, $2, 'DGT', $3, $4)`,
        [employeeId, c.nombre, c.caducidad, c.numero]
      );
      anotadas.push(`${c.nombre} (${c.caducidad})`);
    }

    await registrarAuditoria({
      empresaId: req.authCtx!.empresaId,
      userId: req.authCtx!.userId,
      accion: "core.alta.aplicarLectura",
      entidad: "sea_employees",
      entidadId: employeeId,
      detalle: { campos: nombres, certificaciones: anotadas },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, campos: nombres, certificaciones: anotadas });
  });

  /**
   * Volver a recortar una foto.
   *
   * Existe porque el recorte automático a veces sale torcido —una foto a
   * contraluz, el documento sobre una carpeta del mismo color— y el encargado
   * no tiene por qué pedirle otra foto al trabajador por eso: primero se
   * intenta otra vez, que el original sigue ahí entero.
   */
  r.post("/:employeeId/documento/:tipo/recortar", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    const tipo = String(req.params.tipo ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId) || !esTipoDocumento(tipo)) {
      return res.status(400).json({ error: "Ese documento no existe." });
    }
    if (!hayIA()) {
      return res.status(503).json({ error: "El recorte automático no está configurado." });
    }

    const { rows } = await db.query(
      `SELECT storage_path FROM sea_employee_documents WHERE employee_id = $1 AND tipo = $2`,
      [employeeId, tipo]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Esa foto no está subida." });

    try {
      const hecho = await mejorarDocumento(employeeId, tipo, rows[0].storage_path);
      res.json({ ok: true, recortado: hecho, documentos: await documentosConUrl(employeeId) });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "error desconocido";
      res.status(502).json({ error: `No se ha podido recortar: ${motivo}` });
    }
  });

  /**
   * Dar la ficha por buena.
   *
   * Solo desde `recibida`: aprobar una ficha que nadie ha mandado no
   * significa nada, y dejarlo pasar convertiría el botón en una forma de
   * cerrar altas vacías sin que quede claro quién lo hizo.
   */
  r.post("/:employeeId/aprobar", async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
      return res.status(400).json({ error: "Ese empleado no existe." });
    }

    const { rows } = await db.query(
      `SELECT estado_alta, carnet_numero, carnet_clases, carnet_caducidad,
              cap_numero, cap_caducidad
         FROM sea_employees WHERE id = $1`,
      [employeeId]
    );
    const empleado = rows[0];
    if (!empleado) return res.status(404).json({ error: "Ese empleado no existe." });
    if (empleado.estado_alta !== "recibida") {
      return res.status(409).json({
        error: "Esta ficha no está pendiente de revisar.",
        code: "NO_PENDIENTE",
      });
    }

    await db.query(`UPDATE sea_employees SET estado_alta = 'completa' WHERE id = $1`, [employeeId]);
    const certificaciones = await anotarCaducidades(employeeId, empleado);

    await registrarAuditoria({
      empresaId: req.authCtx!.empresaId,
      userId: req.authCtx!.userId,
      accion: "core.alta.aprobar",
      entidad: "sea_employees",
      entidadId: employeeId,
      detalle: { certificaciones },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, estado: "completa", certificaciones });
  });

  return r;
}

// ── Lo que necesita la pantalla de revisión ────────────────────────────────

/** Una hora: lo que dura mirar una ficha, no lo que dura un enlace reenviado. */
const CADUCIDAD_URL_S = 3600;

async function urlFirmada(ruta: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD_URL_S);
  return error ? null : data.signedUrl;
}

type DocumentoRevision = {
  tipo: string;
  /** La que se enseña: la limpia si salió, y si no la original. */
  url: string | null;
  /** La foto tal cual la mandó, siempre. */
  urlOriginal: string | null;
  recortada: boolean;
  recorteNota: string | null;
  subidoAt: string;
  bytes: number | null;
};

async function documentosConUrl(employeeId: string): Promise<DocumentoRevision[]> {
  const { rows } = await db.query(
    `SELECT tipo, storage_path, recorte_path, recorte_meta, subido_at, bytes
       FROM sea_employee_documents
      WHERE employee_id = $1 ORDER BY tipo`,
    [employeeId]
  );
  return Promise.all(
    rows.map(async (d: {
      tipo: string; storage_path: string; recorte_path: string | null;
      recorte_meta: { nota?: string } | null; subido_at: string; bytes: number | null;
    }) => {
      const original = await urlFirmada(d.storage_path);
      const recorte = d.recorte_path ? await urlFirmada(d.recorte_path) : null;
      return {
        tipo: d.tipo,
        url: recorte ?? original,
        urlOriginal: original,
        recortada: Boolean(recorte),
        recorteNota: d.recorte_meta?.nota ?? null,
        subidoAt: d.subido_at,
        bytes: d.bytes,
      };
    })
  );
}

// ── Recortar y mejorar la foto ─────────────────────────────────────────────

/**
 * De la foto de un móvil a algo que parece un documento escaneado.
 *
 * El modelo NO recorta: devuelve coordenadas. El recorte, el enderezado y la
 * mejora los hace `sharp` aquí, que es instantáneo y no cuesta nada. Y la
 * original no se toca: si el recorte sale mal, sigue estando entera.
 */
async function mejorarDocumento(
  employeeId: string,
  tipo: string,
  rutaOriginal: string
): Promise<boolean> {
  if (!hayIA()) return false;

  const { data, error } = await supabase.storage.from(BUCKET).download(rutaOriginal);
  if (error || !data) throw new Error("no se ha podido leer la foto");

  // Primero se normaliza la orientación EXIF: así las coordenadas que dé el
  // modelo valen sobre los mismos píxeles que luego se recortan.
  const derecha = await sharp(Buffer.from(await data.arrayBuffer())).rotate().toBuffer();
  const meta = await sharp(derecha).metadata();
  const ancho = meta.width ?? 0;
  const alto = meta.height ?? 0;
  if (!ancho || !alto) throw new Error("la foto no se ha podido medir");

  const paraModelo = await sharp(derecha)
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const r = await pedirIA<LecturaRecorte>({
    operacion: "core.alta.recortar",
    proposito: "documento",
    prompt: INSTRUCCIONES_RECORTE,
    imagenes: [{ url: `data:image/jpeg;base64,${paraModelo.toString("base64")}` }],
    esquema: {
      nombre: "recuadro_documento",
      schema: ESQUEMA_RECORTE as unknown as Record<string, unknown>,
    },
    maxTokens: 500,
    timeoutMs: 60_000,
  });

  const lectura = r.datos;
  const caja = r.ok && lectura?.encontrado ? recorteEnPixeles(lectura.recuadro, ancho, alto) : null;

  if (!caja) {
    // Se anota por qué no, y se deja la original: la ficha la enseña igual.
    await db.query(
      `UPDATE sea_employee_documents
          SET recorte_path = NULL, recorte_at = now(), recorte_meta = $3
        WHERE employee_id = $1 AND tipo = $2`,
      [
        employeeId,
        tipo,
        JSON.stringify({
          nota: lectura?.nota ?? r.error?.slice(0, 200) ?? "no se ha encontrado el documento",
          encontrado: false,
        }),
      ]
    );
    return false;
  }

  /*
   * A partir de aquí nada puede tumbar la petición.
   *
   * `sharp` se queja de un recorte imposible con un error técnico —el famoso
   * «bad extract area»— y lo que vio el encargado la primera vez fue esa
   * frase en rojo encima de la ficha. La foto original está entera: si el
   * recorte no sale, se dice y se sigue con ella.
   */
  let limpia: Buffer;
  const rutaRecorte = `empleados/${employeeId}/recorte-${tipo}.jpg`;
  try {
    limpia = await sharp(derecha)
      .extract(caja)
      .rotate(lectura!.giro)
      // `normalise` estira el histograma: el gris de una foto con sombra pasa a
      // blanco y negro de verdad, que es lo que hace legible un DNI a contraluz.
      .normalise()
      .sharpen()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();

    const subida = await supabase.storage
      .from(BUCKET)
      .upload(rutaRecorte, limpia, { contentType: "image/jpeg", upsert: true });
    if (subida.error) throw new Error(subida.error.message);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error desconocido";
    console.error("[Core alta] recorte fallido:", motivo);
    await db.query(
      `UPDATE sea_employee_documents
          SET recorte_path = NULL, recorte_at = now(), recorte_meta = $3
        WHERE employee_id = $1 AND tipo = $2`,
      [employeeId, tipo, JSON.stringify({ encontrado: false, nota: `No se ha podido recortar: ${motivo}` })]
    );
    return false;
  }

  await db.query(
    `UPDATE sea_employee_documents
        SET recorte_path = $3, recorte_at = now(), recorte_meta = $4
      WHERE employee_id = $1 AND tipo = $2`,
    [
      employeeId,
      tipo,
      rutaRecorte,
      JSON.stringify({
        encontrado: true,
        recuadro: lectura!.recuadro,
        giro: lectura!.giro,
        nota: lectura!.nota,
        bytes: limpia.length,
        modelo: r.modelo,
      }),
    ]
  );
  return true;
}

/**
 * El carnet y el CAP, anotados como certificaciones con su caducidad.
 *
 * Así dejan de ser dos fechas sueltas en la ficha y pasan a la pestaña de
 * Certificaciones, que es donde ya se mira qué caduca y cuándo. No se
 * duplica: si ya hay una igual con la misma fecha, se deja la que está.
 */
async function anotarCaducidades(
  employeeId: string,
  e: {
    carnet_numero: string | null;
    carnet_clases: string | null;
    carnet_caducidad: string | null;
    cap_numero: string | null;
    cap_caducidad: string | null;
  }
): Promise<string[]> {
  const candidatas = [
    e.carnet_caducidad && {
      nombre: `Carnet de conducir${e.carnet_clases ? ` (${e.carnet_clases})` : ""}`,
      numero: e.carnet_numero,
      caducidad: e.carnet_caducidad,
    },
    e.cap_caducidad && { nombre: "CAP", numero: e.cap_numero, caducidad: e.cap_caducidad },
  ].filter(Boolean) as Array<{ nombre: string; numero: string | null; caducidad: string }>;

  const anotadas: string[] = [];
  for (const c of candidatas) {
    const { rows } = await db.query(
      `SELECT 1 FROM sea_employee_certifications
        WHERE employee_id = $1 AND nombre = $2 AND fecha_caducidad = $3`,
      [employeeId, c.nombre, c.caducidad]
    );
    if (rows.length > 0) continue;
    await db.query(
      `INSERT INTO sea_employee_certifications
         (employee_id, nombre, entidad_emisora, fecha_caducidad, numero_certificado)
       VALUES ($1, $2, 'DGT', $3, $4)`,
      [employeeId, c.nombre, c.caducidad, c.numero]
    );
    anotadas.push(c.nombre);
  }
  return anotadas;
}

/** Guarda la foto en el bucket y la anota en la ficha. Devuelve su ruta. */
async function guardarDocumento(
  employeeId: string,
  tipo: string,
  fichero: { buffer: Buffer; mimetype: string; size: number }
): Promise<string> {
  const extension =
    fichero.mimetype === "image/png" ? "png" : fichero.mimetype === "image/webp" ? "webp" : "jpg";
  const ruta = await guardarEnStorage(employeeId, `${tipo}.${extension}`, fichero.buffer, fichero.mimetype);

  await db.query(
    `INSERT INTO sea_employee_documents (employee_id, tipo, storage_path, mime, bytes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, tipo) DO UPDATE
       SET storage_path = EXCLUDED.storage_path, mime = EXCLUDED.mime,
           bytes = EXCLUDED.bytes, subido_at = now(),
           recorte_path = NULL, recorte_at = NULL, recorte_meta = NULL`,
    [employeeId, tipo, ruta, fichero.mimetype, fichero.size]
  );
  return ruta;
}

// ── La comprobación con IA ─────────────────────────────────────────────────

/**
 * Una foto de móvil de 2,5 MB no se le manda tal cual al modelo.
 *
 * A 1400 px de ancho se lee perfectamente un DNI —las letras del documento
 * ocupan una fracción del encuadre— y el fichero baja a unos cientos de kB.
 * Lo que se ahorra no es dinero: es el minuto largo que tardaría en subir
 * cuatro fotos enteras mientras el encargado mira una pantalla parada.
 */
async function imagenParaIA(ruta: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta);
  if (error || !data) return null;
  const original = Buffer.from(await data.arrayBuffer());
  const reducida = await sharp(original)
    .rotate()
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${reducida.toString("base64")}`;
}

async function verificarConIA(employeeId: string): Promise<Verificacion> {
  const { rows: emp } = await db.query(
    `SELECT nombre, apellidos, dni_nie, fecha_nacimiento, carnet_numero,
            carnet_caducidad, carnet_clases
       FROM sea_employees WHERE id = $1`,
    [employeeId]
  );
  if (emp.length === 0) throw new Error("el empleado no existe");

  const { rows: docs } = await db.query(
    `SELECT tipo, storage_path FROM sea_employee_documents WHERE employee_id = $1 ORDER BY tipo`,
    [employeeId]
  );
  if (docs.length === 0) throw new Error("no hay ninguna foto que mirar");

  const imagenes: Array<{ url: string }> = [];
  const presentes: string[] = [];
  for (const d of docs as Array<{ tipo: string; storage_path: string }>) {
    const uri = await imagenParaIA(d.storage_path);
    if (!uri) continue;
    imagenes.push({ url: uri });
    presentes.push(d.tipo);
  }
  if (imagenes.length === 0) throw new Error("no se ha podido leer ninguna foto");

  const tecleado = CAMPOS_VERIFICABLES.map(
    (c) => `- ${c.campo} (${c.etiqueta}): ${formatearValor(emp[0][c.campo])}`
  ).join("\n");

  const r = await pedirIA<Verificacion>({
    operacion: "core.alta.verificar",
    proposito: "documento",
    prompt:
      `${INSTRUCCIONES_VERIFICACION}\n\n` +
      `Fotos adjuntas, en este orden: ${presentes.join(", ")}.\n\n` +
      `Lo que ha tecleado el trabajador:\n${tecleado}`,
    imagenes,
    esquema: {
      nombre: "verificacion_documentacion",
      schema: ESQUEMA_VERIFICACION as unknown as Record<string, unknown>,
    },
    maxTokens: 2000,
    timeoutMs: 90_000,
  });

  if (!r.ok || !r.datos) throw new Error(r.error?.slice(0, 200) ?? "el modelo no ha contestado");
  return r.datos;
}

function formatearValor(v: unknown): string {
  if (v == null || v === "") return "(vacío)";
  if (v instanceof Date) return v.toISOString().slice(0, 10).split("-").reverse().join("/");
  return String(v);
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

    const ruta = await guardarDocumento(invitacion!.employee_id, tipo, fichero);

    res.json({ ok: true, tipo, documentos: await documentosDe(invitacion!.employee_id) });

    /*
     * Y ya sin que nadie espere: la copia recortada y enderezada.
     *
     * Va después de contestar a propósito. Son unos segundos de modelo y el
     * operario está en la calle con su móvil: si la respuesta dependiera de
     * esto, cada foto parecería colgada y acabaría dándole dos veces.
     */
    void mejorarDocumento(invitacion!.employee_id, tipo, ruta).catch((e) => {
      console.error("[Core alta] no se ha podido recortar la foto:", e);
    });
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


/**
 * Lee el DNI y el carnet de las fotos que haya.
 *
 * Se le dan las versiones RECORTADAS cuando existen: el documento llena el
 * encuadre y la tabla de clases del reverso se lee mucho mejor que en una
 * foto donde ocupa un tercio de la imagen.
 */
async function leerDocumentos(employeeId: string): Promise<Lectura> {
  const { rows: docs } = await db.query(
    `SELECT tipo, storage_path, recorte_path FROM sea_employee_documents
      WHERE employee_id = $1 ORDER BY tipo`,
    [employeeId]
  );
  if (docs.length === 0) throw new Error("no hay ninguna foto que leer");

  const imagenes: Array<{ url: string }> = [];
  const presentes: string[] = [];
  for (const d of docs as Array<{ tipo: string; storage_path: string; recorte_path: string | null }>) {
    const uri = await imagenParaIA(d.recorte_path ?? d.storage_path);
    if (!uri) continue;
    imagenes.push({ url: uri });
    presentes.push(d.tipo);
  }
  if (imagenes.length === 0) throw new Error("no se ha podido leer ninguna foto");

  const r = await pedirIA<Lectura>({
    operacion: "core.alta.leer",
    proposito: "documento",
    prompt: `${INSTRUCCIONES_LECTURA}\n\nFotos adjuntas, en este orden: ${presentes.join(", ")}.`,
    imagenes,
    esquema: {
      nombre: "lectura_documentacion",
      schema: ESQUEMA_LECTURA as unknown as Record<string, unknown>,
    },
    maxTokens: 2000,
    timeoutMs: 90_000,
  });

  if (!r.ok || !r.datos) throw new Error(r.error?.slice(0, 200) ?? "el modelo no ha contestado");
  return r.datos;
}
