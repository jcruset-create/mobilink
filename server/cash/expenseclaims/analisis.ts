/**
 * La lectura automática de los tickets de una liquidación.
 *
 * Lo importante de este fichero es lo que NO tiene: ni una línea de lectura.
 * Llama a `escanearFactura`, el mismo escáner de Cobros, Pagos y AutoScan,
 * con sentido PAGO. Dos lectores de tickets darían dos respuestas distintas
 * para el mismo papel el día que se tocara uno y no el otro.
 *
 * ## La IA ayuda; nunca decide ni bloquea
 *
 * · **Solo rellena huecos.** Lo que una persona ya haya escrito no se pisa, y
 *   una línea ya dada por REVISADA no se toca en absoluto: la lectura se
 *   guarda para auditarla, y ya. Tampoco se toca nada de una liquidación que
 *   ya no está en borrador: presentar congela.
 * · **Si falla, no pasa nada.** La línea queda FALLIDA, el fichero sigue ahí y
 *   los datos se ponen a mano, como antes de que esto existiera.
 * · **Sin clave de IA, ni se intenta.** Las líneas nacen OMITIDAS.
 * · **Lo leído se guarda aparte** (`leido`), y no se modifica después. Lo que
 *   vale es lo revisado; comparar las dos cosas es lo que dice cuánto acierta
 *   la lectura (`campos_corregidos`).
 */

import pool from "../../db.ts";
import { hayIA } from "../../core/openaiService.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { ErrorCaja } from "../errors.ts";
import { extractorIA, type ExtractorFacturas } from "../invoice-scan/extractor.ts";
import { escanearFactura } from "../invoice-scan/service.ts";
import { enTransaccion } from "../repository.ts";
import type { Contexto } from "../service.ts";
import { leerDocumento } from "../storage.ts";
import { type ReglaConcepto, clasificarConcepto } from "./conceptos.ts";
import { lineasEditables } from "./domain.ts";
import { detectarPorContenido } from "./duplicates.ts";
import { cargarLiquidacion } from "./repository.ts";

/** Hay con qué leer. Sin clave, las líneas nacen OMITIDAS y no se intenta. */
export function lecturaDisponible(): boolean {
  return hayIA();
}

/** Cuántas veces se intenta una línea antes de dejarla FALLIDA para siempre. */
export const MAXIMO_INTENTOS = 3;

/** Una lectura colgada más de esto se da por perdida (el proceso murió). */
export const ANALISIS_COLGADO_MS = 10 * 60_000;

export async function reglasGastoDeEmpresa(empresaId: string): Promise<ReglaConcepto[]> {
  const { rows } = await pool.query(
    `SELECT id, campo, patron, expense_concept_id, confianza, auto_seleccionar, prioridad
       FROM cash_expense_rules
      WHERE empresa_id = $1 AND activa
      ORDER BY prioridad, id`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    campo: r.campo,
    patron: r.patron,
    conceptoId: r.expense_concept_id,
    confianza: Number(r.confianza),
    autoSeleccionar: r.auto_seleccionar,
    prioridad: r.prioridad,
  }));
}

async function conceptosActivos(empresaId: string): Promise<Set<number>> {
  const { rows } = await pool.query(
    `SELECT id FROM cash_expense_concepts WHERE empresa_id = $1 AND activo`,
    [empresaId]
  );
  return new Set(rows.map((r: { id: number }) => r.id));
}

/** Lo leído, tal y como se guarda en `leido`. Los nombres son los de la línea. */
export type Leido = {
  fecha: string | null;
  emisorNombre: string | null;
  emisorNif: string | null;
  numeroDocumento: string | null;
  concepto: string | null;
  baseCentimos: number | null;
  ivaCentimos: number | null;
  importeCentimos: number | null;
  moneda: string | null;
  tipoEstablecimiento: string;
  tipoDocumento: string;
  esAbono: boolean;
  facturasDetectadas: number;
  avisos: { codigo: string; mensaje: string; grave: boolean }[];
  conceptoPropuesto: {
    conceptoId: number | null;
    confianza: number;
    motivo: string;
    autoSeleccionar: boolean;
    reglaId: number | null;
  };
};

