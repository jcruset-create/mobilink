import type { AreaKey } from "./workshopTypes";
import type { CustomExtraTask } from "./quickTaskSelector";

export type NewCustomExtraTaskV2State = {
  label: string;
  area: AreaKey;
  standardMinutes: string;

  // V2
  usesQuantity: boolean;
  unitMinutes: string;
  unitPrice: string;
};

export const INITIAL_NEW_CUSTOM_EXTRA_TASK_V2: NewCustomExtraTaskV2State = {
  label: "",
  area: "camion",
  standardMinutes: "",
  usesQuantity: false,
  unitMinutes: "",
  unitPrice: "",
};

export function normalizeExtraTaskMinutes(value: unknown): number | null {
  const raw = String(value ?? "").trim();

  if (raw === "") return null;

  const numberValue = Number(raw.replace(",", "."));

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue);
}

export function normalizeExtraTaskMoney(value: unknown): number | null {
  const raw = String(value ?? "").trim();

  if (raw === "") return null;

  const numberValue = Number(raw.replace(",", "."));

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue * 100) / 100;
}

export function validateNewCustomExtraTaskV2(
  draft: NewCustomExtraTaskV2State
): string | null {
  const label = draft.label.trim();

  if (!label) {
    return "Escribe un nombre para la tarea extra.";
  }

  if (!draft.area) {
    return "Selecciona un área para la tarea extra.";
  }

  const standardMinutesRaw = String(draft.standardMinutes ?? "").trim();
  const unitMinutesRaw = String(draft.unitMinutes ?? "").trim();
  const unitPriceRaw = String(draft.unitPrice ?? "").trim();

  const standardMinutes = normalizeExtraTaskMinutes(draft.standardMinutes);
  const unitMinutes = normalizeExtraTaskMinutes(draft.unitMinutes);
  const unitPrice = normalizeExtraTaskMoney(draft.unitPrice);

  if (standardMinutesRaw !== "" && standardMinutes == null) {
    return "El tiempo estándar de la tarea extra debe ser válido.";
  }

  if (unitMinutesRaw !== "" && unitMinutes == null) {
    return "Los minutos por unidad de la tarea extra deben ser válidos.";
  }

  if (unitPriceRaw !== "" && unitPrice == null) {
    return "El precio por unidad de la tarea extra debe ser válido.";
  }

  if (draft.usesQuantity && unitMinutes == null && standardMinutes == null) {
    return "Si la tarea extra usa cantidad, indica los minutos por unidad.";
  }

  return null;
}

export function buildCustomExtraTaskV2(
  draft: NewCustomExtraTaskV2State
): CustomExtraTask {
  const label = draft.label.trim();

  const standardMinutes = normalizeExtraTaskMinutes(draft.standardMinutes);
  const unitMinutes =
    normalizeExtraTaskMinutes(draft.unitMinutes) ?? standardMinutes;

  const unitPrice = normalizeExtraTaskMoney(draft.unitPrice);

  const safeStandardMinutes = draft.usesQuantity
    ? unitMinutes
    : standardMinutes ?? unitMinutes;

  return {
    id: `custom-extra-${Date.now()}`,
    label,
    area: draft.area,
    standardMinutes: safeStandardMinutes,
    usesQuantity: Boolean(draft.usesQuantity),
    unitMinutes,
    unitPrice,
  };
}

export function resetNewCustomExtraTaskV2(
  area: AreaKey
): NewCustomExtraTaskV2State {
  return {
    ...INITIAL_NEW_CUSTOM_EXTRA_TASK_V2,
    area,
  };
}