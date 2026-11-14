import { describe, it, expect } from "vitest";

import {
  resolverEnCatalogo, decidir, separarParaBloque, filasPropuesta, claveDe, porCaso,
  type MedidaCatalogo, type PropuestaGuardada, type Candidata,
} from "./propuestas.ts";
import type { PropuestaMedida } from "./simular.ts";

const CAT: MedidaCatalogo[] = [
  { id: "m-295", valor: "295/80R22.5", activo: true },
  { id: "m-225", valor: "225/75R16", activo: true },
  { id: "m-215", valor: "215/75R17.5", activo: true },
  { id: "m-vieja", valor: "11R22.5", activo: false },
];

const prop = (p: Partial<PropuestaGuardada> = {}): PropuestaGuardada => ({
  id: "p1",
  vehiculoId: "v1",
  matriculaNorm: "1234ABC",
  caso: "sin_medida",
  medidaNorm: "295/80R22.5",
  medidaOrigen: "295/80 R22,5",
  fecha: "2025-04-10",
  idOrigen: "io-1",
  medidaActual: null,
  medidaActualId: null,
  estado: "pendiente",
  seguraParaBloque: true,
  ...p,
});

describe("resolverEnCatalogo", () => {
  it("encuentra el valor exacto", () => {
    const r = resolverEnCatalogo("295/80R22.5", CAT);
    expect(r?.medida.id).toBe("m-295");
    expect(r?.exacta).toBe(true);
    expect(r?.marcadoIgnorado).toBeNull();
  });

  // El caso que de verdad importa: el catálogo no escribe la C y el
  // tacógrafo sí. Exigir coincidencia exacta dejaría estas propuestas
  // bloqueadas por «no está en el catálogo» teniendo la medida delante.
  it("encuentra la medida sin el marcado cuando el catálogo no lo escribe", () => {
    const r = resolverEnCatalogo("225/75R16C", CAT);
    expect(r?.medida.id).toBe("m-225");
    expect(r?.exacta).toBe(false);
    expect(r?.marcadoIgnorado).toBe("C");
  });

  it("no inventa nada si no está ni con marcado ni sin él", () => {
    expect(resolverEnCatalogo("385/65R22.5", CAT)).toBeNull();
  });

  it("prefiere la activa cuando el catálogo tiene la misma medida dos veces", () => {
    const dos: MedidaCatalogo[] = [
      { id: "baja", valor: "315/80R22.5", activo: false },
      { id: "alta", valor: "315/80R22.5", activo: true },
    ];
    expect(resolverEnCatalogo("315/80R22.5", dos)?.medida.id).toBe("alta");
    // Y también cuando llegan en el otro orden: no es el orden de la lista.
    expect(resolverEnCatalogo("315/80R22.5", [...dos].reverse())?.medida.id).toBe("alta");
  });

  it("devuelve la de baja si es la única, para que decidir() pueda decir por qué no", () => {
    const r = resolverEnCatalogo("11R22.5", CAT);
    expect(r?.medida.id).toBe("m-vieja");
    expect(r?.medida.activo).toBe(false);
  });
});

