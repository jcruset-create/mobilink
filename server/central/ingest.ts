/**
 * Ingesta de eventos en MC Central.
 *
 * Tres reglas gobiernan este fichero.
 *
 * **1. Un evento se aplica una sola vez.** `central_events.event_id` es clave
 * primaria y la inserción usa `ON CONFLICT DO NOTHING`: si no insertó fila, el
 * evento ya estaba y no se vuelve a proyectar. El worker de la caja puede
 * reenviar sin miedo —se cae justo después de entregar y antes de anotar— y
 * aquí eso no suma un cobro de más. Es la defensa contra el doble conteo, y no
 * es una comprobación de código: es la clave primaria.
 *
 * **2. Un evento tardío no pisa el estado.** Un reintento puede entregar la
 * apertura de una jornada DESPUÉS de su cierre. Sin orden, la pantalla diría
 * que sigue abierta una caja que se cerró hace horas. Por eso los cambios de
 * estado solo se aplican si la versión del agregado es mayor que la última
 * aplicada; los contadores, en cambio, se suman siempre, porque la clave
 * primaria ya garantiza que cada evento se cuenta una vez.
 *
 * **3. Central nunca escribe en `cash_*`.** Solo lee eventos y mantiene sus
 * proyecciones. Si se borraran enteras, se reconstruyen volviendo a pasar
 * `central_events`. Un error de agregación aquí no puede corromper la caja.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import type { EventoParaEnviar } from "../cash/events/transport.ts";

export type ResultadoIngesta = "APLICADO" | "DUPLICADO" | "TARDIO";

/**
 * Ingiere un evento. Devuelve qué se hizo con él, que es lo que distingue «no
 * ha llegado» de «llegó y se descartó por viejo».
 */
