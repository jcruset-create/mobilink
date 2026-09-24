import { describe, it, expect } from "vitest";
import {
  posicionesPorNumero, esCambio, profundidadDeFila, medidaDeTexto,
  neumaticoDelParte, servicioDeProducto, interpretarParte, claveDeParte, estadoDeDestino,
  type LecturaParteProveedor, type PosicionDelPlano,
} from "./parteProveedor";

/** El plano de un autocar 2x4x4, con el orden que genera generarPosiciones(). */
const PLANO_2x4x4: PosicionDelPlano[] = [
  { id: "p1",  codigo_posicion: "E1_IZQ",     eje: 1, orden_visual: 1 },
  { id: "p2",  codigo_posicion: "E1_DER",     eje: 1, orden_visual: 2 },
  { id: "p3",  codigo_posicion: "E2_IZQ_EXT", eje: 2, orden_visual: 3 },
  { id: "p4",  codigo_posicion: "E2_IZQ_INT", eje: 2, orden_visual: 4 },
  { id: "p5",  codigo_posicion: "E2_DER_INT", eje: 2, orden_visual: 5 },
  { id: "p6",  codigo_posicion: "E2_DER_EXT", eje: 2, orden_visual: 6 },
  { id: "p7",  codigo_posicion: "E3_IZQ_EXT", eje: 3, orden_visual: 7 },
  { id: "p8",  codigo_posicion: "E3_IZQ_INT", eje: 3, orden_visual: 8 },
  { id: "p9",  codigo_posicion: "E3_DER_INT", eje: 3, orden_visual: 9 },
  { id: "p10", codigo_posicion: "E3_DER_EXT", eje: 3, orden_visual: 10 },
];

/** El parte real de Comercial Sea del 19/08/2026: PT B2_26/3.492, 0020KFW. */
const PARTE_REAL: LecturaParteProveedor = {
  pt_numero: "B2_26/3.492",
  fecha: "2026-08-19",
  matricula: "0020KFW",
  numero_unidad: "1352",
  km: 1018417,
  cliente_nombre: "CINTOI BUS S.L",
  cliente_cif: "B61075347",
  tecnico: "JAIME.02",
  confianza: 0.9,
  aviso: null,
  filas: [
    { posicion: 1,  presion_bar: 9,   mm_int: 14.9, mm_ext: 14.9, operacion: "NUEV", montadas: null, quitadas: null },
    { posicion: 2,  presion_bar: 9,   mm_int: 15,   mm_ext: 15,   operacion: "NUEV", montadas: null, quitadas: null },
    { posicion: 3,  presion_bar: 8.5, mm_int: 7.9,  mm_ext: 7.9,  operacion: null,   montadas: null, quitadas: null },
    { posicion: 4,  presion_bar: 8.5, mm_int: 6.8,  mm_ext: 6.8,  operacion: null,   montadas: null, quitadas: null },
    { posicion: 5,  presion_bar: 8.5, mm_int: 6.1,  mm_ext: 6.1,  operacion: null,   montadas: null, quitadas: null },
    { posicion: 6,  presion_bar: 8.5, mm_int: 5.9,  mm_ext: 5.9,  operacion: null,   montadas: null, quitadas: null },
    { posicion: 7,  presion_bar: 9,   mm_int: 14,   mm_ext: 14,   operacion: null,   montadas: null, quitadas: null },
    { posicion: 8,  presion_bar: null, mm_int: null, mm_ext: null, operacion: null,  montadas: null, quitadas: null },
    { posicion: 9,  presion_bar: null, mm_int: null, mm_ext: null, operacion: null,  montadas: null, quitadas: null },
    { posicion: 10, presion_bar: 9,   mm_int: 15.2, mm_ext: 15.2, operacion: "NUEV", montadas: null, quitadas: null },
  ],
  productos: [
    { descripcion: "MANTENIMIENTO CAMIÓN", unidades: 1, precio_unitario: 0, precio_total: 0 },
    { descripcion: "MONTAJE FIJACIÓN(QUIT.PONER)CM", unidades: 3, precio_unitario: 17.14, precio_total: 0.01 },
    { descripcion: "MONTAJE CAMION MAYOR 19.5", unidades: 3, precio_unitario: 18.54, precio_total: 0.01 },
    { descripcion: "EQUILIBRADO CAMION", unidades: 3, precio_unitario: 19.14, precio_total: 0.01 },
    { descripcion: "MONTA 3 CUBIERTAS NUEVAS 295/80R22.5 AH51", unidades: 1, precio_unitario: 0, precio_total: 0 },
    { descripcion: "CONTRAPESA PLOMO CAMION 150GR", unidades: 3, precio_unitario: 3.29, precio_total: 9.87 },
    { descripcion: "VERIFICA.PRESIONES X MATRICULA", unidades: 1, precio_unitario: 0, precio_total: 0 },
    { descripcion: "295/80X22.5 HANKOOK AH51 154M", unidades: 3, precio_unitario: 409, precio_total: 1227 },
  ],
};

