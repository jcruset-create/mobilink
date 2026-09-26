/**
 * Cotejar una captura del ERP contra lo registrado en Mobilink.
 *
 * Junta tres piezas que ya existen y no decide nada por su cuenta:
 *
 *   1. `pedirIA` lee la captura              (server/core/openaiService.ts)
 *   2. `interpretarLecturaErp` la pasa por la aduana  (domain/lecturaErp.ts)
 *   3. `cotejar` compara                              (domain/cotejo.ts)
 *
 * Todo lo que se puede probar vive en las dos de dominio. Aquí solo queda el
 * pegamento: pedir, leer la jornada de la base de datos, y llamar.
 *
 * ## No toca nada
 *
 * Ni un INSERT, ni un UPDATE. Este fichero LEE. Que un cotejo pudiera crear
 * cobros a partir de una captura es la automatización que sale mal el día que
 * el modelo lea 377,24 como 377,74, y saldría mal en silencio.
 */

import pool from "../db.ts";
import { pedirIA } from "../core/openaiService.ts";
import { ErrorCaja } from "./repository.ts";
import { mapaEquivalenciasErp } from "./config.ts";
import { cotejar, type Informe, type LineaMobilink } from "./domain/cotejo.ts";
import { interpretarLecturaErp, PROMPT_LECTURA, type LecturaErp } from "./domain/lecturaErp.ts";

export type ResultadoCotejo = {
  lectura: LecturaErp;
  /**
   * `null` cuando la lectura es bloqueante.
   *
   * No es pereza: enseñar un cotejo que se apoya en una lectura que YA SE SABE
   * mala es peor que no enseñar nada. Diría «falta este cobro» por una línea
   * que el modelo no supo leer, y alguien acabaría metiéndola dos veces.
   */
  informe: Informe | null;
  /** Lo que no se ha cotejado por ser de una sección que se arquea aparte. */
  apartadas: Apartada[];
};

/**
 * Lo que se deja fuera del cotejo por ser de una sección que se arquea aparte.
 *
 * Taller y gasolinera comparten cajón pero en Genes son dos cajas: el arqueo
 * del taller no trae los cobros del surtidor, y cotejarlos contra él los daría
 * siempre por sobrantes. Se dice cuánto se ha dejado fuera, para que nadie
 * piense que se ha perdido.
 */
export type Apartada = {
  seccion: string;
  operaciones: number;
  /** Cobros menos abonos. */
  cobrosCentimos: number;
  pagosCentimos: number;
};

/** Las operaciones vivas de la jornada, en lo que el cotejo necesita. */
export async function operacionesDeJornada(
  empresaId: string,
  sessionId: number
): Promise<LineaMobilink[]> {
  return (await leerJornada(empresaId, sessionId)).lineas;
}

