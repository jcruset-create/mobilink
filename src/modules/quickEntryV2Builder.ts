import type {
  AreaKey,
  Job,
  QuickTemplate,
  TemplateKey,
} from "./workshopTypes";
import type { IncludedTask } from "./quickTaskSelector";
import {
  getIncludedTasksMinutes,
  getIncludedTasksTotalPrice,
} from "./quickTaskSelector";
import { isBuiltInTemplateKey } from "./jobHelpers";
import { normalizeWorkshopId, type WorkshopId } from "./workshops";
import { normalizeQuickEntryQuantity } from "./quickEntryV2State";

export type QuickEntryV2BuildInput = {
  safeJobId: number;
  secondSafeJobId: number;
  selectedWorkshopId: WorkshopId | string;
  firstTemplate: QuickTemplate;
  secondTemplate?: QuickTemplate | null;
  plate: string;
  urgent: boolean;
  customerName: string;
  customerPhone: string;
  selectedIncludedTasks: IncludedTask[];
  quantity: string | number;
  createdAtMs: number;
};

export type QuickEntryV2BuildResult = {
  firstJob: Job;
  secondJob: Job | null;
  jobsToSave: Job[];
  linkedGroupId: string | null;
  isLinkedEntry: boolean;
  quantity: number;
  firstJobTotalMinutes: number;
  firstJobTotalPrice: number;
};

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getTemplateUnitMinutes(template: QuickTemplate): number {
  return (
    toPositiveNumber(template.unitMinutes) ??
    toPositiveNumber(template.standardMinutes) ??
    0
  );
}

function getTemplateUnitPrice(template: QuickTemplate): number {
  return toPositiveNumber(template.unitPrice) ?? 0;
}

function getTemplateTotalMinutes(template: QuickTemplate, quantity: number) {
  const unitMinutes = getTemplateUnitMinutes(template);

  if (template.usesQuantity) {
    return Math.round(quantity * unitMinutes);
  }

  return Math.round(toPositiveNumber(template.standardMinutes) ?? unitMinutes);
}

function getTemplateTotalPrice(template: QuickTemplate, quantity: number) {
  const unitPrice = getTemplateUnitPrice(template);

  if (template.usesQuantity) {
    return roundMoney(quantity * unitPrice);
  }

  return roundMoney(unitPrice);
}

