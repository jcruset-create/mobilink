import { describe, expect, it } from "vitest";
import { AJUSTES_POR_DEFECTO, areasEnUso, normalizarAjustes, ordenDeAreas, validarAjustes } from "./ajustesWorkplanner";

describe("normalizarAjustes", () => {
  it("sin nada guardado, los valores que tenía el código", () => {
    expect(normalizarAjustes(undefined)).toEqual(AJUSTES_POR_DEFECTO);
    expect(normalizarAjustes({})).toMatchObject({ duracionCitaMin: 45, bloqueoTabletMin: 5, radioLlegadaM: 300, radioSalidaTallerM: 500, tvSonido: "apagado", tvRefrescoSeg: 20, movilExigeFurgoneta: true });
  });
  it("lo guardado manda; lo roto o fuera de tope se corrige", () => {
    expect(normalizarAjustes({ duracionCitaMin: "30", bloqueoTabletMin: 10, radioLlegadaM: 250, radioSalidaTallerM: 800 })).toMatchObject({
      duracionCitaMin: 30, bloqueoTabletMin: 10, radioLlegadaM: 250, radioSalidaTallerM: 800,
    });
    expect(normalizarAjustes({ duracionCitaMin: "x", bloqueoTabletMin: 0, radioLlegadaM: 99999 })).toMatchObject({
      duracionCitaMin: 45, bloqueoTabletMin: 1, radioLlegadaM: 5000, radioSalidaTallerM: 500,
    });
  });
});

describe("validarAjustes", () => {
  it("acepta lo razonable y explica lo demás", () => {
    expect(validarAjustes({ duracionCitaMin: "30", bloqueoTabletMin: "5", radioLlegadaM: "300", radioSalidaTallerM: "500" })).toEqual([]);
    const e = validarAjustes({ duracionCitaMin: "", bloqueoTabletMin: "500", radioLlegadaM: "600", radioSalidaTallerM: "500" });
    expect(e).toContain("La duración por defecto de una cita tiene que ser un número.");
    expect(e).toContain("El bloqueo por inactividad tiene que estar entre 1 y 120.");
    expect(e).toContain("El radio de salida del taller tiene que ser mayor que el radio de llegada.");
  });
});

describe("segunda fase: WhatsApp, Pantalla técnicos y Áreas", () => {
  it("booleanos y sonido: solo valores válidos", () => {
    const a = normalizarAjustes({ waAlGuardar: false, waRecordatorio1h: "no", tvSonido: "voz", tvBloques: { cola: false, standby: "x" } });
    expect(a.waAlGuardar).toBe(false);
    expect(a.waRecordatorio1h).toBe(true);
    expect(a.tvSonido).toBe("voz");
    expect(a.tvBloques).toEqual({ recepciones: true, llegadas: true, validar: true, standby: true, cola: false });
    expect(normalizarAjustes({ tvSonido: "sirena" }).tvSonido).toBe("apagado");
  });
  it("áreas: el orden guardado manda y las que falten van detrás; nunca todas apagadas", () => {
    expect(ordenDeAreas(["tacografo", "camion", "tacografo", "nave"])).toEqual(["tacografo", "camion", "movil", "turismo", "mecanica"]);
    const a = normalizarAjustes({ areasOrden: ["movil"], areasActivas: { turismo: false } });
    expect(areasEnUso(a)).toEqual(["movil", "camion", "tacografo", "mecanica"]);
    const todas = normalizarAjustes({ areasActivas: { camion: false, movil: false, tacografo: false, turismo: false, mecanica: false } });
    expect(areasEnUso(todas)).toHaveLength(5);
  });
  it("avisos de caducidad: el segundo va después del primero", () => {
    expect(validarAjustes({ tacografoDiasAviso: "15", tacografoDiasAviso2: "7" })).toEqual([]);
    expect(validarAjustes({ tacografoDiasAviso: "7", tacografoDiasAviso2: "15" })).toContain("El segundo aviso de caducidad tiene que ir después del primero (menos días de antelación).");
    expect(validarAjustes({ tvRefrescoSeg: "2" })).toContain("El refresco de Pantalla técnicos tiene que estar entre 5 y 300.");
  });
});