export async function leerJornada(
  empresaId: string,
  sessionId: number
): Promise<{ lineas: LineaMobilink[]; apartadas: Apartada[] }> {
  /*
   * Una operación con formas de pago MIXTAS sale como varias líneas, una por
   * forma. Es lo correcto: el ERP también las apunta por separado —en la
   * captura del 10/09, RAMON BERENGUER tiene un CONTADO y un TPV CAIXA— y
   * juntarlas daría un importe que no existe en ninguno de los dos sitios.
   *
   * Solo CONFIRMED: una anulada y su reversión no tienen que cotejarse contra
   * nada, porque en el ERP tampoco están.
   */
  const { rows } = await pool.query(
    `SELECT o.id, o.numero, o.tipo,
            COALESCE(NULLIF(o.external_document_reference, ''), NULLIF(o.referencia, '')) AS referencia,
            o.concepto,
            p.forma_pago, p.importe_centimos,
            COALESCE(sec.arquea_aparte, false) AS arquea_aparte, sec.nombre AS seccion
       FROM cash_operations o
       JOIN cash_operation_payments p ON p.operation_id = o.id
       JOIN cash_sessions s ON s.id = o.session_id
       LEFT JOIN cash_sections sec ON sec.id = o.section_id
      WHERE o.session_id = $1
        AND s.empresa_id = $2
        AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','REFUND','PAYMENT')
      ORDER BY o.id, p.id`,
    [sessionId, empresaId]
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const todas = (rows as any[]).map((r) => ({
    linea: {
      id: r.id,
      numero: r.numero,
      referencia: r.referencia ?? null,
      formaCodigo: r.forma_pago,
      importeCentimos: Number(r.importe_centimos),
      tipo:
        r.tipo === "COLLECTION"
          ? ("COBRO" as const)
          : r.tipo === "REFUND"
            ? ("ABONO" as const)
            : ("PAGO" as const),
      concepto: r.concepto || null,
    } as LineaMobilink,
    apartada: Boolean(r.arquea_aparte),
    seccion: (r.seccion as string | null) ?? "",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const apartadas = new Map<string, Apartada & { ids: Set<number> }>();
  for (const x of todas.filter((t) => t.apartada)) {
    const a = apartadas.get(x.seccion) ?? { seccion: x.seccion, operaciones: 0, cobrosCentimos: 0, pagosCentimos: 0, ids: new Set<number>() };
    a.ids.add(x.linea.id);
    a.operaciones = a.ids.size;
    if (x.linea.tipo === "COBRO") a.cobrosCentimos += x.linea.importeCentimos;
    else if (x.linea.tipo === "ABONO") a.cobrosCentimos -= x.linea.importeCentimos;
    else a.pagosCentimos += x.linea.importeCentimos;
    apartadas.set(x.seccion, a);
  }

  const lineas = todas.filter((t) => !t.apartada).map((t) => t.linea);
  await ponerDesgloseDeLiquidaciones(lineas);

  return {
    lineas,
    apartadas: [...apartadas.values()].map(({ ids: _ids, ...a }) => a),
  };
}

/**
 * El pago de una liquidación de gastos, con su total por concepto.
 *
 * Solo si el pago salió por UNA forma: con varias no se sabe qué parte de
 * cada concepto fue por cuál, y un desglose inventado casaría líneas del ERP
 * que no le tocan. Y solo si las partes suman el pago al céntimo.
 */
async function ponerDesgloseDeLiquidaciones(lineas: LineaMobilink[]): Promise<void> {
  const pagos = lineas.filter((l) => l.tipo === "PAGO");
  if (pagos.length === 0) return;
  const { rows } = await pool.query(
    `SELECT c.operation_pago_id AS op, COALESCE(k.nombre, 'Sin concepto') AS concepto,
            SUM(l.importe_centimos)::bigint AS importe
       FROM cash_expense_claims c
       JOIN cash_expense_claim_lines l ON l.claim_id = c.id AND l.situacion = 'INCLUIDA'
       LEFT JOIN cash_expense_concepts k ON k.id = l.expense_concept_id
      WHERE c.operation_pago_id = ANY($1::int[]) AND c.estado = 'PAGADA'
      GROUP BY c.operation_pago_id, k.nombre
      ORDER BY c.operation_pago_id, MIN(l.id)`,
    [pagos.map((l) => l.id)]
  );
  const porPago = new Map<number, { concepto: string; importeCentimos: number }[]>();
  for (const r of rows as { op: number; concepto: string; importe: string }[]) {
    const partes = porPago.get(r.op) ?? [];
    partes.push({ concepto: r.concepto, importeCentimos: Number(r.importe) });
    porPago.set(r.op, partes);
  }
  for (const l of pagos) {
    const partes = porPago.get(l.id);
    if (!partes || partes.length < 2) continue;
    if (lineas.filter((x) => x.id === l.id).length !== 1) continue;
    if (partes.reduce((a, p) => a + p.importeCentimos, 0) !== l.importeCentimos) continue;
    l.desglose = partes;
  }
}

/**
 * El recorrido entero.
 *
 * `imagen` es un data-URI (`data:image/png;base64,...`), que es lo que sale de
 * pegar una captura en el navegador. No se guarda en ningún sitio: se manda al
 * modelo, se lee y se tira. Una captura del cierre lleva nombres de clientes y
 * números de factura, y guardarla sería crear un depósito de datos personales
 * que nadie ha pedido y que nadie vigilaría.
 */
export async function cotejarCapturaErp(
  empresaId: string,
  e: { sessionId: number; imagen: string }
): Promise<ResultadoCotejo> {
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(e.imagen)) {
    throw new ErrorCaja(
      "IMAGEN_NO_VALIDA",
      "Pega una captura de pantalla (PNG o JPG).",
      400
    );
  }

  const respuesta = await pedirIA({
    prompt: PROMPT_LECTURA,
    imagenes: [{ url: e.imagen }],
    proposito: "documento",
    operacion: "cash.cotejo_erp",
  });

  if (!respuesta.ok) {
    /*
     * Que el modelo no conteste es un problema del servicio, no de la captura,
     * y el mensaje tiene que decirlo: si no, quien lo lea se pondrá a recortar
     * la imagen otra vez para nada.
     */
    throw new ErrorCaja(
      "IA_NO_DISPONIBLE",
      `No se ha podido leer la captura: ${respuesta.error ?? "el servicio de lectura no responde"}.`,
      503
    );
  }

  const lectura = interpretarLecturaErp(respuesta.texto);
  const [jornada, equivalencias] = await Promise.all([
    leerJornada(empresaId, e.sessionId),
    mapaEquivalenciasErp(empresaId),
  ]);
  if (lectura.bloqueante) return { lectura, informe: null, apartadas: jornada.apartadas };

  return {
    lectura,
    informe: cotejar(lectura.lineas, jornada.lineas, equivalencias),
    apartadas: jornada.apartadas,
  };
}
