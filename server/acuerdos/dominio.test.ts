/**
 * Reglas del acuerdo comercial, sin base de datos.
 *
 * Se prueba lo que se pacta de verdad y lo que se olvida siempre: la guardia
 * que cruza la medianoche, la exclusión de un código postal dentro de una
 * provincia incluida, y que un acuerdo antiguo —sin ninguno de estos campos—
 * siga cubriendo todo en vez de quedarse cerrado.
 */

import { describe, expect, it } from "vitest";

import {
  abiertoEn, evaluar, leerCobertura, leerHorario, vigente, type Acuerdo,
} from "./dominio.ts";

function acuerdo(cambios: Partial<Acuerdo> = {}): Acuerdo {
  return {
    id: 1, controlCenterId: 1, providerCompanyId: 1, status: "active",
    serviciosCubiertos: [],
    cobertura: leerCobertura({}),
    horario: leerHorario({}),
    economico: { moneda: "EUR", limiteSinPresupuesto: null, limiteMaximo: null, presupuestoObligatorio: false },
    condiciones: { documentacionExigida: [], cancelacionSinCosteMin: null, cancelacionCoste: null, cancelacionEnPorcentaje: false },
    slaAcceptMin: null, slaArrivalMin: null, maxConcurrent: null,
    preferred: false, excluded: false, validFromMs: null, validToMs: null,
    ...cambios,
  };
}

