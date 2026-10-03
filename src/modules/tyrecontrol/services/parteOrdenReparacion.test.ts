import { describe, it, expect } from "vitest";
import {
  numeracionSeguida, numeracionDelProveedor, ruedasDelCroquis, ruedasDelPlano,
  normalizarSerie, normalizarDot, verificarGomaQueSale,
  interpretarOrdenReparacion, interpretar, formatoDe, numeroDelParte,
  type LecturaParteProveedor, type PosicionDelPlano, type GomaDelParte,
} from "./parteProveedor";

/** El bus del parte: 2x4 (C2-4), delantero simple y trasero gemelo. */
const PLANO_2x4: PosicionDelPlano[] = [
  { id: "b1", codigo_posicion: "E1_IZQ",     eje: 1, orden_visual: 1 },
  { id: "b2", codigo_posicion: "E1_DER",     eje: 1, orden_visual: 2 },
  { id: "b3", codigo_posicion: "E2_IZQ_EXT", eje: 2, orden_visual: 3 },
  { id: "b4", codigo_posicion: "E2_IZQ_INT", eje: 2, orden_visual: 4 },
  { id: "b5", codigo_posicion: "E2_DER_INT", eje: 2, orden_visual: 5 },
  { id: "b6", codigo_posicion: "E2_DER_EXT", eje: 2, orden_visual: 6 },
];

/** Lo que TyreControl tiene montado en ese bus: las Hankook que salen. */
const MONTADO = [
  { posicionId: "b3", numeroSerie: "8682464634", dot: "3724" },
  { posicionId: "b4", numeroSerie: "8679972350", dot: "1324" },
  { posicionId: "b5", numeroSerie: null, dot: "0423" },
  { posicionId: "b6", numeroSerie: null, dot: "2524" },
];

const sale = (posicion: number, numero_serie: string | null, dot: string): GomaDelParte => ({
  posicion, marca: "HANKOOK", medida: "295/80/225", modelo: "AH51",
  numero_serie, dot, mm: 3, destino: null,
});
const entra = (posicion: number, numero_serie: string, dot: string): GomaDelParte => ({
  posicion, marca: "INSA T", medida: "295/80/225", modelo: "K25",
  numero_serie, dot, mm: null, destino: null,
});

/** La O.R. 2501071 + albarán B2_0004781, del 24/09/2026. */
const OR_REAL: LecturaParteProveedor = {
  formato: "orden_reparacion",
  pt_numero: null,
  or_numero: "2501071",
  albaran_numero: "B2_0004781",
  croquis: "C2-4",
  fecha: "2026-09-24",
  matricula: "2452JDD",
  numero_unidad: "1003",
  km: 391038,
  cliente_nombre: "EMPRESA PLANA,S.L.",
  cliente_cif: "B43009091",
  tecnico: "IVAN",
  desmontados: [
    sale(3, "8682464634", "3724"),
    sale(4, "8679972350", "1324"),
    sale(5, "BORRADO", "0423"),
    sale(6, "BORRADO", "2524"),
  ],
  montados: [
    entra(3, "6159558697", "1725"),
    entra(4, "6155711173", "1725"),
    entra(5, "8683394018", "1426"),
    entra(6, "8683144419", "1526"),
  ],
  filas: [],
  productos: [
    { descripcion: "295/80X22.5 INSA K25 BASE 1ª", unidades: 4, precio_unitario: 295, precio_total: 1180 },
    { descripcion: "MONTAJE CAMION MAYOR 19.5\"", unidades: 4, precio_unitario: 18.54, precio_total: 0.01 },
    { descripcion: "MONTAJE FIJACIÓN(QUIT.PONER)CM", unidades: 4, precio_unitario: 17.14, precio_total: 0.01 },
    { descripcion: "NºVEHICULO:1003", unidades: 1, precio_unitario: 0.01, precio_total: 0.01 },
  ],
  confianza: 0.8,
  aviso: null,
};

const ctx = { posiciones: PLANO_2x4, montajes: MONTADO, kmActual: 380000 };

