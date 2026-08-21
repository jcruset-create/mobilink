/**
 * Lector de Norma 43. Sin base de datos: es un lector de texto.
 *
 * Se prueba con líneas construidas a mano con las posiciones del cuaderno,
 * porque el formato es de ancho fijo y un carácter de más lo desplaza todo.
 */

import { describe, expect, it } from "vitest";
import { leerNorma43 } from "./norma43.ts";

/** Rellena a 80 la línea, como hace el banco. */
const l = (s: string) => s.padEnd(80, " ");

/** Cabecera de cuenta: 11 + entidad/oficina/cuenta + fechas + saldo inicial. */
const cabecera = (saldo: number) =>
  l(
    "11" +
      "0049" + "1500" + "0123456789" + // entidad, oficina, cuenta
      "260501" + "260531" + // desde, hasta
      "2" + String(saldo).padStart(14, "0")
  );

/** Movimiento: 22 + relleno + fechas + concepto + signo + importe + refs. */
const movimiento = (fecha: string, signo: "1" | "2", importe: number, ref = "") =>
  l(
    "22" +
      "00000000" + // oficina origen y relleno
      fecha + fecha + // fecha operación y valor
      "12  " + " " + // concepto común
      signo +
      String(importe).padStart(14, "0") +
      "0000000000" + // referencia 1
      ref.padEnd(16, " ")
  );

const finCuenta = (saldo: number) =>
  l("33" + "0049" + "1500" + "0123456789".padEnd(43, "0") + "2" + String(saldo).padStart(14, "0"));

describe("lector de Norma 43", () => {
  it("lee cabecera, movimientos y saldo final", () => {
    const fichero = [
      cabecera(100000), // 1.000 €
      movimiento("260503", "2", 150000, "INGRESO CAJA"), // entran 1.500 €
      movimiento("260504", "1", 25000), // salen 250 €
      finCuenta(225000), // 2.250 €
    ].join("\n");

    const r = leerNorma43(fichero);

    expect(r.errores).toEqual([]);
    expect(r.cuentas).toHaveLength(1);
    const c = r.cuentas[0];
    expect(c.saldoInicialCentimos).toBe(100000);
    expect(c.saldoFinalCentimos).toBe(225000);
    expect(c.movimientos).toHaveLength(2);
    expect(c.movimientos[0].fecha).toBe("2026-05-03");
    expect(c.movimientos[0].importeCentimos).toBe(150000);
    // El signo «1» es debe: sale dinero de la cuenta.
    expect(c.movimientos[1].importeCentimos).toBe(-25000);
    expect(c.cuadra).toBe(true);
  });

  /*
   * La comprobación que da valor al lector. Un fichero incompleto leído «lo
   * mejor posible» daría por descuadrado lo que en realidad estaba bien.
   */
  it("avisa si el saldo del banco no cuadra con sus propios movimientos", () => {
    const fichero = [
      cabecera(100000),
      movimiento("260503", "2", 150000),
      finCuenta(999999), // no es 250000
    ].join("\n");

    const r = leerNorma43(fichero);
    expect(r.cuentas[0].cuadra).toBe(false);
    expect(r.errores.join(" ")).toMatch(/no cuadra/i);
  });

  it("pega los conceptos ampliados al movimiento al que pertenecen", () => {
    const fichero = [
      cabecera(0),
      movimiento("260503", "2", 5000),
      l("2301" + "TRANSFERENCIA DE TALLERES PEREZ SL".padEnd(38, " ") + "REF TAR1-IB-26-001"),
      finCuenta(5000),
    ].join("\n");

    const r = leerNorma43(fichero);
    expect(r.cuentas[0].movimientos[0].ampliado).toContain("TALLERES PEREZ");
    expect(r.cuentas[0].movimientos[0].ampliado).toContain("TAR1-IB-26-001");
  });

  it("no se traga un fichero que no es una Norma 43", () => {
    const r = leerNorma43("fecha;concepto;importe\n2026-05-03;INGRESO;1500,00");
    expect(r.cuentas).toHaveLength(0);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it("un fichero vacío se dice, no se devuelve como correcto", () => {
    const r = leerNorma43("   \n\n");
    expect(r.errores.join(" ")).toMatch(/vac/i);
  });

  it("un concepto ampliado suelto se reporta en vez de perderse", () => {
    const r = leerNorma43([cabecera(0), l("2301" + "HUERFANO"), finCuenta(0)].join("\n"));
    expect(r.errores.join(" ")).toMatch(/sin movimiento/i);
  });
});
