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
};

/** Las operaciones vivas de la jornada, en lo que el cotejo necesita. */
export async function operacionesDeJornada(
  empresaId: string,
  sessionId: number
): Promise<LineaMobilink[]> {
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
            p.forma_pago, p.importe_centimos
       FROM cash_operations o
       JOIN cash_operation_payments p ON p.operation_id = o.id
       JOIN cash_sessions s ON s.id = o.session_id
      WHERE o.session_id = $1
        AND s.empresa_id = $2
        AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','PAYMENT')
      ORDER BY o.id, p.id`,
    [sessionId, empresaId]
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (rows as any[]).map((r) => ({
    id: r.id,
    numero: r.numero,
    referencia: r.referencia ?? null,
    formaCodigo: r.forma_pago,
    importeCentimos: Number(r.importe_centimos),
    tipo: r.tipo === "COLLECTION" ? ("COBRO" as const) : ("PAGO" as const),
    concepto: r.concepto || null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
  if (lectura.bloqueante) return { lectura, informe: null };

  const [mobilink, equivalencias] = await Promise.all([
    operacionesDeJornada(empresaId, e.sessionId),
    mapaEquivalenciasErp(empresaId),
  ]);

  return { lectura, informe: cotejar(lectura.lineas, mobilink, equivalencias) };
}