describe("numeracionSeguida — la de la O.R.", () => {
  it("un eje simple detrás son 7 y 8, no 7 y 10 como en el «Examen»", () => {
    // Lo dice el croquis C2-4-2 impreso en la propia hoja.
    const plano: PosicionDelPlano[] = [
      ...PLANO_2x4,
      { id: "b7", codigo_posicion: "E3_IZQ", eje: 3, orden_visual: 7 },
      { id: "b8", codigo_posicion: "E3_DER", eje: 3, orden_visual: 8 },
    ];
    expect(numeracionSeguida(plano).get(8)?.codigo_posicion).toBe("E3_DER");
    // Y el otro impreso lo numera distinto: por eso cada formato lleva el suyo.
    expect(numeracionDelProveedor(plano)!.get(10)?.codigo_posicion).toBe("E3_DER");
    expect(numeracionDelProveedor(plano)!.get(8)).toBeUndefined();
  });

  it("en un C2-2-4 el segundo eje simple es 3 y 4, y el gemelo del 5 al 8", () => {
    const plano: PosicionDelPlano[] = [
      { id: "a", codigo_posicion: "E1_IZQ", eje: 1, orden_visual: 1 },
      { id: "b", codigo_posicion: "E1_DER", eje: 1, orden_visual: 2 },
      { id: "c", codigo_posicion: "E2_IZQ", eje: 2, orden_visual: 3 },
      { id: "d", codigo_posicion: "E2_DER", eje: 2, orden_visual: 4 },
      { id: "e", codigo_posicion: "E3_IZQ_EXT", eje: 3, orden_visual: 5 },
      { id: "f", codigo_posicion: "E3_IZQ_INT", eje: 3, orden_visual: 6 },
      { id: "g", codigo_posicion: "E3_DER_INT", eje: 3, orden_visual: 7 },
      { id: "h", codigo_posicion: "E3_DER_EXT", eje: 3, orden_visual: 8 },
    ];
    const m = numeracionSeguida(plano);
    expect(m.get(4)?.codigo_posicion).toBe("E2_DER");
    expect(m.get(5)?.codigo_posicion).toBe("E3_IZQ_EXT");
  });
});

describe("ruedasDelCroquis / ruedasDelPlano", () => {
  it("lee los croquis impresos en la hoja", () => {
    expect(ruedasDelCroquis("C2-4")).toEqual([2, 4]);
    expect(ruedasDelCroquis("c2-4-2")).toEqual([2, 4, 2]);
    expect(ruedasDelCroquis("R2-2-2")).toEqual([2, 2, 2]);
    expect(ruedasDelCroquis("R4-4")).toEqual([4, 4]);
  });
  it("lo que no se entiende no se inventa", () => {
    expect(ruedasDelCroquis("tridem")).toBeNull();
    expect(ruedasDelCroquis("C2-6")).toBeNull();
    expect(ruedasDelCroquis(null)).toBeNull();
  });
  it("cuenta las ruedas de cada eje del plano", () => {
    expect(ruedasDelPlano(PLANO_2x4)).toEqual([2, 4]);
  });
});

describe("normalizarSerie / normalizarDot", () => {
  it("«BORRADO» no es un número de serie", () => {
    expect(normalizarSerie("BORRADO")).toBeNull();
    expect(normalizarSerie(" borrado ")).toBeNull();
    expect(normalizarSerie("Ilegible")).toBeNull();
  });
  it("se compara sin espacios ni guiones", () => {
    expect(normalizarSerie("868 246-4634")).toBe("8682464634");
  });
  it("el DOT se queda en semana y año", () => {
    expect(normalizarDot("3724")).toBe("3724");
    expect(normalizarDot("DOT 4B 3724")).toBe("3724");
    expect(normalizarDot("37")).toBeNull();
  });
});

describe("verificarGomaQueSale", () => {
  it("si el serie coincide, adelante", () => {
    expect(verificarGomaQueSale(3, { numeroSerie: "8682464634", dot: "3724" }, MONTADO[0])).toBeNull();
  });
  it("si NO coincide, se para", () => {
    const v = verificarGomaQueSale(3, { numeroSerie: "1111111111", dot: "3724" }, MONTADO[0]);
    expect(v?.error).toContain("en TyreControl está montada la 8682464634");
  });
  it("con el serie borrado, coteja por DOT", () => {
    expect(verificarGomaQueSale(5, { numeroSerie: "BORRADO", dot: "0423" }, MONTADO[2])).toBeNull();
    const v = verificarGomaQueSale(5, { numeroSerie: "BORRADO", dot: "9999" }, MONTADO[2]);
    expect(v?.error).toContain("no es la misma goma");
  });
  it("si no hay con qué cotejar, avisa pero no para", () => {
    const v = verificarGomaQueSale(5, { numeroSerie: "BORRADO", dot: null }, MONTADO[2]);
    expect(v?.aviso).toContain("No se puede comprobar");
    expect(v?.error).toBeUndefined();
  });
  it("si en TyreControl no hay nada montado ahí, se para", () => {
    const v = verificarGomaQueSale(3, { numeroSerie: "8682464634", dot: "3724" }, undefined);
    expect(v?.error).toContain("no hay ninguna montada");
  });
});

