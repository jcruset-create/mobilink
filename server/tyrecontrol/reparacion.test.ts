/**
 * Qué asistencias se sincronizan y cuáles no.
 *
 * Lo que más importa: que un RPC que toca el histórico técnico de un cliente NO
 * se dispare por una coincidencia de letras en un texto libre.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  accionEnSitio, admiteEnSitio, empresaEnAlcance, empresasPermitidas,
  esResultadoReparacion, esTipoReparacion, evaluarAptitud,
  sincronizacionReparacionActiva,
} from "./reparacion.ts";

const APTA = {
  status: "finalizada",
  tcOperacion: "reparacion_neumatico",
  tcPosicionCodigo: "E2_IZQ_EXT",
  plate: "1234ABC",
};

afterEach(() => {
  delete process.env.TYRE_CONTROL_WRITE_ENABLED;
  delete process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED;
  delete process.env.TYRE_CONTROL_SYNC_COMPANIES;
});

describe("Aptitud", () => {
  it("una reparación marcada y con rueda es apta", () => {
    const r = evaluarAptitud(APTA);
    expect(r.apta).toBe(true);
    if (r.apta) { expect(r.tipo).toBe("pinchazo"); expect(r.resultado).toBe("reparado"); }
  });

  /*
   * «No se pudo reparar, se sustituye la rueda» contiene «repar» y es lo
   * contrario. Por eso la marca es explícita y no se deduce del texto.
   */
  it("sin marca explícita NO se sincroniza, diga lo que diga el texto", () => {
    const r = evaluarAptitud({ ...APTA, tcOperacion: null });
    expect(r).toEqual({ apta: false, motivo: "sin_marca" });
  });

  it("una asistencia sin cerrar no se sincroniza", () => {
    expect(evaluarAptitud({ ...APTA, status: "en_curso" }))
      .toEqual({ apta: false, motivo: "no_finalizada" });
  });

  /* Adivinar la rueda repararía la ficha de otra. */
  it("sin rueda ni neumático no se sincroniza", () => {
    expect(evaluarAptitud({ ...APTA, tcPosicionCodigo: null }))
      .toEqual({ apta: false, motivo: "sin_posicion" });
  });

  it("con neumático explícito basta, aunque no haya posición", () => {
    expect(evaluarAptitud({ ...APTA, tcPosicionCodigo: null, tcNeumaticoId: "neu-1" }).apta).toBe(true);
  });

  /* Las demás operaciones se reconocen para poder decir «todavía no». */
  it("una sustitución se reconoce y se rechaza con su motivo", () => {
    expect(evaluarAptitud({ ...APTA, tcOperacion: "sustitucion_neumatico" }))
      .toEqual({ apta: false, motivo: "operacion_no_soportada" });
  });

  it("un tipo de reparación inventado se rechaza", () => {
    expect(evaluarAptitud({ ...APTA, tcTipoReparacion: "magia" }))
      .toEqual({ apta: false, motivo: "tipo_invalido" });
  });

  it("sin matrícula no hay nada que resolver", () => {
    expect(evaluarAptitud({ ...APTA, plate: "  " }))
      .toEqual({ apta: false, motivo: "sin_matricula" });
  });
});

describe("Catálogos de TyreControl", () => {
  it("solo se admiten los tipos y resultados que TC conoce", () => {
    expect(esTipoReparacion("pinchazo")).toBe(true);
    expect(esTipoReparacion("pinchazo_grande")).toBe(false);
    expect(esResultadoReparacion("reparado")).toBe(true);
    expect(esResultadoReparacion("arreglado")).toBe(false);
  });

  /*
   * La lista de acciones que dejan traza está DENTRO del RPC. Mandar una que no
   * esté cierra la incidencia sin dejar operación, que parece que funcionó.
   */
  it("solo algunos tipos se pueden hacer con la rueda puesta", () => {
    expect(admiteEnSitio("pinchazo")).toBe(true);
    expect(accionEnSitio("pinchazo")).toBe("reparar_pinchazo");
    expect(admiteEnSitio("llanta")).toBe(false);
    expect(accionEnSitio("llanta")).toBeNull();
  });
});

describe("Las dos llaves", () => {
  it("hacen falta las dos", () => {
    expect(sincronizacionReparacionActiva()).toBe(false);
    process.env.TYRE_CONTROL_WRITE_ENABLED = "true";
    expect(sincronizacionReparacionActiva()).toBe(false);
    process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED = "true";
    expect(sincronizacionReparacionActiva()).toBe(true);
  });

  it("solo la general no basta, y solo la de reparación tampoco", () => {
    process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED = "true";
    expect(sincronizacionReparacionActiva()).toBe(false);
  });
});

describe("Despliegue por empresa", () => {
  /* Se empieza por una empresa concreta, no por todas. */
  it("la lista vacía significa NINGUNA", () => {
    expect(empresasPermitidas()).toEqual([]);
    expect(empresaEnAlcance("emp-1")).toBe(false);
  });

  it("solo entra la empresa que se escriba", () => {
    process.env.TYRE_CONTROL_SYNC_COMPANIES = "emp-1, emp-2";
    expect(empresaEnAlcance("emp-1")).toBe(true);
    expect(empresaEnAlcance("emp-3")).toBe(false);
  });

  it("el comodín existe pero hay que escribirlo a propósito", () => {
    process.env.TYRE_CONTROL_SYNC_COMPANIES = "*";
    expect(empresaEnAlcance("la-que-sea")).toBe(true);
    expect(empresaEnAlcance(null)).toBe(false);
  });
});