describe("posicionesPorNumero", () => {
  it("numera como el croquis del proveedor: por ejes y de fuera a dentro", () => {
    const m = posicionesPorNumero(PLANO_2x4x4);
    expect(m.get(1)?.codigo_posicion).toBe("E1_IZQ");
    expect(m.get(4)?.codigo_posicion).toBe("E2_IZQ_INT");
    expect(m.get(10)?.codigo_posicion).toBe("E3_DER_EXT");
    expect(m.size).toBe(10);
  });

  it("no le importa en qué orden vengan las filas de la base de datos", () => {
    const desordenado = [...PLANO_2x4x4].reverse();
    expect(posicionesPorNumero(desordenado).get(1)?.codigo_posicion).toBe("E1_IZQ");
  });
});

describe("esCambio", () => {
  it("reconoce las formas en que el taller escribe «se cambió»", () => {
    for (const t of ["NUEV", "nueva", " NUEVAS ", "RECAU", "Recauchutada", "N"]) {
      expect(esCambio(t)).toBe(true);
    }
  });
  it("una fila sin operación es solo una medición", () => {
    expect(esCambio(null)).toBe(false);
    expect(esCambio("")).toBe(false);
    expect(esCambio("REVISADA")).toBe(false);
  });
});

describe("profundidadDeFila", () => {
  it("se queda con la MENOR: es la que dice si hay que cambiarla", () => {
    // Una rueda con 14 por fuera y 3 por dentro está gastada, no a medias.
    expect(profundidadDeFila(3, 14)).toBe(3);
    expect(profundidadDeFila(14.9, 14.9)).toBe(14.9);
  });
  it("con una sola lectura vale esa; sin ninguna, null", () => {
    expect(profundidadDeFila(null, 6.1)).toBe(6.1);
    expect(profundidadDeFila(null, null)).toBeNull();
    expect(profundidadDeFila(0, null)).toBeNull();
  });
});

describe("medidaDeTexto", () => {
  it("la X del papel es la R del catálogo", () => {
    expect(medidaDeTexto("295/80X22.5 HANKOOK AH51 154M")).toBe("295/80R22.5");
    expect(medidaDeTexto("MONTA 3 CUBIERTAS NUEVAS 295/80R22.5 AH51")).toBe("295/80R22.5");
  });
  it("una línea sin medida no es una cubierta", () => {
    expect(medidaDeTexto("EQUILIBRADO CAMION")).toBeNull();
    expect(medidaDeTexto("CONTRAPESA PLOMO CAMION 150GR")).toBeNull();
  });
});

describe("servicioDeProducto", () => {
  it("casa las líneas del taller con nuestro catálogo", () => {
    expect(servicioDeProducto("EQUILIBRADO CAMION")).toBe("equilibrado");
    expect(servicioDeProducto("MONTAJE FIJACIÓN(QUIT.PONER)CM")).toBe("quitar_poner_rueda");
    expect(servicioDeProducto("MONTAJE CAMION MAYOR 19.5")).toBe("desmontar_montar_cubierta");
  });
  it("lo que no reconoce NO se inventa", () => {
    // Facturar un servicio que no se hizo es peor que dejar el hueco.
    expect(servicioDeProducto("CONTRAPESA PLOMO CAMION 150GR")).toBeNull();
    expect(servicioDeProducto("MANTENIMIENTO CAMIÓN")).toBeNull();
  });
});

