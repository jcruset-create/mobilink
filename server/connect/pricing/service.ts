/**
 * Las tres etapas de la tarificación, con su persistencia.
 *
 *   estimar()   antes de asignar, para comparar talleres. No se guarda por
 *               taller: solo la del taller elegido.
 *   bloquear()  al dar la orden de salida. Congela la regla y el forfait.
 *   finalizar() al cerrar. Regulariza con lo que ha pasado de verdad.
 *
 * Ninguna sobrescribe a otra: son tres filas. Eso es lo que permite enseñar
 * después qué se estimó, qué se comprometió y qué se acabó cobrando, y por qué
 * no coinciden.
 *
 * `bloquear()` y `finalizar()` son idempotentes. No por elegancia: la orden de
 * salida puede dispararse dos veces —un doble clic, un reintento de la API, dos
 * instancias procesando el mismo evento— y dos forfaits distintos para el mismo
 * servicio serían un problema contractual, no un fallo técnico.
 */

import crypto from "node:crypto";
import db from "../../db.ts";
import { calcularTarifa } from "./engine.ts";
import { cargarConfiguracion } from "./repository.ts";
import { construirSnapshot } from "./snapshot.ts";
import { formatear, type Dinero } from "./money.ts";
import type { ConceptoServicio, ContextoTarifa, EtapaTarifa, ResultadoTarifa } from "./types.ts";

export interface DatosAsistencia {
  id: number;
  controlCenterId: number | null;
  clientId: number | null;
  workshopId: number | null;
  providerCompanyId: number | null;
  serviceType: string;
  vehicleTypeCode: string;
  serviceOrderedAtMs: number | null;
  createdAtMs: number;
  lugar: { country?: string | null; regionCode?: string | null; provinceCode?: string | null; postalCode?: string | null; municipality?: string | null };
}

export interface OpcionesTarificacion {
  distanceKm?: number | null;
  distanceSource?: "estimated" | "routed" | null;
  durationMin?: number | null;
  conceptos?: ConceptoServicio[];
  cancelado?: boolean;
  /** Taller alternativo, para comparar candidatos sin tocar la asistencia. */
  workshopId?: number | null;
  providerCompanyId?: number | null;
  userId?: number | null;
}

/** Lo mínimo que hace falta de la asistencia para tarificar. */
export async function datosDeAsistencia(assistanceId: number): Promise<DatosAsistencia | null> {
  const r = await db.query(
    `SELECT ca.id, ca."controlCenterId", ca."clientId", ca."workshopId", ca."serviceType",
            ca.vehicle, ca."serviceOrderedAtMs", ca."createdAtMs",
            w."providerCompanyId", w.province AS "workshopProvince",
            b."tipoVehiculo", b."ubicacionIncidencia"
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_assistance_backoffice b ON b."assistanceId" = ca.id
      WHERE ca.id = $1`,
    [assistanceId],
  );
  const a = r.rows[0];
  if (!a) return null;

  const vehiculo = leerJson(a.vehicle);
  return {
    id: a.id,
    controlCenterId: a.controlCenterId ?? null,
    clientId: a.clientId ?? null,
    workshopId: a.workshopId ?? null,
    providerCompanyId: a.providerCompanyId ?? null,
    serviceType: a.serviceType,
    // El tipo del vehículo averiado, no el de la unidad que va a atenderlo
    vehicleTypeCode: String(vehiculo.type ?? a.tipoVehiculo ?? "car"),
    serviceOrderedAtMs: a.serviceOrderedAtMs == null ? null : Number(a.serviceOrderedAtMs),
    createdAtMs: Number(a.createdAtMs),
    /*
     * La asistencia no guarda provincia ni país: solo coordenadas y dirección.
     * Hasta que se resuelva la zona por geocodificación inversa se asume
     * España, que es donde opera la red hoy. Está declarado como limitación
     * en docs/PRICING_auditoria_arquitectura.md §3.5.
     */
    lugar: { country: "ES", province: null, municipality: null } as DatosAsistencia["lugar"],
  };
}

function leerJson(v: unknown): Record<string, any> {
  if (v == null) return {};
  if (typeof v !== "string") return v as Record<string, any>;
  try { return JSON.parse(v); } catch { return {}; }
}

/**
 * Instante contractual de la asistencia.
 *
 * Es la orden de salida al taller, no la creación ni la llegada del técnico.
 * Si todavía no se ha dado (estimación previa a la asignación), se usa el
 * momento actual: se está estimando lo que costaría salir ahora.
 */
export function instanteContractual(a: DatosAsistencia, ahoraMs = Date.now()): number {
  return a.serviceOrderedAtMs ?? ahoraMs;
}

