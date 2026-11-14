import { describe, it, expect } from "vitest";
import { entraEn, filtrarDesgaste, plazoDe, recuentosDesgaste, DIAS_PROXIMA } from "./desgasteFiltro";
import type { DesgasteNeumatico } from "../types/informes";

const HOY = new Date("2026-11-14T10:00:00");

function goma(id: string, fecha: string | null, origen: DesgasteNeumatico["origen_ritmo"] = "neumatico"): DesgasteNeumatico {
  return {
    neumatico_id: id, codigo: id, marca: "Hankook", modelo: "AH51", medida: "295/80R22.5", matricula: "7112KHV",
    ultima_prof: 1.8, ultima_fecha: "2026-05-13", mm_por_1000km: 0.122, origen_ritmo: origen,
    km_restantes: 1633, fecha_prevista: fecha, n_medidas: 2,
  };
}

const LISTA = [
  goma("vencida-modelo", "2026-06-30", "modelo"),
  goma("vencida-suya", "2026-11-13"),
  goma("pronto", "2026-12-20"),
  goma("pronto-modelo", "2027-01-05", "modelo"),
  goma("lejos", "2027-06-01"),
  goma("sin-fecha", null, "modelo"),
];

describe("plazoDe", () => {
  it("una fecha que ya pasó está vencida", () => {
    expect(plazoDe(goma("a", "2026-06-30"), HOY)).toBe("vencida");
    expect(plazoDe(goma("a", "2026-11-13"), HOY)).toBe("vencida");
  });

  it(`dentro de los próximos ${DIAS_PROXIMA} días toca pronto, y ni un día más`, () => {
    expect(plazoDe(goma("a", "2026-11-15"), HOY)).toBe("proxima");
    expect(plazoDe(goma("a", "2027-01-13"), HOY)).toBe("proxima");
    expect(plazoDe(goma("a", "2027-01-14"), HOY)).toBe("resto");
  });

  it("sin fecha, o con una que no se entiende, no se acusa de nada", () => {
    expect(plazoDe(goma("a", null), HOY)).toBe("resto");
    expect(plazoDe(goma("a", "no es una fecha"), HOY)).toBe("resto");
  });
});

describe("filtrarDesgaste", () => {
  const ids = (f: Parameters<typeof filtrarDesgaste>[1]) => filtrarDesgaste(LISTA, f, HOY).map((i) => i.neumatico_id);

  it("«todo» las devuelve todas, la misma lista", () => {
    expect(filtrarDesgaste(LISTA, "todo", HOY)).toBe(LISTA);
  });

  it("cada cuadro deja lo suyo, en el orden de urgencia en que venía", () => {
    expect(ids("vencida")).toEqual(["vencida-modelo", "vencida-suya"]);
    expect(ids("proxima")).toEqual(["pronto", "pronto-modelo"]);
    expect(ids("modelo")).toEqual(["vencida-modelo", "pronto-modelo", "sin-fecha"]);
  });

  it("«del modelo» se solapa con los plazos: una vencida puede llevar el ritmo prestado", () => {
    expect(entraEn(LISTA[0], "vencida", HOY)).toBe(true);
    expect(entraEn(LISTA[0], "modelo", HOY)).toBe(true);
  });
});

describe("recuentosDesgaste", () => {
  it("el número del cuadro es el número de filas que deja su filtro", () => {
    const n = recuentosDesgaste(LISTA, HOY);
    expect(n).toEqual({ vencida: 2, proxima: 2, modelo: 3 });
    for (const f of ["vencida", "proxima", "modelo"] as const) {
      expect(filtrarDesgaste(LISTA, f, HOY)).toHaveLength(n[f]);
    }
  });

  it("sin filas, todo a cero", () => {
    expect(recuentosDesgaste([], HOY)).toEqual({ vencida: 0, proxima: 0, modelo: 0 });
  });
});
