/**
 * La bandeja de excepciones y los importes de la asistencia.
 *
 * La bandeja enseña lo que está atascado, no lo que hay. Un listado de «todas
 * las asistencias» no es una herramienta de trabajo: obliga a mirarlas una a
 * una para encontrar las tres que necesitan algo. Aquí cada cajón responde una
 * pregunta que se puede resolver.
 *
 * Cada consulta es independiente y se limita: una bandeja que tarda en cargar
 * se deja de mirar, y una bandeja que no se mira no sirve de nada.
 */

import db from "../db.ts";
import { registrarEvento } from "../eventlog/servicio.ts";
import {
  MINUTOS_SIN_ACEPTAR,
  calcularMargen,
  facturacionBloqueada,
  nivelDesviacion,
  ordenarCajones,
  type Cajon,
  type Costes,
} from "./dominio.ts";

const TOPE = 100;

export class ErrorExcepciones extends Error {
  codigo: string;
  estado: number;
  constructor(codigo: string, mensaje: string, estado = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

export type Entrada = {
  cajon: Cajon;
  assistanceId: number;
  referencia: string;
  matricula: string | null;
  cliente: string | null;
  detalle: string;
  desdeMs: number | null;
};

/**
 * Llena la bandeja de un taller.
 *
 * `tallerId` nulo significa «todos», que es lo que ve un administrador. No es
 * un descuido: el aislamiento entre talleres de Assist ya lo aplica el guarda
 * de la ruta, y aquí se respeta lo que llegue.
 */
export async function bandejaDe(tallerId: string | null): Promise<{
  total: number;
  porCajon: Record<string, number>;
  data: Entrada[];
}> {
  const now = Date.now();
  const entradas: Entrada[] = [];

  // Filtro de taller reutilizado en todas las consultas.
  const filtro = tallerId == null ? "" : `AND a."tallerId" = ${Number(tallerId)}`;

  /* ── Sin aceptar ──────────────────────────────────────────────────────── */
  const sinAceptar = await db.query(
    `SELECT a.id, a.plate, a."customerName", a."createdAtMs"
       FROM roadside_assistances a
      WHERE a.status = 'pendiente' AND a."createdAtMs" < $1 ${filtro}
      ORDER BY a."createdAtMs" LIMIT $2`,
    [now - MINUTOS_SIN_ACEPTAR * 60_000, TOPE],
  );
  for (const a of sinAceptar.rows) {
    const minutos = Math.round((now - Number(a.createdAtMs)) / 60_000);
    entradas.push(fila("sin_aceptar", a, `Lleva ${minutos} min sin asignar`, Number(a.createdAtMs)));
  }

  /* ── SLA vencido ──────────────────────────────────────────────────────── */
  /*
   * Assist no tiene SLA propio todavía; el que hay es el de la plataforma a la
   * que se subcontrató. Se mira el envío: aceptado hace rato y sin noticias.
   */
  const sla = await db.query(
    `SELECT a.id, a.plate, a."customerName", d."acceptedAtMs", d."lastEvent", dest.name AS destino
       FROM external_dispatches d
       JOIN roadside_assistances a ON a.id = d."sourceAssistanceId"::int
       JOIN external_destinations dest ON dest.id = d."destinationId"
      WHERE d.status = 'ACCEPTED' AND d."acceptedAtMs" < $1
        AND (d."lastEvent" IS NULL OR d."lastEvent" IN ('ACCEPTED','RECEIVED'))
        AND a.status NOT IN ('finalizada','cancelada') ${filtro}
      ORDER BY d."acceptedAtMs" LIMIT $2`,
    [now - 60 * 60_000, TOPE],
  );
  for (const a of sla.rows) {
    entradas.push(fila("sla_vencido", a,
      `${a.destino} la aceptó hace más de una hora y no ha asignado proveedor`,
      a.acceptedAtMs != null ? Number(a.acceptedAtMs) : null));
  }

  /* ── Errores de integración ───────────────────────────────────────────── */
  const errores = await db.query(
    `SELECT a.id, a.plate, a."customerName", d."lastError", d."retryCount", d."lastAttemptAtMs"
       FROM external_dispatches d
       JOIN roadside_assistances a ON a.id = d."sourceAssistanceId"::int
      WHERE d.status = 'ERROR' ${filtro}
      ORDER BY d."lastAttemptAtMs" DESC NULLS LAST LIMIT $1`,
    [TOPE],
  );
  for (const a of errores.rows) {
    entradas.push(fila("error_integracion", a,
      `${a.lastError ?? "Error de envío"} (${a.retryCount} intentos)`,
      a.lastAttemptAtMs != null ? Number(a.lastAttemptAtMs) : null));
  }

  /* ── Avisos sin entregar ──────────────────────────────────────────────── */
  /*
   * Un webhook que no llega es una asistencia cuyo estado no se está
   * actualizando en el otro sistema. Se cuenta aparte de los errores de envío
   * porque se arregla en otro sitio: allí, no aquí.
   */
  const webhooks = await db.query(
    // 'dead' es como el worker marca lo que ya no va a reintentar. Y un
    // 'pending' con muchos intentos lleva horas sin entrar: los dos cuentan.
    `SELECT COUNT(*)::int AS n FROM connect_webhook_deliveries
      WHERE status = 'dead' OR (status = 'pending' AND attempt >= 3)`,
  );
  if (Number(webhooks.rows[0]?.n ?? 0) > 0) {
    entradas.push({
      cajon: "webhook_fallido", assistanceId: 0, referencia: "—",
      matricula: null, cliente: null,
      detalle: `${webhooks.rows[0].n} avisos no se han podido entregar`,
      desdeMs: null,
    });
  }

  /* ── Documentación pendiente ──────────────────────────────────────────── */
  const docs = await db.query(
    `SELECT a.id, a.plate, a."customerName", a."estadoAdmin", a."finishedAtMs",
            r.intentos, r.motivo, r."ultimoError"
       FROM roadside_assistances a
       LEFT JOIN assistance_reminders r
              ON r."sourceSystem" = 'assist' AND r."assistanceId" = a.id::text
             AND r."resueltoAtMs" IS NULL
      WHERE a."estadoAdmin" IN ('PENDIENTE_ALBARAN','PENDIENTE_FACTURA','DOCUMENTACION_COMPLETA')
        ${filtro}
      ORDER BY a."finishedAtMs" NULLS LAST LIMIT $1`,
    [TOPE],
  );
  for (const a of docs.rows) {
    const detalle = a.estadoAdmin === "DOCUMENTACION_COMPLETA"
      ? "Falta validar el coste"
      : a.ultimoError
        ? `Falta el ${a.motivo}: ${a.ultimoError}`
        : `Falta el ${a.motivo ?? "documento"}${a.intentos ? ` · ${a.intentos} avisos sin respuesta` : ""}`;
    entradas.push(fila("documentacion_pendiente", a, detalle,
      a.finishedAtMs != null ? Number(a.finishedAtMs) : null));
  }

  /* ── Coste desviado y facturación bloqueada ───────────────────────────── */
  const costes = await db.query(
    `SELECT id, plate, "customerName", "costePrevisto", "costeAcordado", "costeFinal",
            "importeVenta", "desviacionAprobadaAtMs", "estadoAdmin", "finishedAtMs"
       FROM roadside_assistances a
      WHERE "costeFinal" IS NOT NULL AND "costeAcordado" IS NOT NULL
        AND "costeFinal" > "costeAcordado" AND "facturadaAtMs" IS NULL ${filtro}
      ORDER BY ("costeFinal" - "costeAcordado") DESC LIMIT $1`,
    [TOPE],
  );
  for (const a of costes.rows) {
    const m = calcularMargen(costesDe(a));
    const nivel = nivelDesviacion(m);
    if (nivel === "ninguna") continue;
    const bloqueo = facturacionBloqueada(m, a.desviacionAprobadaAtMs != null);
    entradas.push(fila(
      bloqueo.bloqueada ? "facturacion_bloqueada" : "coste_desviado",
      a,
      bloqueo.motivo ?? `${m.desviacionEuros} € (${m.desviacionPct} %) por encima de lo acordado`,
      a.finishedAtMs != null ? Number(a.finishedAtMs) : null,
    ));
  }

  const porCajon: Record<string, number> = {};
  for (const e of entradas) porCajon[e.cajon] = (porCajon[e.cajon] ?? 0) + 1;

  // Ordenadas por gravedad del cajón y, dentro, por lo que lleva más tiempo
  // esperando: lo que más rabia da es lo que lleva ahí desde el martes.
  const orden = ordenarCajones([...new Set(entradas.map((e) => e.cajon))]);
  entradas.sort((a, b) => {
    const d = orden.indexOf(a.cajon) - orden.indexOf(b.cajon);
    return d !== 0 ? d : (a.desdeMs ?? Infinity) - (b.desdeMs ?? Infinity);
  });

  return { total: entradas.length, porCajon, data: entradas };
}

function fila(cajon: Cajon, a: any, detalle: string, desdeMs: number | null): Entrada {
  return {
    cajon,
    assistanceId: Number(a.id),
    referencia: `AST-${a.id}`,
    matricula: a.plate || null,
    cliente: a.customerName || null,
    detalle,
    desdeMs,
  };
}

function costesDe(a: any): Costes {
  return {
    previsto: a.costePrevisto != null ? Number(a.costePrevisto) : null,
    acordado: a.costeAcordado != null ? Number(a.costeAcordado) : null,
    final: a.costeFinal != null ? Number(a.costeFinal) : null,
    venta: a.importeVenta != null ? Number(a.importeVenta) : null,
  };
}

/* ── Importes de una asistencia ──────────────────────────────────────────── */

export async function importesDe(assistanceId: number) {
  const r = await db.query(
    `SELECT "costePrevisto", "costeAcordado", "costeFinal", "importeVenta", moneda,
            "desviacionAprobadaAtMs", "desviacionAprobadaPor", "estadoAdmin",
            "pedidoCliente", "centroCoste", "referenciaFactura",
            "importeDestino", "conceptoDestino", "impuestosDestino"
       FROM roadside_assistances WHERE id = $1`,
    [assistanceId],
  );
  const a = r.rows[0];
  if (!a) throw new ErrorExcepciones("not_found", "Asistencia no encontrada", 404);

  const costes = costesDe(a);
  const margen = calcularMargen(costes);
  const aprobada = a.desviacionAprobadaAtMs != null;
  return {
    costes,
    moneda: a.moneda ?? "EUR",
    margen,
    nivelDesviacion: nivelDesviacion(margen),
    aprobada,
    aprobadaPor: a.desviacionAprobadaPor ?? null,
    facturacion: facturacionBloqueada(margen, aprobada),
    estadoAdmin: a.estadoAdmin ?? null,
    referencias: {
      pedidoCliente: a.pedidoCliente ?? null,
      centroCoste: a.centroCoste ?? null,
      referenciaFactura: a.referenciaFactura ?? null,
    },
    // Lo que la plataforma externa dice que nos factura: su venta, nuestro coste.
    destino: {
      importe: a.importeDestino != null ? Number(a.importeDestino) : null,
      concepto: a.conceptoDestino ?? null,
      impuestos: a.impuestosDestino != null ? Number(a.impuestosDestino) : null,
    },
  };
}

const CAMPOS_IMPORTE = [
  "costePrevisto", "costeAcordado", "costeFinal", "importeVenta",
  "pedidoCliente", "centroCoste", "referenciaFactura",
] as const;

export async function guardarImportes(
  assistanceId: number,
  cambios: Record<string, unknown>,
  porQuien: string | null,
) {
  const sets: string[] = [];
  const params: unknown[] = [assistanceId];
  for (const campo of CAMPOS_IMPORTE) {
    if (!(campo in cambios)) continue;
    const v = cambios[campo];
    if (campo.startsWith("coste") || campo === "importeVenta") {
      const n = v == null || v === "" ? null : Number(v);
      if (n != null && (!Number.isFinite(n) || n < 0)) {
        throw new ErrorExcepciones("importe_invalido", `${campo} no puede ser negativo`);
      }
      params.push(n);
    } else {
      const s = v == null ? null : String(v).trim() || null;
      params.push(s);
    }
    sets.push(`"${campo}" = $${params.length}`);
  }
  if (sets.length === 0) return importesDe(assistanceId);

  await db.query(`UPDATE roadside_assistances SET ${sets.join(", ")} WHERE id = $1`, params);

  const despues = await importesDe(assistanceId);
  if ("costeFinal" in cambios) {
    await registrarEvento({
      system: "assist", assistanceId, eventType: "COST_CONFIRMED",
      actorType: "user", actorName: porQuien,
      payload: {
        // El margen NO entra en el payload: el diario se enseña y se exporta.
        desviacion: despues.margen.desviacionEuros,
        nivel: despues.nivelDesviacion,
      },
    });
  }
  return despues;
}

/**
 * Aprueba una desviación de coste.
 *
 * Es una decisión con nombre y fecha: es lo que se mira cuando alguien
 * pregunta quién autorizó pagar 200 € de más.
 */
export async function aprobarDesviacion(assistanceId: number, porQuien: string | null) {
  const antes = await importesDe(assistanceId);
  if (antes.nivelDesviacion !== "aprobacion") {
    throw new ErrorExcepciones("sin_desviacion", "Esta asistencia no tiene una desviación que aprobar");
  }
  const now = Date.now();
  await db.query(
    `UPDATE roadside_assistances
        SET "desviacionAprobadaAtMs" = COALESCE("desviacionAprobadaAtMs", $2),
            "desviacionAprobadaPor" = COALESCE("desviacionAprobadaPor", $3)
      WHERE id = $1`,
    [assistanceId, now, porQuien],
  );
  await registrarEvento({
    system: "assist", assistanceId, eventType: "COST_CONFIRMED",
    actorType: "user", actorName: porQuien, occurredAtMs: now,
    payload: { accion: "desviacion_aprobada", desviacion: antes.margen.desviacionEuros },
    dedupeKey: `desviacion-aprobada-${assistanceId}`,
  });
  return importesDe(assistanceId);
}

/**
 * Registra lo que la plataforma externa dice que nos va a facturar.
 *
 * Llega por la integración, con lo que el otro lado tiene permitido mandar:
 * referencia, concepto, importe, moneda e impuestos. **Nunca su coste interno
 * ni su margen** — eso es suyo, igual que el nuestro es nuestro.
 *
 * Se guarda como coste acordado si no había uno: es lo que nos van a cobrar.
 */
export async function registrarImporteDelDestino(
  correlationId: string,
  datos: { importe?: unknown; concepto?: unknown; impuestos?: unknown; moneda?: unknown },
) {
  const d = await db.query(
    `SELECT "sourceAssistanceId" FROM external_dispatches
      WHERE "correlationId" = $1 AND "sourceSystem" = 'assist' ORDER BY id DESC LIMIT 1`,
    [correlationId],
  );
  if (!d.rows[0]) return { aplicado: false, motivo: "correlation_id desconocido" };

  const id = Number(d.rows[0].sourceAssistanceId);
  const importe = datos.importe == null ? null : Number(datos.importe);
  if (importe != null && (!Number.isFinite(importe) || importe < 0)) {
    return { aplicado: false, motivo: "importe no válido" };
  }

  await db.query(
    `UPDATE roadside_assistances
        SET "importeDestino" = $2,
            "conceptoDestino" = $3,
            "impuestosDestino" = $4,
            moneda = COALESCE($5, moneda),
            -- Solo rellena el acordado si estaba vacío: si alguien ya pactó un
            -- precio a mano, lo que diga la integración no lo pisa.
            "costeAcordado" = COALESCE("costeAcordado", $2)
      WHERE id = $1`,
    [id, importe, datos.concepto ? String(datos.concepto).slice(0, 300) : null,
     datos.impuestos == null ? null : Number(datos.impuestos),
     datos.moneda ? String(datos.moneda).slice(0, 3).toUpperCase() : null],
  );

  await registrarEvento({
    system: "assist", assistanceId: id, correlationId,
    eventType: "READY_TO_BILL", actorType: "partner",
    payload: { concepto: datos.concepto ?? null, importe },
    dedupeKey: `importe-destino-${correlationId}`,
  });
  return { aplicado: true, assistanceId: id };
}