async function tarificar(
  a: DatosAsistencia,
  etapa: EtapaTarifa,
  opciones: OpcionesTarificacion,
  atMs: number,
  bloqueada?: { saleRuleId: number | null; purchaseRuleId: number | null },
): Promise<ResultadoTarifa | null> {
  if (a.controlCenterId == null) return null;

  const workshopId = opciones.workshopId ?? a.workshopId;
  const providerCompanyId = opciones.providerCompanyId ?? a.providerCompanyId;

  const { configuracion, timezone } = await cargarConfiguracion({
    controlCenterId: a.controlCenterId,
    clientId: a.clientId,
    providerCompanyId,
    workshopId,
    atMs,
    lugar: a.lugar,
  });

  const ctx: ContextoTarifa = {
    assistanceId: a.id,
    controlCenterId: a.controlCenterId,
    clientId: a.clientId,
    workshopId,
    providerCompanyId,
    serviceTypeCode: a.serviceType,
    vehicleTypeCode: a.vehicleTypeCode,
    atMs,
    timezone,
    lugar: { municipality: a.lugar.municipality ?? null },
    zoneIds: (configuracion as any).zoneIds ?? [],
    distanceKm: opciones.distanceKm ?? null,
    distanceSource: opciones.distanceSource ?? null,
    durationMin: opciones.durationMin ?? null,
    conceptos: opciones.conceptos,
    cancelado: opciones.cancelado,
  };

  return calcularTarifa(ctx, configuracion, {
    etapa,
    pricingRequestId: crypto.randomUUID(),
    reglaVentaBloqueadaId: bloqueada?.saleRuleId ?? null,
    reglaCompraBloqueadaId: bloqueada?.purchaseRuleId ?? null,
  });
}

/**
 * Estimación para un taller candidato. No guarda nada: se llama una vez por
 * candidato y guardar diez estimaciones que nadie va a mirar solo ensucia.
 */
export async function estimar(
  assistanceId: number,
  opciones: OpcionesTarificacion = {},
): Promise<ResultadoTarifa | null> {
  const a = await datosDeAsistencia(assistanceId);
  if (!a) return null;
  return tarificar(a, "estimate", opciones, instanteContractual(a));
}

/**
 * Bloqueo del forfait al dar la orden de salida.
 *
 * Idempotente: si ya hay una tarifa bloqueada se devuelve esa. Un segundo
 * intento no puede producir un forfait distinto para el mismo servicio.
 */
export async function bloquear(
  assistanceId: number,
  opciones: OpcionesTarificacion = {},
): Promise<ResultadoTarifa | null> {
  const yaEsta = await leerEtapa(assistanceId, "locked");
  if (yaEsta) return yaEsta;

  const a = await datosDeAsistencia(assistanceId);
  if (!a) return null;

  const ahora = Date.now();
  // La orden de salida es AHORA si no se había registrado antes
  const atMs = a.serviceOrderedAtMs ?? ahora;
  if (a.serviceOrderedAtMs == null) {
    await db.query(
      `UPDATE connect_assistances SET "serviceOrderedAtMs" = $1 WHERE id = $2 AND "serviceOrderedAtMs" IS NULL`,
      [atMs, assistanceId],
    );
  }

  const r = await tarificar(a, "locked", opciones, atMs);
  if (!r) return null;
  return guardar(a, r, atMs, opciones);
}

/**
 * Cierre: se regulariza con la distancia, el tiempo y los conceptos reales,
 * pero MANTENIENDO la regla bloqueada. Es el compromiso contractual: la tarifa
 * la fijó la orden de salida.
 */
export async function finalizar(
  assistanceId: number,
  opciones: OpcionesTarificacion = {},
): Promise<ResultadoTarifa | null> {
  const yaEsta = await leerEtapa(assistanceId, "final");
  if (yaEsta) return yaEsta;

  const a = await datosDeAsistencia(assistanceId);
  if (!a) return null;

  const bloqueada = await db.query(
    `SELECT "saleRuleId", "purchaseRuleId" FROM connect_assistance_pricings
      WHERE "assistanceId" = $1 AND stage = 'locked'`,
    [assistanceId],
  );

  const atMs = instanteContractual(a);
  const r = await tarificar(a, "final", opciones, atMs, {
    saleRuleId: bloqueada.rows[0]?.saleRuleId ?? null,
    purchaseRuleId: bloqueada.rows[0]?.purchaseRuleId ?? null,
  });
  if (!r) return null;
  return guardar(a, r, atMs, opciones);
}

// ---------------------------------------------------------------------------

