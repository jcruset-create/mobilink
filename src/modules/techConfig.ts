import type {
  AreaKey,
  CompetencyKey,
  RoleCapability,
  RolePriority,
  Tech,
  TechStatus,
} from "./workshopTypes";

import {
  ALIGNMENT_SPECIALISTS,
  AREA_META,
  BASE_AREA_ORDER,
  MOBILE_MIN_RESERVED,
  MOBILE_SPECIALISTS,
} from "./workshopConstants";

import { nowMs } from "./time";
import { isUnavailableTechStatus } from "./techStatus";

export function makeCapability(enabled: boolean): RoleCapability {
  return { responsable: enabled, apoyo: enabled };
}

export function defaultCompetencies(
  name: string
): Record<CompetencyKey, RoleCapability> {
  if (name === "Ramón") {
    return {
      camion: makeCapability(true),
      movil: makeCapability(true),
      tacografo: makeCapability(true),
      turismo: makeCapability(true),
      mecanica: makeCapability(true),
      alineacion_camion: makeCapability(true),
      pinchazo_camion: makeCapability(true),
    };
  }

  return {
    camion: makeCapability([...BASE_AREA_ORDER.camion].includes(name)),
    movil: makeCapability(MOBILE_SPECIALISTS.includes(name)),
    tacografo: makeCapability(["José", "Andrés"].includes(name)),
    turismo: makeCapability(
      ["Andrés", "Anthoni", "Alejandro", "José", "Iván", "David", "Jesús"].includes(name)
    ),
    mecanica: makeCapability(
      ["Andrés", "Alejandro", "Anthoni", "José", "Iván", "David", "Jesús", "Albert"].includes(name)
    ),
    alineacion_camion: makeCapability(ALIGNMENT_SPECIALISTS.includes(name)),
    pinchazo_camion: makeCapability([...BASE_AREA_ORDER.camion].includes(name)),
  };
}

export function defaultPriorities(name: string): Record<AreaKey, RolePriority> {
  const idx = (arr: string[]) => {
    const i = arr.indexOf(name);
    return i >= 0 ? i + 1 : 99;
  };

  return {
    camion: {
      responsable: idx(AREA_META.camion.order),
      apoyo: idx(AREA_META.camion.order),
    },
    movil: {
      responsable: idx(AREA_META.movil.order),
      apoyo: idx(AREA_META.movil.order),
    },
    tacografo: {
      responsable: idx(AREA_META.tacografo.order),
      apoyo: idx(AREA_META.tacografo.order),
    },
    turismo: {
      responsable: idx(AREA_META.turismo.order),
      apoyo: idx(AREA_META.turismo.order),
    },
    mecanica: {
      responsable: idx(AREA_META.mecanica.order),
      apoyo: idx(AREA_META.mecanica.order),
    },
  };
}

export function createTech(
  name: string,
  status: TechStatus = "disponible"
): Tech {
  return {
    name,
    status,
    currentJobId: null,
    blocked: isUnavailableTechStatus(status),
    competencies: defaultCompetencies(name),
    priorities: defaultPriorities(name),
    statusChangedAtMs: nowMs(),
    statusTotals: {},
  };
}

export const INITIAL_TECHS: Tech[] = [
  createTech("José"),
  createTech("Iván"),
  createTech("Alejandro"),
  createTech("Jesús"),
  createTech("Anthoni"),
  createTech("David"),
  createTech("Andrés"),
  createTech("Albert"),
  createTech("Ramón"),
];

export function countReservedMobileCapacity(techs: Tech[]): number {
  return techs.filter(
    (t) =>
      t.competencies.movil.responsable &&
      !t.blocked &&
      t.currentJobId == null &&
      t.status === "disponible"
  ).length;
}

export { MOBILE_MIN_RESERVED };