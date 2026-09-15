import { describe, expect, it } from "vitest";
import { componerZip, crc32, indiceZip } from "./zip.ts";

describe("el zip mínimo", () => {
  it("el CRC-32 es el de la tabla estándar", () => {
    // Valor de referencia de «123456789» (el vector de prueba clásico).
    expect(crc32(Buffer.from("123456789", "ascii")).toString(16)).toBe("cbf43926");
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("empaqueta varias entradas y el directorio central las declara con su tamaño y su CRC", () => {
    const a = Buffer.from("%PDF-1.4 ejemplo", "utf8");
    const b = Buffer.from("expediente;albarán\nINC-000001;0501234\n", "utf8");
    const zip = componerZip([
      { nombre: "INC-000001_0501234.pdf", contenido: a, fecha: new Date(2026, 8, 15, 10, 30, 0) },
      { nombre: "índice.csv", contenido: b },
    ]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(indiceZip(zip)).toEqual([
      { nombre: "INC-000001_0501234.pdf", tamano: a.length, crc: crc32(a) },
      { nombre: "índice.csv", tamano: b.length, crc: crc32(b) },
    ]);
    // El contenido va tal cual (sin comprimir) justo detrás de su cabecera.
    expect(zip.indexOf(a)).toBeGreaterThan(0);
  });

  it("un zip vacío también es un zip", () => {
    expect(indiceZip(componerZip([]))).toEqual([]);
  });
});
