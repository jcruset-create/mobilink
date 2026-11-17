import { describe, expect, it } from "vitest";
import { estadoParaGuardar, fechaDelParte, origenDelParte } from "./guardarPartePapel";
import type { FilaLeidaFlotas } from "./parteFlotas";

const fila = (pos: number, mm: number | null): FilaLeidaFlotas =>
  ({ pos, profundidad_mm: mm, medida: "295/80R22.5", marca: "Hankook", modelo: "AH51", numero_serie: null, fecha_dot: null });
const plano: Record<number, string> = { 1: "E1_IZQ", 2: "E1_DER", 3: "E2_IZQ_INT", 4: "E2_IZQ_EXT", 5: "E2_DER_INT", 6: "E2_DER_EXT" };
const base = {
  matricula: "6921HFT", fechaLeida: "16-11-2026",
  filas: [1, 2, 3, 4, 5, 6].map((p) => fila(p, 14)),
  ruedaDe: (p: number | null) => (p != null ? plano[p] ?? null : null),
  sinPlano: false, avisosDeLectura: [], hoy: "2026-11-17",
};

describe("la fecha del parte", () => {
  it("se entiende en los formatos del papel", () => {
    expect(fechaDelParte("16-11-2026")).toBe("2026-11-16");
    expect(fechaDelParte("16/11/26")).toBe("2026-11-16");
    expect(fechaDelParte("2026-11-16")).toBe("2026-11-16");
    expect(fechaDelParte("6.3.2026")).toBe("2026-03-06");
  });
  it("y una que no existe no se inventa", () => {
    expect(fechaDelParte("31-02-2026")).toBeNull();
    expect(fechaDelParte("")).toBeNull();
    expect(fechaDelParte(null)).toBeNull();
  });
});

describe("estado para guardar", () => {
  it("una hoja limpia se guarda, cada fila en su rueda y con la fecha del parte", () => {
    const e = estadoParaGuardar(base);
    expect(e.bloqueos).toEqual([]);
    expect(e.filas).toHaveLength(6);
    expect(e.filas[2]).toMatchObject({ matricula: "6921HFT", fecha_revision: "2026-11-16", codigo_posicion: "E2_IZQ_INT", profundidad_mm: 14 });
  });

  it("vehículo sin tipo: bloqueada", () => {
    const e = estadoParaGuardar({ ...base, sinPlano: true, ruedaDe: () => null });
    expect(e.bloqueos.join(" ")).toMatch(/tipo asignado/);
    expect(e.filas).toEqual([]);
  });

  it("sin vehículo, sin fecha o con fecha futura: bloqueada", () => {
    expect(estadoParaGuardar({ ...base, matricula: null }).bloqueos.join(" ")).toMatch(/vehículo/);
    expect(estadoParaGuardar({ ...base, fechaLeida: null }).bloqueos.join(" ")).toMatch(/fecha/);
    expect(estadoParaGuardar({ ...base, fechaLeida: "20-11-2026" }).bloqueos.join(" ")).toMatch(/posterior a hoy/);
  });

  it("una fila sin rueda o sin profundidad: bloqueada", () => {
    expect(estadoParaGuardar({ ...base, filas: [...base.filas, fila(7, 10)] }).bloqueos.join(" ")).toMatch(/sin rueda.*\(7\)/);
    expect(estadoParaGuardar({ ...base, filas: [fila(1, null), ...base.filas.slice(1)] }).bloqueos.join(" ")).toMatch(/sin leer/);
  });

  it("dos filas en la misma rueda: bloqueada", () => {
    const e = estadoParaGuardar({ ...base, filas: [...base.filas, fila(1, 9)] });
    expect(e.bloqueos.join(" ")).toMatch(/misma rueda: E1_IZQ/);
  });

  it("los avisos de lectura no bloquean: se confirman", () => {
    const e = estadoParaGuardar({ ...base, avisosDeLectura: ["La matrícula leída no cuadra con la unidad."] });
    expect(e.bloqueos).toEqual([]);
    expect(e.avisos).toHaveLength(1);
    expect(e.filas).toHaveLength(6);
  });

  it("deja dicho de dónde sale la revisión", () => {
    expect(origenDelParte("20261117.pdf", 3)).toBe("Importada del parte en papel 20261117.pdf, hoja 3");
  });
});