describe("Cobertura", () => {
  it("un acuerdo antiguo, sin nada pactado, cubre todo", () => {
    const r = evaluar(acuerdo(), { servicio: "tow_truck", provincia: "Teruel", codigoPostal: "44001" });
    expect(r.apto).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  it("respeta la provincia pactada, con acentos o sin ellos", () => {
    const a = acuerdo({ cobertura: leerCobertura({ provincias: ["Álava", "Tarragona"] }) });
    expect(evaluar(a, { provincia: "Alava" }).apto).toBe(true);
    expect(evaluar(a, { provincia: "Teruel" }).apto).toBe(false);
  });

  it("un prefijo de código postal cubre toda su zona", () => {
    const a = acuerdo({ cobertura: leerCobertura({ codigosPostales: ["43"] }) });
    expect(evaluar(a, { codigoPostal: "43201" }).apto).toBe(true);
    expect(evaluar(a, { codigoPostal: "08001" }).apto).toBe(false);
  });

  /* Se pacta justo para recortar una zona ya incluida: tiene que ganar. */
  it("la exclusión gana sobre la inclusión", () => {
    const a = acuerdo({
      cobertura: leerCobertura({ provincias: ["Barcelona"], codigosPostalesExcluidos: ["0800"] }),
    });
    expect(evaluar(a, { provincia: "Barcelona", codigoPostal: "08192" }).apto).toBe(true);
    const fuera = evaluar(a, { provincia: "Barcelona", codigoPostal: "08001" });
    expect(fuera.apto).toBe(false);
    expect(fuera.motivos[0]).toContain("excluido");
  });

  /* Quien pactó «Tarragona» y quien pactó «43» dicen lo mismo. */
  it("provincia y código postal son alternativas, no requisitos a la vez", () => {
    const a = acuerdo({ cobertura: leerCobertura({ provincias: ["Tarragona"], codigosPostales: ["08"] }) });
    expect(evaluar(a, { provincia: "Tarragona", codigoPostal: "43001" }).apto).toBe(true);
    expect(evaluar(a, { provincia: "Barcelona", codigoPostal: "08001" }).apto).toBe(true);
  });

  it("el radio descarta lo que queda lejos, y lo dice en km", () => {
    const a = acuerdo({ cobertura: leerCobertura({ radioKm: 60 }) });
    expect(evaluar(a, { distanciaKm: 40 }).apto).toBe(true);
    const lejos = evaluar(a, { distanciaKm: 180 });
    expect(lejos.apto).toBe(false);
    expect(lejos.motivos[0]).toContain("180 km");
  });

  it("el país se compara en mayúsculas", () => {
    const a = acuerdo({ cobertura: leerCobertura({ paises: ["es", "PT"] }) });
    expect(evaluar(a, { pais: "es" }).apto).toBe(true);
    expect(evaluar(a, { pais: "fr" }).apto).toBe(false);
  });
});

describe("Horario", () => {
  const lunes10 = new Date(2026, 0, 5, 10, 0);   // 2026-01-05 es lunes
  const lunes23 = new Date(2026, 0, 5, 23, 0);
  const martes3 = new Date(2026, 0, 6, 3, 0);

  it("sin horario declarado es 24 h: nadie pactó cerrar", () => {
    expect(abiertoEn(leerHorario({}), lunes23)).toBe(true);
    expect(abiertoEn(leerHorario({ franjas: [] }), lunes23)).toBe(true);
  });

  it("una franja normal abre y cierra el mismo día", () => {
    const h = leerHorario({ franjas: [{ dia: 1, inicio: "08:00", fin: "18:00" }] });
    expect(abiertoEn(h, lunes10)).toBe(true);
    expect(abiertoEn(h, lunes23)).toBe(false);
  });

  /* La guardia de 22:00 a 06:00 es el caso normal en carretera. */
  it("una guardia que cruza la medianoche sigue abierta de madrugada", () => {
    const h = leerHorario({ franjas: [{ dia: 1, inicio: "22:00", fin: "06:00" }] });
    expect(abiertoEn(h, lunes23)).toBe(true);
    expect(abiertoEn(h, martes3)).toBe(true);
    expect(abiertoEn(h, lunes10)).toBe(false);
  });

  it("24 h ignora las franjas", () => {
    const h = leerHorario({ veinticuatroHoras: true, franjas: [{ dia: 1, inicio: "08:00", fin: "09:00" }] });
    expect(abiertoEn(h, martes3)).toBe(true);
  });

  it("fuera de horario se dice, no se calla", () => {
    const a = acuerdo({ horario: leerHorario({ franjas: [{ dia: 1, inicio: "08:00", fin: "18:00" }] }) });
    expect(evaluar(a, { cuando: lunes23 }).motivos).toContain("Fuera del horario pactado");
  });
});

describe("Vigencia y estado", () => {
  it("un acuerdo caducado no está vigente", () => {
    const a = acuerdo({ validToMs: Date.now() - 1000 });
    expect(vigente(a)).toBe(false);
    expect(evaluar(a, {}).motivos).toContain("Acuerdo no vigente");
  });

  it("un acuerdo futuro tampoco", () => {
    expect(vigente(acuerdo({ validFromMs: Date.now() + 60_000 }))).toBe(false);
  });

  it("un partner excluido se dice por su nombre", () => {
    expect(evaluar(acuerdo({ excluded: true }), {}).motivos).toContain("Partner excluido");
  });

  it("suspendido no es lo mismo que borrado, pero no trabaja", () => {
    expect(vigente(acuerdo({ status: "suspended" }))).toBe(false);
  });
});

describe("Servicios y dinero", () => {
  it("una lista de servicios vacía significa todos", () => {
    expect(evaluar(acuerdo({ serviciosCubiertos: [] }), { servicio: "tyres" }).apto).toBe(true);
  });

  it("un servicio fuera de la lista se descarta con su nombre", () => {
    const a = acuerdo({ serviciosCubiertos: ["tow_truck"] });
    expect(evaluar(a, { servicio: "tyres" }).motivos).toContain("No cubre el servicio tyres");
  });

  it("por encima del tope no se encarga", () => {
    const a = acuerdo({ economico: { moneda: "EUR", limiteSinPresupuesto: null, limiteMaximo: 300, presupuestoObligatorio: false } });
    expect(evaluar(a, { importeEstimado: 250 }).apto).toBe(true);
    expect(evaluar(a, { importeEstimado: 400 }).apto).toBe(false);
  });

  /*
   * Lo que separa «no puede» de «hay que preguntar antes»: confundirlos
   * dejaría fuera justo a los partners con los que aún no hay tarifa cerrada.
   */
  it("pedir presupuesto NO descarta al partner", () => {
    const a = acuerdo({ economico: { moneda: "EUR", limiteSinPresupuesto: 200, limiteMaximo: null, presupuestoObligatorio: false } });
    const r = evaluar(a, { importeEstimado: 500 });
    expect(r.apto).toBe(true);
    expect(r.requierePresupuesto).toBe(true);
  });

  it("por debajo del umbral se encarga directo", () => {
    const a = acuerdo({ economico: { moneda: "EUR", limiteSinPresupuesto: 200, limiteMaximo: null, presupuestoObligatorio: false } });
    expect(evaluar(a, { importeEstimado: 120 }).requierePresupuesto).toBe(false);
  });

  it("un partner que siempre presupuesta lo pide aunque no haya importe", () => {
    const a = acuerdo({ economico: { moneda: "EUR", limiteSinPresupuesto: null, limiteMaximo: null, presupuestoObligatorio: true } });
    expect(evaluar(a, {}).requierePresupuesto).toBe(true);
  });
});

/*
 * Arreglar la zona para descubrir después que tampoco era el horario es
 * perder dos viajes.
 */
describe("Los motivos se dan todos a la vez", () => {
  it("acumula zona, horario y servicio", () => {
    const a = acuerdo({
      serviciosCubiertos: ["tow_truck"],
      cobertura: leerCobertura({ provincias: ["Tarragona"] }),
      horario: leerHorario({ franjas: [{ dia: 1, inicio: "08:00", fin: "18:00" }] }),
    });
    const r = evaluar(a, { servicio: "tyres", provincia: "Teruel", cuando: new Date(2026, 0, 5, 23, 0) });
    expect(r.apto).toBe(false);
    expect(r.motivos.length).toBe(3);
  });
});

describe("Lectura tolerante", () => {
  it("una cobertura corrupta no revienta: se lee como vacía", () => {
    expect(leerCobertura("{no es json").provincias).toEqual([]);
    expect(leerCobertura(null).paises).toEqual([]);
  });

  it("una hora mal escrita se ignora, no cierra el acuerdo entero", () => {
    const h = leerHorario({ franjas: [{ dia: 1, inicio: "99:99", fin: "18:00" }] });
    expect(h.veinticuatroHoras).toBe(true);
  });

  it("acepta el horario tanto en minutos como en HH:MM", () => {
    const h = leerHorario({ franjas: [{ dia: 3, inicio: 480, fin: 1080 }] });
    expect(abiertoEn(h, new Date(2026, 0, 7, 10, 0))).toBe(true);
  });
});
