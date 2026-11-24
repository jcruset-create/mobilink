import { describe, expect, it } from "vitest";
import { fraseDeAviso, nuevasAsignaciones } from "./sonidoAsignacion";

describe("nuevasAsignaciones", () => {
  it("la primera vuelta no suena; después, solo lo que no estaba", () => {
    const a = nuevasAsignaciones(null, [{ id: 1, assignedNames: ["José"] }]);
    expect(a.nuevos).toEqual([]);
    const b = nuevasAsignaciones(a.vistos, [{ id: 1, assignedNames: ["José"] }, { id: 2, plate: "9328KBN", assignedNames: ["Iván"] }]);
    expect(b.nuevos.map((t) => t.id)).toEqual([2]);
    // Cambiar los técnicos de un trabajo también es una asignación nueva.
    const c = nuevasAsignaciones(b.vistos, [{ id: 1, assignedNames: ["José", "Alejandro"] }, { id: 2, assignedNames: ["Iván"] }]);
    expect(c.nuevos.map((t) => t.id)).toEqual([1]);
    // Sin técnicos no suena.
    expect(nuevasAsignaciones(c.vistos, [{ id: 3, assignedNames: [] }]).nuevos).toEqual([]);
  });
  it("la frase para la voz", () => {
    expect(fraseDeAviso({ id: 1, plate: "9328KBN", assignedNames: ["José", "Alejandro"] })).toBe("Nuevo trabajo para José y Alejandro: 9 3 2 8 K B N.");
    expect(fraseDeAviso({ id: 1, plate: "1234BCD", assignedNames: ["Iván"] })).toBe("Nuevo trabajo para Iván: 1 2 3 4 B C D.");
  });
});
