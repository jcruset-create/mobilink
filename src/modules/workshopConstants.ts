import type React from "react";

import {
  Car,
  Gauge,
  Truck,
  Wrench,
} from "lucide-react";

import type {
  AreaKey,
  QuickEntryMode,
  QuickTemplate,
  TemplateKey,
} from "./workshopTypes";

export const MOBILE_SPECIALISTS = ["David", "Iván", "Jesús", "Anthoni", "Alejandro"];
export const MOBILE_MIN_RESERVED = 2;
export const ALIGNMENT_SPECIALISTS = ["Anthoni", "Alejandro", "José"];

export const DEFAULT_RULES = [
  "Un técnico no puede estar en 2 trabajos activos",
  "Primero usar técnicos disponibles antes que refuerzos",
  "Refuerzos solo se usan si no hay libres válidos",
  "Especialistas de alineación y móvil prioritarios como refuerzo",
  "Ramón solo asignación manual",
  "Registrar tiempo real para sacar media por operación",
  "Cada actividad puede tener competencia y prioridad de responsable y de apoyo",
];

export const BASE_AREA_ORDER: Record<AreaKey, string[]> = {
  camion: [
    "José",
    "Iván",
    "Alejandro",
    "Jesús",
    "Anthoni",
    "David",
    "Andrés",
    "Albert",
  ],
  movil: ["Anthoni", "David", "Jesús", "Iván", "Alejandro"],
  tacografo: ["José", "Andrés"],
  turismo: ["Andrés", "Anthoni", "Alejandro", "José", "Iván", "David", "Jesús"],
  mecanica: [
    "Andrés",
    "Alejandro",
    "Anthoni",
    "José",
    "Iván",
    "David",
    "Jesús",
    "Albert",
  ],
};

export const JOB_TEMPLATES: Record<
  TemplateKey,
  { label: string; area: AreaKey; mode: QuickEntryMode }
> = {
  alineacion_camion: {
    label: "Alineación camión",
    area: "camion",
    mode: "single",
  },
  pinchazo_camion: {
    label: "Pinchazo de camión",
    area: "camion",
    mode: "single",
  },
};

export const DEFAULT_QUICK_TEMPLATES: QuickTemplate[] = [
  {
    key: "alineacion_camion",
    label: "Alineación camión",
    area: "camion",
    mode: "single",
    allowedTechs: ["Anthoni", "Alejandro", "José"],
    priorityOrder: ["Anthoni", "Alejandro", "José"],
  },
  {
    key: "pinchazo_camion",
    label: "Pinchazo de camión",
    area: "camion",
    mode: "single",
    allowedTechs: ["José", "Iván", "Alejandro", "Jesús", "Anthoni", "David"],
    priorityOrder: ["José", "Iván", "Alejandro", "Jesús", "Anthoni", "David"],
  },
  {
    key: "cambio_4_neumaticos_camion",
    label: "Cambio de 4 neumáticos de camión",
    area: "camion",
    mode: "team",
    allowedTechs: ["José", "Iván", "Alejandro", "Jesús", "Anthoni", "David"],
    priorityOrder: ["José", "Iván", "Alejandro", "Jesús", "Anthoni", "David"],
  },
];

export const AREA_META: Record<
AreaKey,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    priority: number;
    order: string[];
  }
> = {
  camion: {
    label: "Camión",
    icon: Truck,
    color: "bg-red-50 text-red-700 border-red-200",
    priority: 1,
    order: [...BASE_AREA_ORDER.camion, "Ramón"],
  },
  movil: {
    label: "Móvil",
    icon: Wrench,
    color: "bg-amber-50 text-amber-700 border-amber-200",
    priority: 2,
    order: [...BASE_AREA_ORDER.movil, "Ramón"],
  },
  tacografo: {
  label: "Tacógrafo",
  icon: Gauge,
  color: "bg-orange-50 text-orange-700 border-orange-200",
  priority: 0,
  order: [...BASE_AREA_ORDER.tacografo, "Ramón"],
},
  turismo: {
    label: "Turismo",
    icon: Car,
    color: "bg-sky-50 text-sky-700 border-sky-200",
    priority: 3,
    order: [...BASE_AREA_ORDER.turismo, "Ramón"],
  },
  mecanica: {
    label: "Mecánica",
    icon: Wrench,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    priority: 4,
    order: [...BASE_AREA_ORDER.mecanica, "Ramón"],
  },
};

export const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

