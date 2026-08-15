/**
 * Precio de un neumático.
 *
 * Dos modelos conviven en el mismo tarifario y hay que resolver los dos:
 *
 *  - NET_PRICE: el precio está escrito. 315/70R22.5 Bridgestone dirección,
 *    460 € de compra y 485,49 € de venta.
 *  - DISCOUNT_FROM_LIST: el precio sale del baremo del fabricante menos un
 *    porcentaje. Baremo 1.000 € con 39 % de descuento = 610 €. El porcentaje
 *    es el DESCUENTO, no el precio: confundirlo cuesta 220 € por neumático.
 *
 * El precio puede colgar de una marca concreta o de un grupo de marcas
 * (PREMIUM, IMPORT_1…), y el grupo pertenece a la VERSIÓN tarifaria, no a la
 * marca: que Hankook sea IMPORT_1 para un cliente no obliga a que lo sea para
 * otro.
 *
 * La medida se normaliza con el mismo código que TyreControl (`shared/medidas`)
 * para que "315/80 R 22,5" y "315/80R22.5" sean la misma y el catálogo de
 * precios pueda cruzarse algún día con el del almacén.
 */

import { medidaCanonica } from "../../../shared/medidas.ts";
import { aDinero, porcentaje, redondearCentimos, restar, type Dinero } from "./money.ts";

export type PosicionNeumatico = "STEER" | "DRIVE" | "TRAILER" | "ANY";
export type ModeloPrecio = "NET_PRICE" | "DISCOUNT_FROM_LIST";

export interface PrecioNeumaticoTarifa {
  id: number;
  /** null = cualquier medida. */
  tireSizeCode?: string | null;
  /** Marca concreta, normalizada en mayúsculas. */
  brandName?: string | null;
  /** O grupo de marcas de esta versión tarifaria. */
  brandGroupCode?: string | null;
  position: PosicionNeumatico;
  priceModel: ModeloPrecio;
  netAmount?: string | number | null;
  discountPercent?: string | number | null;
  manufacturerPriceListId?: number | null;
  priority: number;
  active?: boolean | null;
}

/** Baremo del fabricante, ya acotado a la fecha del servicio. */
export interface BaremoFabricante {
  priceListId: number;
  tireSizeCode: string;
  brandName: string;
  model?: string | null;
  listPrice: string | number;
}

export interface PeticionNeumatico {
  medida: string;
  marca?: string | null;
  posicion?: PosicionNeumatico | null;
  modelo?: string | null;
}

export interface CatalogoNeumaticos {
  precios: PrecioNeumaticoTarifa[];
  /** Marca → grupos a los que pertenece EN ESTA VERSIÓN tarifaria. */
  gruposPorMarca: Map<string, string[]>;
  baremos: BaremoFabricante[];
}

export interface ResultadoNeumatico {
  importe: Dinero | null;
  precio: PrecioNeumaticoTarifa | null;
  /** Baremo usado, si el modelo era por descuento. */
  baremo?: BaremoFabricante | null;
  avisos: string[];
  explicacion: string | null;
}

export function normalizarMarca(v: string | null | undefined): string {
  return String(v ?? "").trim().toUpperCase();
}

/**
 * ¿Este precio del tarifario sirve para lo que se pide?
 *
 * Un precio sin medida vale para cualquier medida, y uno sin marca ni grupo
 * vale para cualquier marca: son los comodines, y como en las reglas, cuantos
 * menos comodines tenga, más específico es.
 */
function aplica(
  p: PrecioNeumaticoTarifa,
  pedido: { medida: string; marca: string; posicion: PosicionNeumatico },
  grupos: string[],
): boolean {
  if (p.active === false) return false;
  if (p.tireSizeCode && medidaCanonica(p.tireSizeCode) !== pedido.medida) return false;
  if (p.brandName && normalizarMarca(p.brandName) !== pedido.marca) return false;
  if (p.brandGroupCode && !grupos.includes(p.brandGroupCode)) return false;
  // 'ANY' en el tarifario vale para cualquier posición; una posición concreta
  // solo para la suya.
  if (p.position !== "ANY" && p.position !== pedido.posicion) return false;
  return true;
}

