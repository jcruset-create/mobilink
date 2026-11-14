import { describe, expect, it } from "vitest";

import { sqlActualizarOtf } from "./actualizar.ts";

describe("editar una OTF: solo cambia lo que llega", () => {
  it("cambiar la base no toca el operario ni las notas", () => {
    const r = sqlActualizarOtf(7, { knownPlaceId: 3, baseName: "Riu Clar", direccion: "Pol. Riu Clar", lat: 41.1, lng: 1.2 }, 99);
    expect(r?.sql).toBe(
      `UPDATE otf SET "knownPlaceId" = $2, "baseName" = $3, direccion = $4, lat = $5, lng = $6, "updatedAtMs" = $7 WHERE id = $1`
    );
    expect(r?.params).toEqual([7, 3, "Riu Clar", "Pol. Riu Clar", 41.1, 1.2, 99]);
    expect(r?.sql).not.toContain("assignedTechName");
  });

  it("un campo a null se vacía a propósito (quitar el operario)", () => {
    const r = sqlActualizarOtf(7, { assignedTechName: null }, 99);
    expect(r?.sql).toContain(`"assignedTechName" = $2`);
    expect(r?.params).toEqual([7, null, 99]);
  });

  it("el cliente no se puede dejar vacío", () => {
    expect(sqlActualizarOtf(7, { clientName: "   " }, 99)).toBeNull();
  });

  it("los campos que no son de la OTF se ignoran: las columnas nunca salen del cuerpo", () => {
    expect(sqlActualizarOtf(7, { id: 1, otraCosa: "x" }, 99)).toBeNull();
  });
});
