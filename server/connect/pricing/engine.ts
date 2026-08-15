/**
 * El motor de tarifas.
 *
 * Recibe la configuración ya cargada y devuelve el precio con sus líneas, sus
 * avisos y su explicación. **No toca la base de datos**: eso es del
 * repositorio. Así todo lo que decide precios se prueba sin levantar nada, que
 * es lo que permite cubrir los casos que de otra forma nadie probaría —el
 * cambio de hora, Navidad a medianoche, el empate entre dos reglas—.
 *
 * Dos ideas gobiernan el diseño:
 *
 * 1. **El tarifario no sabe si es de compra o de venta.** Una regla da UN
 *    importe; el papel lo pone el contrato que apunta al tarifario. El motor
 *    se ejecuta dos veces sobre la misma asistencia, con la misma lógica y
 *    distinto contrato, y el margen es la resta. Por eso una central puede
 *    comprar y vender con el mismo tarifario sin duplicarlo.
 *
 * 2. **Desconocido no es cero.** Si falta el tarifario de compra, la venta se
 *    calcula igual, la compra queda nula y el margen indeterminado, con su
 *    aviso. Un cero ahí sería un margen inventado del 100 %.
 */

import { clasesDeDia, describirDia, type DiaCalendario } from "./calendar.ts";
import {
  calcularExtra, debeCobrarse, esError, unidadesExcedidas,
  type Extra, type TipoDisparo,
} from "./extras.ts";
import {
  CERO, aDinero, multiplicar, aCantidad, porcentajeDe, redondearCentimos, type Dinero,
} from "./money.ts";
import { resolverRegla, type ContextoRegla, type ReglaTarifa } from "./rules.ts";
import { resolverPrecioNeumatico, type CatalogoNeumaticos, type PosicionNeumatico } from "./tires.ts";
import { instanteLocal } from "./time.ts";
import { describirFranja, franjasAplicables, type FranjaHoraria } from "./timeBands.ts";
import {
  VERSION_MOTOR,
  type Aviso, type CodigoAviso, type ContextoTarifa, type EstadoTarifa,
  type EtapaTarifa, type ExplicacionTarifa, type LadoResuelto, type LineaPrecio,
  type ResultadoTarifa, type TipoLinea,
} from "./types.ts";

/** Regla del tarifario tal y como la guarda la base, con sus importes. */
export interface ReglaConImporte extends ReglaTarifa {
  amount: string | number | null;
  includedDistanceKm?: string | number | null;
  includedDurationMin?: number | null;
  extraDistanceExtraId?: number | null;
  extraDurationExtraId?: number | null;
  extraTriggerType?: TipoDisparo | null;
  extraThresholdPercent?: string | number | null;
}

/** Todo lo que hace falta de un lado (venta o compra) para calcular. */
export interface ConfiguracionLado {
  contractId: number;
  tariffPlanId: number;
  tariffPlanName: string;
  tariffVersionId: number;
  version: string;
  currency: string;
  reglas: ReglaConImporte[];
  extras: Extra[];
  /** Catálogo de precios de neumático de esta versión tarifaria. */
  catalogoNeumaticos?: CatalogoNeumaticos;
}

export interface ConfiguracionTarifa {
  franjas: FranjaHoraria[];
  calendario: DiaCalendario[];
  venta: ConfiguracionLado | null;
  compra: ConfiguracionLado | null;
  /** Nombre de la zona, solo para la explicación. */
  nombreZona?: string | null;
}

export interface OpcionesMotor {
  etapa: EtapaTarifa;
  pricingRequestId: string;
  /** Regla de venta ya bloqueada: en el cierre no se vuelve a resolver. */
  reglaVentaBloqueadaId?: number | null;
  reglaCompraBloqueadaId?: number | null;
}

// ---------------------------------------------------------------------------

interface ResueltoLado {
  lado: LadoResuelto | null;
  regla: ReglaConImporte | null;
  avisos: Aviso[];
  descartes: string[];
}