describe("decidir", () => {
  it("acepta una propuesta limpia y dice qué se va a escribir", () => {
    const d = decidir(prop(), CAT, null);
    expect(d.puede).toBe(true);
    expect(d.resuelta?.medida.id).toBe("m-295");
    expect(d.explicacion).toContain("295/80R22.5");
  });

  it("avisa cuando se acepta quitando el marcado, sin callárselo", () => {
    const d = decidir(prop({ medidaNorm: "225/75R16C" }), CAT, null);
    expect(d.puede).toBe(true);
    expect(d.resuelta?.exacta).toBe(false);
    expect(d.explicacion).toContain("225/75R16C");
    expect(d.explicacion).toContain("225/75R16");
    expect(d.explicacion).toContain("sin la C");
  });

  it("no acepta una propuesta sin vehículo: primero hay que enlazarla", () => {
    const d = decidir(prop({ vehiculoId: null, caso: "sin_vehiculo" }), CAT, null);
    expect(d.puede).toBe(false);
    expect(d.motivo).toBe("sin_vehiculo");
  });

  it("no acepta una medida que no está en el catálogo, y no la da de alta", () => {
    const d = decidir(prop({ medidaNorm: "385/65R22.5" }), CAT, null);
    expect(d.puede).toBe(false);
    expect(d.motivo).toBe("fuera_de_catalogo");
    expect(d.explicacion).toContain("Medidas de neumáticos");
  });

  it("no acepta una medida dada de baja sin que alguien la reactive", () => {
    const d = decidir(prop({ medidaNorm: "11R22.5" }), CAT, null);
    expect(d.puede).toBe(false);
    expect(d.motivo).toBe("medida_de_baja");
  });

  it("no acepta una propuesta ya resuelta", () => {
    for (const estado of ["aceptada", "rechazada", "caducada"]) {
      const d = decidir(prop({ estado }), CAT, null);
      expect(d.puede).toBe(false);
      expect(d.motivo).toBe("ya_resuelta");
    }
  });

  // Lo que evita pisar una decisión humana con un dato de un fichero: si
  // alguien puso la medida a mano mientras la propuesta esperaba, se para.
  it("se para si la medida del vehículo ha cambiado desde que se creó", () => {
    const d = decidir(prop(), CAT, "215/75R17.5");
    expect(d.puede).toBe(false);
    expect(d.motivo).toBe("el_vehiculo_cambio");
    expect(d.explicacion).toContain("215/75R17.5");
  });

  it("y también si la ha cambiado al revés: tenía una y ahora no tiene", () => {
    const d = decidir(
      prop({ caso: "discrepa", medidaActual: "215/75R17.5", medidaActualId: "m-215" }),
      CAT, null,
    );
    expect(d.puede).toBe(false);
    expect(d.motivo).toBe("el_vehiculo_cambio");
  });

  // Los 35 casos de «solo el marcado»: el vehículo ya tiene esa medida y el
  // tacógrafo solo la escribe con la C. Aceptar cierra la propuesta sin
  // cambiar el dato, y hay que decirlo: si no, alguien busca qué va a
  // cambiar, no lo encuentra, y la rechaza creyendo que le pisaba la medida.
  it("dice cuando aceptar no va a cambiar nada, porque ya es esa medida", () => {
    const d = decidir(
      prop({ caso: "solo_marcado", medidaNorm: "225/75R16C",
             medidaActual: "225/75R16", medidaActualId: "m-225" }),
      CAT, "225/75R16",
    );
    expect(d.puede).toBe(true);
    expect(d.resuelta?.medida.id).toBe("m-225");
    expect(d.explicacion).toContain("Ya es la medida que tiene");
    expect(d.explicacion).toContain("no cambia el dato");
  });

  it("y cuando SÍ va a cambiarlo no dice que no cambia nada", () => {
    const d = decidir(
      prop({ caso: "discrepa", medidaActual: "225/75R16", medidaActualId: "m-225" }),
      CAT, "225/75R16",
    );
    expect(d.puede).toBe(true);
    expect(d.resuelta?.medida.id).toBe("m-295");
    expect(d.explicacion).not.toContain("no cambia el dato");
  });

  it("acepta una discrepancia real si nada ha cambiado: individual, sí", () => {
    const d = decidir(
      prop({ caso: "discrepa", medidaActual: "215/75R17.5", medidaActualId: "m-215", seguraParaBloque: false }),
      CAT, "215/75R17.5",
    );
    expect(d.puede).toBe(true);
    expect(d.resuelta?.medida.id).toBe("m-295");
  });
});

describe("separarParaBloque", () => {
  const cand = (p: Partial<PropuestaGuardada>, puede = true): Candidata => {
    const pr = prop(p);
    return { propuesta: pr, decision: decidir(pr, CAT, pr.medidaActual) };
  };

  it("deja pasar la coincidencia segura sin medida previa", () => {
    const { aceptables, excluidas } = separarParaBloque([cand({})]);
    expect(aceptables).toHaveLength(1);
    expect(excluidas).toHaveLength(0);
  });

  // El acuerdo, literal: las 19 discrepancias reales solo una a una.
  it("NUNCA mete una discrepancia en el aceptar todo, aunque se pueda aceptar", () => {
    const c = cand({ caso: "discrepa", medidaActual: "215/75R17.5", medidaActualId: "m-215" });
    expect(c.decision.puede).toBe(true);           // individualmente sí
    const { aceptables, excluidas } = separarParaBloque([c]);
    expect(aceptables).toHaveLength(0);            // en bloque no
    expect(excluidas).toHaveLength(1);
  });

  it("excluye la que el fichero marcó con avisos, aunque no tenga medida previa", () => {
    const { aceptables, excluidas } = separarParaBloque([cand({ seguraParaBloque: false })]);
    expect(aceptables).toHaveLength(0);
    expect(excluidas).toHaveLength(1);
  });

  it("excluye la que no se puede aceptar por su propio motivo", () => {
    const { aceptables } = separarParaBloque([cand({ medidaNorm: "385/65R22.5" })]);
    expect(aceptables).toHaveLength(0);
  });

  it("separa una mezcla sin perder ninguna", () => {
    const todas = [
      cand({ id: "a" }),
      cand({ id: "b", caso: "discrepa", medidaActual: "215/75R17.5", medidaActualId: "m-215" }),
      cand({ id: "c", seguraParaBloque: false }),
      cand({ id: "d", medidaNorm: "385/65R22.5" }),
      cand({ id: "e", medidaNorm: "225/75R16C" }),
    ];
    const { aceptables, excluidas } = separarParaBloque(todas);
    expect(aceptables.map((c) => c.propuesta.id).sort()).toEqual(["a", "e"]);
    expect(aceptables.length + excluidas.length).toBe(todas.length);
  });

  it("solo_marcado no entra en bloque: es una diferencia que hay que ver una vez", () => {
    const c = cand({ caso: "solo_marcado", medidaActual: "295/80R22.5", medidaActualId: "m-295" });
    const { aceptables } = separarParaBloque([c]);
    expect(aceptables).toHaveLength(0);
  });
});