describe("neumaticoDelParte", () => {
  it("encuentra la cubierta entre montajes, equilibrados y contrapesas", () => {
    const { neumatico } = neumaticoDelParte(PARTE_REAL.productos);
    expect(neumatico?.medida).toBe("295/80R22.5");
    expect(neumatico?.unidades).toBe(3);
    expect(neumatico?.precioUnitario).toBe(409);
  });

  it("con dos medidas facturadas avisa en vez de repartir a ojo", () => {
    const r = neumaticoDelParte([
      { descripcion: "295/80R22.5 HANKOOK", unidades: 2, precio_unitario: 400, precio_total: 800 },
      { descripcion: "315/80R22.5 MICHELIN", unidades: 1, precio_unitario: 500, precio_total: 500 },
    ]);
    expect(r.neumatico?.medida).toBe("295/80R22.5");
    expect(r.avisos.join(" ")).toContain("2 medidas distintas");
  });

  it("un parte solo de revisión no factura cubiertas", () => {
    expect(neumaticoDelParte([{ descripcion: "EQUILIBRADO", unidades: 1, precio_unitario: 10, precio_total: 10 }])
      .neumatico).toBeNull();
  });
});

describe("interpretarParte — el parte real", () => {
  const p = interpretarParte(PARTE_REAL, { posiciones: PLANO_2x4x4, kmActual: 1000000 });

  it("guarda las 5 mediciones de las ruedas que NO se tocaron", () => {
    expect(p.mediciones.map((m) => m.numero)).toEqual([3, 4, 5, 6, 7]);
    expect(p.mediciones.find((m) => m.numero === 5)).toMatchObject({
      codigo: "E2_DER_INT", presionBar: 8.5, profundidadMm: 6.1,
    });
  });

  it("y aparta las de las ruedas cambiadas, que son de la goma NUEVA", () => {
    // El parte da 14,9 · 15 · 15,2 en las tres que se cambiaron: es la goma
    // que se acaba de poner. Guardarlo como medición de la posición diría que
    // la que se tiró tenía 15 mm, y eso iría al coste por kilómetro de una
    // goma que en realidad estaba gastada.
    expect(p.medicionesDeGomaNueva.map((m) => m.numero)).toEqual([1, 2, 10]);
    expect(p.mediciones.some((m) => [1, 2, 10].includes(m.numero))).toBe(false);
  });

  it("y los tres cambios, en las ruedas que marca el croquis", () => {
    expect(p.cambios.map((c) => c.codigo)).toEqual(["E1_IZQ", "E1_DER", "E3_DER_EXT"]);
  });

  it("propone la goma facturada", () => {
    expect(p.neumatico?.medida).toBe("295/80R22.5");
    expect(p.neumatico?.unidades).toBe(3);
  });

  it("casa los servicios y suma los que caen en el mismo código", () => {
    const eq = p.servicios.find((s) => s.codigo === "equilibrado");
    expect(eq?.cantidad).toBe(3);
    expect(p.servicios.map((s) => s.codigo).sort())
      .toEqual(["desmontar_montar_cubierta", "equilibrado", "quitar_poner_rueda"]);
  });

  it("deja a la vista lo que no ha sabido casar", () => {
    expect(p.serviciosSinCasar).toContain("CONTRAPESA PLOMO CAMION 150GR");
  });

  it("no tiene nada que impida guardarlo", () => {
    expect(p.errores).toEqual([]);
  });
});

