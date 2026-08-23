/**
 * Acceso a datos del módulo Tacógrafos.
 *
 * Todas las consultas llevan `empresa_id` en el WHERE, sin excepción: es una
 * base multiempresa y un expediente lleva el NIF de una persona física.
 */

import pool from "../db.ts";
import { normalizarMatricula, type DatosExpediente, type Modalidad } from "./domain.ts";
import { VERSION_SEMILLA, type Plantillas } from "./templates.ts";

export class ErrorTacografos extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ErrorTacografos";
  }
}

export type Centro = {
  nombre: string;
  centroTecnico: string;
  numCentro: string;
  direccion1: string;
  direccion2: string;
  ciudad: string;
  ciudadFirma: string;
  email: string;
  destinatarioAdmin: string;
  responsableTecnico: string;
  urlTramite: string;
  urlTramiteOvt: string;
};

const CENTRO_POR_DEFECTO: Centro = {
  nombre: "",
  centroTecnico: "Centro técnico de Tacógrafos",
  numCentro: "",
  direccion1: "",
  direccion2: "",
  ciudad: "",
  ciudadFirma: "",
  email: "",
  destinatarioAdmin: "Direcció General de Transports i Mobilitat",
  responsableTecnico: "",
  urlTramite: "https://web.gencat.cat/ca/tramits/tramits-temes/Peticio-generica",
  urlTramiteOvt: "",
};