async function guardar(
  a: DatosAsistencia,
  r: ResultadoTarifa,
  atMs: number,
  opciones: OpcionesTarificacion,
): Promise<ResultadoTarifa> {
  const ahora = Date.now();
  const snapshot = construirSnapshot(r, {
    assistanceId: a.id,
    serviceTypeCode: a.serviceType,
    vehicleTypeCode: a.vehicleTypeCode,
    atMs,
    timezone: r.explicacion.zonaHoraria,
    durationMin: opciones.durationMin ?? null,
  }, ahora);

  const t = (d: Dinero | null) => (d == null ? null : formatear(d, 4));

  /*
   * ON CONFLICT DO NOTHING sobre (asistencia, etapa): si dos procesos llegan a
   * la vez, uno inserta y el otro se encuentra la fila. Ninguno de los dos
   * falla y los dos devuelven el mismo forfait.
   */
  const ins = await db.query(
    `INSERT INTO connect_assistance_pricings
       ("controlCenterId", "assistanceId", stage, status,
        "saleContractId", "saleVersionId", "saleRuleId",
        "purchaseContractId", "purchaseVersionId", "purchaseRuleId",
        "purchaseTotal", "saleTotal", "grossMargin", "grossMarginPct", currency,
        snapshot, warnings, "engineVersion", "pricingRequestId", "computedAtMs", "computedByUserId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT ("assistanceId", stage) DO NOTHING
     RETURNING id`,
    [
      a.controlCenterId, a.id, r.etapa, r.estado,
      r.venta?.contractId ?? null, r.venta?.tariffVersionId ?? null, r.venta?.regla?.id ?? null,
      r.compra?.contractId ?? null, r.compra?.tariffVersionId ?? null, r.compra?.regla?.id ?? null,
      t(r.compraTotal), t(r.ventaTotal), t(r.margen), t(r.margenPct), r.currency,
      JSON.stringify(snapshot), JSON.stringify(r.avisos),
      r.engineVersion, r.pricingRequestId, ahora, opciones.userId ?? null,
    ],
  );

  if (!ins.rows[0]) {
    // Otro proceso llegó antes: manda el suyo.
    const existente = await leerEtapa(a.id, r.etapa);
    return existente ?? r;
  }

  const pricingId = ins.rows[0].id;
  for (const l of r.lineas) {
    await db.query(
      `INSERT INTO connect_assistance_price_lines
         ("controlCenterId", "pricingId", "lineNumber", kind, "conceptCode", description,
          quantity, unit, "purchaseUnitPrice", "saleUnitPrice", "purchaseTotal", "saleTotal",
          "saleRuleId", "purchaseRuleId", "extraId", metadata, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        a.controlCenterId, pricingId, l.numero, l.tipo, l.conceptCode, l.descripcion,
        l.cantidad, l.unidad, t(l.compraUnitaria), t(l.ventaUnitaria),
        t(l.compraTotal), t(l.ventaTotal),
        l.saleRuleId, l.purchaseRuleId, l.extraId, JSON.stringify(l.metadata), ahora,
      ],
    );
  }

  /*
   * Se refleja en las columnas de siempre para que la facturación y las
   * pantallas actuales sigan funcionando sin cambios. El motor manda, pero no
   * rompe lo que ya había.
   */
  if (r.etapa === "locked" && r.ventaTotal != null) {
    await db.query(
      `UPDATE connect_assistances
          SET "estimatedCost" = $1, "costDetail" = $2, "costCurrency" = $3, "updatedAtMs" = $4
        WHERE id = $5`,
      [t(r.ventaTotal), explicacionCorta(r), r.currency, ahora, a.id],
    );
  }
  if (r.etapa === "final" && r.ventaTotal != null) {
    await db.query(
      `UPDATE connect_assistances SET "finalCost" = $1, "costCurrency" = $2, "updatedAtMs" = $3 WHERE id = $4`,
      [t(r.ventaTotal), r.currency, ahora, a.id],
    );
  }

  return r;
}

function explicacionCorta(r: ResultadoTarifa): string {
  const e = r.explicacion;
  return [
    e.tarifario && e.version ? `${e.tarifario} ${e.version}` : null,
    e.regla,
    e.distanciaIncluidaKm != null ? `incluye ${e.distanciaIncluidaKm} km` : null,
    e.tiempoIncluidoMin != null ? `${e.tiempoIncluidoMin} min` : null,
  ].filter(Boolean).join(" · ");
}

/** Etapa ya calculada, reconstruida desde el snapshot que se guardó. */
export async function leerEtapa(assistanceId: number, etapa: EtapaTarifa): Promise<ResultadoTarifa | null> {
  const r = await db.query(
    `SELECT snapshot FROM connect_assistance_pricings WHERE "assistanceId" = $1 AND stage = $2`,
    [assistanceId, etapa],
  );
  if (!r.rows[0]) return null;
  return desdeSnapshot(leerJson(r.rows[0].snapshot));
}

/** Todas las etapas de una asistencia, para la ficha y la explicación. */
export async function etapasDe(assistanceId: number): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT p.stage, p.status, p."saleTotal", p."purchaseTotal", p."grossMargin",
            p."grossMarginPct", p.currency, p.snapshot, p.warnings, p."computedAtMs",
            COALESCE(json_agg(json_build_object(
              'lineNumber', l."lineNumber", 'kind', l.kind, 'description', l.description,
              'quantity', l.quantity, 'unit', l.unit,
              'saleUnitPrice', l."saleUnitPrice", 'saleTotal', l."saleTotal",
              'purchaseUnitPrice', l."purchaseUnitPrice", 'purchaseTotal', l."purchaseTotal"
            ) ORDER BY l."lineNumber") FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM connect_assistance_pricings p
       LEFT JOIN connect_assistance_price_lines l ON l."pricingId" = p.id
      WHERE p."assistanceId" = $1
      GROUP BY p.id
      ORDER BY CASE p.stage WHEN 'estimate' THEN 1 WHEN 'locked' THEN 2 ELSE 3 END`,
    [assistanceId],
  );
  return r.rows;
}

/**
 * Reconstruye el resultado desde el snapshot guardado.
 *
 * Se lee del snapshot y no de las tablas de configuración a propósito: si
 * mañana se archiva la versión o se cambia un precio, la asistencia de ayer
 * tiene que seguir explicándose con lo que se le aplicó entonces.
 */
function desdeSnapshot(s: any): ResultadoTarifa {
  const d = (v: string | null) => (v == null ? null : BigInt(Math.round(Number(v) * 10_000)));
  return {
    etapa: s.etapa, estado: s.estado, currency: s.totales?.currency ?? "EUR",
    compraTotal: d(s.totales?.compra ?? null),
    ventaTotal: d(s.totales?.venta ?? null),
    margen: d(s.totales?.margen ?? null),
    margenPct: d(s.totales?.margenPct ?? null),
    venta: s.venta ? {
      contractId: s.venta.contractId, tariffPlanId: s.venta.tariffPlanId,
      tariffPlanName: s.venta.tariffPlanName, tariffVersionId: s.venta.tariffVersionId,
      version: s.venta.version, currency: s.venta.currency,
      regla: s.venta.reglaId ? { id: s.venta.reglaId, code: s.venta.reglaCode, name: s.venta.reglaNombre, priority: 0 } : null,
    } : null,
    compra: s.compra ? {
      contractId: s.compra.contractId, tariffPlanId: s.compra.tariffPlanId,
      tariffPlanName: s.compra.tariffPlanName, tariffVersionId: s.compra.tariffVersionId,
      version: s.compra.version, currency: s.compra.currency,
      regla: s.compra.reglaId ? { id: s.compra.reglaId, code: s.compra.reglaCode, name: s.compra.reglaNombre, priority: 0 } : null,
    } : null,
    lineas: (s.lineas ?? []).map((l: any) => ({
      numero: l.numero, tipo: l.tipo, conceptCode: l.conceptCode, descripcion: l.descripcion,
      cantidad: l.cantidad, unidad: l.unidad,
      compraUnitaria: d(l.compraUnitaria), ventaUnitaria: d(l.ventaUnitaria),
      compraTotal: d(l.compraTotal), ventaTotal: d(l.ventaTotal),
      saleRuleId: l.saleRuleId, purchaseRuleId: l.purchaseRuleId, extraId: null, metadata: {},
    })),
    avisos: s.avisos ?? [],
    explicacion: {
      tarifario: s.venta?.tariffPlanName ?? s.compra?.tariffPlanName ?? null,
      version: s.venta?.version ?? s.compra?.version ?? null,
      regla: s.venta?.reglaNombre ?? s.compra?.reglaNombre ?? null,
      fechaLocal: s.contexto?.fechaLocal ?? "", horaLocal: s.contexto?.horaLocal ?? "",
      zonaHoraria: s.contexto?.timezone ?? "Europe/Madrid",
      franja: s.contexto?.franja ?? null, tipoDia: s.contexto?.tipoDia ?? "",
      zona: s.contexto?.zona ?? null,
      distanciaKm: s.contexto?.distanciaKm ?? null,
      origenDistancia: s.contexto?.origenDistancia ?? null,
      distanciaIncluidaKm: s.venta?.distanciaIncluidaKm ?? null,
      tiempoIncluidoMin: s.venta?.tiempoIncluidoMin ?? null,
      descartes: [],
    },
    engineVersion: s.engineVersion, pricingRequestId: s.pricingRequestId,
  };
}