describe("interpretarParte — lo que no cuadra", () => {
  it("si el croquis trae más ruedas que el plano, se PARA", () => {
    // El caso que de verdad pasa: un autocar dado de alta como 2x4x2 (8
    // ruedas) cuyo parte mide la 10. Repartir «lo que quepa» pondría la
    // medida de una rueda en otra.
    const plano8 = PLANO_2x4x4.slice(0, 8);
    const p = interpretarParte(PARTE_REAL, { posiciones: plano8 });
    expect(p.errores.join(" ")).toContain("solo tiene 8 posiciones");
  });

  it("sin plano no se puede hacer nada", () => {
    const p = interpretarParte(PARTE_REAL, { posiciones: [] });
    expect(p.errores.join(" ")).toContain("no tiene plano de ruedas");
  });

  it("sin número de PT no se guarda: es lo que evita duplicarlo", () => {
    const p = interpretarParte({ ...PARTE_REAL, pt_numero: null }, { posiciones: PLANO_2x4x4 });
    expect(p.errores.join(" ")).toContain("número de PT");
  });

  it("sin matrícula tampoco", () => {
    const p = interpretarParte({ ...PARTE_REAL, matricula: null }, { posiciones: PLANO_2x4x4 });
    expect(p.errores.join(" ")).toContain("matrícula");
  });

  it("avisa si las cubiertas facturadas no son las ruedas cambiadas", () => {
    const productos = PARTE_REAL.productos.map((x) =>
      x.descripcion.startsWith("295/80X") ? { ...x, unidades: 2 } : x);
    const p = interpretarParte({ ...PARTE_REAL, productos }, { posiciones: PLANO_2x4x4 });
    expect(p.avisos.join(" ")).toContain("Se facturan 2 cubiertas");
  });

  it("avisa si los kilómetros del papel van hacia atrás", () => {
    const p = interpretarParte(PARTE_REAL, { posiciones: PLANO_2x4x4, kmActual: 1100000 });
    expect(p.avisos.join(" ")).toContain("menores que los que tenemos");
  });

  it("avisa si la cubierta no es de la medida del vehículo", () => {
    const p = interpretarParte(PARTE_REAL, { posiciones: PLANO_2x4x4, medidaVehiculo: "315/80R22.5" });
    expect(p.avisos.join(" ")).toContain("no es la medida que tiene el vehículo");
  });

  it("una rueda repetida no se cuenta dos veces", () => {
    const filas = [...PARTE_REAL.filas, { ...PARTE_REAL.filas[0], mm_int: 3, mm_ext: 3 }];
    const p = interpretarParte({ ...PARTE_REAL, filas }, { posiciones: PLANO_2x4x4 });
    expect(p.medicionesDeGomaNueva.filter((m) => m.numero === 1)).toHaveLength(1);
    expect(p.medicionesDeGomaNueva.find((m) => m.numero === 1)?.profundidadMm).toBe(14.9);
    expect(p.avisos.join(" ")).toContain("sale más de una vez");
  });
});

describe("estadoDeDestino", () => {
  it("lo que vuelve al almacén, vuelve al almacén", () => {
    expect(estadoDeDestino("almacen")).toBe("almacen");
    expect(estadoDeDestino("stock_usado")).toBe("almacen");
    expect(estadoDeDestino(null)).toBe("almacen");
  });
  it("lo que sale del circuito se da de baja", () => {
    expect(estadoDeDestino("descartado")).toBe("descartado");
    expect(estadoDeDestino("vendido")).toBe("descartado");
  });
  it("y lo demás se queda en un estado que NO mueve stock", () => {
    // Carcasa, cuarentena, recauchutado: se afinan después, pero mientras
    // tanto no pueden aparecer como disponibles en el almacén.
    expect(estadoDeDestino("recauchutado")).toBe("reparacion");
    expect(estadoDeDestino("cuarentena")).toBe("reparacion");
  });
});

describe("claveDeParte", () => {
  it("el mismo papel da la misma clave, siempre", () => {
    const a = claveDeParte("comercial_sea", "B2_26/3.492");
    const b = claveDeParte("comercial_sea", " b2_26/3.492 ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("dos partes distintos, o dos proveedores, dan claves distintas", () => {
    expect(claveDeParte("comercial_sea", "B2_26/3.492"))
      .not.toBe(claveDeParte("comercial_sea", "B2_26/3.493"));
    expect(claveDeParte("comercial_sea", "B2_26/3.492"))
      .not.toBe(claveDeParte("otro_taller", "B2_26/3.492"));
  });
});