/** «EUR», «€», «eur» → EUR; otra cosa de tres letras, tal cual; si no, null. */
function monedaLeida(texto: string | null): string | null {
  const t = (texto ?? "").trim().toUpperCase();
  if (!t) return null;
  if (t === "€" || t.includes("EUR")) return "EUR";
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

/**
 * Lee UNA línea y rellena lo que falte. La llama el worker con la línea ya
 * marcada ANALIZANDO; el extractor entra por parámetro para poder probar el
 * camino entero sin llamar a ningún proveedor.
 */
export async function analizarLinea(
  lineId: number,
  extractor: ExtractorFacturas = extractorIA
): Promise<"LISTO" | "FALLIDO" | "OMITIDO"> {
  const { rows } = await pool.query(
    `SELECT l.id, l.empresa_id, l.claim_id, l.nombre, l.mime, l.ruta
       FROM cash_expense_claim_lines l WHERE l.id = $1`,
    [lineId]
  );
  const l = rows[0];
  if (!l) return "OMITIDO";

  let leido: Leido;
  let scanId: number;
  try {
    const contenido = await leerDocumento(l.ruta);
    if (!contenido) throw new Error("El fichero del ticket no está en el almacenamiento.");
    const p = await escanearFactura(
      {
        empresaId: l.empresa_id,
        userId: null,
        sessionId: null,
        fichero: { originalname: l.nombre, mimetype: l.mime, buffer: contenido },
        // PAGO: el duplicado se mira contra PAGOS anteriores de esa factura.
        sentido: "PAGO",
      },
      extractor
    );
    scanId = p.scanId;
    const n = p.extra;
    const propuesta = clasificarConcepto(
      {
        tipoEstablecimiento: n.tipoEstablecimiento,
        nombreEmisor: n.emisor.nombre,
        nifEmisor: n.emisor.nif,
        concepto: n.concepto,
        baseCentimos: n.totales.baseCentimos,
        ivaCentimos: n.totales.ivaCentimos,
        totalCentimos: n.totales.totalCentimos,
        confianzaEmisor: n.confianza.emisor,
      },
      await reglasGastoDeEmpresa(l.empresa_id),
      await conceptosActivos(l.empresa_id)
    );
    const valor = <T,>(c: { valor: T; estado: string }): T | null => (c.estado === "VACIO" ? null : c.valor);
    leido = {
      fecha: n.fecha,
      emisorNombre: valor(p.proveedor),
      emisorNif: n.emisor.nif,
      numeroDocumento: valor(p.referencia),
      concepto: valor(p.concepto),
      baseCentimos: n.totales.baseCentimos == null ? null : Math.abs(n.totales.baseCentimos),
      ivaCentimos: n.totales.ivaCentimos == null ? null : Math.abs(n.totales.ivaCentimos),
      /*
       * Un abono no se rellena: un ticket de gasto no devuelve dinero, y
       * poner su importe en positivo sería pagar lo que en realidad se
       * devolvió. Se deja vacío y el aviso lo explica.
       */
      importeCentimos: p.esAbono ? null : valor(p.importeCentimos),
      moneda: monedaLeida(n.totales.moneda),
      tipoEstablecimiento: n.tipoEstablecimiento,
      tipoDocumento: n.tipoDocumento,
      esAbono: p.esAbono,
      facturasDetectadas: n.facturasDetectadas,
      avisos: p.avisos.map((a) => ({ codigo: a.codigo, mensaje: a.mensaje, grave: a.grave })),
      conceptoPropuesto: propuesta,
    };
  } catch (e) {
    await pool.query(
      `UPDATE cash_expense_claim_lines
          SET analisis = 'FALLIDO', analisis_error = $2, updated_at_ms = $3
        WHERE id = $1 AND analisis = 'ANALIZANDO'`,
      [lineId, String(e instanceof Error ? e.message : e).slice(0, 300), Date.now()]
    );
    return "FALLIDO";
  }

  /*
   * Se escribe con la liquidación BLOQUEADA y comprobando su estado ahí
   * dentro: si alguien la presentó mientras se leía, lo leído se guarda pero
   * no se rellena nada. Presentar congela, también para la máquina.
   */
  await enTransaccion(async (client) => {
    const { rows: c } = await client.query(
      `SELECT estado FROM cash_expense_claims WHERE id = $1 FOR UPDATE`,
      [l.claim_id]
    );
    const { rows: actual } = await client.query(
      `SELECT * FROM cash_expense_claim_lines WHERE id = $1 FOR UPDATE`,
      [lineId]
    );
    const x = actual[0];
    const puedeRellenar = lineasEditables(c[0]?.estado) && !x.revisada;
    const ahora = Date.now();

    const sets = [
      "analisis = 'LISTO'",
      "analisis_error = NULL",
      "leido = $2",
      "scan_id = $3",
      "concepto_propuesto_id = $4",
      "concepto_confianza = $5",
      "concepto_regla_id = $6",
      "updated_at_ms = $7",
    ];
    const valores: unknown[] = [
      lineId,
      JSON.stringify(leido),
      scanId,
      leido.conceptoPropuesto.conceptoId,
      leido.conceptoPropuesto.confianza,
      leido.conceptoPropuesto.reglaId,
      ahora,
    ];
    const rellenar = (columna: string, vacio: boolean, valor: unknown) => {
      if (!puedeRellenar || !vacio || valor == null || valor === "") return;
      valores.push(valor);
      sets.push(`${columna} = $${valores.length}`);
    };
    rellenar("fecha", x.fecha == null, leido.fecha);
    rellenar("emisor_nombre", !x.emisor_nombre, leido.emisorNombre);
    rellenar("emisor_nif", !x.emisor_nif, leido.emisorNif);
    rellenar("numero_documento", !x.numero_documento, leido.numeroDocumento);
    rellenar("concepto", !x.concepto, leido.concepto);
    rellenar("base_centimos", x.base_centimos == null, leido.baseCentimos);
    rellenar("iva_centimos", x.iva_centimos == null, leido.ivaCentimos);
    rellenar("importe_centimos", Number(x.importe_centimos) === 0, leido.importeCentimos);
    /*
     * La moneda solo se cambia si el papel dice OTRA. Un ticket en libras
     * pagado como si fueran euros es el error caro; uno en euros ya lo está.
     */
    if (leido.moneda && leido.moneda !== "EUR") rellenar("moneda", x.moneda === "EUR", leido.moneda);
    // El concepto, solo si la regla puede rellenarlo sola y el hueco sigue ahí.
    if (leido.conceptoPropuesto.autoSeleccionar) {
      rellenar("expense_concept_id", x.expense_concept_id == null, leido.conceptoPropuesto.conceptoId);
    }

    await client.query(
      `UPDATE cash_expense_claim_lines SET ${sets.join(", ")} WHERE id = $1 AND analisis = 'ANALIZANDO'`,
      valores
    );
    // Con los datos ya puestos, se puede saber si es un ticket repetido.
    await detectarPorContenido(client, l.empresa_id, lineId, "ANALISIS");
  });
  return "LISTO";
}

// ── El worker ──────────────────────────────────────────────────────────────

/** Cada cuánto mira si hay trabajo. */
const CADA_MS = 15_000;
/** Cuántas por vuelta. Cada una es una llamada a la IA, que cuesta dinero. */
const LOTE = 3;

/**
 * Coge UNA línea pendiente y la marca como en curso, atómicamente.
 *
 * Como `autoscan/worker.ts`: el `WHERE analisis = 'PENDIENTE'` del propio
 * UPDATE, con `SKIP LOCKED`, es lo que impide que dos instancias —en Render
 * hay varias— lean el mismo ticket dos veces.
 */
async function cogerUna(): Promise<number | null> {
  const { rows } = await pool.query(
    `UPDATE cash_expense_claim_lines
        SET analisis = 'ANALIZANDO', analisis_intentos = analisis_intentos + 1, updated_at_ms = $1
      WHERE id = (
        SELECT id FROM cash_expense_claim_lines
         WHERE analisis = 'PENDIENTE'
         ORDER BY subido_at_ms, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
    [Date.now()]
  );
  return rows[0]?.id ?? null;
}

/**
 * Las que se quedaron ANALIZANDO porque el proceso murió a medias vuelven a la
 * cola; las que ya lo intentaron demasiadas veces, a FALLIDO. Sin esto, un
 * reinicio en mal momento dejaría un ticket «leyendo…» para siempre.
 */
async function rescatarColgadas(): Promise<void> {
  const limite = Date.now() - ANALISIS_COLGADO_MS;
  await pool.query(
    `UPDATE cash_expense_claim_lines
        SET analisis = CASE WHEN analisis_intentos >= $2 THEN 'FALLIDO' ELSE 'PENDIENTE' END,
            analisis_error = CASE WHEN analisis_intentos >= $2
                                  THEN 'La lectura se interrumpió demasiadas veces.' ELSE analisis_error END
      WHERE analisis = 'ANALIZANDO' AND updated_at_ms < $1`,
    [limite, MAXIMO_INTENTOS]
  );
}

export async function procesarPendientes(
  limite = LOTE,
  extractor: ExtractorFacturas = extractorIA
): Promise<number> {
  await rescatarColgadas();
  let hechas = 0;
  for (let i = 0; i < limite; i++) {
    const id = await cogerUna();
    if (id == null) break;
    await analizarLinea(id, extractor);
    hechas++;
  }
  return hechas;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

/** Se arranca al montar la API. Sin clave de IA no arranca: no hay nada que hacer. */
export function arrancarWorkerGastos(): void {
  if (temporizador || !lecturaDisponible()) return;
  temporizador = setInterval(() => {
    procesarPendientes().catch((e) => console.error("[Mobilink Cash] lectura de tickets:", e));
  }, CADA_MS);
}

export function pararWorkerGastos(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

// ── Reintentar ─────────────────────────────────────────────────────────────

/** Vuelve a poner en cola una lectura FALLIDA u OMITIDA. */
export async function reintentarAnalisis(ctx: Contexto, claimId: number, lineId: number): Promise<void> {
  if (!lecturaDisponible()) {
    throw new ErrorCaja(
      "LECTURA_NO_DISPONIBLE",
      "La lectura automática no está configurada en este servidor. Pon los datos a mano.",
      409
    );
  }
  const l = await cargarLiquidacion(pool, ctx, claimId);
  if (!lineasEditables(l.estado)) {
    throw new ErrorCaja("LINEA_NO_EDITABLE", `${l.numero} ya no está en borrador.`, 409);
  }
  const { rowCount } = await pool.query(
    `UPDATE cash_expense_claim_lines
        SET analisis = 'PENDIENTE', analisis_intentos = 0, analisis_error = NULL, updated_at_ms = $3
      WHERE id = $1 AND claim_id = $2 AND analisis IN ('FALLIDO','OMITIDO')`,
    [lineId, claimId, Date.now()]
  );
  if (!rowCount) {
    throw new ErrorCaja("ANALISIS_EN_CURSO", "Ese ticket ya se está leyendo o ya está leído.", 409);
  }
  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.line.retry",
    entidad: "cash_expense_claim_lines",
    entidadId: String(lineId),
    detalle: { claimId },
    ip: ctx.ip,
  });
}

// ── Aprender sin volver a leer ─────────────────────────────────────────────

/**
 * Vuelve a pasar las reglas de concepto por los tickets YA LEÍDOS de una
 * liquidación en borrador.
 *
 * Es lo que hace útil el «Recordar» de la pantalla: el trabajador trae cuatro
 * menús del mismo bar, alguien elige Dietas en el primero y guarda la regla, y
 * los otros tres lo reciben al momento. Sin volver a llamar a la IA —lo leído
 * está guardado y leer cuesta dinero—: se clasifica otra vez con lo que ya se
 * sabía del papel, con la misma función y con la seguridad que el modelo dio
 * al emisor aquella vez.
 *
 * Las mismas reglas del juego que la lectura: solo se rellena el concepto
 * VACÍO de un ticket que nadie ha dado por revisado; lo demás queda como
 * propuesta con su porqué.
 */
export async function aplicarReglasDeConcepto(
  ctx: Contexto,
  claimId: number
): Promise<{ propuestas: number; rellenadas: number }> {
  const reglas = await reglasGastoDeEmpresa(ctx.empresaId);
  const activos = await conceptosActivos(ctx.empresaId);
  const hecho = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, claimId, true);
    if (!lineasEditables(l.estado)) {
      throw new ErrorCaja("LINEA_NO_EDITABLE", `${l.numero} ya no está en borrador.`, 409);
    }
    const { rows } = await client.query(
      `SELECT x.id, x.leido, x.revisada, x.expense_concept_id,
              (s.extraccion_normalizada->'confianza'->>'emisor')::float AS confianza_emisor
         FROM cash_expense_claim_lines x
         LEFT JOIN cash_invoice_scans s ON s.id = x.scan_id
        WHERE x.claim_id = $1 AND x.analisis = 'LISTO' AND x.leido IS NOT NULL AND x.situacion = 'INCLUIDA'
        ORDER BY x.id
        FOR UPDATE OF x`,
      [claimId]
    );
    let propuestas = 0;
    let rellenadas = 0;
    for (const x of rows) {
      const leido = x.leido as Leido;
      const propuesta = clasificarConcepto(
        {
          tipoEstablecimiento: leido.tipoEstablecimiento,
          nombreEmisor: leido.emisorNombre,
          nifEmisor: leido.emisorNif,
          concepto: leido.concepto,
          baseCentimos: leido.baseCentimos,
          ivaCentimos: leido.ivaCentimos,
          totalCentimos: leido.importeCentimos,
          // Sin el escaneo no se sabe cuánto se fiaba el modelo: no se rellena solo.
          confianzaEmisor: x.confianza_emisor == null ? 0 : Number(x.confianza_emisor),
        },
        reglas,
        activos
      );
      if (propuesta.conceptoId != null) propuestas++;
      const rellenar = propuesta.autoSeleccionar && !x.revisada && x.expense_concept_id == null;
      if (rellenar) rellenadas++;
      await client.query(
        `UPDATE cash_expense_claim_lines
            SET leido = jsonb_set(leido, '{conceptoPropuesto}', $2::jsonb),
                concepto_propuesto_id = $3, concepto_confianza = $4, concepto_regla_id = $5,
                expense_concept_id = CASE WHEN $6 THEN $3 ELSE expense_concept_id END,
                updated_at_ms = $7
          WHERE id = $1`,
        [
          x.id,
          JSON.stringify(propuesta),
          propuesta.conceptoId,
          propuesta.confianza,
          propuesta.reglaId,
          rellenar,
          Date.now(),
        ]
      );
    }
    return { propuestas, rellenadas };
  });
  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.rules_applied",
    entidad: "cash_expense_claims",
    entidadId: String(claimId),
    detalle: hecho,
    ip: ctx.ip,
  });
  return hecho;
}
