/**
 * La validación de la configuración que llega por la API.
 *
 * Pura, sin base de datos: lo que se fija es qué se acepta, qué se rechaza y
 * —sobre todo— que por aquí NO entra nada de Twilio. Las credenciales y los
 * Content SID viven en variables de entorno; quien administra un taller no
 * tiene por qué poder cambiar con qué cuenta se manda un WhatsApp.
 */

import { describe, expect, it } from "vitest";

import { leerConfig } from "./configEntrada.ts";

describe("configuración de Satisfaction", () => {
  it("acepta los interruptores y los números dentro de rango", () => {
    const { cambios, errores } = leerConfig({
      activo: true, conductor: true, cliente: false, recordatorio: true,
      caducidadHoras: 168, retrasoMinutos: 60, recordatorioHoras: 24,
    });
    expect(errores).toEqual([]);
    expect(cambios).toEqual({
      activo: true, conductor: true, cliente: false, recordatorio: true,
      caducidadHoras: 168, retrasoMinutos: 60, recordatorioHoras: 24,
    });
  });

  it("solo cambia lo que se manda: lo ausente se queda como estaba", () => {
    const { cambios } = leerConfig({ activo: true });
    expect(cambios).toEqual({ activo: true });
  });

  it("un interruptor tiene que ser booleano, no «true» de texto", () => {
    const { cambios, errores } = leerConfig({ activo: "true" });
    expect(cambios).toEqual({});
    expect(errores[0]).toMatch(/activo/);
  });

  it("rechaza números fuera de rango en vez de recortarlos por su cuenta", () => {
    expect(leerConfig({ caducidadHoras: 0 }).errores).toHaveLength(1);
    expect(leerConfig({ caducidadHoras: 99999 }).errores).toHaveLength(1);
    expect(leerConfig({ recordatorioHoras: -5 }).errores).toHaveLength(1);
    expect(leerConfig({ retrasoMinutos: 0 }).errores).toEqual([]);  // cero sí vale
  });

  it("lo que no es un número no pasa", () => {
    expect(leerConfig({ caducidadHoras: "muchas" }).errores).toHaveLength(1);
  });

  it("NO deja entrar nada de Twilio ni ninguna clave", () => {
    const { cambios } = leerConfig({
      activo: true,
      TWILIO_ACCOUNT_SID: "ACloquesea",
      contentSid: "HXloquesea",
      twilioAuthToken: "secreto",
      plantillas: { driverInitial: "HX" },
    });
    expect(cambios).toEqual({ activo: true });
    expect(JSON.stringify(cambios)).not.toMatch(/HX|AC|secreto/);
  });
});
