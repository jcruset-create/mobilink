/**
 * Snapshot inmutable de una tarificación, y modificaciones manuales.
 *
 * La pregunta que hay que poder responder dentro de tres años no es «cuánto
 * costó» —eso está en los totales— sino «POR QUÉ costó eso», con el tarifario
 * de entonces y no con el de ahora. Por eso el snapshot no guarda referencias:
 * guarda los valores. Si mañana se archiva la versión, se sube el nocturno o
 * se borra una regla, la asistencia de ayer sigue explicándose sola.
 *
 * Y por eso también los importes viajan como TEXTO. Un `bigint` no cabe en
 * JSON y un `number` volvería a meter la coma flotante que se ha quitado a
 * propósito en todo el motor.
 */

import { formatear, type Dinero } from "./money.ts";
import type {
  Aviso, EtapaTarifa, LineaPrecio, ResultadoTarifa,
} from "./types.ts";

export interface SnapshotTarifa {
  engineVersion: string;
  pricingRequestId: string;
  etapa: EtapaTarifa;
  estado: string;
  calculadoEnMs: number;

  contexto: {
    assistanceId: number;
    serviceTypeCode: string;
    vehicleTypeCode: string;
    atMs: number;
    timezone: string;
    fechaLocal: string;
    horaLocal: string;
    tipoDia: string;
    franja: string | null;
    zona: string | null;
    distanciaKm: number | null;
    origenDistancia: string | null;
    duracionMin: number | null;
  };

  venta: LadoSnapshot | null;
  compra: LadoSnapshot | null;

  totales: {
    compra: string | null;
    venta: string | null;
    margen: string | null;
    margenPct: string | null;
    currency: string;
  };

  lineas: LineaSnapshot[];
  avisos: Aviso[];
}

interface LadoSnapshot {
  contractId: number;
  tariffPlanId: number;
  tariffPlanName: string;
  tariffVersionId: number;
  version: string;
  reglaId: number | null;
  reglaCode: string | null;
  reglaNombre: string | null;
  distanciaIncluidaKm: number | null;
  tiempoIncluidoMin: number | null;
  currency: string;
}

interface LineaSnapshot {
  numero: number;
  tipo: string;
  conceptCode: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  compraUnitaria: string | null;
  ventaUnitaria: string | null;
  compraTotal: string | null;
  ventaTotal: string | null;
  saleRuleId: number | null;
  purchaseRuleId: number | null;
}

const texto = (d: Dinero | null): string | null => (d == null ? null : formatear(d, 4));

