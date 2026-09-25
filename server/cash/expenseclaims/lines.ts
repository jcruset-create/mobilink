/**
 * Los tickets de una liquidación: subirlos, corregirlos, incluirlos o no.
 *
 * Todo esto solo se puede mientras la liquidación está en BORRADOR. Presentar
 * congela las líneas: lo que se aprueba tiene que ser lo que se presentó.
 *
 * ## La IA no es requisito
 *
 * Con lectura automática configurada, cada ticket nace PENDIENTE y
 * `analisis.ts` rellena los huecos; sin ella, nace OMITIDO y se rellena a
 * mano. Si la lectura falla, la línea se sigue rellenando a mano y se paga
 * igual. Lo que habilita el pago es que alguien la haya REVISADO, no que una
 * máquina la haya leído.
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import pool from "../../db.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { validarClasificacionGasto } from "../config.ts";
import { ErrorCaja } from "../errors.ts";
import { exigirDocumentoValido } from "../invoice-scan/service.ts";
import { enTransaccion } from "../repository.ts";
import type { Contexto } from "../service.ts";
import { guardarDocumento, rutaDeTicket, urlFirmada } from "../storage.ts";
import { lineasEditables } from "./domain.ts";
import { lecturaDisponible } from "./analisis.ts";
import {
  cargarEvidencia,
  detectarMismoFichero,
  reabrirPorInclusion,
  resolverPorExclusion,
} from "./duplicates.ts";
import { type LineaLiquidacion, type Liquidacion, cargarLiquidacion, lineasDe } from "./repository.ts";

/** Cuántos tickets por petición. El mismo tope que el router le pone a multer. */
export const MAXIMO_TICKETS_POR_SUBIDA = 20;

function exigirEditable(l: Liquidacion): void {
  if (!lineasEditables(l.estado)) {
    throw new ErrorCaja(
      "LINEA_NO_EDITABLE",
      `${l.numero} está ${l.estado.toLowerCase()}: sus tickets ya no se pueden cambiar.${
        l.estado === "RECHAZADA" ? " Reábrela para corregirla." : ""
      }`,
      409
    );
  }
}

const EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

async function lineaDe(client: PoolClient, claimId: number, lineId: number): Promise<LineaLiquidacion> {
  const l = (await lineasDe(client, claimId)).find((x) => x.id === lineId);
  if (!l) throw new ErrorCaja("LINEA_NO_ENCONTRADA", "Ese ticket no es de esta liquidación.", 404);
  return l;
}

// ── Subir ──────────────────────────────────────────────────────────────────

/**
 * Sube varios tickets a la vez.
 *
 * Se validan TODOS antes de guardar ninguno: si el tercero es un .docx, no se
 * quedan dos subidos y uno no, que obliga a adivinar cuáles faltan. Después se
 * guardan de uno en uno; si el almacenamiento cae a mitad, los anteriores ya
 * están y el error lo dice.
 *
 * Un fichero repetido NO se rechaza: se sube y se marca. A veces el mismo
 * papel respalda de verdad dos cosas, y quien decide eso es una persona, no un
 * hash.
 */