function resolverLado(
  cfg: ConfiguracionLado | null,
  ctxRegla: ContextoRegla,
  papel: "sale" | "purchase",
  reglaBloqueadaId: number | null | undefined,
): ResueltoLado {
  if (!cfg) {
    return {
      lado: null, regla: null, descartes: [],
      avisos: [{
        codigo: papel === "sale" ? "SALE_TARIFF_NOT_FOUND" : "PURCHASE_TARIFF_NOT_FOUND",
        lado: papel,
      }],
    };
  }

  const lado: LadoResuelto = {
    contractId: cfg.contractId,
    tariffPlanId: cfg.tariffPlanId,
    tariffPlanName: cfg.tariffPlanName,
    tariffVersionId: cfg.tariffVersionId,
    version: cfg.version,
    regla: null,
    currency: cfg.currency,
  };

  /*
   * En el cierre no se vuelve a resolver la regla: se usa la que se bloqueó al
   * dar la orden de salida. Es lo que hace que un servicio pedido el viernes a
   * las 22:17 siga siendo nocturno aunque el técnico termine el sábado por la
   * mañana, que es el compromiso contractual.
   */
  if (reglaBloqueadaId != null) {
    const bloqueada = cfg.reglas.find((r) => r.id === reglaBloqueadaId) ?? null;
    if (bloqueada) {
      lado.regla = bloqueada;
      return { lado, regla: bloqueada, avisos: [], descartes: [] };
    }
    // La regla bloqueada ya no existe (se archivó la versión). No se
    // reinventa el precio: a revisión manual.
    return {
      lado, regla: null, descartes: [],
      avisos: [{ codigo: "NO_MATCHING_RULE", lado: papel, detalle: `regla bloqueada ${reglaBloqueadaId} no encontrada` }],
    };
  }

  const r = resolverRegla(cfg.reglas, ctxRegla);
  lado.regla = r.regla;
  return {
    lado,
    regla: (r.regla as ReglaConImporte) ?? null,
    avisos: r.avisos.map((c) => ({ codigo: c as CodigoAviso, lado: papel })),
    descartes: [],
  };
}

// ---------------------------------------------------------------------------

