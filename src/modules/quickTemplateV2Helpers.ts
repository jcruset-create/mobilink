import type {
  AreaKey,
  QuickEntryMode,
  QuickTemplate,
} from "./workshopTypes";
import { normalizeWorkshopId, type WorkshopId } from "./workshops";

export type NewQuickTemplateV2State = {
  label: string;
  area: AreaKey;
  mode: QuickEntryMode;
  allowedTechs: string[];
  priorityOrder: string[];
  standardMinutes: string;

  // V2
  usesQuantity: boolean;
  unitMinutes: string;
  unitPrice: string;
};

export const INITIAL_NEW_QUICK_TEMPLATE_V2: NewQuickTemplateV2State = {
  label: "",
  area: "camion",
  mode: "single",
  allowedTechs: [],
  priorityOrder: [],
  standardMinutes: "",
  usesQuantity: false,
  unitMinutes: "",
  unitPrice: "",
};

export function normalizeMinutes(value: unknown): number | null {
  const raw = String(value ?? "").trim();

  if (raw === "") return null;

  const numberValue = Number(raw.replace(",", "."));

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue);
}

export function normalizeMoney(value: unknown): number | null {
  const raw = String(value ?? "").trim();

  if (raw === "") return null;

  const numberValue = Number(raw.replace(",", "."));

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue * 100) / 100;
}

export function buildQuickTemplateKey(label: string) {
  const keyBase = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return `${keyBase || "entrada"}_${Date.now()}`;
}

export function buildPriorityOrder(
  allowedTechs: string[],
  priorityOrder: string[]
) {
  const finalAllowedTechs = [...allowedTechs];

  const finalPriorityOrder =
    finalAllowedTechs.length === 0
      ? []
      : priorityOrder.length > 0
      ? priorityOrder.filter((name) => finalAllowedTechs.includes(name))
      : finalAllowedTechs;

  return {
    finalAllowedTechs,
    finalPriorityOrder,
  };
}

function getSafeUnitMinutes({
  usesQuantity,
  unitMinutes,
  standardMinutes,
}: {
  usesQuantity: boolean;
  unitMinutes: number | null;
  standardMinutes: number | null;
}) {
  if (usesQuantity) {
    return unitMinutes ?? standardMinutes ?? null;
  }

  return unitMinutes ?? standardMinutes ?? null;
}

function getSafeStandardMinutes({
  usesQuantity,
  unitMinutes,
  standardMinutes,
}: {
  usesQuantity: boolean;
  unitMinutes: number | null;
  standardMinutes: number | null;
}) {
  if (usesQuantity) {
    return unitMinutes ?? standardMinutes ?? null;
  }

  return standardMinutes ?? unitMinutes ?? null;
}

export function buildNewQuickTemplateV2({
  draft,
  selectedWorkshopId,
}: {
  draft: NewQuickTemplateV2State;
  selectedWorkshopId: WorkshopId | string;
}): QuickTemplate {
  const label = draft.label.trim();

  const usesQuantity = Boolean(draft.usesQuantity);

  const parsedStandardMinutes = normalizeMinutes(draft.standardMinutes);
  const parsedUnitMinutes = normalizeMinutes(draft.unitMinutes);
  const parsedUnitPrice = normalizeMoney(draft.unitPrice);

  const safeUnitMinutes = getSafeUnitMinutes({
    usesQuantity,
    unitMinutes: parsedUnitMinutes,
    standardMinutes: parsedStandardMinutes,
  });

  const safeStandardMinutes = getSafeStandardMinutes({
    usesQuantity,
    unitMinutes: safeUnitMinutes,
    standardMinutes: parsedStandardMinutes,
  });

  const { finalAllowedTechs, finalPriorityOrder } = buildPriorityOrder(
    draft.allowedTechs,
    draft.priorityOrder
  );

  return {
    key: buildQuickTemplateKey(label),
    workshopId: normalizeWorkshopId(selectedWorkshopId),
    label,
    area: draft.area,
    mode: draft.mode,
    allowedTechs: finalAllowedTechs,
    priorityOrder: finalPriorityOrder,
    standardMinutes: safeStandardMinutes,
    usesQuantity,
    unitMinutes: safeUnitMinutes,
    unitPrice: parsedUnitPrice,
  };
}

