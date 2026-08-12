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

/**
 * Crea un técnico.
 *
 * `semilla` distingue los dos usos, que hasta ahora se confundían:
 *
 * - **true**: plantilla histórica (INITIAL_TECHS). Las competencias y
 *   prioridades salen de las listas de nombres de este fichero, que es lo que
 *   reproduce la configuración con la que arrancó el taller.
 * - **false** (por defecto): alta nueva desde la pantalla de Técnicos. **No se
 *   mira el nombre**: entra sin competencias y con prioridad baja, y es el
 *   supervisor quien decide en qué áreas trabaja. Antes, un fichaje nuevo
 *   heredaba capacidades solo si se llamaba como alguien de la lista, lo que es
 *   tan arbitrario como suena.
 */
export function createTech(
  name: string,
  status: TechStatus = "disponible",
  { semilla = false }: { semilla?: boolean } = {}
): Tech {
  return {
    name,
    status,
    currentJobId: null,
    blocked: isUnavailableTechStatus(status),
    competencies: semilla ? defaultCompetencies(name) : sinCompetencias(),
    priorities: semilla ? defaultPriorities(name) : sinPrioridades(),
    statusChangedAtMs: nowMs(),
    statusTotals: {},
  };
}

/** Sin competencias: el supervisor las activa en la pantalla de Técnicos. */
function sinCompetencias(): Record<CompetencyKey, RoleCapability> {
  return {
    camion: makeCapability(false),
    movil: makeCapability(false),
    tacografo: makeCapability(false),
    turismo: makeCapability(false),
    mecanica: makeCapability(false),
    alineacion_camion: makeCapability(false),
    pinchazo_camion: makeCapability(false),
  };
}

function sinPrioridades(): Record<AreaKey, RolePriority> {
  const baja: RolePriority = { responsable: 99, apoyo: 99 };
  return {
    camion: { ...baja },
    movil: { ...baja },
    tacografo: { ...baja },
    turismo: { ...baja },
    mecanica: { ...baja },
  };
}

export const INITIAL_TECHS: Tech[] = [
  createTech("José", "disponible", { semilla: true }),
  createTech("Iván", "disponible", { semilla: true }),
  createTech("Alejandro", "disponible", { semilla: true }),
  createTech("Jesús", "disponible", { semilla: true }),
  createTech("Anthoni", "disponible", { semilla: true }),
  createTech("David", "disponible", { semilla: true }),
  createTech("Andrés", "disponible", { semilla: true }),
  createTech("Albert", "disponible", { semilla: true }),
  createTech("Ramón", "disponible", { semilla: true }),
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