describe("filasPropuesta", () => {
  const sim = (p: Partial<PropuestaMedida> = {}): PropuestaMedida => ({
    matriculaNorm: "1234ABC",
    matricula: "1234-ABC",
    vehiculoId: "v1",
    caso: "sin_medida",
    medidaNorm: "295/80R22.5",
    medidaOrigen: "295/80 R22,5",
    fecha: "2025-04-10",
    idOrigen: "io-1",
    medidaActual: null,
    medidaActualId: null,
    seguraParaBloque: true,
    ...p,
  });

  it("pasa la evidencia entera a la fila", () => {
    const [f] = filasPropuesta([sim()], { empresa: "e1", loteId: "l1" });
    expect(f).toMatchObject({
      empresa_id: "e1", lote_id: "l1", vehiculo_id: "v1",
      matricula_norm: "1234ABC", caso: "sin_medida",
      medida_norm: "295/80R22.5", medida_origen: "295/80 R22,5",
      fecha_intervencion: "2025-04-10", id_origen: "io-1",
      segura_para_bloque: true, estado: "pendiente",
      intervencion_id: null,
    });
  });

  it("enlaza con la intervención cuando la fila se insertó", () => {
    const [f] = filasPropuesta([sim()], {
      empresa: "e1", loteId: "l1",
      intervencionPorIdOrigen: new Map([["io-1", "int-7"]]),
    });
    expect(f.intervencion_id).toBe("int-7");
  });

  it("no se queda sin propuesta porque la intervención no se insertara", () => {
    const [f] = filasPropuesta([sim()], {
      empresa: "e1", loteId: "l1", intervencionPorIdOrigen: new Map(),
    });
    expect(f.intervencion_id).toBeNull();
    expect(f.medida_norm).toBe("295/80R22.5");
  });

  // Reimportar el mismo fichero no puede llenar la pantalla de repetidos.
  it("salta las que ya tienen propuesta", () => {
    const ya = new Set([claveDe("1234ABC", "295/80R22.5")]);
    expect(filasPropuesta([sim()], { empresa: "e1", loteId: "l1", yaExisten: ya })).toHaveLength(0);
  });

  it("y respeta una rechazada: no la resucita", () => {
    // `yaExisten` incluye las resueltas a propósito. Si alguien dijo que no a
    // esta medida para esta matrícula, la exportación del mes que viene no
    // puede volver a preguntarlo: el dato es el mismo.
    const ya = new Set([claveDe("1234ABC", "295/80R22.5")]);
    const filas = filasPropuesta([sim(), sim({ matriculaNorm: "9999ZZZ" })],
      { empresa: "e1", loteId: "l1", yaExisten: ya });
    expect(filas.map((f) => f.matricula_norm)).toEqual(["9999ZZZ"]);
  });

  it("la misma matrícula con OTRA medida sí es una propuesta nueva", () => {
    const ya = new Set([claveDe("1234ABC", "295/80R22.5")]);
    const filas = filasPropuesta([sim({ medidaNorm: "215/75R17.5" })],
      { empresa: "e1", loteId: "l1", yaExisten: ya });
    expect(filas).toHaveLength(1);
  });
});

describe("porCaso", () => {
  it("cuenta los cuatro casos, con cero en los que no hay", () => {
    const r = porCaso([
      prop({ caso: "sin_medida" }), prop({ caso: "sin_medida" }),
      prop({ caso: "discrepa" }), prop({ caso: "sin_vehiculo" }),
    ]);
    expect(r).toEqual({ sin_medida: 2, solo_marcado: 0, discrepa: 1, sin_vehiculo: 1 });
  });
});