export function calcularTarifa(
  ctx: ContextoTarifa,
  cfg: ConfiguracionTarifa,
  opciones: OpcionesMotor,
): ResultadoTarifa {
  const avisos: Aviso[] = [];
  const instante = instanteLocal(ctx.atMs, ctx.timezone);

  // ── Contexto común a los dos lados ──────────────────────────────────────
  const franjas = franjasAplicables(cfg.franjas, instante);
  const dia = clasesDeDia(instante.fecha, cfg.calendario, ctx.lugar);
  for (const a of dia.avisos) avisos.push({ codigo: a as CodigoAviso });

  if (ctx.zoneIds.length === 0 && cfg.nombreZona == null) {
    // Sin zona no fallan las reglas sin zona, pero sí las que la exigen.
    avisos.push({ codigo: "ZONE_NOT_RESOLVED" });
  }

  const ctxRegla: ContextoRegla = {
    serviceTypeCode: ctx.serviceTypeCode,
    vehicleTypeCode: ctx.vehicleTypeCode,
    zoneIds: ctx.zoneIds,
    timeBandIds: franjas.map((f) => f.id),
    dayClasses: dia.clases,
    distanceKm: ctx.distanceKm,
    durationMin: ctx.durationMin,
  };

  /*
   * El lado de compra puede tener MÁS clases de día que el de venta.
   *
   * Si en el pueblo del taller es fiesta local, ese taller trabaja en festivo y
   * lo factura como tal, aunque para el cliente de la central sea un martes
   * cualquiera. Es la única asimetría deliberada entre los dos lados, y por eso
   * va con su propio aviso: un forfait de compra más caro que el de venta sin
   * explicación parece un error de configuración.
   */
  const extraTaller = (ctx.clasesDiaTaller ?? []).filter((c) => !dia.clases.includes(c));
  const ctxCompra: ContextoRegla = extraTaller.length === 0 ? ctxRegla : {
    ...ctxRegla,
    // El genérico 'holiday' al final: si adelantara a 'holiday_local', una
    // regla de festivo local dejaría de ser la más específica.
    dayClasses: [
      ...extraTaller.filter((c) => c !== "holiday"),
      ...ctxRegla.dayClasses,
      ...(extraTaller.includes("holiday") ? ["holiday"] : []),
    ],
  };

  const venta = resolverLado(cfg.venta, ctxRegla, "sale", opciones.reglaVentaBloqueadaId);
  const compra = resolverLado(cfg.compra, ctxCompra, "purchase", opciones.reglaCompraBloqueadaId);
  avisos.push(...venta.avisos, ...compra.avisos);

  /*
   * Se avisa solo si el festivo del taller ha CAMBIADO algo. Un 25 de diciembre
   * el taller también está de fiesta local, pero ese día los dos lados cobran
   * festivo igual: avisarlo sería ruido, y un aviso que casi siempre sale deja
   * de leerse.
   */
  if (extraTaller.length > 0 && cfg.compra) {
    const sinTaller = resolverLado(cfg.compra, ctxRegla, "purchase", opciones.reglaCompraBloqueadaId);
    if (sinTaller.regla?.id !== compra.regla?.id) {
      avisos.push({
        codigo: "WORKSHOP_HOLIDAY", lado: "purchase",
        detalle: `El taller está de festivo (${extraTaller.filter((c) => c !== "holiday").join(", ")}): ` +
                 `su lado de compra pasa de "${sinTaller.regla?.name ?? "sin regla"}" a ` +
                 `"${compra.regla?.name ?? "sin regla"}" aunque para el cliente no sea festivo`,
      });
    }
  }

  // ── Líneas ──────────────────────────────────────────────────────────────
  const lineas: LineaPrecio[] = [];
  let numero = 0;
  const nuevaLinea = (l: Omit<LineaPrecio, "numero">): LineaPrecio => {
    const linea = { ...l, numero: ++numero };
    lineas.push(linea);
    return linea;
  };

  const forfaitVenta = venta.regla ? aDinero(venta.regla.amount) : null;
  const forfaitCompra = compra.regla ? aDinero(compra.regla.amount) : null;

  if (ctx.cancelado) {
    anadirCancelacion(nuevaLinea, cfg, forfaitVenta, forfaitCompra, avisos);
  } else if (forfaitVenta != null || forfaitCompra != null) {
    nuevaLinea({
      tipo: "FORFAIT",
      conceptCode: venta.regla?.code ?? compra.regla?.code ?? null,
      descripcion: venta.regla?.name ?? compra.regla?.name ?? "Forfait",
      cantidad: 1,
      unidad: "servicio",
      compraUnitaria: forfaitCompra,
      ventaUnitaria: forfaitVenta,
      compraTotal: forfaitCompra,
      ventaTotal: forfaitVenta,
      saleRuleId: venta.regla?.id ?? null,
      purchaseRuleId: compra.regla?.id ?? null,
      extraId: null,
      metadata: {},
    });
  }

  /*
   * Los suplementos de kilómetros y tiempo solo se calculan al cerrar: en la
   * estimación y en el bloqueo todavía no se ha recorrido nada y cobrarlos
   * sería adivinar.
   */
  if (opciones.etapa === "final" && !ctx.cancelado) {
    anadirSuplemento(nuevaLinea, cfg, venta.regla, compra.regla, "EXTRA_KM",
      ctx.distanceKm, avisos);
    anadirSuplemento(nuevaLinea, cfg, venta.regla, compra.regla, "EXTRA_TIME",
      ctx.durationMin, avisos);
    anadirConceptos(nuevaLinea, cfg, ctx, avisos);
  }

  // ── Totales ─────────────────────────────────────────────────────────────
  const ventaTotal = totalDe(lineas, "ventaTotal", venta.lado != null && venta.regla != null);
  const compraTotal = totalDe(lineas, "compraTotal", compra.lado != null && compra.regla != null);
  const margen = ventaTotal != null && compraTotal != null ? ventaTotal - compraTotal : null;
  const margenPct = margen != null && ventaTotal != null ? porcentajeDe(margen, ventaTotal) : null;

  const explicacion: ExplicacionTarifa = {
    tarifario: venta.lado?.tariffPlanName ?? compra.lado?.tariffPlanName ?? null,
    version: venta.lado?.version ?? compra.lado?.version ?? null,
    regla: venta.regla?.name ?? compra.regla?.name ?? null,
    fechaLocal: instante.fecha,
    horaLocal: instante.hora,
    zonaHoraria: ctx.timezone,
    franja: franjas[0] ? describirFranja(franjas[0]) : null,
    tipoDia: describirDia(dia),
    zona: cfg.nombreZona ?? null,
    distanciaKm: ctx.distanceKm,
    origenDistancia: ctx.distanceSource,
    distanciaIncluidaKm: numeroDe(venta.regla?.includedDistanceKm ?? compra.regla?.includedDistanceKm),
    tiempoIncluidoMin: venta.regla?.includedDurationMin ?? compra.regla?.includedDurationMin ?? null,
    descartes: [],
  };

  return {
    etapa: opciones.etapa,
    estado: estadoDe(ventaTotal, compraTotal, avisos, lineas),
    currency: venta.lado?.currency ?? compra.lado?.currency ?? "EUR",
    compraTotal,
    ventaTotal,
    margen,
    margenPct,
    venta: venta.lado,
    compra: compra.lado,
    lineas,
    avisos,
    explicacion,
    engineVersion: VERSION_MOTOR,
    pricingRequestId: opciones.pricingRequestId,
  };
}