export async function subirTickets(
  ctx: Contexto,
  claimId: number,
  ficheros: { originalname: string; mimetype: string; buffer: Buffer }[]
): Promise<LineaLiquidacion[]> {
  if (ficheros.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ningún ticket.", 400);
  }
  if (ficheros.length > MAXIMO_TICKETS_POR_SUBIDA) {
    throw new ErrorCaja(
      "DEMASIADOS_FICHEROS",
      `Como mucho ${MAXIMO_TICKETS_POR_SUBIDA} tickets de una vez.`,
      400
    );
  }

  const l = await cargarLiquidacion(pool, ctx, claimId);
  exigirEditable(l);

  // Primero todos: el tipo REAL de cada uno, por su firma y no por su nombre.
  const preparados = ficheros.map((f) => {
    const mime = exigirDocumentoValido(f);
    return {
      nombre: f.originalname.slice(0, 200) || "ticket",
      mime,
      buffer: f.buffer,
      sha256: createHash("sha256").update(f.buffer).digest("hex"),
    };
  });

  const creadas: number[] = [];
  const ahora = Date.now();
  for (const [i, f] of preparados.entries()) {
    const ruta = rutaDeTicket(ctx.empresaId, claimId, i, EXTENSION[f.mime] ?? ".bin", ahora);
    /*
     * El fichero ANTES que la fila: si el almacenamiento falla, no queda una
     * línea apuntando a nada. Al revés, un fichero huérfano en el bucket no
     * rompe nada.
     */
    try {
      await guardarDocumento(ruta, f.buffer, f.mime);
    } catch (e) {
      if (e instanceof ErrorCaja && e.codigo === "SUBIDA_FALLIDA") {
        throw new ErrorCaja(
          "SUBIDA_FALLIDA",
          creadas.length > 0
            ? `Se han subido ${creadas.length} tickets; «${f.nombre}» y los siguientes no. Vuelve a subirlos.`
            : `No se ha podido guardar «${f.nombre}». Vuelve a intentarlo.`,
          502
        );
      }
      throw e;
    }

    const id = await enTransaccion(async (client) => {
      // Bloqueada: si otra pestaña la presenta mientras tanto, no entra un ticket más.
      const actual = await cargarLiquidacion(client, ctx, claimId, true);
      exigirEditable(actual);
      const { rows } = await client.query(
        `INSERT INTO cash_expense_claim_lines
           (empresa_id, claim_id, orden, nombre, mime, tamano_bytes, ruta, sha256,
            analisis, situacion, subido_por, subido_at_ms, updated_at_ms)
         VALUES ($1,$2,
                 (SELECT COALESCE(MAX(orden), 0) + 1 FROM cash_expense_claim_lines WHERE claim_id = $2),
                 $3,$4,$5,$6,$7,$10,'INCLUIDA',$8,$9,$9)
         RETURNING id`,
        [
          ctx.empresaId,
          claimId,
          f.nombre,
          f.mime,
          f.buffer.length,
          ruta,
          f.sha256,
          ctx.userId,
          Date.now(),
          // Sin clave de IA ni se intenta: se rellena a mano desde el principio.
          lecturaDisponible() ? "PENDIENTE" : "OMITIDO",
        ]
      );
      await detectarMismoFichero(
        client,
        ctx.empresaId,
        { id: rows[0].id, claimId, sha256: f.sha256 },
        "SUBIDA"
      );
      await client.query(
        `UPDATE cash_expense_claims SET updated_at_ms = $2 WHERE id = $1`,
        [claimId, Date.now()]
      );
      return rows[0].id as number;
    });
    creadas.push(id);

    await registrarAuditoria({
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.expense_claim.line.upload",
      entidad: "cash_expense_claim_lines",
      entidadId: String(id),
      detalle: { liquidacion: l.numero, nombre: f.nombre, tamanoBytes: f.buffer.length, sha256: f.sha256 },
      ip: ctx.ip,
    });
  }

  const todas = await lineasDe(pool, claimId, urlFirmada);
  return todas.filter((x) => creadas.includes(x.id));
}

// ── Corregir ───────────────────────────────────────────────────────────────

