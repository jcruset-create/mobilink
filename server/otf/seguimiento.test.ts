import { describe, expect, it } from "vitest";

import { enlaceCaducado, fasesParaInforme, hitosDeOtf, textoCorreoSalida, ventanaDeOtf } from "./seguimiento.ts";

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 27, 12, 16); // 13:16 en Madrid

describe("seguimiento de la OTF", () => {
  it("la ventana: de la salida del taller a la llegada al taller", () => {
    expect(ventanaDeOtf({ id: 1, status: "finalizada", departedAtMs: T0, arrivedAtWorkshopMs: T0 + 4 * H }))
      .toEqual({ desdeMs: T0, hastaMs: T0 + 4 * H });
  });

  it("sin la vuelta, hasta ahora; sin salida detectada, desde dos horas antes de la base", () => {
    expect(ventanaDeOtf({ id: 1, status: "en_curso", departedAtMs: T0 }, T0 + H)).toEqual({ desdeMs: T0, hastaMs: T0 + H });
    expect(ventanaDeOtf({ id: 1, status: "en_curso", arrivedAtBaseMs: T0 + 2 * H }, T0 + 3 * H)).toEqual({ desdeMs: T0, hastaMs: T0 + 3 * H });
  });

  it("aún sin salir no hay ventana, y nunca más de un día", () => {
    expect(ventanaDeOtf({ id: 1, status: "planificada" })).toBeNull();
    expect(ventanaDeOtf({ id: 1, status: "en_curso", departedAtMs: T0 }, T0 + 100 * H)!.hastaMs).toBe(T0 + 24 * H);
  });

  it("los hitos, en orden, con cada trabajo y su matrícula", () => {
    const h = hitosDeOtf(
      { id: 1, status: "finalizada", departedAtMs: T0, arrivedAtBaseMs: T0 + 37 * 60_000, finishedAtMs: T0 + 3 * H, enCaminoBaseAtMs: T0 + 3.3 * H, arrivedAtWorkshopMs: T0 + 3.7 * H },
      [
        { plate: "1234ABC", iniciadoAtMs: T0 + 1.5 * H, finalizadoAtMs: T0 + 2 * H, status: "finalizado" },
        { plate: "6088FRG", iniciadoAtMs: T0 + 42 * 60_000, finalizadoAtMs: T0 + H, status: "finalizado" },
        { plate: "5290MKL", iniciadoAtMs: null, finalizadoAtMs: null, status: "pendiente" },
      ],
    );
    expect(h.map((x) => x.etiqueta)).toEqual([
      "Salida del taller", "Llegada a la base", "6088FRG 13:58–14:16", "1234ABC 14:46–15:16", "Firma", "Vuelta al taller", "Llegada al taller",
    ]);
  });

  it("las fases del PDF: primer y último trabajo", () => {
    const f = fasesParaInforme({ id: 1, status: "finalizada", departedAtMs: T0 }, [
      { plate: "A", iniciadoAtMs: T0 + H, finalizadoAtMs: T0 + 2 * H, status: "finalizado" },
      { plate: "B", iniciadoAtMs: T0 + 0.5 * H, finalizadoAtMs: T0 + 3 * H, status: "finalizado" },
    ]);
    expect(f.find((x) => x.etiqueta === "Primer trabajo")!.ms).toBe(T0 + 0.5 * H);
    expect(f.find((x) => x.etiqueta === "Último trabajo")!.ms).toBe(T0 + 3 * H);
    expect(f.find((x) => x.etiqueta === "Llegada al taller")!.ms).toBeNull();
  });

  it("el enlace del cliente: vale en marcha y un día después de volver; anulada, no", () => {
    expect(enlaceCaducado({ id: 1, status: "en_curso" }, T0)).toBe(false);
    expect(enlaceCaducado({ id: 1, status: "finalizada", arrivedAtWorkshopMs: T0 }, T0 + 23 * H)).toBe(false);
    expect(enlaceCaducado({ id: 1, status: "finalizada", arrivedAtWorkshopMs: T0 }, T0 + 25 * H)).toBe(true);
    expect(enlaceCaducado({ id: 1, status: "finalizada", finishedAtMs: T0 }, T0 + 30 * H)).toBe(false);
    expect(enlaceCaducado({ id: 1, status: "cancelada" }, T0)).toBe(true);
  });

  it("el correo de salida lleva el enlace", () => {
    const t = textoCorreoSalida({ cliente: "La Ponderosa", base: "Cantera Alcover", tecnico: "David", enlace: "https://x/seguimiento-otf/abc" });
    expect(t).toContain("David, de Mobilink, ha salido hacia Cantera Alcover (La Ponderosa)");
    expect(t).toContain("https://x/seguimiento-otf/abc");
  });
});