// ---------------------------------------------------------------------------

type Anadir = (l: Omit<LineaPrecio, "numero">) => LineaPrecio;

/**
 * Suma de una columna. Si el lado no se ha podido resolver devuelve null:
 * sumar las líneas de un lado que no existe daría cero, y cero es un precio.
 */
function totalDe(lineas: LineaPrecio[], columna: "ventaTotal" | "compraTotal", resuelto: boolean): Dinero | null {
  if (!resuelto) return null;
  let total = CERO;
  let alguna = false;
  for (const l of lineas) {
    const v = l[columna];
    if (v != null) { total += v; alguna = true; }
  }
  return alguna ? redondearCentimos(total) : CERO;
}

/**
 * `manual_review` significa que nadie debería facturar esto sin mirarlo.
 * `partial` es que el precio está pero incompleto —venta sí y compra no, por
 * ejemplo—, que es corriente y no bloquea nada.
 *
 * Una línea SIN precio de venta es motivo de revisión aunque el total salga:
 * el total sale porque esa línea suma cero, y la factura iría corta por un
 * importe que nadie ha decidido. Es el caso del neumático sin precio, que los
 * tarifarios suelen mandar a revisión manual expresamente.
 */
function estadoDe(
  venta: Dinero | null,
  compra: Dinero | null,
  avisos: Aviso[],
  lineas: LineaPrecio[],
): EstadoTarifa {
  const graves: CodigoAviso[] = ["NO_TARIFF_PLAN", "NO_MATCHING_RULE", "FORMULA_NOT_SUPPORTED"];
  const lineaSinPrecio = lineas.some((l) => l.ventaTotal == null);
  if (venta == null || lineaSinPrecio || avisos.some((a) => graves.includes(a.codigo))) {
    return "manual_review";
  }
  if (compra == null || lineas.some((l) => l.compraTotal == null) || avisos.length > 0) return "partial";
  return "ok";
}

