import { describe, expect, it } from "vitest";

import { sustitucionPorFoto } from "./matriculaFoto.ts";

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const t = (plate: string | null, extra: Partial<{ plateRemolque: string; platePlanificada: string }> = {}) => ({
  plate, plateRemolque: extra.plateRemolque ?? null, platePlanificada: extra.platePlanificada ?? null,
});

describe("la matrícula de la foto manda", () => {
  it("si no coincide, la de la foto sustituye a la del trabajo y la planificada se guarda", () => {
    expect(sustitucionPorFoto("6088FRG", t("XXXXSM"), norm)).toEqual({ plate: "6088FRG", platePlanificada: "XXXXSM" });
  });

  it("si coincide (con espacios o guiones), no se toca nada", () => {
    expect(sustitucionPorFoto("6088 FRG", t("6088-FRG"), norm)).toBeNull();
    expect(sustitucionPorFoto("R1234BCD", t("6088FRG", { plateRemolque: "R1234BCD" }), norm)).toBeNull();
  });

  it("sin lectura, o una lectura que no es una matrícula, tampoco", () => {
    expect(sustitucionPorFoto(null, t("XXXXSM"), norm)).toBeNull();
    expect(sustitucionPorFoto("AB", t("XXXXSM"), norm)).toBeNull();
  });

  it("cambiada dos veces, la planificada sigue siendo la de la oficina", () => {
    expect(sustitucionPorFoto("1111AAA", t("6088FRG", { platePlanificada: "XXXXSM" }), norm))
      .toEqual({ plate: "1111AAA", platePlanificada: "XXXXSM" });
  });

  it("un trabajo sin matrícula toma la de la foto", () => {
    expect(sustitucionPorFoto("6088FRG", t(null), norm)).toEqual({ plate: "6088FRG", platePlanificada: null });
  });
});
