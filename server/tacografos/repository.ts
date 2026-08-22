/**
 * Acceso a datos del módulo Tacógrafos.
 *
 * Todas las consultas llevan `empresa_id` en el WHERE, sin excepción: es una
 * base multiempresa y un expediente lleva el NIF de una persona física.
 */

import pool from "../db.ts";
import { normalizarMatricula, type DatosExpediente, type Modalidad } from "./domain.ts";

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

/** `DATE` de PostgreSQL a `aaaa-mm-dd`, sin pasar por la zona horaria local. */
function aIso(v: Date | null): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString().slice(0, 10);
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
