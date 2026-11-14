import { describe, it, expect } from "vitest";
import {
  agruparPorVehiculo, estadoDeRueda, edadEnTexto, fechaCorta, filtrarVehiculos,
  mm, ordenarVehiculos, resumenDeTarjeta, ruedasParaMedirConSonda, type VehiculoConAlertas,
} from "./alertasPorVehiculo";
import type { RuedaAlerta } from "../types/informes";

const FOTO_BUS = "https://x.supabase.co/storage/v1/object/public/tc-chasis/config-ejes/6ac2b9a4/1785514268172.png";

/** Una rueda montada y medida, con lo mínimo para que valga de fila. */
function fila(p: Partial<RuedaAlerta> = {}): RuedaAlerta {
  return {
    vehiculo_id: "v1", matricula: "1234ABC", numero_unidad: "100",
    tipo_vehiculo: "autobus", config_ejes: "2X4 BUS", imagen_chasis_url: FOTO_BUS,
    posicion_id: "p1", codigo_posicion: "E1_IZQ", eje: 1, lado: "izq", interior_exterior: null,
    neumatico_id: "n1", codigo: "AB-1", medida: "295/80R22.5",
    profundidad_mm: 8, minimo_mm: 4, fecha_revision: "2026-11-11",
    presion_bar: null, presion_recomendada_bar: null, desviacion_pct: null,
    presion_avisos: null, presion_aviso_at: null,
    ...p,
  };
}

/** El 3294KKK tal como está en producción: 1,7 y 3,9 en la trasera derecha. */
const KKK: RuedaAlerta[] = [
  fila({ codigo_posicion: "E1_IZQ", eje: 1, lado: "izq", profundidad_mm: 9.9, fecha_revision: "2026-05-19" }),
  fila({ codigo_posicion: "E1_DER", eje: 1, lado: "der", profundidad_mm: 13, fecha_revision: "2026-01-21" }),
  fila({ codigo_posicion: "E2_IZQ_EXT", eje: 2, lado: "izq", interior_exterior: "ext", profundidad_mm: 4.4, fecha_revision: "2026-05-19" }),
  fila({ codigo_posicion: "E2_IZQ_INT", eje: 2, lado: "izq", interior_exterior: "int", profundidad_mm: 4.3, fecha_revision: "2026-05-19" }),
  fila({ codigo_posicion: "E2_DER_INT", eje: 2, lado: "der", interior_exterior: "int", profundidad_mm: 1.7, fecha_revision: "2026-05-19" }),
  fila({ codigo_posicion: "E2_DER_EXT", eje: 2, lado: "der", interior_exterior: "ext", profundidad_mm: 3.9, fecha_revision: "2026-05-19" }),
];

const HOY = "2026-11-13";

describe("mm", () => {
  it("coma decimal y siempre un decimal", () => {
    expect(mm(1.7)).toBe("1,7");
    expect(mm(4)).toBe("4,0");
    expect(mm(13)).toBe("13,0");
  });
  it("sin dato, raya", () => {
    expect(mm(null)).toBe("—");
    expect(mm(undefined)).toBe("—");
    expect(mm(Number.NaN)).toBe("—");
  });
  it("el cero es un dato, no un hueco: una goma a 0 está lisa", () => {
    expect(mm(0)).toBe("0,0");
  });
});

describe("fechaCorta y edadEnTexto", () => {
  it("la fecha, como se lee aquí", () => {
    expect(fechaCorta("2026-11-11")).toBe("11/11/2026");
    expect(fechaCorta("2024-04-27T00:00:00Z")).toBe("27/04/2024");
    expect(fechaCorta(null)).toBe("");
  });
  it("la edad, en cristiano", () => {
    expect(edadEnTexto(0)).toBe("hoy");
    expect(edadEnTexto(1)).toBe("ayer");
    expect(edadEnTexto(930)).toBe("hace 930 días");
    expect(edadEnTexto(null)).toBeNull();
  });
});

describe("estadoDeRueda", () => {
  it("por debajo o EN su mínimo hay que cambiarla", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 3.9, minimo_mm: 4 }))).toBe("cambiar");
    expect(estadoDeRueda(fila({ profundidad_mm: 4, minimo_mm: 4 }))).toBe("cambiar");
    expect(estadoDeRueda(fila({ profundidad_mm: 4.1, minimo_mm: 4 }))).toBe("ok");
  });

  it("el aviso de presión manda sobre el dibujo: una goma de 12 mm con aviso no está «ok»", () => {
    const r = fila({ profundidad_mm: 12, presion_bar: 6, presion_recomendada_bar: 8, presion_aviso_at: "2026-11-11T20:09:44Z" });
    expect(estadoDeRueda(r)).toBe("presion");
  });

  it("sin medición no se dice que esté bien, se dice que no se sabe", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: null }))).toBe("sin_medir");
  });

  it("una posición sin neumático es un hueco, no una goma sin medir", () => {
    expect(estadoDeRueda(fila({ neumatico_id: null, profundidad_mm: null }))).toBe("vacia");
  });

  it("sin mínimo no se pinta de rojo: eso convertiría el rojo en ruido", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 1, minimo_mm: null }))).toBe("ok");
  });
});