export type CambiosLinea = {
  fecha?: string | null;
  emisorNombre?: string;
  emisorNif?: string | null;
  numeroDocumento?: string | null;
  concepto?: string;
  baseCentimos?: number | null;
  ivaCentimos?: number | null;
  importeCentimos?: number;
  moneda?: string;
  expenseConceptId?: number | null;
  expenseTargetId?: number | null;
  revisada?: boolean;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v: string): boolean {
  if (!FECHA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function centimosOpcionales(v: unknown, campo: string): number | null {
  if (v == null) return null;
  if (!Number.isSafeInteger(v) || (v as number) < 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser un importe en céntimos, sin signo.`, 400);
  }
  return v as number;
}

/**
 * Corrige lo que se haya leído mal, o lo pone a mano.
 *
 * Solo cambia lo que llega: un campo ausente se queda como estaba, y un
 * `null` explícito lo vacía. Así la pantalla puede guardar campo a campo sin
 * mandar la línea entera cada vez.
 */
export async function editarLinea(
  ctx: Contexto,
  claimId: number,
  lineId: number,
  cambios: CambiosLinea
): Promise<LineaLiquidacion> {
  const sets: string[] = [];
  const valores: unknown[] = [];
  const poner = (columna: string, valor: unknown) => {
    valores.push(valor);
    sets.push(`${columna} = $${valores.length + 2}`);
  };

  if ("fecha" in cambios) {
    const f = cambios.fecha == null || cambios.fecha === "" ? null : String(cambios.fecha);
    if (f != null && !fechaValida(f)) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", "La fecha tiene que ser AAAA-MM-DD.", 400);
    }
    poner("fecha", f);
  }
  if ("emisorNombre" in cambios) poner("emisor_nombre", String(cambios.emisorNombre ?? "").trim().slice(0, 200));
  if ("emisorNif" in cambios) poner("emisor_nif", String(cambios.emisorNif ?? "").trim().slice(0, 30) || null);
  if ("numeroDocumento" in cambios) {
    poner("numero_documento", String(cambios.numeroDocumento ?? "").trim().slice(0, 60) || null);
  }
  if ("concepto" in cambios) poner("concepto", String(cambios.concepto ?? "").trim().slice(0, 300));
  if ("baseCentimos" in cambios) poner("base_centimos", centimosOpcionales(cambios.baseCentimos, "La base"));
  if ("ivaCentimos" in cambios) poner("iva_centimos", centimosOpcionales(cambios.ivaCentimos, "El IVA"));
  if ("importeCentimos" in cambios) {
    /*
     * Cero se admite al guardar —es «todavía no lo sé»— pero no al presentar.
     * Negativo nunca: un ticket de gasto no devuelve dinero a la caja, y el
     * dinero en este módulo es siempre un importe positivo.
     */
    const v = cambios.importeCentimos;
    if (!Number.isSafeInteger(v) || (v as number) < 0) {
      throw new ErrorCaja("IMPORTE_NO_VALIDO", "El importe tiene que ser un número de céntimos sin signo.", 400);
    }
    poner("importe_centimos", v);
  }
  if ("moneda" in cambios) {
    const m = String(cambios.moneda ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(m)) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La moneda tiene que ser un código de tres letras.", 400);
    poner("moneda", m);
  }

  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, claimId, true);
    exigirEditable(l);
    const antes = await lineaDe(client, claimId, lineId);

    /*
     * Concepto y destino van juntos. La CATEGORÍA puede ser cualquier concepto
     * activo; el destino de la línea solo existe si el concepto imputa a un
     * centro de coste. Si imputa a una persona, esa persona es el trabajador
     * de la liquidación y no se escribe aquí: se deriva al pagar.
     */
    if ("expenseConceptId" in cambios || "expenseTargetId" in cambios) {
      const conceptoId = "expenseConceptId" in cambios ? (cambios.expenseConceptId ?? null) : antes.expenseConceptId;
      let destinoId = "expenseTargetId" in cambios ? (cambios.expenseTargetId ?? null) : antes.expenseTargetId;

      if (conceptoId != null) {
        const { rows } = await client.query(
          `SELECT tipo_destino FROM cash_expense_concepts WHERE id = $1 AND empresa_id = $2`,
          [conceptoId, ctx.empresaId]
        );
        const tipo = rows[0]?.tipo_destino;
        if (tipo && tipo !== "CENTRO_COSTE") {
          if ("expenseTargetId" in cambios && cambios.expenseTargetId != null) {
            throw new ErrorCaja(
              "DESTINO_NO_VALIDO",
              tipo === "PERSONA"
                ? "Este concepto se imputa al trabajador de la liquidación: no se elige destino en el ticket."
                : "Este concepto no se imputa a nadie en concreto.",
              400
            );
          }
          // Cambiar a un concepto que no pide centro de coste limpia el que hubiera.
          destinoId = null;
        }
        // Existencia, activo y coherencia de tipo: la misma regla que un pago.
        await validarClasificacionGasto(ctx.empresaId, conceptoId, destinoId);
      } else {
        destinoId = null;
      }
      poner("expense_concept_id", conceptoId);
      poner("expense_target_id", destinoId);
    }

    if ("revisada" in cambios) {
      const r = Boolean(cambios.revisada);
      poner("revisada", r);
      poner("revisada_por", r ? ctx.userId : null);
      poner("revisada_at_ms", r ? Date.now() : null);
    }

    if (sets.length === 0) return antes;

    /*
     * Qué se ha corregido respecto a lo LEÍDO. Es la medida de cuánto acierta
     * la lectura: sin esto se sabría qué propuso la máquina, pero nunca si
     * acertó. Se acumula; un campo corregido una vez queda corregido.
     */
    const { rows: previa } = await client.query(
      `SELECT leido, campos_corregidos FROM cash_expense_claim_lines WHERE id = $1`,
      [lineId]
    );
    const leido = previa[0]?.leido as Record<string, unknown> | null;
    if (leido) {
      const corregidos = new Set<string>(previa[0].campos_corregidos ?? []);
      const comparables: [keyof CambiosLinea, string][] = [
        ["fecha", "fecha"],
        ["emisorNombre", "emisorNombre"],
        ["emisorNif", "emisorNif"],
        ["numeroDocumento", "numeroDocumento"],
        ["concepto", "concepto"],
        ["baseCentimos", "baseCentimos"],
        ["ivaCentimos", "ivaCentimos"],
        ["importeCentimos", "importeCentimos"],
      ];
      for (const [campo, clave] of comparables) {
        if (!(campo in cambios)) continue;
        const nuevo = cambios[campo] ?? null;
        const viejo = leido[clave] ?? null;
        if (String(nuevo ?? "").trim() !== String(viejo ?? "").trim()) corregidos.add(campo);
      }
      if ("expenseConceptId" in cambios) {
        const propuesto = (leido.conceptoPropuesto as { conceptoId?: number | null } | undefined)?.conceptoId ?? null;
        if ((cambios.expenseConceptId ?? null) !== propuesto) corregidos.add("expenseConceptId");
      }
      poner("campos_corregidos", JSON.stringify([...corregidos].sort()));
    }

    poner("updated_at_ms", Date.now());
    await client.query(
      `UPDATE cash_expense_claim_lines SET ${sets.join(", ")} WHERE id = $1 AND claim_id = $2`,
      [lineId, claimId, ...valores]
    );
    await client.query(`UPDATE cash_expense_claims SET updated_at_ms = $2 WHERE id = $1`, [
      claimId,
      Date.now(),
    ]);
    return lineaDe(client, claimId, lineId);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "revisada" in cambios && Object.keys(cambios).length === 1
      ? "cash.expense_claim.line.review"
      : "cash.expense_claim.line.edit",
    entidad: "cash_expense_claim_lines",
    entidadId: String(lineId),
    detalle: { claimId, cambios },
    ip: ctx.ip,
  });
  return conEnlace(hecha);
}

/** La línea recién escrita, ya fuera de la transacción y con su enlace firmado. */
async function conEnlace(l: LineaLiquidacion): Promise<LineaLiquidacion> {
  const { rows } = await pool.query(`SELECT ruta FROM cash_expense_claim_lines WHERE id = $1`, [l.id]);
  return { ...l, url: rows[0] ? await urlFirmada(rows[0].ruta) : null };
}

// ── Incluir y excluir ──────────────────────────────────────────────────────

/**
 * Excluir no borra: el ticket sigue en la liquidación, se ve con su motivo y
 * no suma. Es lo que se hace con un gasto que no se reembolsa —una copa en la
 * cena de trabajo— y con un duplicado confirmado.
 */
export async function excluirLinea(
  ctx: Contexto,
  claimId: number,
  lineId: number,
  motivo: string
): Promise<LineaLiquidacion> {
  const texto = String(motivo ?? "").trim().slice(0, 500);
  if (!texto) throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir por qué no se paga este ticket.", 400);

  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, claimId, true);
    exigirEditable(l);
    await lineaDe(client, claimId, lineId);
    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claim_lines
          SET situacion = 'EXCLUIDA', excluida_motivo = $3, excluida_por = $4, excluida_at_ms = $5,
              updated_at_ms = $5
        WHERE id = $1 AND claim_id = $2`,
      [lineId, claimId, texto, ctx.userId, ahora]
    );
    await resolverPorExclusion(client, lineId, ctx.userId, texto);
    await client.query(`UPDATE cash_expense_claims SET updated_at_ms = $2 WHERE id = $1`, [claimId, ahora]);
    return lineaDe(client, claimId, lineId);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.line.exclude",
    entidad: "cash_expense_claim_lines",
    entidadId: String(lineId),
    detalle: { claimId, motivo: texto },
    ip: ctx.ip,
  });
  return conEnlace(hecha);
}

