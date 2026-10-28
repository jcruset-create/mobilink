import { describe, expect, it } from "vitest";
import { otfDelTecnico, otfsEnCurso, progresoDeOtf, textoDeOtf, type OtfEnPantalla } from "./otfEnPantalla";

const otf = (extra: Partial<OtfEnPantalla>): OtfEnPantalla => ({
  id: 1, clientName: "Transbrugent", baseName: "Base Constantí", status: "en_curso", assignedTechName: "David", ...extra,
});

describe("otfsEnCurso", () => {
  it("con operario, planificada o en la base, y no a la espera", () => {
    const lista = [
      otf({ id: 1 }),
      otf({ id: 2, status: "planificada" }),
      otf({ id: 3, status: "finalizada" }),
      otf({ id: 4, status: "cancelada" }),
      otf({ id: 5, assignedTechName: null }),
      otf({ id: 6, status: "planificada", enEspera: true }),
    ];
    expect(otfsEnCurso(lista).map((o) => o.id)).toEqual([1, 2]);
  });
});

describe("otfDelTecnico", () => {
  it("el caso de David: la OTF le tiene ocupado desde que se planifica, también en la base", () => {
    expect(otfDelTecnico([otf({})], "David")?.id).toBe(1);
    expect(otfDelTecnico([otf({ status: "planificada" })], "David")?.id).toBe(1);
    expect(otfDelTecnico([otf({ status: "planificada", enEspera: true })], "David")).toBeNull();
    expect(otfDelTecnico([otf({ status: "finalizada" })], "David")).toBeNull();
    expect(otfDelTecnico([otf({})], "Iván")).toBeNull();
  });
});

describe("textos", () => {
  it("cliente y base, sin huecos", () => {
    expect(textoDeOtf(otf({}))).toBe("OTF · Transbrugent · Base Constantí");
    expect(textoDeOtf(otf({ baseName: null, direccion: "Pol. Ind. nave 3" }))).toBe("OTF · Transbrugent · Pol. Ind. nave 3");
    expect(textoDeOtf(otf({ clientName: "", baseName: "" }))).toBe("OTF");
    expect(progresoDeOtf(otf({ progreso: { hechos: 2, total: 5 } }))).toBe("2/5 trabajos");
    expect(progresoDeOtf(otf({}))).toBe("");
  });
});
