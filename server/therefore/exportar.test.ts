/**
 * La bandeja a Excel: lo que va en cada celda.
 *
 * Sólo la parte pura. Que `xlsx` escriba un fichero válido lo comprueba la de
 * integración leyéndolo de vuelta; aquí se fija qué se exporta y cómo, que es
 * lo que alguien va a mirar en la hoja.
 */

import { describe, expect, it } from "vitest";
import { filasParaExcel } from "./exportar.ts";
import type { FilaBandeja } from "./service.ts";

const fila = (extra: Partial<FilaBandeja> = {}): FilaBandeja =>
  ({
    id: "e1",
    numero: "INC-000001",
    tipo: "INCIDENCIA_ALBARAN",
    estado: "PENDIENTE",
    prioridad: "ALTA",
    empresaCodigo: "007",
    empresaNombre: "Comercial Ejemplo",
    proveedorNombre: "PROVEEDOR EJEMPLO SL",
    facturaNumero: "F-2026-0001",
    importeCentimos: -4563,
    numeroReclamaciones: 2,
    requiereRevision: true,
    asignadoUsuarioId: null,
    fechaPrimeraNotificacion: "2026-09-01T08:15:00.000Z",
    diasAbierto: 14,
    actuaciones: [
      { tipoAccion: "GRABAR", accionTexto: null, albaranSolicitado: "0501234" },
      { tipoAccion: "MODIFICAR", accionTexto: "MODIFICAR FECHA", albaranSolicitado: "0501299" },
    ] as never,
    ...extra,
  }) as FilaBandeja;

describe("filas para Excel", () => {
  it("la primera fila es la cabecera y luego una por expediente", () => {
    const filas = filasParaExcel([fila(), fila({ id: "e2", numero: "INC-000002" })]);
    expect(filas).toHaveLength(3);
    expect(filas[0][0]).toBe("Expediente");
    expect(filas[1][0]).toBe("INC-000001");
    expect(filas[2][0]).toBe("INC-000002");
  });

  it("el importe va como número con signo, para que Excel lo sume", () => {
    const [, f] = filasParaExcel([fila()]);
    expect(f[6]).toBe(-45.63);
  });

  it("sin importe la celda queda vacía, no a cero", () => {
    const [, f] = filasParaExcel([fila({ importeCentimos: null })]);
    expect(f[6]).toBe("");
  });

  it("las actuaciones van resumidas con su matiz literal cuando lo hay", () => {
    const [, f] = filasParaExcel([fila()]);
    expect(f[7]).toBe("GRABAR 0501234 · MODIFICAR FECHA 0501299");
  });

  it("la fecha sale a la española y la revisión como Sí/No", () => {
    const [, f] = filasParaExcel([fila()]);
    expect(f[1]).toMatch(/^1\/9\/2026$|^01\/09\/2026$/);
    expect(f[13]).toBe("Sí");
  });
});
