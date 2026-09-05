/**
 * Analiza los documentos que van llegando a la bandeja de AutoScan.
 *
 * Lo importante de este fichero es lo que NO tiene: ni una línea de análisis.
 * Llama a `escanearFactura`, la misma que usa la subida manual, con
 * `sessionId: null`. AutoScan es una puerta de entrada, no un cerebro
 * paralelo, y dos motores de lectura de facturas darían dos respuestas
 * distintas para el mismo papel el día que uno se toque y el otro no.
 *
 *     SUBIDA MANUAL ────┐
 *                       ├──▶ escanearFactura(...)
 *     AUTOSCAN ─────────┘
 *
 * Sigue la forma del worker de la ERP (`server/cash/erp/worker.ts`): un
 * temporizador, un lote pequeño y ninguna infraestructura nueva. El día que
 * haga falta algo más serio, se cambia aquí y en un solo sitio.
 */

import pool from "../../db.ts";
import { escanearFactura } from "../invoice-scan/service.ts";
import { leerDocumento } from "../storage.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";

/** Cada cuánto mira si hay trabajo. */
const CADA_MS = 15_000;

/** Cuántos por vuelta. Cada uno es una llamada a la IA, que cuesta dinero. */
const LOTE = 3;

/**
 * Coge UN documento pendiente y lo marca como en curso, atómicamente.
 *
 * El `WHERE estado = 'PENDIENTE'` dentro del propio UPDATE es lo que impide
 * que dos instancias analicen el mismo: en Render hay varias, y quien no
 * reciba fila es que no la tenía.
 */
async function cogerUno(): Promise<{
  id: number;
  empresaId: string;
  ruta: string;
  nombre: string;
  mime: string;
} | null> {
  const { rows } = await pool.query(
    `UPDATE cash_autoscan_inbox
        SET estado = 'ANALIZANDO', intentos = intentos + 1
      WHERE id = (
        SELECT id FROM cash_autoscan_inbox
         WHERE estado = 'PENDIENTE'
         ORDER BY recibido_at_ms
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, empresa_id, ruta, nombre_original, mime`,
    []
  );
  const r = rows[0];
  return r
    ? { id: r.id, empresaId: r.empresa_id, ruta: r.ruta, nombre: r.nombre_original, mime: r.mime }
    : null;
}

/** Analiza uno. Nunca lanza: un documento roto no puede parar la cola. */
async function analizar(d: {
  id: number;
  empresaId: string;
  ruta: string;
  nombre: string;
  mime: string;
}): Promise<void> {
  try {
    const contenido = await leerDocumento(d.ruta);
    if (!contenido) {
      throw new Error("El documento ya no está en el almacenamiento.");
    }

    /*
     * `sessionId: null` es el punto de todo esto. La factura llegó a las 20:40
     * con la caja cerrada y no pertenece a ninguna jornada; inventarle una
     * sería meter dinero en un cierre que no lo vio.
     *
     * `userId: null` por lo mismo: no lo subió nadie, lo dejó un escáner.
     */
    const propuesta = await escanearFactura({
      empresaId: d.empresaId,
      userId: null,
      sessionId: null,
      fichero: { originalname: d.nombre, mimetype: d.mime, buffer: contenido },
    });

    await pool.query(
      `UPDATE cash_autoscan_inbox
          SET estado = 'LISTO', scan_id = $2, analizado_at_ms = $3, error = NULL
        WHERE id = $1 AND estado = 'ANALIZANDO'`,
      [d.id, propuesta.scanId, Date.now()]
    );

    await registrarAuditoria({
      empresaId: d.empresaId,
      userId: null,
      accion: "cash.autoscan.document_ready",
      entidad: "cash_autoscan_inbox",
      entidadId: String(d.id),
      // Ni el contenido del documento ni lo que leyó la IA: solo qué pasó.
      detalle: { scanId: propuesta.scanId },
    });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "Error analizando el documento";
    await pool.query(
      `UPDATE cash_autoscan_inbox
          SET estado = 'FALLIDO', error = $2, analizado_at_ms = $3
        WHERE id = $1 AND estado = 'ANALIZANDO'`,
      [d.id, motivo.slice(0, 500), Date.now()]
    );
    await registrarAuditoria({
      empresaId: d.empresaId,
      userId: null,
      accion: "cash.autoscan.document_failed",
      entidad: "cash_autoscan_inbox",
      entidadId: String(d.id),
      detalle: { motivo: motivo.slice(0, 200) },
    });
  }
}

/** Una vuelta. Exportada para poder probarla sin temporizadores. */
export async function procesarPendientes(limite = LOTE): Promise<number> {
  let hechos = 0;
  for (let i = 0; i < limite; i++) {
    const uno = await cogerUno();
    if (!uno) break;
    await analizar(uno);
    hechos++;
  }
  return hechos;
}

let temporizador: NodeJS.Timeout | null = null;

export function arrancarWorkerAutoScan(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void procesarPendientes().catch((e) => {
      console.error("Mobilink Cash: worker de AutoScan:", e);
    });
  }, CADA_MS);
  // No mantiene el proceso vivo por su cuenta.
  temporizador.unref?.();
  console.log("Mobilink Cash: worker de AutoScan arrancado");
}

export function pararWorkerAutoScan(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