function buildCustomerInfo(customerName: string, customerPhone: string) {
  return [
    customerName ? `Cliente: ${customerName}` : "",
    customerPhone ? `Teléfono: ${customerPhone}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildFirstJobReason({
  firstTemplate,
  secondTemplate,
  selectedIncludedTasks,
  customerInfo,
}: {
  firstTemplate: QuickTemplate;
  secondTemplate?: QuickTemplate | null;
  selectedIncludedTasks: IncludedTask[];
  customerInfo: string;
}) {
  const isLinkedEntry = Boolean(secondTemplate);

  const baseReason = isLinkedEntry
    ? `Trabajo vinculado iniciado: ${firstTemplate.label} → ${secondTemplate?.label}`
    : selectedIncludedTasks.length > 0
    ? `Entrada creada desde plantilla: ${firstTemplate.label}. Tareas incluidas: ${selectedIncludedTasks
        .map((task) => task.label)
        .join(" + ")}`
    : `Entrada creada desde plantilla: ${firstTemplate.label}`;

  return customerInfo ? `${baseReason}. ${customerInfo}.` : baseReason;
}

export function buildQuickEntryV2Jobs(
  input: QuickEntryV2BuildInput
): QuickEntryV2BuildResult {
  const {
    safeJobId,
    secondSafeJobId,
    selectedWorkshopId,
    firstTemplate,
    secondTemplate,
    plate,
    urgent,
    customerName,
    customerPhone,
    selectedIncludedTasks,
    quantity: rawQuantity,
    createdAtMs,
  } = input;

  const quantity = normalizeQuickEntryQuantity(rawQuantity);
  const isLinkedEntry = Boolean(secondTemplate);

  const linkedGroupId = isLinkedEntry
    ? `linked-quick-${safeJobId}-${createdAtMs}`
    : null;

  const cleanPlate = plate.trim().toUpperCase();
  const cleanCustomerName = customerName.trim();
  const cleanCustomerPhone = customerPhone.trim();

  const customerInfo = buildCustomerInfo(cleanCustomerName, cleanCustomerPhone);

  const firstTemplateUnitMinutes = getTemplateUnitMinutes(firstTemplate);
  const firstTemplateUnitPrice = getTemplateUnitPrice(firstTemplate);

  const firstTemplateTotalMinutes = getTemplateTotalMinutes(
    firstTemplate,
    quantity
  );

  const firstTemplateTotalPrice = getTemplateTotalPrice(firstTemplate, quantity);

  const includedTasksMinutes = getIncludedTasksMinutes(selectedIncludedTasks);
  const includedTasksTotalPrice = getIncludedTasksTotalPrice(
    selectedIncludedTasks
  );

  const firstJobTotalMinutes =
    firstTemplateTotalMinutes + includedTasksMinutes;

  const firstJobTotalPrice = roundMoney(
    firstTemplateTotalPrice + includedTasksTotalPrice
  );

  const firstJob: Job = {
    id: safeJobId,
    workshopId: normalizeWorkshopId(selectedWorkshopId),
    area: firstTemplate.area as AreaKey,
    plate: cleanPlate,
    urgent,
    status: "espera",
    assignedNames: [],
    reason: buildFirstJobReason({
      firstTemplate,
      secondTemplate,
      selectedIncludedTasks,
      customerInfo,
    }),

    customerName: cleanCustomerName || undefined,
    customerPhone: cleanCustomerPhone || undefined,

    createdAtMs,
    startedAtMs: null,
    template: isBuiltInTemplateKey(firstTemplate.key)
      ? (firstTemplate.key as TemplateKey)
      : null,
    quickEntryLabel: firstTemplate.label,
    quickEntryMode: firstTemplate.mode,
    includedTasks: selectedIncludedTasks,

    linkedGroupId,
    linkedOrder: isLinkedEntry ? 1 : null,
    dependsOnJobId: null,
    blockedReason: null,

    quantity: firstTemplate.usesQuantity ? quantity : 1,
    unitMinutes: firstTemplateUnitMinutes || null,
    unitPrice: firstTemplateUnitPrice || null,
    standardMinutes: firstJobTotalMinutes || null,
    totalPrice: firstJobTotalPrice || null,
  };

  let secondJob: Job | null = null;

  if (isLinkedEntry && secondTemplate) {
    const secondTemplateUnitMinutes = getTemplateUnitMinutes(secondTemplate);
    const secondTemplateUnitPrice = getTemplateUnitPrice(secondTemplate);
    const secondQuantity = secondTemplate.usesQuantity ? quantity : 1;

    const secondJobTotalMinutes = getTemplateTotalMinutes(
      secondTemplate,
      secondQuantity
    );

    const secondJobTotalPrice = getTemplateTotalPrice(
      secondTemplate,
      secondQuantity
    );

    secondJob = {
      id: secondSafeJobId,
      workshopId: normalizeWorkshopId(selectedWorkshopId),
      area: secondTemplate.area as AreaKey,
      plate: cleanPlate,
      urgent,
      status: "parado",
      assignedNames: [],
      reason: `Pendiente del trabajo anterior: ${firstTemplate.label}. Trabajo vinculado: ${firstTemplate.label} → ${secondTemplate.label}`,

      customerName: cleanCustomerName || undefined,
      customerPhone: cleanCustomerPhone || undefined,

      createdAtMs: createdAtMs + 1,
      startedAtMs: null,
      pausedAtMs: createdAtMs,
      workedAccumulatedMinutes: 0,
      pausedAccumulatedMinutes: 0,
      template: isBuiltInTemplateKey(secondTemplate.key)
        ? (secondTemplate.key as TemplateKey)
        : null,
      quickEntryLabel: secondTemplate.label,
      quickEntryMode: secondTemplate.mode,
      includedTasks: [],

      linkedGroupId,
      linkedOrder: 2,
      dependsOnJobId: firstJob.id,
      blockedReason: `Pendiente de finalizar ${firstTemplate.label}.`,

      quantity: secondTemplate.usesQuantity ? secondQuantity : 1,
      unitMinutes: secondTemplateUnitMinutes || null,
      unitPrice: secondTemplateUnitPrice || null,
      standardMinutes: secondJobTotalMinutes || null,
      totalPrice: secondJobTotalPrice || null,
    };
  }

  return {
    firstJob,
    secondJob,
    jobsToSave: secondJob ? [firstJob, secondJob] : [firstJob],
    linkedGroupId,
    isLinkedEntry,
    quantity,
    firstJobTotalMinutes,
    firstJobTotalPrice,
  };
}