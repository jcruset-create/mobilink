/**
 * Worker de sincronización con la ERP.
 *
 * Vacía `cash_erp_outbox`: coge los eventos pendientes, los manda por el
 * conector y anota el resultado. Mismo patrón que `IntegrationWorker` del
 * Integration Hub — intervalo, tanda pequeña y reintentos con espera creciente.
 *
 * La regla que gobierna este fichero: **un fallo de la ERP nunca deshace un
 * movimiento de efectivo**. El dinero ya entró o salió del cajón físicamente;
 * lo único que está pendiente es contárselo a la ERP. Si la ERP está caída, el
 * evento se queda en la cola y se reintenta. No hay ningún camino de código que
 * revierta una operación de caja por un error de integración.
 *
 * `FOR UPDATE SKIP LOCKED` para que dos instancias del servidor (Render puede
 * levantar varias) no se peleen por el mismo evento ni se bloqueen entre ellas.
 */

import pool from "../../db.ts";
import { ErrorErpPermanente, type ResultadoOperacionErp } from "./connector.ts";
import { obtenerConectorPorClave } from "./registry.ts";

const INTERVALO_MS = 30_000;
const TANDA = 10;
const MAX_INTENTOS = 8;

/** Espera creciente: 30 s, 1 min, 2 min… hasta una hora. */
function proximoIntentoMs(intentos: number): number {
  const espera = Math.min(30_000 * 2 ** intentos, 3_600_000);
  return Date.now() + espera;
}

type FilaOutbox = {
  id: string;
  empresa_id: string;
  operation_id: number | null;
  connector_key: string | null;
  evento: string;
  idempotency_key: string;
  payload: {
    externalSystem?: string;
    externalDocumentId?: string;
    operacionNumero?: string;
    importeCentimos?: number;
    fechaIso?: string;
    formasPago?: { forma: string; importeCentimos: number; referencia: string | null }[];
    motivo?: string;
  };
  intentos: number;
};

/**
 * Procesa una tanda de eventos pendientes. Devuelve cuántos ha tratado, que es
 * lo que usan las pruebas para saber que el ciclo hizo algo.
 */