export function construirSnapshot(r: ResultadoTarifa, ctx: {
  assistanceId: number; serviceTypeCode: string; vehicleTypeCode: string;
  atMs: number; timezone: string; durationMin: number | null;
}, calculadoEnMs: number): SnapshotTarifa {
  const lado = (l: ResultadoTarifa["venta"], incluidoKm: number | null, incluidoMin: number | null): LadoSnapshot | null =>
    l == null ? null : {
      contractId: l.contractId,
      tariffPlanId: l.tariffPlanId,
      tariffPlanName: l.tariffPlanName,
      tariffVersionId: l.tariffVersionId,
      version: l.version,
      reglaId: l.regla?.id ?? null,
      reglaCode: l.regla?.code ?? null,
      reglaNombre: l.regla?.name ?? null,
      distanciaIncluidaKm: incluidoKm,
      tiempoIncluidoMin: incluidoMin,
      currency: l.currency,
    };

  return {
    engineVersion: r.engineVersion,
    pricingRequestId: r.pricingRequestId,
    etapa: r.etapa,
    estado: r.estado,
    calculadoEnMs,
    contexto: {
      assistanceId: ctx.assistanceId,
      serviceTypeCode: ctx.serviceTypeCode,
      vehicleTypeCode: ctx.vehicleTypeCode,
      atMs: ctx.atMs,
      timezone: ctx.timezone,
      fechaLocal: r.explicacion.fechaLocal,
      horaLocal: r.explicacion.horaLocal,
      tipoDia: r.explicacion.tipoDia,
      franja: r.explicacion.franja,
      zona: r.explicacion.zona,
      distanciaKm: r.explicacion.distanciaKm,
      origenDistancia: r.explicacion.origenDistancia,
      duracionMin: ctx.durationMin,
    },
    venta: lado(r.venta, r.explicacion.distanciaIncluidaKm, r.explicacion.tiempoIncluidoMin),
    compra: lado(r.compra, r.explicacion.distanciaIncluidaKm, r.explicacion.tiempoIncluidoMin),
    totales: {
      compra: texto(r.compraTotal),
      venta: texto(r.ventaTotal),
      margen: texto(r.margen),
      margenPct: texto(r.margenPct),
      currency: r.currency,
    },
    lineas: r.lineas.map((l) => ({
      numero: l.numero,
      tipo: l.tipo,
      conceptCode: l.conceptCode,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      compraUnitaria: texto(l.compraUnitaria),
      ventaUnitaria: texto(l.ventaUnitaria),
      compraTotal: texto(l.compraTotal),
      ventaTotal: texto(l.ventaTotal),
      saleRuleId: l.saleRuleId,
      purchaseRuleId: l.purchaseRuleId,
    })),
    avisos: r.avisos,
  };
}

// ---------------------------------------------------------------------------

/**
 * Modificación manual de un importe.
 *
 * Nunca se sustituye un precio en silencio: se guarda el anterior, el nuevo,
 * el motivo y quién lo autorizó. Sin motivo no hay modificación, y no por
 * burocracia: dentro de seis meses, cuando el cliente pregunte por qué esa
 * asistencia costó 300 en vez de 331, el motivo es la única respuesta posible.
 */
export interface Override {
  priceLineId?: number | null;
  campo: "saleTotal" | "purchaseTotal" | "saleUnitPrice" | "purchaseUnitPrice";
  valorAnterior: Dinero | null;
  valorNuevo: Dinero;
  motivo: string;
  autorizadoPorUserId: number | null;
  autorizadoPorNombre: string | null;
  autorizadoEnMs: number;
}

export function validarOverride(o: Partial<Override>): string | null {
  if (o.valorNuevo == null) return "El importe nuevo es obligatorio";
  if (!o.motivo || !o.motivo.trim()) return "El motivo es obligatorio";
  if (o.motivo.trim().length < 5) return "El motivo tiene que explicar algo";
  if (o.autorizadoPorUserId == null) return "Falta quién lo autoriza";
  return null;
}

/**
 * Aplica las modificaciones a las líneas y devuelve las líneas resultantes.
 * No muta las originales: el snapshot de antes del override tiene que seguir
 * siendo válido.
 */
export function aplicarOverrides(lineas: LineaPrecio[], overrides: Override[]): LineaPrecio[] {
  return lineas.map((l) => {
    const suyos = overrides.filter((o) => o.priceLineId === l.numero);
    if (suyos.length === 0) return l;
    const copia: LineaPrecio = { ...l, metadata: { ...l.metadata } };
    for (const o of suyos) {
      switch (o.campo) {
        case "saleTotal": copia.ventaTotal = o.valorNuevo; break;
        case "purchaseTotal": copia.compraTotal = o.valorNuevo; break;
        case "saleUnitPrice": copia.ventaUnitaria = o.valorNuevo; break;
        case "purchaseUnitPrice": copia.compraUnitaria = o.valorNuevo; break;
      }
    }
    copia.metadata.overrides = suyos.map((o) => ({
      campo: o.campo,
      anterior: texto(o.valorAnterior),
      nuevo: texto(o.valorNuevo),
      motivo: o.motivo,
      por: o.autorizadoPorNombre,
      enMs: o.autorizadoEnMs,
    }));
    return copia;
  });
}