describe("agruparPorVehiculo", () => {
  const [v] = agruparPorVehiculo(KKK, HOY);

  it("una tarjeta por vehículo, con todas sus ruedas", () => {
    expect(v.matricula).toBe("1234ABC");
    expect(v.ruedas).toHaveLength(6);
  });

  it("cuenta las que hay que cambiar y señala la peor", () => {
    expect(v.paraCambiar).toBe(2);
    expect(v.peor).toBe(1.7);
    expect(v.conPresion).toBe(0);
  });

  it("las que están bien siguen en el plano, en verde", () => {
    expect(v.ruedas.filter((r) => r.estado === "ok")).toHaveLength(4);
  });

  it("cada rueda lleva su número dentro del recuadro", () => {
    const der = v.ruedas.find((r) => r.codigo === "E2_DER_INT");
    expect(der?.texto).toBe("1,7");
    expect(der?.estado).toBe("cambiar");
  });

  it("y su marca sobre la foto", () => {
    for (const r of v.ruedas) expect(r.marca).not.toBeNull();
  });

  it("la fecha de la tarjeta es la más reciente DE LAS QUE AVISAN", () => {
    // La delantera derecha es del 21/01 y no avisa: no es la fecha del aviso.
    expect(v.medidoEl).toBe("2026-05-19");
    expect(v.diasDesdeMedicion).toBe(178);
  });

  it("el tooltip de cada rueda lleva su propia fecha", () => {
    const delantera = v.ruedas.find((r) => r.codigo === "E1_DER");
    expect(delantera?.titulo).toContain("21/01/2026");
    expect(delantera?.titulo).toContain("13,0 mm");
  });

  it("recoge la medida y el mínimo para la cabecera", () => {
    expect(v.medidas).toEqual(["295/80R22.5"]);
    expect(v.minimo).toBe(4);
  });

  it("con dos medidas montadas las saca las dos", () => {
    const dos = agruparPorVehiculo([
      fila({ codigo_posicion: "E1_IZQ", medida: "275/70R22.5" }),
      fila({ codigo_posicion: "E2_IZQ_EXT", eje: 2, interior_exterior: "ext", medida: "295/80R22.5", profundidad_mm: 3 }),
    ], HOY);
    expect(dos[0].medidas).toEqual(["275/70R22.5", "295/80R22.5"]);
  });

  it("separa los vehículos y no mezcla sus ruedas", () => {
    const dos = agruparPorVehiculo([
      ...KKK,
      fila({ vehiculo_id: "v2", matricula: "9999ZZZ", profundidad_mm: 2 }),
    ], HOY);
    expect(dos).toHaveLength(2);
    expect(dos[1].ruedas).toHaveLength(1);
    expect(dos[1].paraCambiar).toBe(1);
  });

  it("una posición vacía no cuenta como rueda para cambiar", () => {
    const [uno] = agruparPorVehiculo([
      fila({ codigo_posicion: "E1_IZQ", neumatico_id: null, profundidad_mm: null, medida: null }),
      fila({ codigo_posicion: "E1_DER", lado: "der", profundidad_mm: 2 }),
    ], HOY);
    expect(uno.paraCambiar).toBe(1);
    expect(uno.ruedas.find((r) => r.codigo === "E1_IZQ")?.texto).toBe("");
  });

  it("sin fecha en las que avisan, no se inventa una", () => {
    const [sin] = agruparPorVehiculo([fila({ profundidad_mm: 2, fecha_revision: null })], HOY);
    expect(sin.medidoEl).toBeNull();
    expect(sin.diasDesdeMedicion).toBeNull();
  });
});