/** Cuantas menos condiciones en blanco, más específico. */
function especificidad(p: PrecioNeumaticoTarifa): number {
  let n = 0;
  if (p.tireSizeCode) n++;
  // La marca concreta es más específica que el grupo: si el tarifario nombra
  // Bridgestone, quería Bridgestone y no "cualquier premium".
  if (p.brandName) n += 2;
  else if (p.brandGroupCode) n++;
  if (p.position !== "ANY") n++;
  return n;
}

export function compararPrecios(a: PrecioNeumaticoTarifa, b: PrecioNeumaticoTarifa): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ea = especificidad(a);
  const eb = especificidad(b);
  if (ea !== eb) return eb - ea;
  return a.id - b.id;
}

export function resolverPrecioNeumatico(
  peticion: PeticionNeumatico,
  catalogo: CatalogoNeumaticos,
): ResultadoNeumatico {
  const avisos: string[] = [];
  const medida = medidaCanonica(peticion.medida);
  const marca = normalizarMarca(peticion.marca);
  const posicion = (peticion.posicion ?? "ANY") as PosicionNeumatico;
  const grupos = catalogo.gruposPorMarca.get(marca) ?? [];

  const candidatos = catalogo.precios
    .filter((p) => aplica(p, { medida, marca, posicion }, grupos))
    .sort(compararPrecios);

  if (candidatos.length === 0) {
    // No se inventa el precio de un neumático: va a revisión manual.
    return { importe: null, precio: null, avisos: ["TIRE_PRICE_NOT_FOUND"], explicacion: null };
  }

  const [primero, segundo] = candidatos;
  if (segundo &&
      primero.priority === segundo.priority &&
      especificidad(primero) === especificidad(segundo)) {
    avisos.push("AMBIGUOUS_TIRE_PRICE");
  }

  if (primero.priceModel === "NET_PRICE") {
    const importe = aDinero(primero.netAmount ?? null);
    if (importe == null) {
      return { importe: null, precio: primero, avisos: [...avisos, "TIRE_PRICE_NOT_FOUND"], explicacion: null };
    }
    return {
      importe, precio: primero, avisos,
      explicacion: `Precio neto de tarifa (${medida}${marca ? ` ${marca}` : ""}, ${primero.position})`,
    };
  }

  // DISCOUNT_FROM_LIST: hace falta el baremo del fabricante vigente
  const descuento = aDinero(primero.discountPercent ?? null);
  const baremo = buscarBaremo(catalogo.baremos, {
    priceListId: primero.manufacturerPriceListId ?? null,
    medida, marca, modelo: peticion.modelo ?? null,
  });

  if (descuento == null || !baremo) {
    return {
      importe: null, precio: primero, baremo: baremo ?? null,
      avisos: [...avisos, baremo ? "TIRE_PRICE_NOT_FOUND" : "MANUFACTURER_LIST_NOT_FOUND"],
      explicacion: null,
    };
  }

  const listado = aDinero(baremo.listPrice);
  if (listado == null) {
    return { importe: null, precio: primero, baremo, avisos: [...avisos, "TIRE_PRICE_NOT_FOUND"], explicacion: null };
  }

  const importe = redondearCentimos(restar(listado, porcentaje(listado, descuento)));
  return {
    importe, precio: primero, baremo, avisos,
    explicacion: `Baremo ${baremo.brandName} menos ${Number(primero.discountPercent)} % de descuento`,
  };
}

function buscarBaremo(
  baremos: BaremoFabricante[],
  q: { priceListId: number | null; medida: string; marca: string; modelo: string | null },
): BaremoFabricante | null {
  const candidatos = baremos.filter((b) =>
    (q.priceListId == null || b.priceListId === q.priceListId) &&
    medidaCanonica(b.tireSizeCode) === q.medida &&
    normalizarMarca(b.brandName) === q.marca);

  if (candidatos.length === 0) return null;
  if (q.modelo) {
    // El modelo concreto manda sobre la entrada genérica de la medida
    const exacto = candidatos.find((b) => normalizarMarca(b.model) === normalizarMarca(q.modelo));
    if (exacto) return exacto;
  }
  return candidatos.find((b) => !b.model) ?? candidatos[0];
}
