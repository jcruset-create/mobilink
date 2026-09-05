/**
 * Los textos y los cálculos de la parte interna.
 *
 * Dos cosas importan de verdad aquí: que no se diga «enviada» de algo que no se
 * ha mandado, y que no se enseñe un tiempo que no se puede calcular.
 */

import { describe, expect, it } from "vitest";

import {
  MOTIVO_CASO, duracion, estadoEncuesta, etiqueta, tramos,
} from "./etiquetas";

describe("estado de la encuesta", () => {
  /*
   * Mientras no exista el envío real, QUEUED no puede decir «enviada»: la ficha
   * afirmaría que al cliente le llegó algo que nadie mandó.
   */
  it("QUEUED dice «en cola», no «enviada»", () => {
    expect(estadoEncuesta("QUEUED").texto).toBe("En cola de envío");
    expect(estadoEncuesta("QUEUED").texto.toLowerCase()).not.toContain("enviad");
  });

  it("sin encuesta se dice, no se deja en blanco", () => {
    expect(estadoEncuesta(null)).toEqual({ texto: "Sin encuesta", tono: "apagado" });
    expect(estadoEncuesta(undefined).texto).toBe("Sin encuesta");
  });

  it("un estado desconocido se enseña tal cual en vez de desaparecer", () => {
    expect(estadoEncuesta("INVENTADO").texto).toBe("INVENTADO");
  });

  it("respondida y caducada se distinguen", () => {
    expect(estadoEncuesta("COMPLETED").tono).toBe("bien");
    expect(estadoEncuesta("EXPIRED").tono).toBe("apagado");
  });
});

describe("motivos del expediente", () => {
  /*
   * LA distinción de esta fase: la encuesta ALEGA daños. Que los hubiera lo
   * decide el supervisor al cerrar el caso.
   */
  it("los daños son una alegación, no un hecho confirmado", () => {
    expect(MOTIVO_CASO.VEHICLE_DAMAGE).toBe("Daños alegados en el vehículo");
    expect(MOTIVO_CASO.VEHICLE_DAMAGE.toLowerCase()).not.toContain("confirmad");
  });

  it("un código nuevo no rompe la pantalla", () => {
    expect(etiqueta(MOTIVO_CASO, "MOTIVO_FUTURO")).toBe("MOTIVO_FUTURO");
    expect(etiqueta(MOTIVO_CASO, null)).toBe("—");
  });
});

describe("tiempos del servicio", () => {
  const T = 1_700_000_000_000;

  it("calcula los tramos que tienen sus dos extremos", () => {
    const r = tramos({
      solicitada: T, asignada: T + 5 * 60_000, enCamino: T + 10 * 60_000,
      enPunto: T + 40 * 60_000, finalizada: T + 100 * 60_000,
    });
    expect(r.map((x) => x.etiqueta))
      .toEqual(["Hasta asignar", "Hasta salir", "Desplazamiento", "En el punto", "Total"]);
    expect(r[0].ms).toBe(5 * 60_000);
    expect(r[4].ms).toBe(100 * 60_000);
  });

  /*
   * Sin hora de llegada NO hay «desplazamiento». No es cero: es que no se sabe,
   * y en una pantalla donde alguien juzga si hubo demora, inventarlo es peor
   * que no darlo.
   */
  it("un tramo sin uno de sus extremos no se inventa", () => {
    const r = tramos({ solicitada: T, asignada: T + 60_000, enPunto: null, finalizada: null });
    expect(r.map((x) => x.etiqueta)).toEqual(["Hasta asignar"]);
  });

  it("sin ningún dato no se enseña nada", () => {
    expect(tramos({})).toEqual([]);
  });

  it("unas fechas al revés se descartan en vez de dar un tiempo negativo", () => {
    expect(tramos({ solicitada: T + 60_000, asignada: T })).toEqual([]);
  });
});

describe("formato de duración", () => {
  it("minutos sueltos, y horas cuando toca", () => {
    expect(duracion(18 * 60_000)).toBe("18 min");
    expect(duracion(60 * 60_000)).toBe("1 h");
    expect(duracion(85 * 60_000)).toBe("1 h 25 min");
    expect(duracion(0)).toBe("0 min");
  });
});