describe("resumenDeTarjeta", () => {
  const base = (p: Partial<VehiculoConAlertas>): VehiculoConAlertas => ({
    vehiculoId: "v", matricula: "1234ABC", unidad: null, tipo: null, foto: null,
    medidas: [], minimo: null, ruedas: [], paraCambiar: 0, conPresion: 0, porConfirmar: 0, peor: null,
    medidoEl: null, diasDesdeMedicion: null, ...p,
  });

  it("cuenta las ruedas y la peor", () => {
    expect(resumenDeTarjeta(base({ paraCambiar: 4, peor: 1.9 }))).toBe("4 ruedas · peor 1,9 mm");
    expect(resumenDeTarjeta(base({ paraCambiar: 1, peor: 3 }))).toBe("1 rueda · peor 3,0 mm");
  });

  it("si solo hay presión, lo dice sin hablar de ruedas gastadas", () => {
    expect(resumenDeTarjeta(base({ conPresion: 1 }))).toBe("Presión baja");
    expect(resumenDeTarjeta(base({ conPresion: 2 }))).toBe("2 avisos de presión");
  });

  it("y si hay de las dos cosas, las dos", () => {
    expect(resumenDeTarjeta(base({ paraCambiar: 2, peor: 2, conPresion: 1 }))).toBe("2 ruedas · peor 2,0 mm · y presión");
  });
});

