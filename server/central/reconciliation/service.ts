/**
 * Conciliación bancaria asistida.
 *
 * Aquí vive lo que los dos módulos puros —el lector de Norma 43 y el casador—
 * no deben saber: de dónde salen los ingresos y qué se guarda.
 *
 * La palabra que importa es **asistida**. El sistema propone; confirmar es
 * siempre de una persona. Lo que se busca no es que la máquina acierte, sino
 * que confirmar cueste un clic en vez de media mañana con dos pantallas
 * abiertas.
 */

import pool from "../../db.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { leerNorma43 } from "./norma43.ts";
import { proponer, resumir, type ApunteBanco, type IngresoRegistrado } from "./matcher.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `AAAA-MM-DD` a partir de lo que devuelva la base.
 *
 * `node-postgres` entrega las columnas `DATE` como un `Date` en la zona del
 * proceso, así que `String(x).slice(0, 10)` da «Fri May 03» y no una fecha.
 * El módulo de caja ya tropezó con esto en las jornadas; aquí habría sido peor,
 * porque una fecha ilegible no casa con nada y el casador se limitaría a decir
 * que no hay pareja, sin que nadie sospechara del formato.
 */
function fechaIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export type ResultadoImportacion = {
  statementId: string | null;
  cuenta: string | null;
  apuntes: number;
  cuadra: boolean;
  errores: string[];
};

/**
 * Importa un extracto.
 *
 * **Si el fichero no cuadra consigo mismo, no se guarda.** Un extracto
 * incompleto conciliado a medias da por descuadrado lo que en realidad estaba
 * bien, y deshacerlo después cuesta más que volver a pedirle el fichero al
 * banco.
 */
export async function importarExtracto(
  ctx: { empresaId: string; userId: string | null; ip?: string },
  nombreFichero: string,
  contenido: string
): Promise<ResultadoImportacion> {
  const leido = leerNorma43(contenido);

  const cuenta = leido.cuentas[0];
  if (!cuenta || !cuenta.cuadra) {
    return {
      statementId: null,
      cuenta: cuenta?.cuenta ?? null,
      apuntes: 0,
      cuadra: false,
      errores: leido.errores.length > 0 ? leido.errores : ["El extracto no se ha podido leer."],
    };
  }

  const ahora = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO central_bank_statements
       (empresa_id, nombre_fichero, cuenta, desde, hasta,
        saldo_inicial_centimos, saldo_final_centimos, cuadra, importado_por, importado_en_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
     RETURNING id`,
    [
      ctx.empresaId,
      nombreFichero.slice(0, 200),
      cuenta.cuenta,
      cuenta.desde,
      cuenta.hasta,
      cuenta.saldoInicialCentimos,
      cuenta.saldoFinalCentimos,
      ctx.userId,
      ahora,
    ]
  );
  const statementId = rows[0].id;

  for (const m of cuenta.movimientos) {
    await pool.query(
      `INSERT INTO central_statement_lines
         (statement_id, empresa_id, fecha, fecha_valor, importe_centimos,
          concepto, ampliado, referencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        statementId,
        ctx.empresaId,
        m.fecha,
        m.fechaValor,
        m.importeCentimos,
        m.concepto,
        m.ampliado,
        `${m.referencia1} ${m.referencia2}`.trim(),
      ]
    );
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "central.statement.import",
    entidad: "central_bank_statements",
    entidadId: String(statementId),
    detalle: { cuenta: cuenta.cuenta, apuntes: cuenta.movimientos.length },
    ip: ctx.ip,
  });

  return {
    statementId,
    cuenta: cuenta.cuenta,
    apuntes: cuenta.movimientos.length,
    cuadra: true,
    errores: leido.errores,
  };
}

