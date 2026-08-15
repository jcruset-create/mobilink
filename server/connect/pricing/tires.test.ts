import { describe, it, expect } from "vitest";
import { formatear } from "./money.ts";
import {
  resolverPrecioNeumatico, type BaremoFabricante, type CatalogoNeumaticos,
  type PrecioNeumaticoTarifa,
} from "./tires.ts";

const neto: PrecioNeumaticoTarifa = {
  id: 1, tireSizeCode: "315/70R22.5", brandName: "BRIDGESTONE", position: "STEER",
  priceModel: "NET_PRICE", netAmount: "485.49", priority: 10,
};
const porGrupo: PrecioNeumaticoTarifa = {
  id: 2, tireSizeCode: "315/70R22.5", brandGroupCode: "PREMIUM", position: "ANY",
  priceModel: "NET_PRICE", netAmount: "450.00", priority: 10,
};
const porDescuento: PrecioNeumaticoTarifa = {
  id: 3, tireSizeCode: "295/80R22.5", brandName: "MICHELIN", position: "ANY",
  priceModel: "DISCOUNT_FROM_LIST", discountPercent: "39", manufacturerPriceListId: 50, priority: 10,
};

const baremos: BaremoFabricante[] = [
  { priceListId: 50, tireSizeCode: "295/80R22.5", brandName: "MICHELIN", listPrice: "1000" },
  { priceListId: 50, tireSizeCode: "295/80R22.5", brandName: "MICHELIN", model: "X MULTI D", listPrice: "1200" },
];

const catalogo: CatalogoNeumaticos = {
  precios: [neto, porGrupo, porDescuento],
  gruposPorMarca: new Map([["BRIDGESTONE", ["PREMIUM"]], ["MICHELIN", ["PREMIUM"]]]),
  baremos,
};

describe("precio de neumático", () => {
  it("precio neto: 315/70R22.5 Bridgestone dirección", () => {
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" }, catalogo);
    expect(formatear(r.importe!)).toBe("485.49");
    expect(r.explicacion).toContain("Precio neto");
  });

  it("la medida se reconoce esté escrita como esté", () => {
    // Misma normalización que TyreControl: si no, el catálogo de precios no
    // cruzaría nunca con el del almacén.
    for (const medida of ["315/70 R 22.5", "315/70r22,5", "  315/70R22.5  "]) {
      const r = resolverPrecioNeumatico({ medida, marca: "bridgestone", posicion: "STEER" }, catalogo);
      expect(formatear(r.importe!)).toBe("485.49");
    }
  });

  it("descuento sobre baremo: 1.000 € menos 39 % = 610 €", () => {
    const r = resolverPrecioNeumatico(
      { medida: "295/80R22.5", marca: "Michelin" }, catalogo);
    expect(formatear(r.importe!)).toBe("610.00");
    expect(r.explicacion).toBe("Baremo MICHELIN menos 39 % de descuento");
  });

  it("el baremo del modelo concreto manda sobre el genérico de la medida", () => {
    // 1.200 € menos 39 % = 732 €
    const r = resolverPrecioNeumatico(
      { medida: "295/80R22.5", marca: "Michelin", modelo: "X Multi D" }, catalogo);
    expect(formatear(r.importe!)).toBe("732.00");
  });

  it("sin baremo del fabricante no se inventa el precio", () => {
    const r = resolverPrecioNeumatico(
      { medida: "295/80R22.5", marca: "Michelin" },
      { ...catalogo, baremos: [] });
    expect(r.importe).toBeNull();
    expect(r.avisos).toContain("MANUFACTURER_LIST_NOT_FOUND");
  });

  it("la marca concreta gana al grupo", () => {
    // Los dos encajan: el de Bridgestone dirección y el de PREMIUM cualquier
    // posición. El tarifario nombra Bridgestone, así que quería Bridgestone y
    // no "cualquier premium": 485,49 y no 450.
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" }, catalogo);
    expect(r.precio?.id).toBe(neto.id);
    expect(formatear(r.importe!)).toBe("485.49");
  });

  it("sin saber la posición no se aplica un precio de una posición concreta", () => {
    // No se sabe si es de dirección: aplicar el precio de dirección sería
    // decidir por el operario. Cae en el del grupo, que vale para cualquiera.
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone" }, catalogo);
    expect(r.precio?.id).toBe(porGrupo.id);
  });

  it("una marca sin precio propio cae en el de su grupo", () => {
    const catalogoConHankook: CatalogoNeumaticos = {
      ...catalogo,
      gruposPorMarca: new Map([...catalogo.gruposPorMarca, ["HANKOOK", ["PREMIUM"]]]),
    };
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Hankook" }, catalogoConHankook);
    expect(formatear(r.importe!)).toBe("450.00");
  });

  it("el grupo pertenece a la versión tarifaria, no a la marca", () => {
    // Si Hankook no es premium en ESTE tarifario, no cobra el precio premium
    const otroTarifario: CatalogoNeumaticos = { ...catalogo, gruposPorMarca: new Map() };
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Hankook" }, otroTarifario);
    expect(r.importe).toBeNull();
    expect(r.avisos).toContain("TIRE_PRICE_NOT_FOUND");
  });

  it("una posición concreta no sirve para otra", () => {
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "TRAILER" }, catalogo);
    // Cae en el del grupo, que es de posición ANY
    expect(r.precio?.id).toBe(porGrupo.id);
  });

  it("sin ningún precio aplicable se avisa y no se inventa nada", () => {
    const r = resolverPrecioNeumatico({ medida: "205/55R16", marca: "Pirelli" }, catalogo);
    expect(r.importe).toBeNull();
    expect(r.avisos).toContain("TIRE_PRICE_NOT_FOUND");
  });

  it("dos precios igual de específicos avisan de la ambigüedad", () => {
    const gemelo: PrecioNeumaticoTarifa = { ...neto, id: 99, netAmount: "500" };
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" },
      { ...catalogo, precios: [neto, gemelo] });
    expect(r.avisos).toContain("AMBIGUOUS_TIRE_PRICE");
    // Se elige igual, para que el resultado sea reproducible
    expect(r.precio?.id).toBe(neto.id);
  });

  it("el orden de llegada no decide el precio", () => {
    const alReves: CatalogoNeumaticos = { ...catalogo, precios: [...catalogo.precios].reverse() };
    const a = resolverPrecioNeumatico({ medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" }, catalogo);
    const b = resolverPrecioNeumatico({ medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" }, alReves);
    expect(a.precio?.id).toBe(b.precio?.id);
  });

  it("un precio desactivado no se usa", () => {
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" },
      { ...catalogo, precios: [{ ...neto, active: false }] });
    expect(r.importe).toBeNull();
  });

  it("un precio neto sin importe no da cero: da aviso", () => {
    const r = resolverPrecioNeumatico(
      { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" },
      { ...catalogo, precios: [{ ...neto, netAmount: null }] });
    expect(r.importe).toBeNull();
    expect(r.avisos).toContain("TIRE_PRICE_NOT_FOUND");
  });
});