export async function incluirLinea(ctx: Contexto, claimId: number, lineId: number): Promise<LineaLiquidacion> {
  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, claimId, true);
    exigirEditable(l);
    await lineaDe(client, claimId, lineId);
    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claim_lines
          SET situacion = 'INCLUIDA', excluida_motivo = NULL, excluida_por = NULL, excluida_at_ms = NULL,
              updated_at_ms = $3
        WHERE id = $1 AND claim_id = $2`,
      [lineId, claimId, ahora]
    );
    await reabrirPorInclusion(client, lineId);
    await client.query(`UPDATE cash_expense_claims SET updated_at_ms = $2 WHERE id = $1`, [claimId, ahora]);
    return lineaDe(client, claimId, lineId);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.line.include",
    entidad: "cash_expense_claim_lines",
    entidadId: String(lineId),
    detalle: { claimId },
    ip: ctx.ip,
  });
  return conEnlace(hecha);
}

// ── Resolver un posible duplicado ──────────────────────────────────────────

/**
 * Decidir sobre UNA coincidencia.
 *
 * · ACEPTADA — «no es un duplicado, se paga». Exige motivo: es la decisión que
 *   alguien tendrá que poder explicar el día que resulte que sí lo era. El
 *   router exige además permiso de aprobar, por el mismo motivo que cobrar
 *   dos veces una factura lo autoriza un responsable y no el cajero.
 * · EXCLUIDA — «sí lo es». Excluye la línea entera, con las demás
 *   coincidencias que tuviera.
 */
export async function resolverDuplicado(
  ctx: Contexto,
  claimId: number,
  evidenciaId: number,
  e: { resolucion: "ACEPTADA" | "EXCLUIDA"; motivo: string }
): Promise<LineaLiquidacion> {
  const texto = String(e.motivo ?? "").trim().slice(0, 500);
  if (e.resolucion !== "ACEPTADA" && e.resolucion !== "EXCLUIDA") {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "La decisión tiene que ser ACEPTADA o EXCLUIDA.", 400);
  }
  if (e.resolucion === "ACEPTADA" && !texto) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Di por qué no es un duplicado.", 400);
  }

  if (e.resolucion === "EXCLUIDA") {
    const client = await pool.connect();
    let lineId: number;
    let numero: string | null;
    try {
      const ev = await cargarEvidencia(client, ctx.empresaId, claimId, evidenciaId);
      lineId = ev.lineId;
      numero = ev.referenciaNumero;
    } finally {
      client.release();
    }
    return excluirLinea(ctx, claimId, lineId, texto || `Duplicado de ${numero ?? "otro ticket"}`);
  }

  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, claimId, true);
    exigirEditable(l);
    const ev = await cargarEvidencia(client, ctx.empresaId, claimId, evidenciaId);
    if (ev.resolucion !== "PENDIENTE") {
      throw new ErrorCaja("DUPLICADO_YA_RESUELTO", "Esa coincidencia ya está decidida.", 409);
    }
    await client.query(
      `UPDATE cash_expense_claim_duplicates
          SET resolucion = 'ACEPTADA', resuelto_por = $2, resuelto_at_ms = $3, motivo = $4
        WHERE id = $1`,
      [evidenciaId, ctx.userId, Date.now(), texto]
    );
    return { linea: await lineaDe(client, claimId, ev.lineId), ev };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.duplicate_accepted",
    entidad: "cash_expense_claim_duplicates",
    entidadId: String(evidenciaId),
    detalle: {
      claimId,
      lineId: hecha.ev.lineId,
      tipo: hecha.ev.tipo,
      referencia: hecha.ev.referenciaNumero,
      motivo: texto,
    },
    ip: ctx.ip,
  });
  return conEnlace(hecha.linea);
}
