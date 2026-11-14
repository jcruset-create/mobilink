import { describe, expect, it } from "vitest";
import {
  accionDeFila, borradorVacio, datosMedicion, descripcionNeumatico, etiquetaNeumatico,
  filasDelPlano, planoCompleto, posicionesSinInformar, resumen, validarFila,
  type BorradorFila, type FilaMontada,
} from "./neumaticosMontados";
import type { MontajeActual, Neumatico, PosicionVehiculo } from "../types";

/**
 * Lo que se fija aquí es la frontera entre las tres cosas que esta pantalla
 * puede hacer y que el histórico NO confunde:
 *
 *  - informar una goma que ya estaba puesta (ni venta, ni taller, ni stock),
 *  - corregir qué goma hay registrada (no es un cambio de neumático),
 *  - y medir.
 *
 * Y sobre todo: que una fila que nadie ha tocado no escribe nada. Repasar un
 * plano de doce ruedas para arreglar una no puede reescribir las otras once.
 */

const pos = (p: Partial<PosicionVehiculo> & { id: string }): PosicionVehiculo => ({
  tipo_vehiculo_id: "t", codigo_posicion: p.id.toUpperCase(), orden_visual: 1, activo: true, ...p,
});

const neu = (n: Partial<Neumatico> & { id: string }): Neumatico => ({
  empresa_id: "e", estado: "montado", ...n,
} as Neumatico);

const montaje = (m: Partial<MontajeActual> & { id: string; posicion_id: string }): MontajeActual => ({
  empresa_id: "e", vehiculo_id: "v", neumatico_id: "n", fecha_montaje: "2026-01-01", ...m,
});

const libre: FilaMontada = { posicionId: "p1", codigo: "Eje 1 izq", orden: 1, montajeId: null, neumatico: null };
const informada: FilaMontada = {
  posicionId: "p2", codigo: "Eje 1 der", orden: 2, montajeId: "m2",
  neumatico: neu({ id: "n2", numero_interno: "NT-2026-000007", marca: "Michelin", medida: "295/80R22.5" }),
};

const b = (p: Partial<BorradorFila> = {}): BorradorFila => ({ ...borradorVacio(), ...p });

describe("filasDelPlano", () => {
  it("manda el orden de revisión, y el visual solo desempata", () => {
    const posiciones = [
      pos({ id: "a", orden_visual: 1, orden_revision: 3 }),
      pos({ id: "b", orden_visual: 2, orden_revision: 1 }),
      pos({ id: "c", orden_visual: 3 }), // sin orden de revisión: al final
    ];
    expect(filasDelPlano(posiciones, []).map((f) => f.posicionId)).toEqual(["b", "a", "c"]);
  });

  it("las posiciones dadas de baja no salen: no son ruedas de este vehículo", () => {
    const posiciones = [pos({ id: "a" }), pos({ id: "z", activo: false, orden_visual: 2 })];
    expect(filasDelPlano(posiciones, []).map((f) => f.posicionId)).toEqual(["a"]);
  });

  it("cada fila trae su montaje y su goma, y la libre viene vacía", () => {
    const posiciones = [pos({ id: "a" }), pos({ id: "b", orden_visual: 2 })];
    const filas = filasDelPlano(posiciones, [
      montaje({ id: "m1", posicion_id: "a", neumatico: neu({ id: "n1" }) }),
    ]);
    expect(filas[0].montajeId).toBe("m1");
    expect(filas[0].neumatico?.id).toBe("n1");
    expect(filas[1].montajeId).toBeNull();
    expect(filas[1].neumatico).toBeNull();
  });

  it("el nombre de la posición manda sobre el código, que es interno", () => {
    const filas = filasDelPlano([pos({ id: "a", codigo_posicion: "1I", nombre: "Eje 1 izq" })], []);
    expect(filas[0].codigo).toBe("Eje 1 izq");
  });
});

describe("accionDeFila", () => {
  it("una fila que nadie ha tocado no escribe nada", () => {
    expect(accionDeFila(libre, b())).toBe("nada");
    expect(accionDeFila(informada, b())).toBe("nada");
  });

  it("posición libre con referencia elegida: se informa", () => {
    expect(accionDeFila(libre, b({ referenciaId: "r1", profundidadMm: "12" }))).toBe("informar");
  });

  it("posición libre con profundidad pero sin referencia: nada, porque no se sabe qué goma es", () => {
    expect(accionDeFila(libre, b({ profundidadMm: "12" }))).toBe("nada");
  });

  it("posición informada que coincide y lleva profundidad nueva: solo se mide", () => {
    expect(accionDeFila(informada, b({ profundidadMm: "9" }))).toBe("medir");
  });

  it("la presión sola no abre una revisión", () => {
    expect(accionDeFila(informada, b({ presionBar: "8.5" }))).toBe("nada");
  });

  it("no coincide: se corrige el registro, con ficha o creándola", () => {
    expect(accionDeFila(informada, b({ coincide: false, neumaticoCorrectoId: "n9" }))).toBe("corregir");
    expect(accionDeFila(informada, b({ coincide: false, correccion: "nueva" }))).toBe("corregir_nueva");
  });

  it("corregir manda sobre medir: una sola fila no hace dos cosas a medias", () => {
    const accion = accionDeFila(informada, b({ coincide: false, neumaticoCorrectoId: "n9", profundidadMm: "9" }));
    expect(accion).toBe("corregir");
  });
});

