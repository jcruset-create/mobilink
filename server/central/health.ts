/**
 * Observabilidad de MC Central: qué está pasando ahora mismo.
 *
 * No es un `ok: true`. Un servicio que contesta «ok» mientras tiene ocho mil
 * eventos sin enviar está mintiendo con la verdad: el proceso vive, pero el
 * sistema no funciona. Lo que se mide aquí es **el atasco**, que es la única
 * avería que este módulo puede tener sin que nadie se entere.
 *
 * Las tres colas —eventos hacia Central, avisos por correo, webhooks— fallan de
 * la misma manera: en silencio y creciendo. La caja sigue cobrando, las
 * pantallas siguen pintando, y lo único que pasa es que Central se va quedando
 * atrás. Un vistazo a esta pantalla lo enseña en un segundo.
 *
 * **El retraso se mide en tiempo, no en filas.** Cien eventos pendientes de
 * hace treinta segundos es una tarde normal; tres pendientes desde hace dos
 * días es una integración rota. El número de filas solo no distingue una cosa
 * de la otra.
 */

import pool from "../db.ts";

export type EstadoCola = {
  nombre: string;
  pendientes: number;
  enError: number;
  /** Antigüedad del pendiente MÁS VIEJO, en minutos. Es lo que importa. */
  retrasoMinutos: number | null;
  estado: "OK" | "RETRASO" | "ATASCADA";
};

export type Salud = {
  estado: "OK" | "DEGRADADO" | "ATASCADO";
  baseDeDatosMs: number;
  colas: EstadoCola[];
  ultimoEventoRecibidoMs: number | null;
  comprobadoEnMs: number;
};

/** A partir de aquí hay retraso; a partir del segundo, atasco. */
const RETRASO_MIN = 15;
const ATASCO_MIN = 120;

function clasificar(retrasoMinutos: number | null, enError: number): EstadoCola["estado"] {
  // Una fila en error terminal no se resuelve sola: es atasco desde el minuto
  // uno, por muy poquitas que sean.
  if (enError > 0) return "ATASCADA";
  if (retrasoMinutos == null) return "OK";
  if (retrasoMinutos >= ATASCO_MIN) return "ATASCADA";
  if (retrasoMinutos >= RETRASO_MIN) return "RETRASO";
  return "OK";
}

async function cola(
  nombre: string,
  tabla: string,
  columnaFecha: string,
  pendientes: string[],
  errores: string[]
): Promise<EstadoCola> {
  const lista = (xs: string[]) => xs.map((x) => `'${x}'`).join(",");
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE estado IN (${lista(pendientes)}))::int AS pendientes,
       COUNT(*) FILTER (WHERE estado IN (${lista(errores)}))::int AS en_error,
       MIN(${columnaFecha}) FILTER (WHERE estado IN (${lista(pendientes)})) AS mas_viejo
     FROM ${tabla}`
  );

  const r = rows[0];
  const retraso =
    r.mas_viejo == null ? null : Math.round((Date.now() - Number(r.mas_viejo)) / 60_000);

  return {
    nombre,
    pendientes: r.pendientes,
    enError: r.en_error,
    retrasoMinutos: retraso,
    estado: clasificar(retraso, r.en_error),
  };
}

/**
 * Foto del estado. Nunca revienta: si una consulta falla, esa cola sale como
 * atascada y las demás se siguen midiendo.
 *
 * Es deliberado. La pantalla que enseña esto es a la que se va cuando algo va
 * mal, y que se caiga entera porque una tabla no responde es justo lo contrario
 * de lo que hace falta en ese momento.
 */
export async function salud(): Promise<Salud> {
  const t0 = Date.now();
  await pool.query("SELECT 1");
  const baseDeDatosMs = Date.now() - t0;

  const definiciones: [string, string, string, string[], string[]][] = [
    [
      "Eventos hacia Central",
      "cash_event_outbox",
      "created_at_ms",
      ["PENDING", "RETRY_PENDING"],
      ["ERROR"],
    ],
    ["Avisos por correo", "central_notifications", "creado_en_ms", ["PENDIENTE"], ["ERROR"]],
    [
      "Webhooks",
      "central_webhook_deliveries",
      "creado_en_ms",
      ["PENDIENTE"],
      ["ERROR"],
    ],
    [
      "Sincronización con la ERP",
      "cash_erp_outbox",
      "created_at_ms",
      ["PENDING", "RETRY_PENDING"],
      ["ERROR"],
    ],
  ];

  const colas: EstadoCola[] = [];
  for (const [nombre, tabla, columna, pend, err] of definiciones) {
    try {
      colas.push(await cola(nombre, tabla, columna, pend, err));
    } catch {
      colas.push({
        nombre,
        pendientes: -1,
        enError: -1,
        retrasoMinutos: null,
        estado: "ATASCADA",
      });
    }
  }

  let ultimoEventoRecibidoMs: number | null = null;
  try {
    const { rows } = await pool.query(`SELECT MAX(recibido_en_ms) AS ultimo FROM central_events`);
    ultimoEventoRecibidoMs = rows[0]?.ultimo == null ? null : Number(rows[0].ultimo);
  } catch {
    /* La ingesta puede no haber recibido nada todavía: no es un fallo. */
  }

  const estado = colas.some((c) => c.estado === "ATASCADA")
    ? "ATASCADO"
    : colas.some((c) => c.estado === "RETRASO")
      ? "DEGRADADO"
      : "OK";

  return { estado, baseDeDatosMs, colas, ultimoEventoRecibidoMs, comprobadoEnMs: Date.now() };
}