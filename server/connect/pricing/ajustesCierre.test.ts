/**
 * Los ajustes del cierre automático.
 *
 * Lo que más importa aquí es una sola cosa: que **de fábrica esté apagado**.
 * Un cierre que se enciende solo cerraría tarifas de forma irreversible en
 * centrales que no lo han pedido.
 */

import { describe, expect, it } from "vitest";
import { leerAjustesCierre, ESPERA_POR_DEFECTO_MIN } from "./ajustesCierre.ts";

describe("Ajustes del cierre automático", () => {
  it("de fábrica está APAGADO", () => {
    for (const v of [null, undefined, "", "{}", "{roto", '{"otra":"cosa"}', {}]) {
      expect(leerAjustesCierre(v).activo, String(v)).toBe(false);
    }
  });

  it("solo se activa con un true explícito", () => {
    /*
     * Nada de valores "que parecen sí". Encender esto cierra tarifas de forma
     * irreversible: tiene que haberlo puesto alguien a propósito.
     */
    for (const v of ["true", 1, "sí", "on", {}]) {
      expect(leerAjustesCierre({ pricing: { cierreAutomatico: v } }).activo, String(v)).toBe(false);
    }
    expect(leerAjustesCierre({ pricing: { cierreAutomatico: true } }).activo).toBe(true);
  });

  it("la espera por defecto son 24 horas", () => {
    expect(ESPERA_POR_DEFECTO_MIN).toBe(1440);
    expect(leerAjustesCierre({ pricing: { cierreAutomatico: true } }).esperaMin).toBe(1440);
  });

  it("la espera se puede cambiar, incluida la de cero", () => {
    expect(leerAjustesCierre({ pricing: { cierreAutomatico: true, cierreAutomaticoEsperaMin: 60 } }).esperaMin).toBe(60);
    // Cero es válido: cerrar al momento es una opción, no un valor sin poner
    expect(leerAjustesCierre({ pricing: { cierreAutomatico: true, cierreAutomaticoEsperaMin: 0 } }).esperaMin).toBe(0);
  });

  it("una espera absurda cae al valor por defecto en lugar de aceptarse", () => {
    for (const v of [-100, "mañana", null, NaN]) {
      expect(leerAjustesCierre({ pricing: { cierreAutomaticoEsperaMin: v } }).esperaMin, String(v))
        .toBe(ESPERA_POR_DEFECTO_MIN);
    }
  });

  it("lee igual el JSON en texto que el objeto ya parseado", () => {
    const texto = leerAjustesCierre('{"pricing":{"cierreAutomatico":true,"cierreAutomaticoEsperaMin":120}}');
    const objeto = leerAjustesCierre({ pricing: { cierreAutomatico: true, cierreAutomaticoEsperaMin: 120 } });
    expect(texto).toEqual(objeto);
    expect(texto).toEqual({ activo: true, esperaMin: 120 });
  });
});