export type Expediente = DatosExpediente & {
  id: string;
  estado: string;
  destruccionFecha: string | null;
  destruccionMetodo: string;
  destruccionPersona: string;
  destruccionHash: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type FilaExpediente = {
  id: string;
  num_informe: string;
  tipo: string;
  estado: string;
  empresa_cliente: string;
  autoriza_nombre: string;
  autoriza_nif: string;
  doc_titularidad: boolean;
  matricula: string;
  bastidor: string;
  tac_marca: string;
  tac_modelo: string;
  tac_serie: string;
  fecha_informe: Date | null;
  fecha_entrega: Date | null;
  fecha_transferencia: Date | null;
  fecha_envio: Date | null;
  tecnico: string;
  modalidad_entrega: string | null;
  receptor_nombre: string;
  receptor_dni: string;
  entrega_aparato: boolean;
  destruccion_fecha: Date | null;
  destruccion_metodo: string;
  destruccion_persona: string;
  destruccion_hash: string;
  intervencion_id: string | null;
  created_at_ms: string;
  updated_at_ms: string;
};

/**
 * `DATE` de PostgreSQL a `aaaa-mm-dd`.
 *
 * Con los componentes locales, NO con `toISOString()`. `pg` construye la fecha
 * de una columna DATE a medianoche **local**, así que en Madrid (UTC+1) un
 * `2025-03-10` es `2025-03-09T23:00:00Z` y `toISOString()` lo devolvía como
 * día 9: el certificado habría salido fechado un día antes en toda España.
 * Lo destapó la prueba de integración ejecutada con TZ=Europe/Madrid.
 */
function aIso(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
}

function aExpediente(f: FilaExpediente): Expediente {
  return {
    id: f.id,
    numInforme: f.num_informe,
    tipo: f.tipo as Expediente["tipo"],
    estado: f.estado,
    empresaCliente: f.empresa_cliente,
    autorizaNombre: f.autoriza_nombre,
    autorizaNif: f.autoriza_nif,
    docTitularidad: f.doc_titularidad,
    matricula: f.matricula,
    bastidor: f.bastidor,
    tacMarca: f.tac_marca,
    tacModelo: f.tac_modelo,
    tacSerie: f.tac_serie,
    fechaInforme: aIso(f.fecha_informe),
    fechaEntrega: aIso(f.fecha_entrega),
    fechaTransferencia: aIso(f.fecha_transferencia),
    fechaEnvio: aIso(f.fecha_envio),
    tecnico: f.tecnico,
    modalidadEntrega: (f.modalidad_entrega as Modalidad | null) ?? null,
    receptorNombre: f.receptor_nombre,
    receptorDni: f.receptor_dni,
    entregaAparato: f.entrega_aparato,
    destruccionFecha: aIso(f.destruccion_fecha),
    destruccionMetodo: f.destruccion_metodo,
    destruccionPersona: f.destruccion_persona,
    destruccionHash: f.destruccion_hash,
    intervencionId: f.intervencion_id,
    createdAtMs: Number(f.created_at_ms),
    updatedAtMs: Number(f.updated_at_ms),
  };
}

const COLUMNAS = `
  id, num_informe, tipo, estado, empresa_cliente, autoriza_nombre, autoriza_nif,
  doc_titularidad, matricula, bastidor, tac_marca, tac_modelo, tac_serie,
  fecha_informe, fecha_entrega, fecha_transferencia, fecha_envio, tecnico,
  modalidad_entrega, receptor_nombre, receptor_dni, entrega_aparato,
  destruccion_fecha, destruccion_metodo, destruccion_persona, destruccion_hash,
  intervencion_id, created_at_ms, updated_at_ms
`;

// ── Centro ──────────────────────────────────────────────────────────────────

export async function obtenerCentro(empresaId: string): Promise<Centro> {
  const { rows } = await pool.query(
    `SELECT nombre, centro_tecnico, num_centro, direccion1, direccion2, ciudad,
            ciudad_firma, email, destinatario_admin, responsable_tecnico,
            url_tramite, url_tramite_ovt
       FROM tac_centros WHERE empresa_id = $1`,
    [empresaId]
  );
  const f = rows[0];
  if (!f) return { ...CENTRO_POR_DEFECTO };
  return {
    nombre: f.nombre,
    centroTecnico: f.centro_tecnico,
    numCentro: f.num_centro,
    direccion1: f.direccion1,
    direccion2: f.direccion2,
    ciudad: f.ciudad,
    ciudadFirma: f.ciudad_firma,
    email: f.email,
    destinatarioAdmin: f.destinatario_admin,
    responsableTecnico: f.responsable_tecnico,
    urlTramite: f.url_tramite,
    urlTramiteOvt: f.url_tramite_ovt,
  };
}

export async function guardarCentro(empresaId: string, c: Centro): Promise<Centro> {
  const ahora = Date.now();
  await pool.query(
    `INSERT INTO tac_centros (
       empresa_id, nombre, centro_tecnico, num_centro, direccion1, direccion2,
       ciudad, ciudad_firma, email, destinatario_admin, responsable_tecnico,
       url_tramite, url_tramite_ovt, created_at_ms, updated_at_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     ON CONFLICT (empresa_id) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       centro_tecnico = EXCLUDED.centro_tecnico,
       num_centro = EXCLUDED.num_centro,
       direccion1 = EXCLUDED.direccion1,
       direccion2 = EXCLUDED.direccion2,
       ciudad = EXCLUDED.ciudad,
       ciudad_firma = EXCLUDED.ciudad_firma,
       email = EXCLUDED.email,
       destinatario_admin = EXCLUDED.destinatario_admin,
       responsable_tecnico = EXCLUDED.responsable_tecnico,
       url_tramite = EXCLUDED.url_tramite,
       url_tramite_ovt = EXCLUDED.url_tramite_ovt,
       updated_at_ms = EXCLUDED.updated_at_ms`,
    [
      empresaId, c.nombre, c.centroTecnico, c.numCentro, c.direccion1, c.direccion2,
      c.ciudad, c.ciudadFirma, c.email, c.destinatarioAdmin, c.responsableTecnico,
      c.urlTramite, c.urlTramiteOvt, ahora,
    ]
  );
  return obtenerCentro(empresaId);
}

// ── Expedientes ─────────────────────────────────────────────────────────────

export type FiltroExpedientes = {
  texto?: string;
  tipo?: string;
  estado?: string;
  limite?: number;
};

export async function listarExpedientes(
  empresaId: string,
  filtro: FiltroExpedientes = {}
): Promise<Expediente[]> {
  const cond: string[] = ["empresa_id = $1"];
  const args: unknown[] = [empresaId];

  if (filtro.texto?.trim()) {
    args.push(`%${filtro.texto.trim().toLowerCase()}%`);
    cond.push(
      `(LOWER(num_informe) LIKE $${args.length} OR LOWER(matricula) LIKE $${args.length}
        OR LOWER(empresa_cliente) LIKE $${args.length} OR LOWER(tac_serie) LIKE $${args.length})`
    );
  }
  if (filtro.tipo) {
    args.push(filtro.tipo);
    cond.push(`tipo = $${args.length}`);
  }
  if (filtro.estado) {
    args.push(filtro.estado);
    cond.push(`estado = $${args.length}`);
  }
  // El tope se acota aquí y no sólo en la pantalla: una lista sin límite contra
  // una base con años de expedientes tumba la petición.
  const limite = Math.min(Math.max(filtro.limite ?? 100, 1), 500);
  args.push(limite);

  const { rows } = await pool.query<FilaExpediente>(
    `SELECT ${COLUMNAS} FROM tac_expedientes
      WHERE ${cond.join(" AND ")}
      ORDER BY fecha_informe DESC NULLS LAST, created_at_ms DESC
      LIMIT $${args.length}`,
    args
  );
  return rows.map(aExpediente);
}

export async function obtenerExpediente(
  empresaId: string,
  id: string
): Promise<Expediente | null> {
  const { rows } = await pool.query<FilaExpediente>(
    `SELECT ${COLUMNAS} FROM tac_expedientes WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

function valores(d: DatosExpediente): unknown[] {
  return [
    d.numInforme.trim(),
    d.tipo,
    d.empresaCliente.trim(),
    d.autorizaNombre.trim(),
    d.autorizaNif.trim(),
    d.docTitularidad,
    normalizarMatricula(d.matricula),
    d.bastidor.trim(),
    d.tacMarca.trim(),
    d.tacModelo.trim(),
    d.tacSerie.trim(),
    d.fechaInforme,
    d.fechaEntrega,
    d.fechaTransferencia,
    d.fechaEnvio,
    d.tecnico.trim(),
    d.modalidadEntrega,
    d.receptorNombre.trim(),
    d.receptorDni.trim(),
    d.entregaAparato,
    d.intervencionId,
  ];
}

/** Traduce el choque de `UNIQUE (empresa_id, num_informe)` a un error con código. */
function traducir(e: unknown): never {
  if (typeof e === "object" && e && (e as { code?: string }).code === "23505") {
    throw new ErrorTacografos(
      "Ya existe un expediente con ese nº de informe.",
      "NUM_INFORME_DUPLICADO",
      409
    );
  }
  throw e;
}

export async function crearExpediente(
  empresaId: string,
  userId: string,
  d: DatosExpediente
): Promise<Expediente> {
  const ahora = Date.now();
  try {
    const { rows } = await pool.query<FilaExpediente>(
      `INSERT INTO tac_expedientes (
         empresa_id, num_informe, tipo, empresa_cliente, autoriza_nombre, autoriza_nif,
         doc_titularidad, matricula, bastidor, tac_marca, tac_modelo, tac_serie,
         fecha_informe, fecha_entrega, fecha_transferencia, fecha_envio, tecnico,
         modalidad_entrega, receptor_nombre, receptor_dni, entrega_aparato,
         intervencion_id, created_at_ms, updated_at_ms, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23,$24)
       RETURNING ${COLUMNAS}`,
      [empresaId, ...valores(d), ahora, userId]
    );
    return aExpediente(rows[0]);
  } catch (e) {
    traducir(e);
  }
}

export async function actualizarExpediente(
  empresaId: string,
  id: string,
  d: DatosExpediente
): Promise<Expediente> {
  try {
    const { rows } = await pool.query<FilaExpediente>(
      `UPDATE tac_expedientes SET
         num_informe = $3, tipo = $4, empresa_cliente = $5, autoriza_nombre = $6,
         autoriza_nif = $7, doc_titularidad = $8, matricula = $9, bastidor = $10,
         tac_marca = $11, tac_modelo = $12, tac_serie = $13, fecha_informe = $14,
         fecha_entrega = $15, fecha_transferencia = $16, fecha_envio = $17,
         tecnico = $18, modalidad_entrega = $19, receptor_nombre = $20,
         receptor_dni = $21, entrega_aparato = $22, intervencion_id = $23,
         updated_at_ms = $24
       WHERE empresa_id = $1 AND id = $2 AND estado <> 'anulado'
       RETURNING ${COLUMNAS}`,
      [empresaId, id, ...valores(d), Date.now()]
    );
    if (!rows[0]) {
      throw new ErrorTacografos(
        "El expediente no existe o está anulado.",
        "EXPEDIENTE_NO_EDITABLE",
        404
      );
    }
    return aExpediente(rows[0]);
  } catch (e) {
    traducir(e);
  }
}

export async function anularExpediente(
  empresaId: string,
  id: string
): Promise<Expediente> {
  const { rows } = await pool.query<FilaExpediente>(
    `UPDATE tac_expedientes SET estado = 'anulado', updated_at_ms = $3
      WHERE empresa_id = $1 AND id = $2
      RETURNING ${COLUMNAS}`,
    [empresaId, id, Date.now()]
  );
  if (!rows[0]) {
    throw new ErrorTacografos("El expediente no existe.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  return aExpediente(rows[0]);
}

// ── Documentos emitidos ─────────────────────────────────────────────────────

export type Documento = {
  id: string;
  expedienteId: string;
  tipo: string;
  plantillaVersion: number;
  ruta: string;
  hash: string;
  tamanoBytes: number;
  anulado: boolean;
  motivoAnulacion: string;
  emitidoAtMs: number;
};

type FilaDocumento = {
  id: string;
  expediente_id: string;
  tipo: string;
  plantilla_version: number;
  ruta: string;
  hash: string;
  tamano_bytes: number;
  anulado: boolean;
  motivo_anulacion: string;
  emitido_at_ms: string;
};

const COLUMNAS_DOC = `
  id, expediente_id, tipo, plantilla_version, ruta, hash, tamano_bytes,
  anulado, motivo_anulacion, emitido_at_ms
`;

function aDocumento(f: FilaDocumento): Documento {
  return {
    id: f.id,
    expedienteId: f.expediente_id,
    tipo: f.tipo,
    plantillaVersion: f.plantilla_version,
    ruta: f.ruta,
    hash: f.hash,
    tamanoBytes: f.tamano_bytes,
    anulado: f.anulado,
    motivoAnulacion: f.motivo_anulacion,
    emitidoAtMs: Number(f.emitido_at_ms),
  };
}

export async function listarDocumentos(
  empresaId: string,
  expedienteId: string
): Promise<Documento[]> {
  const { rows } = await pool.query<FilaDocumento>(
    `SELECT ${COLUMNAS_DOC} FROM tac_documentos
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY emitido_at_ms DESC`,
    [empresaId, expedienteId]
  );
  return rows.map(aDocumento);
}

export async function obtenerDocumento(
  empresaId: string,
  id: string
): Promise<Documento | null> {
  const { rows } = await pool.query<FilaDocumento>(
    `SELECT ${COLUMNAS_DOC} FROM tac_documentos WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aDocumento(rows[0]) : null;
}

export async function crearDocumento(
  empresaId: string,
  userId: string,
  d: {
    expedienteId: string;
    tipo: string;
    plantillaVersion: number;
    ruta: string;
    hash: string;
    tamanoBytes: number;
    emitidoAtMs: number;
  }
): Promise<Documento> {
  try {
    const { rows } = await pool.query<FilaDocumento>(
      `INSERT INTO tac_documentos (
         empresa_id, expediente_id, tipo, plantilla_version, ruta, hash,
         tamano_bytes, emitido_at_ms, emitido_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${COLUMNAS_DOC}`,
      [
        empresaId, d.expedienteId, d.tipo, d.plantillaVersion, d.ruta, d.hash,
        d.tamanoBytes, d.emitidoAtMs, userId,
      ]
    );
    return aDocumento(rows[0]);
  } catch (e) {
    // El índice único parcial `tac_doc_vigente_idx` impide dos documentos
    // vigentes del mismo tipo. Se traduce a un mensaje que dice qué hacer.
    if (typeof e === "object" && e && (e as { code?: string }).code === "23505") {
      throw new ErrorTacografos(
        "Ya hay un documento vigente de ese tipo. Anúlalo antes de emitir otro.",
        "DOCUMENTO_YA_VIGENTE",
        409
      );
    }
    throw e;
  }
}

export async function anularDocumento(
  empresaId: string,
  id: string,
  motivo: string
): Promise<Documento> {
  const { rows } = await pool.query<FilaDocumento>(
    `UPDATE tac_documentos SET anulado = true, motivo_anulacion = $3
      WHERE empresa_id = $1 AND id = $2 AND NOT anulado
      RETURNING ${COLUMNAS_DOC}`,
    [empresaId, id, motivo]
  );
  if (!rows[0]) {
    throw new ErrorTacografos(
      "El documento no existe o ya estaba anulado.",
      "DOCUMENTO_NO_ANULABLE",
      404
    );
  }
  return aDocumento(rows[0]);
}

// ── Plantillas de los textos legales ────────────────────────────────────────

/**
 * Textos de una versión concreta. Se pide la versión y no "la última" a
 * propósito: reimprimir un documento emitido hace dos años tiene que dar el
 * mismo papel que se firmó entonces.
 */
export async function cargarPlantillas(version: number): Promise<Plantillas> {
  const { rows } = await pool.query<{ clave: string; texto: string }>(
    `SELECT clave, texto FROM tac_plantillas WHERE version = $1`,
    [version]
  );
  const out: Plantillas = {};
  for (const r of rows) out[r.clave] = r.texto;
  return out;
}

/** Versión más alta disponible: la que se usa al emitir un documento nuevo. */
export async function versionVigente(): Promise<number> {
  const { rows } = await pool.query<{ v: number }>(
    `SELECT MAX(version) AS v FROM tac_plantillas`
  );
  return Number(rows[0]?.v) || VERSION_SEMILLA;
}

// ── Firmas ──────────────────────────────────────────────────────────────────

export const PAPELES_FIRMA = ["autoriza", "receptor", "tecnico", "responsable"] as const;
export type PapelFirma = (typeof PAPELES_FIRMA)[number];

export type Firma = {
  id: string;
  expedienteId: string;
  papel: PapelFirma;
  ruta: string;
  nombre: string;
  firmadoAtMs: number;
};

type FilaFirma = {
  id: string;
  expediente_id: string;
  papel: string;
  ruta: string;
  nombre: string;
  firmado_at_ms: string;
};

function aFirma(f: FilaFirma): Firma {
  return {
    id: f.id,
    expedienteId: f.expediente_id,
    papel: f.papel as PapelFirma,
    ruta: f.ruta,
    nombre: f.nombre,
    firmadoAtMs: Number(f.firmado_at_ms),
  };
}

export async function listarFirmas(
  empresaId: string,
  expedienteId: string
): Promise<Firma[]> {
  const { rows } = await pool.query<FilaFirma>(
    `SELECT id, expediente_id, papel, ruta, nombre, firmado_at_ms
       FROM tac_firmas WHERE empresa_id = $1 AND expediente_id = $2`,
    [empresaId, expedienteId]
  );
  return rows.map(aFirma);
}

/**
 * Guarda la firma de un papel, reemplazando la anterior si la había.
 *
 * Reemplazar es correcto porque la firma sólo vale mientras el documento no se
 * ha emitido: una vez emitido, la rúbrica vive dentro del PDF y ya no depende
 * de esta tabla. La imagen antigua se queda en el almacenamiento a propósito,
 * por si estaba dentro de un documento ya emitido.
 */
export async function guardarFirma(
  empresaId: string,
  userId: string,
  d: { expedienteId: string; papel: PapelFirma; ruta: string; nombre: string; firmadoAtMs: number }
): Promise<Firma> {
  const { rows } = await pool.query<FilaFirma>(
    `INSERT INTO tac_firmas (
       empresa_id, expediente_id, papel, ruta, nombre, firmado_at_ms, firmado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (expediente_id, papel) DO UPDATE SET
       ruta = EXCLUDED.ruta,
       nombre = EXCLUDED.nombre,
       firmado_at_ms = EXCLUDED.firmado_at_ms,
       firmado_por = EXCLUDED.firmado_por
     RETURNING id, expediente_id, papel, ruta, nombre, firmado_at_ms`,
    [empresaId, d.expedienteId, d.papel, d.ruta, d.nombre, d.firmadoAtMs, userId]
  );
  return aFirma(rows[0]);
}

export async function borrarFirma(
  empresaId: string,
  expedienteId: string,
  papel: PapelFirma
): Promise<void> {
  await pool.query(
    `DELETE FROM tac_firmas WHERE empresa_id = $1 AND expediente_id = $2 AND papel = $3`,
    [empresaId, expedienteId, papel]
  );
}

// ── Estado del expediente ───────────────────────────────────────────────────

/**
 * Cambia el estado. Devuelve `null` si el expediente no está en uno de los
 * estados desde los que se permite la transición, para que el servicio pueda
 * explicar por qué en vez de dejarlo pasar en silencio.
 */
export async function cambiarEstado(
  empresaId: string,
  id: string,
  nuevo: string,
  desde: string[]
): Promise<Expediente | null> {
  const { rows } = await pool.query<FilaExpediente>(
    `UPDATE tac_expedientes SET estado = $3, updated_at_ms = $4
      WHERE empresa_id = $1 AND id = $2 AND estado = ANY($5)
      RETURNING ${COLUMNAS}`,
    [empresaId, id, nuevo, Date.now(), desde]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

/** Registro de la entrega al cliente: fecha y quién la recibió. */
export async function registrarEntrega(
  empresaId: string,
  id: string,
  d: { fechaEntrega: string; receptorNombre: string; receptorDni: string }
): Promise<Expediente | null> {
  const { rows } = await pool.query<FilaExpediente>(
    `UPDATE tac_expedientes SET
       fecha_entrega = $3, receptor_nombre = $4, receptor_dni = $5,
       estado = 'entregado', updated_at_ms = $6
      WHERE empresa_id = $1 AND id = $2 AND estado IN ('emitido','entregado')
      RETURNING ${COLUMNAS}`,
    [empresaId, id, d.fechaEntrega, d.receptorNombre, d.receptorDni, Date.now()]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

// ── Custodia de los archivos transferidos ───────────────────────────────────

/**
 * Expedientes cuyos archivos siguen bajo custodia del centro.
 *
 * Sólo los de transferencia: en una intransferibilidad no hay archivo que
 * guardar, que es justo de lo que da fe el certificado. Se ordenan por fecha de
 * transferencia ascendente, de modo que lo primero de la lista sea siempre lo
 * más urgente.
 */
export async function listarCustodia(empresaId: string): Promise<Expediente[]> {
  const { rows } = await pool.query<FilaExpediente>(
    `SELECT ${COLUMNAS} FROM tac_expedientes
      WHERE empresa_id = $1
        AND fecha_transferencia IS NOT NULL
        AND destruccion_fecha IS NULL
        AND estado <> 'anulado'
      ORDER BY fecha_transferencia ASC`,
    [empresaId]
  );
  return rows.map(aExpediente);
}

export async function registrarDestruccion(
  empresaId: string,
  id: string,
  d: { fecha: string; metodo: string; persona: string; hash: string }
): Promise<Expediente | null> {
  const { rows } = await pool.query<FilaExpediente>(
    `UPDATE tac_expedientes SET
       destruccion_fecha = $3, destruccion_metodo = $4,
       destruccion_persona = $5, destruccion_hash = $6, updated_at_ms = $7
      WHERE empresa_id = $1 AND id = $2
        AND fecha_transferencia IS NOT NULL
        AND destruccion_fecha IS NULL
        AND estado <> 'anulado'
      RETURNING ${COLUMNAS}`,
    [empresaId, id, d.fecha, d.metodo, d.persona, d.hash, Date.now()]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

// ── Comunicaciones a la administración ──────────────────────────────────────

export type Comunicacion = {
  id: string;
  expedienteId: string;
  fechaPresentacion: string | null;
  referencia: string;
  notas: string;
  registradoAtMs: number;
};

type FilaComunicacion = {
  id: string;
  expediente_id: string;
  fecha_presentacion: Date | string | null;
  referencia: string;
  notas: string;
  registrado_at_ms: string;
};

function aComunicacion(f: FilaComunicacion): Comunicacion {
  return {
    id: f.id,
    expedienteId: f.expediente_id,
    fechaPresentacion: aIso(f.fecha_presentacion),
    referencia: f.referencia,
    notas: f.notas,
    registradoAtMs: Number(f.registrado_at_ms),
  };
}

export async function listarComunicaciones(
  empresaId: string,
  expedienteId: string
): Promise<Comunicacion[]> {
  const { rows } = await pool.query<FilaComunicacion>(
    `SELECT id, expediente_id, fecha_presentacion, referencia, notas, registrado_at_ms
       FROM tac_comunicaciones
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY fecha_presentacion DESC, registrado_at_ms DESC`,
    [empresaId, expedienteId]
  );
  return rows.map(aComunicacion);
}

export async function registrarComunicacion(
  empresaId: string,
  userId: string,
  d: { expedienteId: string; fechaPresentacion: string; referencia: string; notas: string }
): Promise<Comunicacion> {
  const { rows } = await pool.query<FilaComunicacion>(
    `INSERT INTO tac_comunicaciones (
       empresa_id, expediente_id, fecha_presentacion, referencia, notas,
       registrado_at_ms, registrado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, expediente_id, fecha_presentacion, referencia, notas, registrado_at_ms`,
    [
      empresaId, d.expedienteId, d.fechaPresentacion, d.referencia, d.notas,
      Date.now(), userId,
    ]
  );
  return aComunicacion(rows[0]);
}

/**
 * Intransferibilidades presentadas a la administración y las que faltan.
 *
 * «Falta» es: expediente de intransferibilidad, no anulado, del que ya salió la
 * comunicación en papel y del que no hay ninguna presentación anotada. Antes de
 * emitir el documento no se puede presentar nada, así que no tendría sentido
 * reclamarlo.
 */
export async function listarPendientesComunicar(empresaId: string): Promise<Expediente[]> {
  const { rows } = await pool.query<FilaExpediente>(
    `SELECT ${COLUMNAS} FROM tac_expedientes e
      WHERE e.empresa_id = $1
        AND e.tipo = 'intransferibilidad'
        AND e.estado <> 'anulado'
        AND EXISTS (
          SELECT 1 FROM tac_documentos d
           WHERE d.expediente_id = e.id
             AND d.tipo = 'comunicacion_admin'
             AND NOT d.anulado
        )
        AND NOT EXISTS (
          SELECT 1 FROM tac_comunicaciones c WHERE c.expediente_id = e.id
        )
      ORDER BY e.fecha_informe ASC`,
    [empresaId]
  );
  return rows.map(aExpediente);
}