/** Los apuntes pendientes de un extracto, con lo que el casador propone. */
export async function propuestas(empresaId: string, statementId: string) {
  const { rows: lineas } = await pool.query(
    `SELECT id, fecha, importe_centimos, concepto, ampliado, referencia
       FROM central_statement_lines
      WHERE statement_id = $1 AND empresa_id = $2
        AND deposit_id IS NULL AND NOT descartado
      ORDER BY fecha, id`,
    [statementId, empresaId]
  );

  /*
   * Solo los ingresos que aún no están conciliados con ningún apunte. Ofrecer
   * uno ya casado como candidato es invitar a contarlo dos veces.
   */
  const { rows: ingresos } = await pool.query(
    `SELECT d.deposit_id, d.numero, d.fecha, d.importe_centimos, d.referencia
       FROM central_bank_deposits d
      WHERE d.empresa_id = $1 AND d.estado = 'CONFIRMADO'
        AND NOT EXISTS (
          SELECT 1 FROM central_statement_lines l WHERE l.deposit_id = d.deposit_id
        )`,
    [empresaId]
  );

  const apuntes: ApunteBanco[] = lineas.map((l: any) => ({
    id: l.id,
    fecha: fechaIso(l.fecha) ?? "",
    importeCentimos: Number(l.importe_centimos),
    concepto: `${l.concepto ?? ""} ${l.ampliado ?? ""}`.trim(),
    referencia: l.referencia ?? "",
  }));

  const registrados: IngresoRegistrado[] = ingresos.map((i: any) => ({
    depositId: i.deposit_id,
    numero: i.numero,
    fecha: fechaIso(i.fecha),
    importeCentimos: Number(i.importe_centimos),
    referencia: i.referencia ?? null,
  }));

  const lista = proponer(apuntes, registrados);
  return { apuntes, propuestas: lista, resumen: resumir(lista) };
}

/** Confirma una pareja. Siempre lo hace una persona. */
export async function conciliar(
  ctx: { empresaId: string; userId: string | null; ip?: string },
  lineId: string,
  depositId: number
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE central_statement_lines
        SET deposit_id = $3, conciliado_por = $4, conciliado_en_ms = $5
      WHERE id = $1 AND empresa_id = $2 AND deposit_id IS NULL AND NOT descartado`,
    [lineId, ctx.empresaId, depositId, ctx.userId, Date.now()]
  );

  if (!rowCount) {
    throw new Error("Ese apunte ya está conciliado o no existe.");
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "central.statement.reconcile",
    entidad: "central_statement_lines",
    entidadId: lineId,
    detalle: { depositId },
    ip: ctx.ip,
  });
}

/**
 * Marca un apunte como ajeno a la caja.
 *
 * Comisiones, recibos, nóminas. Sin esto, la lista de pendientes se llena de
 * apuntes que nunca van a casar con nada y deja de servir para ver lo que
 * de verdad falta.
 */
export async function descartar(
  ctx: { empresaId: string; userId: string | null; ip?: string },
  lineId: string,
  motivo: string
): Promise<void> {
  await pool.query(
    `UPDATE central_statement_lines
        SET descartado = true, descartado_motivo = $3
      WHERE id = $1 AND empresa_id = $2 AND deposit_id IS NULL`,
    [lineId, ctx.empresaId, motivo.slice(0, 300)]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "central.statement.discard",
    entidad: "central_statement_lines",
    entidadId: lineId,
    detalle: { motivo },
    ip: ctx.ip,
  });
}

/** Extractos importados, para la pantalla. */
export async function listarExtractos(empresaId: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.nombre_fichero, s.cuenta, s.desde, s.hasta, s.importado_en_ms,
            (SELECT COUNT(*) FROM central_statement_lines l WHERE l.statement_id = s.id)::int AS apuntes,
            (SELECT COUNT(*) FROM central_statement_lines l
              WHERE l.statement_id = s.id AND l.deposit_id IS NULL AND NOT l.descartado)::int AS pendientes
       FROM central_bank_statements s
      WHERE s.empresa_id = $1
      ORDER BY s.importado_en_ms DESC
      LIMIT 50`,
    [empresaId]
  );

  return rows.map((r: any) => ({
    id: r.id,
    nombreFichero: r.nombre_fichero,
    cuenta: r.cuenta,
    desde: fechaIso(r.desde),
    hasta: fechaIso(r.hasta),
    apuntes: r.apuntes,
    pendientes: r.pendientes,
    importadoEnMs: Number(r.importado_en_ms),
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