export function normalizeExistingQuickTemplateV2(
  updatedTemplate: QuickTemplate,
  selectedWorkshopId: WorkshopId | string
): QuickTemplate {
  const usesQuantity = Boolean(updatedTemplate.usesQuantity);

  const parsedStandardMinutes = normalizeMinutes(
    updatedTemplate.standardMinutes
  );
  const parsedUnitMinutes = normalizeMinutes(updatedTemplate.unitMinutes);
  const parsedUnitPrice = normalizeMoney(updatedTemplate.unitPrice);

  const safeUnitMinutes = getSafeUnitMinutes({
    usesQuantity,
    unitMinutes: parsedUnitMinutes,
    standardMinutes: parsedStandardMinutes,
  });

  const safeStandardMinutes = getSafeStandardMinutes({
    usesQuantity,
    unitMinutes: safeUnitMinutes,
    standardMinutes: parsedStandardMinutes,
  });

  return {
    ...updatedTemplate,
    workshopId: normalizeWorkshopId(
      updatedTemplate.workshopId ?? selectedWorkshopId
    ),
    label: updatedTemplate.label.trim(),
    standardMinutes: safeStandardMinutes,
    usesQuantity,
    unitMinutes: safeUnitMinutes,
    unitPrice: parsedUnitPrice,
    allowedTechs: Array.isArray(updatedTemplate.allowedTechs)
      ? updatedTemplate.allowedTechs
      : [],
    priorityOrder: Array.isArray(updatedTemplate.priorityOrder)
      ? updatedTemplate.priorityOrder
      : [],
  };
}

export function getQuickTemplateV2BackendPayload(template: QuickTemplate) {
  return {
    key: template.key,
    workshopId: normalizeWorkshopId(template.workshopId),
    label: template.label,
    area: template.area,
    mode: template.mode,
    standardMinutes: template.standardMinutes ?? null,
    usesQuantity: Boolean(template.usesQuantity),
    unitMinutes: template.unitMinutes ?? null,
    unitPrice: template.unitPrice ?? null,
    allowedTechs: Array.isArray(template.allowedTechs)
      ? template.allowedTechs
      : [],
    priorityOrder: Array.isArray(template.priorityOrder)
      ? template.priorityOrder
      : [],
  };
}

export function resetNewQuickTemplateV2(
  area: AreaKey
): NewQuickTemplateV2State {
  return {
    ...INITIAL_NEW_QUICK_TEMPLATE_V2,
    area,
  };
}

export function validateNewQuickTemplateV2(draft: NewQuickTemplateV2State) {
  const label = draft.label.trim();

  if (!label) {
    return "Escribe un nombre para la entrada rápida.";
  }

  if (!draft.area) {
    return "Selecciona un área.";
  }

  const standardMinutesRaw = String(draft.standardMinutes ?? "").trim();
  const unitMinutesRaw = String(draft.unitMinutes ?? "").trim();
  const unitPriceRaw = String(draft.unitPrice ?? "").trim();

  const standardMinutes = normalizeMinutes(draft.standardMinutes);
  const unitMinutes = normalizeMinutes(draft.unitMinutes);
  const unitPrice = normalizeMoney(draft.unitPrice);

  if (standardMinutesRaw !== "" && standardMinutes == null) {
    return "El tiempo estándar debe ser un número válido.";
  }

  if (unitMinutesRaw !== "" && unitMinutes == null) {
    return "Los minutos por unidad deben ser un número válido.";
  }

  if (unitPriceRaw !== "" && unitPrice == null) {
    return "El precio por unidad debe ser un número válido.";
  }

  if (draft.usesQuantity && unitMinutes == null && standardMinutes == null) {
    return "Si usas cantidad, indica los minutos por unidad.";
  }

  return null;
}