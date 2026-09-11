import { describe, expect, it } from "vitest";
import {
  huellaDeJornada,
  puertaDeCierre,
  type CotejoGuardado,
} from "./puertaDeCierre.ts";

const HUELLA = huellaDeJornada({ ultimaOperacionId: 120, sumaCentimos: 88740 });

const cotejo = (cuadra: boolean, huella = HUELLA): CotejoGuardado => ({
  cuadra,
  huella,
  creadoEnMs: 1_757_000_000_000,
});

describe("no se cierra sin haber cotejado", () => {
  it("sin cotejo, no se cierra", () => {
    expect(puertaDeCierre(null, HUELLA, null)).toEqual({ deja: "PARA", motivo: "FALTA_COTEJO" });
  });

  it("con el cotejo en verde y al día, se cierra sin más", () => {
    expect(puertaDeCierre(cotejo(true), HUELLA, null)).toEqual({ deja: "SIGUE", forzado: false });
  });

  it("con el cotejo en rojo, no se cierra de corrido", () => {
    expect(puertaDeCierre(cotejo(false), HUELLA, null)).toEqual({
      deja: "PARA",
      motivo: "COTEJO_NO_CUADRA",
    });
  });
});

describe("un cotejo caduca en cuanto se toca la jornada", () => {
  /*
   * Es la mitad del valor de la puerta. Cotejar a las seis, meter dos cobros a
   * las siete y cerrar a las ocho enseñando el OK de las seis es PEOR que no
   * cotejar: da por revisado algo que nadie ha mirado.
   */
  it("el OK de antes no vale si después se metió un cobro", () => {
    const despues = huellaDeJornada({
      ultimaOperacionId: 121,
      sumaCentimos: 93740,
    });
    expect(puertaDeCierre(cotejo(true), despues, null)).toEqual({
      deja: "PARA",
      motivo: "COTEJO_CADUCADO",
    });
  });

  it("la huella cambia al corregir un importe", () => {
    const a = huellaDeJornada({ ultimaOperacionId: 120, sumaCentimos: 88740 });
    const b = huellaDeJornada({ ultimaOperacionId: 120, sumaCentimos: 88750 });
    expect(a).not.toBe(b);
  });

  it("y al anular la última, que deja el id donde estaba", () => {
    /*
     * La anulación no crea una operación con id mayor: le cambia el estado a la
     * que había. Mirando solo el máximo, la jornada parecería intacta — y la
     * caza la suma, porque todo importe es mayor que cero.
     */
    const antes = huellaDeJornada({ ultimaOperacionId: 120, sumaCentimos: 88740 });
    const despues = huellaDeJornada({
      ultimaOperacionId: 120,
      sumaCentimos: 75031,
    });
    expect(antes).not.toBe(despues);
  });

  it("y al cambiar un cobro por otro del mismo importe, que no mueve la suma", () => {
    const antes = huellaDeJornada({ ultimaOperacionId: 120, sumaCentimos: 88740 });
    const despues = huellaDeJornada({
      ultimaOperacionId: 121,
      sumaCentimos: 88740,
    });
    expect(antes).not.toBe(despues);
  });
});

describe("la llave: forzar se puede, pero firmando", () => {
  it("con motivo escrito se cierra aunque no haya cotejo", () => {
    /*
     * EL CASO QUE HACE FALTA QUE FUNCIONE. Si el servicio que lee la captura
     * está caído, no hay manera humana de producir un cotejo, y la caja tiene
     * que poder cerrarse igual. Un bloqueo duro aquí deja al mostrador sin
     * cerrar por algo que no tiene que ver con el dinero.
     */
    expect(puertaDeCierre(null, HUELLA, "El servicio de lectura no responde")).toEqual({
      deja: "SIGUE",
      forzado: true,
    });
  });

  it("también con el cotejo en rojo y con el caducado", () => {
    expect(puertaDeCierre(cotejo(false), HUELLA, "Revisado a mano con Genes")).toEqual({
      deja: "SIGUE",
      forzado: true,
    });
    expect(puertaDeCierre(cotejo(true), "otra", "Revisado a mano")).toEqual({
      deja: "SIGUE",
      forzado: true,
    });
  });

  it("un motivo en blanco NO es una llave", () => {
    /*
     * Si valiera, la pantalla podría mandar un string vacío y la puerta se
     * abriría sola. El motivo es lo único que queda escrito de por qué se
     * saltó la comprobación: sin él no hay decisión, hay un atajo.
     */
    expect(puertaDeCierre(null, HUELLA, "   ")).toEqual({ deja: "PARA", motivo: "FALTA_COTEJO" });
    expect(puertaDeCierre(null, HUELLA, "")).toEqual({ deja: "PARA", motivo: "FALTA_COTEJO" });
  });

  it("lo que cuadra NO se marca como forzado aunque venga motivo", () => {
    /*
     * No se ha saltado ninguna comprobación. Anotar «cierre forzado» en una
     * jornada que cuadraba sería mentir en el histórico, y el día que alguien
     * busque los cierres forzados se encontraría ruido.
     */
    expect(puertaDeCierre(cotejo(true), HUELLA, "por si acaso")).toEqual({
      deja: "SIGUE",
      forzado: false,
    });
  });
});
