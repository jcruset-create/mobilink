import { beforeEach, describe, expect, it } from "vitest";

import { REUSAR_FOTO_MS, fotoEstable, olvidarFotos } from "./fotoEstable";

const A1 = "https://x.supabase.co/storage/v1/object/sign/core/empleados/a/foto-1.jpg?token=uno";
const A1_OTRO_SELLO = "https://x.supabase.co/storage/v1/object/sign/core/empleados/a/foto-1.jpg?token=dos";
const A2 = "https://x.supabase.co/storage/v1/object/sign/core/empleados/a/foto-2.jpg?token=tres";

describe("fotoEstable", () => {
  beforeEach(() => olvidarFotos());

  it("la misma foto con otro sello sigue siendo la primera dirección: no parpadea", () => {
    expect(fotoEstable(A1, 0)).toBe(A1);
    expect(fotoEstable(A1_OTRO_SELLO, 15_000)).toBe(A1);
    expect(fotoEstable(A1_OTRO_SELLO, 30_000)).toBe(A1);
  });

  it("una foto nueva (otra ruta) se enseña en el acto", () => {
    fotoEstable(A1, 0);
    expect(fotoEstable(A2, 15_000)).toBe(A2);
  });

  it("pasadas unas horas se renueva, antes de que la dirección caduque", () => {
    fotoEstable(A1, 0);
    expect(fotoEstable(A1_OTRO_SELLO, REUSAR_FOTO_MS - 1)).toBe(A1);
    expect(fotoEstable(A1_OTRO_SELLO, REUSAR_FOTO_MS)).toBe(A1_OTRO_SELLO);
    // Y a partir de ahí, la nueva es la estable.
    expect(fotoEstable(A1, REUSAR_FOTO_MS + 15_000)).toBe(A1_OTRO_SELLO);
  });

  it("las direcciones sin sello (las de siempre del taller) y los vacíos pasan tal cual", () => {
    const publica = "https://x.supabase.co/storage/v1/object/public/panel/techs/ana.jpg";
    expect(fotoEstable(publica, 0)).toBe(publica);
    expect(fotoEstable(null)).toBeNull();
    expect(fotoEstable(undefined)).toBeUndefined();
    expect(fotoEstable("")).toBe("");
  });

  it("cada persona lleva su cuenta", () => {
    const B = "https://x.supabase.co/storage/v1/object/sign/core/empleados/b/foto-1.jpg?token=b1";
    fotoEstable(A1, 0);
    expect(fotoEstable(B, 10)).toBe(B);
    expect(fotoEstable(A1_OTRO_SELLO, 20)).toBe(A1);
  });
});
