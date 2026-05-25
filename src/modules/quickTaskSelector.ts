export type AreaKey =
  | "camion"
  | "movil"
  | "tacografo"
  | "turismo"
  | "mecanica";

export type QuickEntryMode = "single" | "team";

export type QuickTemplateForTaskSelector = {
  key: string;
  label: string;
  area: AreaKey;
  mode: QuickEntryMode;
  standardMinutes?: number | null;

  // V2
  usesQuantity?: boolean;
  unitMinutes?: number | null;
  unitPrice?: number | null;
};

export type CustomExtraTask = {
  id: string;
  label: string;
  area: AreaKey;
  standardMinutes?: number | null;

  // V2
  usesQuantity?: boolean;
  unitMinutes?: number | null;
  unitPrice?: number | null;
};

export type IncludedTaskSource = "quickTemplate" | "customExtra";

export type IncludedTask = {
  id: string;
  label: string;
  area: AreaKey;
  source: IncludedTaskSource;
  templateKey?: string | null;
  standardMinutes?: number | null;

  // V2
  usesQuantity?: boolean;
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
};

function getPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

export function getIncludedTaskQuantity(task: IncludedTask): number {
  return getPositiveNumber(task.quantity) ?? 1;
}

export function getIncludedTaskUnitMinutes(task: IncludedTask): number {
  return (
    getPositiveNumber(task.unitMinutes) ??
    getPositiveNumber(task.standardMinutes) ??
    0
  );
}

export function getIncludedTaskTotalMinutes(task: IncludedTask): number {
  const unitMinutes = getIncludedTaskUnitMinutes(task);

  if (!task.usesQuantity) {
    return Math.round(getPositiveNumber(task.standardMinutes) ?? unitMinutes);
  }

  return Math.round(getIncludedTaskQuantity(task) * unitMinutes);
}

export function getIncludedTaskUnitPrice(task: IncludedTask): number {
  return getPositiveNumber(task.unitPrice) ?? 0;
}

export function getIncludedTaskTotalPrice(task: IncludedTask): number {
  const explicitTotalPrice = getPositiveNumber(task.totalPrice);

  if (explicitTotalPrice != null) {
    return Math.round(explicitTotalPrice * 100) / 100;
  }

  return (
    Math.round(
      getIncludedTaskQuantity(task) * getIncludedTaskUnitPrice(task) * 100
    ) / 100
  );
}

export function buildSelectableIncludedTasks(
  area: AreaKey,
  quickTemplates: QuickTemplateForTaskSelector[],
  customExtraTasks: CustomExtraTask[],
  selectedMainTemplateKey?: string
): IncludedTask[] {
  const tasksFromQuickTemplates: IncludedTask[] = quickTemplates
    .filter((template) => template.area === area)
    .filter((template) => template.key !== selectedMainTemplateKey)
    .map((template) => {
      const unitMinutes =
        getPositiveNumber(template.unitMinutes) ??
        getPositiveNumber(template.standardMinutes) ??
        null;

      const standardMinutes =
        template.usesQuantity && unitMinutes != null
          ? unitMinutes
          : template.standardMinutes ?? unitMinutes;

      return {
        id: `quick:${template.key}`,
        label: template.label,
        area: template.area,
        source: "quickTemplate",
        templateKey: template.key,
        standardMinutes: standardMinutes ?? null,
        usesQuantity: Boolean(template.usesQuantity),
        quantity: 1,
        unitMinutes,
        unitPrice: template.unitPrice ?? null,
        totalPrice:
          template.unitPrice != null && Number.isFinite(Number(template.unitPrice))
            ? Number(template.unitPrice)
            : null,
      };
    });

  const tasksFromCustomExtras: IncludedTask[] = customExtraTasks
    .filter((task) => task.area === area)
    .map((task) => {
      const unitMinutes =
        getPositiveNumber(task.unitMinutes) ??
        getPositiveNumber(task.standardMinutes) ??
        null;

      const standardMinutes =
        task.usesQuantity && unitMinutes != null
          ? unitMinutes
          : task.standardMinutes ?? unitMinutes;

      return {
        id: `extra:${task.id}`,
        label: task.label,
        area: task.area,
        source: "customExtra",
        templateKey: null,
        standardMinutes: standardMinutes ?? null,
        usesQuantity: Boolean(task.usesQuantity),
        quantity: 1,
        unitMinutes,
        unitPrice: task.unitPrice ?? null,
        totalPrice:
          task.unitPrice != null && Number.isFinite(Number(task.unitPrice))
            ? Number(task.unitPrice)
            : null,
      };
    });

  return [...tasksFromQuickTemplates, ...tasksFromCustomExtras].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );
}

export function getIncludedTasksByIds(
  selectedIds: string[],
  availableTasks: IncludedTask[]
): IncludedTask[] {
  return availableTasks.filter((task) => selectedIds.includes(task.id));
}

export function getIncludedTasksMinutes(tasks: IncludedTask[]) {
  return tasks.reduce(
    (total, task) => total + getIncludedTaskTotalMinutes(task),
    0
  );
}

export function getIncludedTasksTotalPrice(tasks: IncludedTask[]) {
  return (
    Math.round(
      tasks.reduce((total, task) => total + getIncludedTaskTotalPrice(task), 0) *
        100
    ) / 100
  );
}