describe("interpretarOrdenReparacion — el parte real del 2452JDD", () => {
  const p = interpretarOrdenReparacion(OR_REAL, ctx);

  it("no hay nada que impida guardarlo", () => {
    expect(p.errores).toEqual([]);
  });

  it("cuatro cambios en el eje trasero, con la goma que sale y la que entra", () => {
    expect(p.cambios.map((c) => c.codigo))
      .toEqual(["E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT"]);
    expect(p.cambios[0].sale?.numeroSerie).toBe("8682464634");
    expect(p.cambios[0].entra).toMatchObject({ numeroSerie: "6159558697", dot: "1725", modelo: "K25" });
    // Las dos con el serie borrado salen sin serie, que es la verdad.
    expect(p.cambios[2].sale?.numeroSerie).toBeNull();
  });

  it("los 3 mm SÍ se guardan: son de la goma que sale, medida antes de quitarla", () => {
    expect(p.mediciones.map((m) => [m.codigo, m.profundidadMm])).toEqual([
      ["E2_IZQ_EXT", 3], ["E2_IZQ_INT", 3], ["E2_DER_INT", 3], ["E2_DER_EXT", 3],
    ]);
    expect(p.medicionesDeGomaNueva).toEqual([]);
  });

  it("propone la cubierta y el precio del albarán", () => {
    expect(p.neumatico).toMatchObject({ medida: "295/80R22.5", unidades: 4, precioUnitario: 295 });
  });

  it("los servicios, casados con nuestro catálogo", () => {
    expect(p.servicios.map((s) => [s.codigo, s.cantidad]).sort()).toEqual([
      ["desmontar_montar_cubierta", 4], ["quitar_poner_rueda", 4],
    ]);
  });
});

describe("interpretarOrdenReparacion — lo que no cuadra", () => {
  it("si la goma que sale no es la que teníamos, se PARA", () => {
    const montado = [{ ...MONTADO[0], numeroSerie: "9999999999" }, ...MONTADO.slice(1)];
    const p = interpretarOrdenReparacion(OR_REAL, { ...ctx, montajes: montado });
    expect(p.errores.join(" ")).toContain("en TyreControl está montada la 9999999999");
  });

  it("si el croquis marcado no es el del vehículo, se para", () => {
    const p = interpretarOrdenReparacion({ ...OR_REAL, croquis: "C2-4-2" }, ctx);
    expect(p.errores.join(" ")).toContain("marca el croquis C2-4-2");
  });

  it("un desmontaje sin goma nueva no se anota solo", () => {
    const p = interpretarOrdenReparacion(
      { ...OR_REAL, montados: OR_REAL.montados!.slice(0, 3) }, ctx);
    expect(p.errores.join(" ")).toContain("La rueda 6 se desmonta");
  });

  it("dos gomas nuevas con el mismo serie es una mala lectura", () => {
    const montados = OR_REAL.montados!.map((g) => ({ ...g, numero_serie: "6159558697" }));
    const p = interpretarOrdenReparacion({ ...OR_REAL, montados }, ctx);
    expect(p.errores.join(" ")).toContain("sale en más de una goma nueva");
  });

  it("sin albarán ni O.R. no se guarda", () => {
    const p = interpretarOrdenReparacion({ ...OR_REAL, or_numero: null, albaran_numero: null }, ctx);
    expect(p.errores.join(" ")).toContain("número de O.R. ni el de albarán");
  });

  it("una rueda que el vehículo no tiene, se para", () => {
    const p = interpretarOrdenReparacion(
      { ...OR_REAL, montados: [...OR_REAL.montados!, entra(9, "1234567890", "0126")] }, ctx);
    expect(p.errores.join(" ")).toContain("La rueda 9");
  });
});

describe("formato y número del parte", () => {
  it("reconoce cada impreso, aunque el lector no lo diga", () => {
    expect(formatoDe(OR_REAL)).toBe("orden_reparacion");
    expect(formatoDe({ ...OR_REAL, formato: null })).toBe("orden_reparacion");
    expect(formatoDe({ ...OR_REAL, formato: null, desmontados: [], montados: [] })).toBe("examen");
  });

  it("la clave sale del albarán, que va a máquina, antes que de la O.R. manuscrita", () => {
    expect(numeroDelParte(OR_REAL)).toBe("ALB B2_0004781");
    expect(numeroDelParte({ ...OR_REAL, albaran_numero: null })).toBe("OR 2501071");
  });

  it("interpretar() elige el traductor que toca", () => {
    expect(interpretar(OR_REAL, ctx).cambios).toHaveLength(4);
  });
});
