import { describe, expect, it } from "vitest";

import { sqlActualizarOtf, sqlContactoDeBase } from "./actualizar.ts";

describe("persona de contacto de una OTF", () => {
  it("se guarda en la OTF como los demás campos: solo lo que llega", () => {
    const u = sqlActualizarOtf(7, { contactoNombre: " Jordi Martí ", contactoTelefono: "600 11 22 33" }, 99);
    expect(u!.sql).toContain(`"contactoNombre" = $2`);
    expect(u!.sql).toContain(`"contactoTelefono" = $3`);
    expect(u!.sql).not.toContain("contactoCargo");
    expect(u!.params).toEqual([7, "Jordi Martí", "600 11 22 33", 99]);
  });

  it("y en su base, para la siguiente OTF", () => {
    const c = sqlContactoDeBase(12, { contactoNombre: "Jordi", contactoTelefono: "600112233", contactoCargo: "", notas: "x" }, 50);
    expect(c!.sql).toMatch(/^UPDATE roadside_known_places SET /);
    // Lo que no es contacto no se toca, y el cargo vacío se borra a propósito.
    expect(c!.sql).not.toContain("notas");
    expect(c!.params).toEqual([12, "Jordi", "600112233", null, 50]);
  });

  it("sin base, o sin datos de contacto, no hay nada que guardar", () => {
    expect(sqlContactoDeBase(null, { contactoNombre: "Jordi" }, 1)).toBeNull();
    expect(sqlContactoDeBase("", { contactoNombre: "Jordi" }, 1)).toBeNull();
    expect(sqlContactoDeBase(12, { notas: "x" }, 1)).toBeNull();
  });
});
