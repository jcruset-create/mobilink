import { describe, expect, it } from "vitest";
import {
  HARD_BLOCKED_TECH_STATUSES,
  getTechStatusLabel,
  isHardBlockedTechStatus,
  isUnavailableTechStatus,
  normalizeTechStatus,
} from "./techStatus";
import { isManualUnavailableStatus } from "./techSync";
import { isUnavailableTechStatus as validacionNoDisponible } from "./jobValidation";
import { SCHEDULED_TECH_STATUS_OPTIONS, isEstadoDeAusencia } from "./techStatusScheduleHelpers";
import { ETIQUETA_NO_DISPONIBLE } from "./tecnicosNoDisponibles";
import { ESTADOS_CONTADOS, ETIQUETA_ESTADO } from "./ausenciasTecnicos";
import { claseDeSituacion, emojiDeSituacion, situacionDeTecnico } from "./colorEstadoTecnico";
import { colorDeEstado } from "./barrasDeEstadoEnAgenda";

/**
 * «Formación» es una ausencia en TODAS las listas.
 *
 * El estado de un técnico pasa por cinco listas distintas que dicen «esto es
 * una ausencia», más la del servidor. Basta con olvidar una para que alguien
 * en un curso salga disponible y le caiga un trabajo: `normalizeTechStatus`
 * convierte cualquier estado que no conoce en «disponible». Este test recorre
 * todas, y lo que se diga aquí de formación vale igual para vacaciones.
 */
describe("formación es una ausencia en todas las listas", () => {
  it("se reconoce al normalizar y no se convierte en disponible", () => {
    expect(normalizeTechStatus("formacion")).toBe("formacion");
    expect(normalizeTechStatus("Formación".normalize("NFD").replace(/[̀-ͯ]/g, ""))).toBe("formacion");
    expect(getTechStatusLabel("formacion")).toBe("Formación");
  });

  it("bloquea la asignación igual que vacaciones", () => {
    expect(HARD_BLOCKED_TECH_STATUSES).toContain("formacion");
    expect(isHardBlockedTechStatus("formacion")).toBe(true);
    expect(isUnavailableTechStatus("formacion")).toBe(true);
    expect(isManualUnavailableStatus("formacion")).toBe(true);
    expect(validacionNoDisponible("formacion")).toBe(true);
    expect(isEstadoDeAusencia("formacion")).toBe(true);
  });

  it("se puede programar desde la agenda y se cuenta en Ausencias", () => {
    expect(SCHEDULED_TECH_STATUS_OPTIONS).toContain("formacion");
    expect(ESTADOS_CONTADOS).toContain("formacion");
    expect(ETIQUETA_ESTADO.formacion).toBe("Formación");
    expect(ETIQUETA_NO_DISPONIBLE.formacion).toBe("Formación");
  });

  it("tiene su color y su cara en las pantallas", () => {
    const s = situacionDeTecnico("formacion");
    expect(s).toBe("formacion");
    expect(emojiDeSituacion(s)).toBe("📚");
    expect(claseDeSituacion(s)).toContain("sky");
    expect(colorDeEstado("formacion")).toBe("sky");
  });
});
