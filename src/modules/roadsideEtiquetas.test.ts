/**
 * Las etiquetas de los estados de una asistencia.
 *
 * Se fija aquí una distinción que se pierde con facilidad: la clave interna y
 * la etiqueta NO son lo mismo. `pendiente` es el valor que hay en la base de
 * datos y el que viaja por la API; «Gestionada» es solo cómo se llama de cara
 * a quien lo lee. Renombrar la clave rompería las asistencias ya guardadas,
 * las APK que aún no se han actualizado y la integración con Central.
 */

import { describe, expect, it } from "vitest";

import {
  ROADSIDE_ASSISTANCE_STATUS_FLOW,
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "./roadsideAssistanceTypes";

describe("etiquetas de estado", () => {
  it("el primer paso se llama «Gestionada», no «Pendiente»", () => {
    expect(ROADSIDE_ASSISTANCE_STATUS_LABELS.pendiente).toBe("Gestionada");
  });

  it("la clave interna sigue siendo `pendiente`", () => {
    // Si esto falla, alguien ha renombrado el valor y no solo la etiqueta.
    expect(ROADSIDE_ASSISTANCE_STATUS_FLOW[0]).toBe("pendiente");
  });

  it("ningún estado se queda sin etiqueta", () => {
    for (const estado of ROADSIDE_ASSISTANCE_STATUS_FLOW) {
      expect(ROADSIDE_ASSISTANCE_STATUS_LABELS[estado]).toBeTruthy();
    }
  });

  it("no queda ninguna etiqueta con la palabra «Pendiente»", () => {
    const etiquetas = Object.values(ROADSIDE_ASSISTANCE_STATUS_LABELS);
    expect(etiquetas.filter((e) => /pendiente/i.test(e))).toEqual([]);
  });
});
