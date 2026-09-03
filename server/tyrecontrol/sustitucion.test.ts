/**
 * El dominio de la sustitución: identidad, aptitud y el cerrojo de la llave.
 *
 * Lo que estas pruebas defienden es el detalle que más fácil sería perder al
 * refactorizar: que una cadena vacía no cuenta como identidad, que el DOT no
 * identifica una unidad, y que la llave general de escritura NO enciende de
 * paso la sustitución.
 */

import { describe, expect, it } from "vitest";

import {
  datosParaRpc, esCondicion, esDestinoRetirado, esMotivoDesmontaje,
  evaluarAptitudSustitucion, sincronizacionSustitucionActiva, tieneIdentidad,
} from "./sustitucion.ts";

describe("identidad del neumático entrante", () => {
  it("solo RFID y número de serie identifican una unidad", () => {
    expect(tieneIdentidad({ rfidEpc: "E280-1160" })).toBe(true);
    expect(tieneIdentidad({ numeroSerie: "SN-99" })).toBe(true);
    // El DOT es la semana de fabricación: identifica un lote, no una rueda.
    expect(tieneIdentidad({ dot: "3623" })).toBe(false);
    expect(tieneIdentidad({})).toBe(false);
    expect(tieneIdentidad(null)).toBe(false);
  });

  it("una cadena vacía o de espacios no es identidad", () => {
    expect(tieneIdentidad({ rfidEpc: "" })).toBe(false);
    expect(tieneIdentidad({ numeroSerie: "   " })).toBe(false);
  });

  it("p_datos lleva solo lo que tiene valor, con los nombres de TyreControl", () => {
    expect(datosParaRpc({ rfidEpc: "E280", numeroSerie: "", dot: "3623", proveedor: null }))
      .toEqual({ rfid_epc: "E280", dot: "3623" });
    expect(datosParaRpc(null)).toEqual({});
  });
});

describe("listas cerradas", () => {
  it("no admite valores fuera del CHECK de TyreControl", () => {
    // `montado` existe en la columna pero no es destino de algo recién quitado.
    expect(esDestinoRetirado("montado")).toBe(false);
    expect(esDestinoRetirado("reservado")).toBe(false);
    expect(esDestinoRetirado("almacen")).toBe(true);
    expect(esMotivoDesmontaje("porque_si")).toBe(false);
    expect(esMotivoDesmontaje("pinchazo")).toBe(true);
    expect(esCondicion("recauchutado")).toBe(false);
  });
});

const BASE = {
  status: "finalizada",
  tcOperacion: "sustitucion_neumatico",
  plate: "1234ABC",
  tcPosicionCodigo: "E1_IZQ",
  tcProductoAlmacenId: "prod-1",
};

describe("aptitud de la asistencia", () => {
  it("acepta una sustitución completa y aplica los valores por defecto", () => {
    const r = evaluarAptitudSustitucion(BASE);
    expect(r).toMatchObject({
      apta: true, productoAlmacenId: "prod-1",
      condicion: "nuevo", destinoRetirado: "almacen", motivoDesmontaje: "desgaste",
    });
  });

  it("sin posición no hay sustitución posible: el RPC entra por el montaje", () => {
    expect(evaluarAptitudSustitucion({ ...BASE, tcPosicionCodigo: null }))
      .toMatchObject({ apta: false, motivo: "sin_posicion" });
  });

  it("sin producto de almacén no se puede decir qué se montó", () => {
    expect(evaluarAptitudSustitucion({ ...BASE, tcProductoAlmacenId: "" }))
      .toMatchObject({ apta: false, motivo: "sin_producto" });
  });

  it("una asistencia sin marcar o sin cerrar no entra", () => {
    expect(evaluarAptitudSustitucion({ ...BASE, tcOperacion: "reparacion_neumatico" }))
      .toMatchObject({ apta: false, motivo: "sin_marca" });
    expect(evaluarAptitudSustitucion({ ...BASE, status: "en_curso" }))
      .toMatchObject({ apta: false, motivo: "no_finalizada" });
  });

  it("rechaza destino, motivo y condición inventados", () => {
    expect(evaluarAptitudSustitucion({ ...BASE, tcDestinoRetirado: "papelera" }))
      .toMatchObject({ apta: false, motivo: "destino_invalido" });
    expect(evaluarAptitudSustitucion({ ...BASE, tcMotivoDesmontaje: "capricho" }))
      .toMatchObject({ apta: false, motivo: "motivo_invalido" });
    expect(evaluarAptitudSustitucion({ ...BASE, tcCondicion: "seminuevo" }))
      .toMatchObject({ apta: false, motivo: "condicion_invalida" });
  });
});

describe("la llave de la sustitución", () => {
  const conLlaves = (general?: string, sustitucion?: string) => {
    const antes = [process.env.TYRE_CONTROL_WRITE_ENABLED, process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED];
    if (general == null) delete process.env.TYRE_CONTROL_WRITE_ENABLED;
    else process.env.TYRE_CONTROL_WRITE_ENABLED = general;
    if (sustitucion == null) delete process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED;
    else process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED = sustitucion;
    const r = sincronizacionSustitucionActiva();
    process.env.TYRE_CONTROL_WRITE_ENABLED = antes[0] as string;
    process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED = antes[1] as string;
    return r;
  };

  it("está apagada por defecto", () => {
    expect(conLlaves(undefined, undefined)).toBe(false);
  });

  /*
   * Esta es la prueba que da sentido a que sean dos llaves: encender la
   * escritura general para que funcionen las reparaciones NO puede encender de
   * paso algo que mueve dos neumáticos y consume stock.
   */
  it("la llave general por sí sola no la enciende", () => {
    expect(conLlaves("true", undefined)).toBe(false);
    expect(conLlaves("true", "false")).toBe(false);
  });

  it("tampoco basta con la suya", () => {
    expect(conLlaves("false", "true")).toBe(false);
  });

  it("hacen falta las dos", () => {
    expect(conLlaves("true", "true")).toBe(true);
  });
});