export async function ingerirEvento(evento: EventoParaEnviar): Promise<ResultadoIngesta> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ahora = Date.now();
    const { rowCount } = await client.query(
      `INSERT INTO central_events
         (event_id, empresa_id, centro_id, register_id, session_id,
          aggregate_type, aggregate_id, aggregate_version, tipo, ocurrido_en_ms,
          actor_user_id, datos, recibido_en_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        evento.eventId,
        evento.empresaId,
        evento.centroId,
        evento.registerId,
        evento.sessionId,
        evento.aggregateType,
        evento.aggregateId,
        evento.aggregateVersion,
        evento.tipo,
        evento.ocurridoEnMs,
        evento.actorUserId,
        JSON.stringify(evento.datos ?? {}),
        ahora,
      ]
    );

    // Sin fila insertada, el evento ya estaba: nada que proyectar.
    if (rowCount === 0) {
      await client.query("COMMIT");
      return "DUPLICADO";
    }

    const resultado = await proyectar(client, evento, ahora);
    if (resultado === "TARDIO") {
      await client.query(`UPDATE central_events SET resultado = 'TARDIO' WHERE event_id = $1`, [
        evento.eventId,
      ]);
    }

    await client.query("COMMIT");
    return resultado;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Los importes llegan en JSON, así que pueden venir como número o como texto. */
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

/** ¿Es el evento más nuevo que lo último aplicado a su agregado? */
function esNuevo(evento: EventoParaEnviar, ultimaVersion: number | null): boolean {
  if (evento.aggregateVersion == null || ultimaVersion == null) return true;
  return evento.aggregateVersion > ultimaVersion;
}

async function proyectar(
  client: PoolClient,
  e: EventoParaEnviar,
  ahora: number
): Promise<ResultadoIngesta> {
  await tocarCaja(client, e, ahora);

  if (e.aggregateType === "REGISTER") return proyectarCaja(client, e, ahora);
  if (e.sessionId == null) return "APLICADO";

  // La fila de la jornada se crea al vuelo: un evento de una jornada que
  // Central no conoce (porque empezó a escuchar a mitad) sigue contando. Es
  // preferible una jornada incompleta a un hueco.
  const { rows } = await client.query(
    `INSERT INTO central_sessions
       (session_id, empresa_id, centro_id, register_id, actualizado_en_ms)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (session_id) DO UPDATE SET actualizado_en_ms = $5
     RETURNING ultima_version`,
    [e.sessionId, e.empresaId, e.centroId, e.registerId, ahora]
  );
  const ultimaVersion = rows[0]?.ultima_version == null ? null : Number(rows[0].ultima_version);
  const nuevo = esNuevo(e, ultimaVersion);

  const d = e.datos ?? {};

  switch (e.tipo) {
    case "SESSION_OPENED":
      if (!nuevo) return "TARDIO";
      await client.query(
        `UPDATE central_sessions
            SET fecha = $2, estado = 'OPEN', fondo_inicial_centimos = $3,
                abierta_en_ms = $4, ultima_version = $5, actualizado_en_ms = $6
          WHERE session_id = $1`,
        [e.sessionId, d.fecha ?? null, num(d.fondoCentimos), e.ocurridoEnMs, e.aggregateVersion, ahora]
      );
      return "APLICADO";

    case "SESSION_CLOSED":
      if (!nuevo) return "TARDIO";
      await client.query(
        `UPDATE central_sessions
            SET estado = 'CLOSED', fecha = COALESCE(fecha, $2),
                cambio_final_centimos = $3, ingreso_bancario_centimos = $4,
                diferencia_centimos = $5, cerrada_en_ms = $6,
                ultima_version = $7, actualizado_en_ms = $8
          WHERE session_id = $1`,
        [
          e.sessionId,
          d.fecha ?? null,
          num(d.cambioFinalCentimos),
          num(d.ingresoBancarioCentimos),
          num(d.diferenciaCentimos),
          e.ocurridoEnMs,
          e.aggregateVersion,
          ahora,
        ]
      );
      await client.query(
        `UPDATE central_registers
            SET ultima_fecha_cerrada = GREATEST(COALESCE(ultima_fecha_cerrada, '0001-01-01'), $2::date),
                jornada_abierta_id = NULL, actualizado_en_ms = $3
          WHERE register_id = $1`,
        [e.registerId, d.fecha ?? null, ahora]
      );
      return "APLICADO";

    case "SESSION_REOPENED":
      if (!nuevo) return "TARDIO";
      await client.query(
        `UPDATE central_sessions
            SET estado = 'REOPENED', reaperturas = reaperturas + 1,
                ultima_version = $2, actualizado_en_ms = $3
          WHERE session_id = $1`,
        [e.sessionId, e.aggregateVersion, ahora]
      );
      return "APLICADO";

    /*
     * Los contadores se suman SIEMPRE, tarde o no. No es una excepción a la
     * regla del orden: un cobro que llega con retraso ocurrió de verdad y su
     * dinero cuenta igual. Lo que no puede es cambiar el estado de la jornada,
     * y no lo cambia. Que no se sume dos veces ya lo garantiza la clave
     * primaria de `central_events`, no este código.
     */
    case "OPERATION_REGISTERED": {
      const tipo = String(d.tipoOperacion ?? "");
      await client.query(
        `UPDATE central_sessions
            SET operaciones = operaciones + 1,
                efectivo_neto_centimos = efectivo_neto_centimos + $2,
                cobros_centimos = cobros_centimos + $3,
                pagos_centimos = pagos_centimos + $4,
                actualizado_en_ms = $5
          WHERE session_id = $1`,
        [
          e.sessionId,
          num(d.efectivoNetoCentimos),
          tipo === "COLLECTION" ? num(d.importeCentimos) : 0,
          tipo === "PAYMENT" ? num(d.importeCentimos) : 0,
          ahora,
        ]
      );
      return nuevo ? "APLICADO" : "TARDIO";
    }

    /*
     * Tránsito: dinero que salió del cajón y volverá.
     *
     * No toca ningún contador de la jornada, y eso es deliberado: el
     * movimiento de efectivo ya llegó como `OPERATION_REGISTERED` y descontó
     * el cajón. Si además sumara aquí, el mismo billete contaría dos veces.
     * Lo único que hace es anotar dónde está mientras no vuelve.
     */
    case "TRANSIT_OPENED":
      await client.query(
        `INSERT INTO central_transits
           (clase, documento_id, empresa_id, centro_id, register_id, session_id,
            numero, importe_centimos, responsable, estado, abierto_en_ms, actualizado_en_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ABIERTO',$10,$11)
         ON CONFLICT (clase, documento_id) DO NOTHING`,
        [
          String(d.clase ?? "?"),
          Number(d.documentoId ?? 0),
          e.empresaId,
          e.centroId,
          e.registerId,
          e.sessionId,
          d.numero ?? null,
          num(d.importeCentimos),
          d.responsable ?? null,
          e.ocurridoEnMs,
          ahora,
        ]
      );
      return "APLICADO";

    case "TRANSIT_SETTLED":
      /*
       * `WHERE estado = 'ABIERTO'` y no a secas: si el cierre llegara dos
       * veces —o llegara antes que la apertura por un reintento— no puede
       * reabrir ni pisar lo ya liquidado. La fila se crea si no existía,
       * directamente cerrada, para no perder el hecho.
       */
      await client.query(
        `INSERT INTO central_transits
           (clase, documento_id, empresa_id, centro_id, register_id, session_id,
            numero, importe_centimos, estado, cerrado_en_ms, liquidado_centimos,
            actualizado_en_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'LIQUIDADO',$9,$10,$11)
         ON CONFLICT (clase, documento_id) DO UPDATE
           SET estado = 'LIQUIDADO',
               cerrado_en_ms = EXCLUDED.cerrado_en_ms,
               liquidado_centimos = EXCLUDED.liquidado_centimos,
               actualizado_en_ms = EXCLUDED.actualizado_en_ms
         WHERE central_transits.estado = 'ABIERTO'`,
        [
          String(d.clase ?? "?"),
          Number(d.documentoId ?? 0),
          e.empresaId,
          e.centroId,
          e.registerId,
          e.sessionId,
          d.numero ?? null,
          num(d.importeCentimos),
          e.ocurridoEnMs,
          num(d.liquidadoCentimos),
          ahora,
        ]
      );
      return "APLICADO";

    case "OPERATION_REVERSED":
      await client.query(
        `UPDATE central_sessions
            SET anulaciones = anulaciones + 1, actualizado_en_ms = $2
          WHERE session_id = $1`,
        [e.sessionId, ahora]
      );
      return nuevo ? "APLICADO" : "TARDIO";

    case "COUNT_RECORDED": {
      if (!nuevo) return "TARDIO";
      await client.query(
        `UPDATE central_sessions
            SET contado_centimos = $2, diferencia_centimos = $3,
                ultima_version = $4, actualizado_en_ms = $5
          WHERE session_id = $1`,
        [e.sessionId, num(d.contadoCentimos), num(d.diferenciaCentimos), e.aggregateVersion, ahora]
      );

      /*
       * La foto del cajón, pieza a pieza. Se PISA la anterior: aquí no interesa
       * la historia de los arqueos —esa está entera en `central_events`— sino
       * cuánta calderilla hay ahora en cada caja.
       *
       * Los eventos anteriores a esta fase no traen `lineas`, y entonces no se
       * toca nada: mejor una foto vieja que ninguna.
       */
      const lineas = Array.isArray(d.lineas)
        ? (d.lineas as { valor: number; contado: number; diferencia: number }[])
        : [];
      for (const l of lineas) {
        await client.query(
          `INSERT INTO central_denomination_stock
             (register_id, valor_centimos, empresa_id, centro_id, cantidad, diferencia,
              session_id, contado_en_ms, actualizado_en_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (register_id, valor_centimos) DO UPDATE
             SET cantidad = EXCLUDED.cantidad,
                 diferencia = EXCLUDED.diferencia,
                 centro_id = EXCLUDED.centro_id,
                 session_id = EXCLUDED.session_id,
                 contado_en_ms = EXCLUDED.contado_en_ms,
                 actualizado_en_ms = EXCLUDED.actualizado_en_ms
             -- Un arqueo que llega tarde no pisa una foto más reciente.
             WHERE central_denomination_stock.contado_en_ms IS NULL
                OR central_denomination_stock.contado_en_ms <= EXCLUDED.contado_en_ms`,
          [
            e.registerId,
            l.valor,
            e.empresaId,
            e.centroId,
            l.contado,
            l.diferencia,
            e.sessionId,
            e.ocurridoEnMs,
            ahora,
          ]
        );
      }
      return "APLICADO";
    }

    case "COUNT_ADJUSTED":
      if (!nuevo) return "TARDIO";
      // Regularizar deja la caja cuadrada: la diferencia pendiente pasa a cero
      // y el descuadre queda asentado como ajuste, que llega como operación.
      await client.query(
        `UPDATE central_sessions
            SET diferencia_centimos = 0, ultima_version = $2, actualizado_en_ms = $3
          WHERE session_id = $1`,
        [e.sessionId, e.aggregateVersion, ahora]
      );
      return "APLICADO";

    default:
      return "APLICADO";
  }
}

/** Alta y último latido de la caja. Todo evento pasa por aquí. */
async function tocarCaja(client: PoolClient, e: EventoParaEnviar, ahora: number): Promise<void> {
  if (e.registerId == null) return;
  await client.query(
    `INSERT INTO central_registers
       (register_id, empresa_id, centro_id, ultima_actividad_ms, actualizado_en_ms)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (register_id) DO UPDATE
       SET ultima_actividad_ms = GREATEST(
             COALESCE(central_registers.ultima_actividad_ms, 0), EXCLUDED.ultima_actividad_ms),
           -- El taller se refresca con el del evento: si la caja se reasignó,
           -- la posición actual la manda el último hecho conocido.
           centro_id = EXCLUDED.centro_id,
           actualizado_en_ms = EXCLUDED.actualizado_en_ms`,
    [e.registerId, e.empresaId, e.centroId, e.ocurridoEnMs, ahora]
  );

  if (e.tipo === "SESSION_OPENED" && e.sessionId != null) {
    await client.query(
      `UPDATE central_registers SET jornada_abierta_id = $2 WHERE register_id = $1`,
      [e.registerId, e.sessionId]
    );
  }
}

async function proyectarCaja(
  client: PoolClient,
  e: EventoParaEnviar,
  ahora: number
): Promise<ResultadoIngesta> {
  const d = e.datos ?? {};
  const importe = Number(d.importeCentimos ?? 0);

  const cierres = Array.isArray(d.cierres) ? (d.cierres as number[]) : [];

  /*
   * El desglose de origen: qué jornada puso cuánto.
   *
   * Se acepta también la forma vieja —solo la lista de ids en `cierres`— porque
   * los eventos ya emitidos ANTES de esta fase siguen en la cola y hay que
   * poder ingerirlos. Un evento es un hecho del pasado: el formato puede
   * crecer, pero lo ya escrito no se reescribe. De ahí que se lea lo que haya y
   * se rellene con lo que falte.
   */
  const origen: { sessionId: number; fecha: string | null; importeCentimos: number }[] =
    Array.isArray(d.origen)
      ? (d.origen as { sessionId: number; fecha: string | null; importeCentimos: number }[])
      : cierres.map((id) => ({ sessionId: id, fecha: null, importeCentimos: 0 }));

  if (e.tipo === "BANK_DEPOSIT_CREATED") {
    await client.query(
      `UPDATE central_registers
          SET ingresos_bancarios = ingresos_bancarios + 1,
              ingresado_centimos = ingresado_centimos + $2,
              actualizado_en_ms = $3
        WHERE register_id = $1`,
      [e.registerId, importe, ahora]
    );
    /*
     * Los cierres que entran en el ingreso quedan conciliados: su importe «para
     * el banco» ya no está en la tienda. Sin esto, la posición global seguiría
     * contando billetes que están en el banco desde hace semanas.
     */
    if (cierres.length > 0) {
      await client.query(
        `UPDATE central_sessions SET conciliada = true, actualizado_en_ms = $2
          WHERE session_id = ANY($1::int[])`,
        [cierres, ahora]
      );
    }

    await client.query(
      `INSERT INTO central_bank_deposits
         (deposit_id, empresa_id, centro_id, register_id, numero, fecha, referencia,
          importe_centimos, total_cierres_centimos, remanente_anterior_centimos,
          remanente_nuevo_centimos, estado, creado_en_ms, actualizado_en_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CONFIRMADO',$12,$13)
       ON CONFLICT (deposit_id) DO UPDATE
         SET estado = 'CONFIRMADO', anulado_motivo = NULL, anulado_en_ms = NULL,
             /*
              * Se refrescan también los datos y no solo el estado. Antes el
              * conflicto solo tocaba el estado, así que un ingreso que YA
              * estaba proyectado se quedaba con su fecha vieja para siempre:
              * reenviarlo no lo arreglaba, y esa es justo la vía por la que se
              * repara lo que Central no vio en su momento.
              *
              * COALESCE y no asignación directa: un evento reenviado sin un
              * dato no debe borrar el que ya hay. Solo rellena huecos y
              * actualiza lo que trae.
              */
             numero = COALESCE(EXCLUDED.numero, central_bank_deposits.numero),
             fecha = COALESCE(EXCLUDED.fecha, central_bank_deposits.fecha),
             referencia = COALESCE(EXCLUDED.referencia, central_bank_deposits.referencia),
             importe_centimos = EXCLUDED.importe_centimos,
             actualizado_en_ms = EXCLUDED.actualizado_en_ms`,
      [
        Number(d.depositId ?? 0),
        e.empresaId,
        e.centroId,
        e.registerId,
        d.numero ?? null,
        d.fecha ?? null,
        d.referencia ?? null,
        importe,
        num(d.totalCierresCentimos),
        num(d.remanenteAnteriorCentimos),
        num(d.remanenteNuevoCentimos),
        e.ocurridoEnMs,
        ahora,
      ]
    );

    for (const o of origen) {
      await client.query(
        `INSERT INTO central_deposit_sources
           (deposit_id, session_id, empresa_id, fecha, importe_centimos)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (deposit_id, session_id) DO NOTHING`,
        [Number(d.depositId ?? 0), o.sessionId, e.empresaId, o.fecha ?? null, o.importeCentimos]
      );
    }
  } else if (e.tipo === "BANK_DEPOSIT_COMPLETED") {
    /*
     * La fecha real del banco, que se sabe al volver de ingresar y no al
     * preparar la bolsa. Es lo que separa «pendiente de confirmar» de
     * «confirmado», así que sin esto Central contradice a la caja.
     *
     * Solo se tocan los campos que el hecho trae. Si llega antes que el alta
     * —la cola no garantiza orden entre agregados distintos—, el UPDATE no
     * encuentra fila y no hace nada; el alta la creará después con su fecha.
     */
    await client.query(
      `UPDATE central_bank_deposits
          SET fecha = COALESCE($2::date, fecha),
              referencia = COALESCE($3, referencia),
              actualizado_en_ms = $4
        WHERE deposit_id = $1`,
      [Number(d.depositId ?? 0), d.fecha ?? null, d.referencia ?? null, ahora]
    );
  } else if (e.tipo === "BANK_DEPOSIT_VOIDED") {
    // Anular resta: el ingreso dejó de existir y la posición de la red no
    // puede seguir contándolo. El evento de alta sigue en `central_events`,
    // así que la historia no se pierde — lo que cambia es el saldo.
    await client.query(
      `UPDATE central_registers
          SET ingresos_bancarios = GREATEST(0, ingresos_bancarios - 1),
              ingresado_centimos = ingresado_centimos - $2,
              actualizado_en_ms = $3
        WHERE register_id = $1`,
      [e.registerId, importe, ahora]
    );
    // Y los cierres vuelven a estar pendientes: su dinero está otra vez en la
    // tienda, así que la posición global tiene que volver a contarlo.
    if (cierres.length > 0) {
      await client.query(
        `UPDATE central_sessions SET conciliada = false, actualizado_en_ms = $2
          WHERE session_id = ANY($1::int[])`,
        [cierres, ahora]
      );
    }

    /*
     * El ingreso se marca anulado, no se borra, y su desglose de origen se
     * queda: es la misma regla que aplica la caja. Lo que existió consta, y lo
     * que cambia es que deja de contar.
     */
    await client.query(
      `UPDATE central_bank_deposits
          SET estado = 'ANULADO', anulado_motivo = $2, anulado_en_ms = $3, actualizado_en_ms = $3
        WHERE deposit_id = $1`,
      [Number(d.depositId ?? 0), d.motivo ?? null, ahora]
    );
  }

  return "APLICADO";
}