export async function procesarOutbox(limite = TANDA): Promise<number> {
  const client = await pool.connect();
  let tratados = 0;

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<FilaOutbox>(
      `SELECT * FROM cash_erp_outbox
        WHERE estado IN ('PENDING','RETRY_PENDING')
          AND (proximo_intento_ms IS NULL OR proximo_intento_ms <= $1)
        ORDER BY id
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [Date.now(), limite]
    );

    for (const fila of rows) {
      tratados++;
      await procesarEvento(client, fila);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[Mobilink Cash] error procesando el outbox:", e);
  } finally {
    client.release();
  }

  return tratados;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function procesarEvento(client: any, fila: FilaOutbox): Promise<void> {
  const ahora = Date.now();
  const intentos = fila.intentos + 1;

  const conector = fila.connector_key ? obtenerConectorPorClave(fila.connector_key) : null;
  if (!conector) {
    // La ERP se ha desconfigurado después de encolar. No es un fallo que se
    // arregle reintentando: se cancela el evento y se deja constancia.
    await marcar(client, fila, "CANCELLED", intentos, "No hay conector de ERP configurado", null, ahora);
    return;
  }

  const p = fila.payload ?? {};
  const entrada: ResultadoOperacionErp = {
    externalSystem: p.externalSystem ?? "",
    externalDocumentId: p.externalDocumentId ?? "",
    operacionNumero: p.operacionNumero ?? fila.idempotency_key,
    importeCentimos: p.importeCentimos ?? 0,
    fechaIso: p.fechaIso ?? new Date(ahora).toISOString(),
    formasPago: (p.formasPago ?? []).map((f) => ({
      forma: f.forma as ResultadoOperacionErp["formasPago"][number]["forma"],
      importeCentimos: f.importeCentimos,
      referencia: f.referencia,
    })),
  };

  try {
    let respuesta;
    switch (fila.evento) {
      case "COLLECTION_COMPLETED":
        if (!conector.registrarCobro) throw new ErrorErpPermanente("El conector no sabe registrar cobros");
        respuesta = await conector.registrarCobro(entrada);
        break;
      case "PAYMENT_COMPLETED":
        if (!conector.registrarPago) throw new ErrorErpPermanente("El conector no sabe registrar pagos");
        respuesta = await conector.registrarPago(entrada);
        break;
      case "COLLECTION_REVERSED":
        if (!conector.anularCobro) throw new ErrorErpPermanente("El conector no sabe anular cobros");
        respuesta = await conector.anularCobro(entrada.operacionNumero, p.motivo ?? "");
        break;
      case "PAYMENT_REVERSED":
        if (!conector.anularPago) throw new ErrorErpPermanente("El conector no sabe anular pagos");
        respuesta = await conector.anularPago(entrada.operacionNumero, p.motivo ?? "");
        break;
      default:
        throw new ErrorErpPermanente(`Evento de integración desconocido: ${fila.evento}`);
    }

    if (!respuesta.ok) throw new Error(respuesta.mensaje ?? "La ERP ha rechazado la operación");

    /*
     * `duplicado` no es un error: significa que la ERP ya tenía registrada esta
     * clave de idempotencia. Pasa cuando el envío anterior llegó pero su
     * respuesta se perdió. Se trata como éxito, que es justo lo que evita
     * contabilizar el cobro dos veces.
     */
    await marcar(client, fila, "SYNCED", intentos, null, respuesta, ahora);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    const permanente = e instanceof ErrorErpPermanente;
    const agotado = intentos >= MAX_INTENTOS;

    // ERROR = no se va a reintentar solo; hay que mirarlo desde el panel.
    const estado = permanente || agotado ? "ERROR" : "RETRY_PENDING";
    await marcar(client, fila, estado, intentos, mensaje, null, ahora);
  }
}

async function marcar(
  client: any,
  fila: FilaOutbox,
  estado: string,
  intentos: number,
  error: string | null,
  respuesta: unknown,
  ahora: number
): Promise<void> {
  await client.query(
    `UPDATE cash_erp_outbox
        SET estado = $2, intentos = $3, last_error = $4, response_payload = $5,
            proximo_intento_ms = $6,
            processed_at_ms = CASE WHEN $2 IN ('SYNCED','CANCELLED','ERROR') THEN $7 ELSE processed_at_ms END
      WHERE id = $1`,
    [
      fila.id,
      estado,
      intentos,
      error,
      respuesta ? JSON.stringify(respuesta) : null,
      estado === "RETRY_PENDING" ? proximoIntentoMs(intentos) : null,
      ahora,
    ]
  );

  // El estado de la operación acompaña al del evento: es lo que ve el operador
  // en el histórico sin tener que entrar al panel de integración.
  if (fila.operation_id) {
    const estadoOperacion =
      estado === "SYNCED" ? "SYNCED" : estado === "RETRY_PENDING" ? "RETRY_PENDING" : estado === "CANCELLED" ? "CANCELLED" : "ERROR";
    await client.query(
      `UPDATE cash_operations
          SET erp_sync_status = $2, erp_sync_at_ms = $3, erp_error = $4, updated_at_ms = $3
        WHERE id = $1`,
      [fila.operation_id, estadoOperacion, ahora, error]
    );
  }

  await client.query(
    `INSERT INTO cash_erp_logs
       (empresa_id, direccion, evento, external_system, external_id, mobilink_id,
        estado, intentos, last_error, created_at_ms, processed_at_ms)
     VALUES ($1,'OUT',$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [
      fila.empresa_id,
      fila.evento,
      fila.payload?.externalSystem ?? null,
      fila.payload?.externalDocumentId ?? null,
      fila.idempotency_key,
      estado,
      intentos,
      error,
      ahora,
    ]
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Reencola los eventos en ERROR para que el worker vuelva a intentarlos. */
export async function reintentarErrores(empresaId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE cash_erp_outbox
        SET estado = 'RETRY_PENDING', intentos = 0, proximo_intento_ms = $2, last_error = NULL
      WHERE empresa_id = $1 AND estado = 'ERROR'`,
    [empresaId, Date.now()]
  );
  return rowCount ?? 0;
}

let temporizador: NodeJS.Timeout | null = null;

export function startCashErpWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void procesarOutbox();
  }, INTERVALO_MS);
  // No debe impedir que el proceso termine.
  temporizador.unref?.();
  console.log("Mobilink Cash: worker de sincronización con ERP arrancado");
}

export function stopCashErpWorker(): void {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}