describe("ordenar y filtrar", () => {
  const v = (p: Partial<VehiculoConAlertas>): VehiculoConAlertas => ({
    vehiculoId: p.matricula ?? "v", matricula: "0000AAA", unidad: null, tipo: null, foto: null,
    medidas: [], minimo: null, ruedas: [], paraCambiar: 0, conPresion: 0, porConfirmar: 0, peor: null,
    medidoEl: null, diasDesdeMedicion: null, ...p,
  });

  const lista = [
    v({ matricula: "AAA", peor: 3.9, paraCambiar: 1, diasDesdeMedicion: 2 }),
    v({ matricula: "BBB", peor: 1.7, paraCambiar: 2, diasDesdeMedicion: 178 }),
    v({ matricula: "CCC", peor: null, conPresion: 1, diasDesdeMedicion: 2 }),
    v({ matricula: "DDD", peor: 4, paraCambiar: 4, diasDesdeMedicion: 930 }),
  ];

  it("por la goma más gastada, y el de solo presión delante", () => {
    expect(ordenarVehiculos(lista, "peor").map((x) => x.matricula)).toEqual(["CCC", "BBB", "AAA", "DDD"]);
  });

  it("por número de ruedas afectadas", () => {
    expect(ordenarVehiculos(lista, "ruedas").map((x) => x.matricula)).toEqual(["DDD", "BBB", "AAA", "CCC"]);
  });

  it("por medición más antigua", () => {
    expect(ordenarVehiculos(lista, "antiguedad").map((x) => x.matricula)).toEqual(["DDD", "BBB", "AAA", "CCC"]);
  });

  it("por matrícula", () => {
    expect(ordenarVehiculos(lista, "matricula").map((x) => x.matricula)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("ordenar no toca la lista que le dan", () => {
    const copia = [...lista];
    ordenarVehiculos(lista, "ruedas");
    expect(lista).toEqual(copia);
  });

  it("los filtros", () => {
    expect(filtrarVehiculos(lista, "todo")).toHaveLength(4);
    expect(filtrarVehiculos(lista, "cambiar").map((x) => x.matricula)).toEqual(["AAA", "BBB", "DDD"]);
    expect(filtrarVehiculos(lista, "presion").map((x) => x.matricula)).toEqual(["CCC"]);
    expect(filtrarVehiculos(lista, "vieja").map((x) => x.matricula)).toEqual(["BBB", "DDD"]);
  });

  it("«medición vieja» es a partir de 90 días, no a los 90 justos", () => {
    const justos = [v({ matricula: "X", diasDesdeMedicion: 90 }), v({ matricula: "Y", diasDesdeMedicion: 91 })];
    expect(filtrarVehiculos(justos, "vieja").map((x) => x.matricula)).toEqual(["Y"]);
  });
});

describe("el protocolo en las alertas: por confirmar", () => {
  it("sin las columnas nuevas todo va como antes: confirmado", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 2 }))).toBe("cambiar");
    expect(estadoDeRueda(fila({ profundidad_mm: 8 }))).toBe("ok");
  });

  it("un valor bajo confirmado es rojo; sin confirmar, no", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 2, confirmada: true }))).toBe("cambiar");
    expect(estadoDeRueda(fila({ profundidad_mm: 2, confirmada: false }))).toBe("por_confirmar");
  });

  it("el 4310JYJ: vale 8,5 y la última lectura de 1,8 queda pendiente", () => {
    const r = fila({ profundidad_mm: 8.5, confirmada: true, pendiente_mm: 1.8, pendiente_fecha: "2026-11-12" });
    expect(estadoDeRueda(r)).toBe("por_confirmar");
  });

  it("una pendiente por encima del mínimo no es incidencia", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 8.5, confirmada: true, pendiente_mm: 12 }))).toBe("ok");
  });

  it("la presión sigue mandando sobre lo demás", () => {
    expect(estadoDeRueda(fila({ profundidad_mm: 2, confirmada: false, presion_aviso_at: "2026-11-12T08:00:00Z" }))).toBe("presion");
  });

  const JYJ = [
    fila({ vehiculo_id: "jyj", matricula: "4310JYJ", codigo_posicion: "E1_IZQ", profundidad_mm: 9 , confirmada: true }),
    fila({ vehiculo_id: "jyj", matricula: "4310JYJ", posicion_id: "p2", codigo_posicion: "E2_DER_EXT", eje: 2, lado: "der", interior_exterior: "ext",
      profundidad_mm: 8.5, fecha_revision: "2026-11-10", confirmada: true, pendiente_mm: 1.8, pendiente_fecha: "2026-11-12" }),
  ];

  it("el vehículo sale, cuenta la rueda aparte y no tiene «peor»", () => {
    const [v] = agruparPorVehiculo(JYJ, HOY);
    expect(v.paraCambiar).toBe(0);
    expect(v.porConfirmar).toBe(1);
    expect(v.peor).toBeNull();
    expect(resumenDeTarjeta(v)).toBe("1 por confirmar");
    // La fecha que importa es la de la lectura en duda.
    expect(v.medidoEl).toBe("2026-11-12");
  });

  it("el recuadro enseña el valor que se mantiene y el aviso explica la duda", () => {
    const [v] = agruparPorVehiculo(JYJ, HOY);
    const r = v.ruedas.find((x) => x.codigo === "E2_DER_EXT")!;
    expect(r.estado).toBe("por_confirmar");
    expect(r.profundidad).toBe(8.5);
    expect(r.pendiente).toBe(1.8);
    expect(r.texto).toBe("8,5");
    expect(r.titulo).toContain("última lectura 1,8 mm el 12/11/2026, sin confirmar");
  });

  it("con rojo y por confirmar, el resumen dice las dos cosas", () => {
    const [v] = agruparPorVehiculo([...JYJ,
      fila({ vehiculo_id: "jyj", matricula: "4310JYJ", posicion_id: "p3", codigo_posicion: "E2_IZQ_EXT", eje: 2, lado: "izq", interior_exterior: "ext",
        profundidad_mm: 3.1, confirmada: true }),
    ], HOY);
    expect(resumenDeTarjeta(v)).toBe("1 rueda · peor 3,1 mm · 1 por confirmar");
  });

  it("la lista para medir con sonda: la lectura más baja primero, con su porqué", () => {
    const vehiculos = agruparPorVehiculo([...JYJ,
      fila({ vehiculo_id: "otro", matricula: "1111BBB", profundidad_mm: 3.5, fecha_revision: "2026-11-11", confirmada: false }),
      fila({ vehiculo_id: "rojo", matricula: "2222CCC", profundidad_mm: 1, confirmada: true }),
    ], HOY);
    const lista = ruedasParaMedirConSonda(vehiculos);
    expect(lista.map((f) => f.matricula)).toEqual(["4310JYJ", "1111BBB"]);
    expect(lista[0]).toMatchObject({ codigo: "E2_DER_EXT", valor: 8.5, enDuda: 1.8, fecha: "2026-11-12" });
    expect(lista[0].motivo).toBe("el arco ha leído 1,8 mm y las anteriores decían 8,5");
    expect(lista[1]).toMatchObject({ valor: 3.5, enDuda: 3.5, fecha: "2026-11-11", motivo: "solo tiene una lectura" });
  });

  it("filtro y orden: los que solo están por confirmar van detrás de los confirmados", () => {
    const vehiculos = agruparPorVehiculo([...JYJ,
      fila({ vehiculo_id: "rojo", matricula: "2222CCC", profundidad_mm: 3.9, confirmada: true }),
      fila({ vehiculo_id: "pres", matricula: "3333DDD", profundidad_mm: 9, presion_aviso_at: "2026-11-12T08:00:00Z" }),
    ], HOY);
    expect(filtrarVehiculos(vehiculos, "confirmar").map((v) => v.matricula)).toEqual(["4310JYJ"]);
    expect(filtrarVehiculos(vehiculos, "cambiar").map((v) => v.matricula)).toEqual(["2222CCC"]);
    expect(ordenarVehiculos(vehiculos, "peor").map((v) => v.matricula)).toEqual(["3333DDD", "2222CCC", "4310JYJ"]);
  });
});