describe("validarFila", () => {
  it("lo que no se va a enviar no se valida: la fila intacta no estorba", () => {
    expect(validarFila(libre, b())).toBeNull();
    expect(validarFila(informada, b({ presionBar: "99" }))).toBeNull();
  });

  it("informar sin profundidad se para: es el dato por el que existe TyreControl", () => {
    expect(validarFila(libre, b({ referenciaId: "r1" }))).toMatch(/profundidad/i);
  });

  it("corregir SIN profundidad vale: cambiar la ficha y medir son dos días distintos", () => {
    expect(validarFila(informada, b({ coincide: false, neumaticoCorrectoId: "n9" }))).toBeNull();
  });

  it("corregir sin decir cuál es la goma de verdad se para", () => {
    expect(validarFila(informada, b({ coincide: false }))).toMatch(/ficha/i);
  });

  it("dar de alta la goma encontrada necesita al menos marca y medida", () => {
    expect(validarFila(informada, b({ coincide: false, correccion: "nueva", medida: "315/70R22.5" })))
      .toMatch(/marca/i);
    expect(validarFila(informada, b({ coincide: false, correccion: "nueva", marca: "Michelin" })))
      .toMatch(/medida/i);
    expect(validarFila(informada, b({ coincide: false, correccion: "nueva", marca: "Michelin", medida: "315/70R22.5" })))
      .toBeNull();
  });

  it("profundidades imposibles, las mismas que rechaza la base", () => {
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "-1" }))).toMatch(/imposible/i);
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "31" }))).toMatch(/imposible/i);
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "30" }))).toBeNull();
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "0" }))).toBeNull();
  });

  it("la coma decimal es válida: el teclado del taller la pone sola", () => {
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "12,5" }))).toBeNull();
  });

  it("lo que no es un número se dice, en vez de mandarlo y que reviente la base", () => {
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "doce" }))).toMatch(/número/i);
  });

  it("presión cero no es «no medida»: cero es rueda desinflada", () => {
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "12", presionBar: "0" })))
      .toMatch(/imposible/i);
  });

  it("la presión en blanco no estorba: no siempre se lleva el manómetro", () => {
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "12", presionBar: "" }))).toBeNull();
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "12", presionBar: "15" }))).toBeNull();
    expect(validarFila(libre, b({ referenciaId: "r1", profundidadMm: "12", presionBar: "15.1" })))
      .toMatch(/imposible/i);
  });
});

describe("datosMedicion", () => {
  it("lo que está en blanco no viaja", () => {
    expect(datosMedicion(b({ profundidadMm: "12" }))).toEqual({ profundidad_mm: "12" });
  });

  it("la coma se normaliza a punto antes de salir", () => {
    expect(datosMedicion(b({ profundidadMm: "12,5", presionBar: "8,25" })))
      .toEqual({ profundidad_mm: "12.5", presion_bar: "8.25" });
  });

  it("serie, DOT y observaciones van recortados y solo si los hay", () => {
    expect(datosMedicion(b({ profundidadMm: "12", numeroSerie: "  AB12  ", dot: " 1422 ", observaciones: "   " })))
      .toEqual({ profundidad_mm: "12", numero_serie: "AB12", dot: "1422" });
  });
});

describe("resumen", () => {
  const filas = [libre, informada];

  it("cuenta por separado lo que es informar, corregir y medir", () => {
    const r = resumen(filas, {
      p1: b({ referenciaId: "r1", profundidadMm: "14" }),
      p2: b({ coincide: false, neumaticoCorrectoId: "n9" }),
    });
    expect(r).toMatchObject({ informar: 1, corregir: 1, medir: 0, total: 2 });
    expect(r.errores).toEqual([]);
  });

  it("una fila con error no se cuenta como trabajo y dice de qué rueda es", () => {
    const r = resumen(filas, { p1: b({ referenciaId: "r1" }) });
    expect(r.total).toBe(0);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].codigo).toBe("Eje 1 izq");
  });

  it("un plano entero sin tocar no propone nada", () => {
    expect(resumen(filas, {})).toMatchObject({ total: 0, errores: [] });
  });
});

describe("planoCompleto y posicionesSinInformar", () => {
  it("falta una rueda: no se puede cerrar y se dice cuál", () => {
    expect(planoCompleto([libre, informada])).toBe(false);
    expect(posicionesSinInformar([libre, informada])).toEqual(["Eje 1 izq"]);
  });

  it("con todas informadas se puede cerrar", () => {
    expect(planoCompleto([informada])).toBe(true);
    expect(posicionesSinInformar([informada])).toEqual([]);
  });

  it("un vehículo sin plano no está completo: no hay nada que cerrar", () => {
    expect(planoCompleto([])).toBe(false);
  });
});

describe("etiquetas", () => {
  it("el número interno manda; si no lo hay se baja al código y a la serie", () => {
    expect(etiquetaNeumatico(neu({ id: "n", numero_interno: "NT-1", codigo_interno: "C" }))).toBe("NT-1");
    expect(etiquetaNeumatico(neu({ id: "n", codigo_interno: "C", numero_serie: "S" }))).toBe("C");
    expect(etiquetaNeumatico(neu({ id: "n", numero_serie: "S" }))).toBe("S");
    expect(etiquetaNeumatico(null)).toBe("—");
  });

  it("la descripción no deja separadores sueltos cuando falta el modelo", () => {
    expect(descripcionNeumatico(neu({ id: "n", marca: "Michelin", medida: "295/80R22.5" })))
      .toBe("Michelin · 295/80R22.5");
    expect(descripcionNeumatico(neu({ id: "n" }))).toBe("—");
  });
});