function numeroDe(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Suplemento de kilómetros o de tiempo, con su regla de disparo. */
function anadirSuplemento(
  anadir: Anadir,
  cfg: ConfiguracionTarifa,
  reglaVenta: ReglaConImporte | null,
  reglaCompra: ReglaConImporte | null,
  tipo: Extract<TipoLinea, "EXTRA_KM" | "EXTRA_TIME">,
  real: number | null,
  avisos: Aviso[],
): void {
  const esKm = tipo === "EXTRA_KM";

  const calcular = (regla: ReglaConImporte | null, cfgLado: ConfiguracionLado | null) => {
    if (!regla || !cfgLado || real == null) return null;
    const incluido = esKm
      ? numeroDe(regla.includedDistanceKm)
      : regla.includedDurationMin ?? null;
    const extraId = esKm ? regla.extraDistanceExtraId : regla.extraDurationExtraId;
    if (extraId == null) return null;
    const extra = cfgLado.extras.find((e) => e.id === extraId);
    if (!extra) return null;

    const dispara = debeCobrarse(
      regla.extraTriggerType ?? "ALWAYS",
      numeroDe(regla.extraThresholdPercent),
      incluido,
      real,
    );
    if (!dispara) return null;

    const unidades = unidadesExcedidas(incluido, real);
    const r = calcularExtra(extra, { unidades });
    if (esError(r)) {
      avisos.push({ codigo: r.error as CodigoAviso, detalle: extra.code });
      return null;
    }
    return { extra, ...r };
  };

  const v = calcular(reglaVenta, cfg.venta);
  const c = calcular(reglaCompra, cfg.compra);
  if (!v && !c) return;

  const modelo = v ?? c!;
  anadir({
    tipo,
    conceptCode: modelo.extra.code,
    descripcion: modelo.extra.name,
    cantidad: modelo.cantidad,
    unidad: modelo.unidad,
    compraUnitaria: c?.importeUnitario ?? null,
    ventaUnitaria: v?.importeUnitario ?? null,
    compraTotal: c?.total ?? null,
    ventaTotal: v?.total ?? null,
    saleRuleId: reglaVenta?.id ?? null,
    purchaseRuleId: reglaCompra?.id ?? null,
    extraId: modelo.extra.id,
    metadata: { real, incluido: esKm ? numeroDe(reglaVenta?.includedDistanceKm ?? reglaCompra?.includedDistanceKm) : (reglaVenta?.includedDurationMin ?? reglaCompra?.includedDurationMin ?? null) },
  });
}

/** Neumáticos, materiales y demás conceptos declarados al cerrar. */
function anadirConceptos(
  anadir: Anadir,
  cfg: ConfiguracionTarifa,
  ctx: ContextoTarifa,
  avisos: Aviso[],
): void {
  for (const c of ctx.conceptos ?? []) {
    const cantidad = c.cantidad ?? 1;

    if (c.neumatico) {
      const peticion = {
        medida: c.neumatico.medida,
        marca: c.neumatico.marca,
        posicion: (c.neumatico.posicion ?? "ANY") as PosicionNeumatico,
      };
      const resolver = (l: ConfiguracionLado | null) =>
        l?.catalogoNeumaticos ? resolverPrecioNeumatico(peticion, l.catalogoNeumaticos) : null;
      const rv = resolver(cfg.venta);
      const rc = resolver(cfg.compra);
      const pv = rv?.importe ?? null;
      const pc = rc?.importe ?? null;
      for (const aviso of [...(rv?.avisos ?? []), ...(rc?.avisos ?? [])]) {
        // No se inventa un precio de neumático: va a revisión.
        if (!avisos.some((a) => a.codigo === aviso)) {
          avisos.push({ codigo: aviso as CodigoAviso, detalle: peticion.medida });
        }
      }
      anadir({
        tipo: c.tipo,
        conceptCode: c.extraCode ?? null,
        descripcion: c.descripcion ?? `${c.neumatico.medida} ${c.neumatico.marca ?? ""}`.trim(),
        cantidad,
        unidad: "ud",
        compraUnitaria: pc,
        ventaUnitaria: pv,
        compraTotal: pc != null ? redondearCentimos(multiplicar(pc, aCantidad(cantidad))) : null,
        ventaTotal: pv != null ? redondearCentimos(multiplicar(pv, aCantidad(cantidad))) : null,
        saleRuleId: null, purchaseRuleId: null, extraId: null,
        metadata: { neumatico: c.neumatico, tarifa: rv?.explicacion ?? rc?.explicacion ?? null },
      });
      continue;
    }

    // Concepto que viene de un extra del tarifario
    const buscar = (l: ConfiguracionLado | null) =>
      c.extraCode ? l?.extras.find((e) => e.code === c.extraCode) ?? null : null;
    const ev = buscar(cfg.venta);
    const ec = buscar(cfg.compra);
    if (!ev && !ec) {
      avisos.push({ codigo: "EXTRA_AMOUNT_MISSING", detalle: c.extraCode ?? c.tipo });
      continue;
    }
    const rv = ev ? calcularExtra(ev, { unidades: cantidad }) : null;
    const rc = ec ? calcularExtra(ec, { unidades: cantidad }) : null;
    for (const r of [rv, rc]) if (r && esError(r)) avisos.push({ codigo: r.error as CodigoAviso });

    const modelo = (rv && !esError(rv) ? rv : null) ?? (rc && !esError(rc) ? rc : null);
    if (!modelo) continue;

    anadir({
      tipo: c.tipo,
      conceptCode: (ev ?? ec)!.code,
      descripcion: c.descripcion ?? (ev ?? ec)!.name,
      cantidad: modelo.cantidad,
      unidad: modelo.unidad,
      compraUnitaria: rc && !esError(rc) ? rc.importeUnitario : null,
      ventaUnitaria: rv && !esError(rv) ? rv.importeUnitario : null,
      compraTotal: rc && !esError(rc) ? rc.total : null,
      ventaTotal: rv && !esError(rv) ? rv.total : null,
      saleRuleId: null, purchaseRuleId: null,
      extraId: (ev ?? ec)!.id,
      metadata: {},
    });
  }
}

/**
 * Anulación: sustituye al forfait, no se suma a él. Si el servicio se anula
 * después de la orden de salida se cobra un porcentaje de lo que habría
 * costado, y ese porcentaje también es configuración.
 */
function anadirCancelacion(
  anadir: Anadir,
  cfg: ConfiguracionTarifa,
  forfaitVenta: Dinero | null,
  forfaitCompra: Dinero | null,
  avisos: Aviso[],
): void {
  const extraVenta = cfg.venta?.extras.find((e) => e.code === "CANCELLATION") ?? null;
  const extraCompra = cfg.compra?.extras.find((e) => e.code === "CANCELLATION") ?? null;
  if (!extraVenta && !extraCompra) {
    avisos.push({ codigo: "EXTRA_AMOUNT_MISSING", detalle: "CANCELLATION" });
    return;
  }

  const calcular = (extra: Extra | null, base: Dinero | null) => {
    if (!extra || base == null) return null;
    const r = calcularExtra(extra, { baseParaPorcentaje: base });
    if (esError(r)) { avisos.push({ codigo: r.error as CodigoAviso, detalle: extra.code }); return null; }
    return r;
  };

  const v = calcular(extraVenta, forfaitVenta);
  const c = calcular(extraCompra, forfaitCompra);
  if (!v && !c) return;

  anadir({
    tipo: "CANCELLATION",
    conceptCode: (extraVenta ?? extraCompra)!.code,
    descripcion: (extraVenta ?? extraCompra)!.name,
    cantidad: 1,
    unidad: "servicio",
    compraUnitaria: c?.total ?? null,
    ventaUnitaria: v?.total ?? null,
    compraTotal: c?.total ?? null,
    ventaTotal: v?.total ?? null,
    saleRuleId: null, purchaseRuleId: null,
    extraId: (extraVenta ?? extraCompra)!.id,
    metadata: { forfaitVenta: forfaitVenta?.toString() ?? null },
  });
}
