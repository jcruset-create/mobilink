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
};

export type CustomExtraTask = {
  id: string;
  label: string;
  area: AreaKey;
  standardMinutes?: number | null;
};

export type IncludedTaskSource = "quickTemplate" | "customExtra";

export type IncludedTask = {
  id: string;
  label: string;
  area: AreaKey;
  source: IncludedTaskSource;
  templateKey?: string | null;
  standardMinutes?: number | null;
};

export function buildSelectableIncludedTasks(
  area: AreaKey,
  quickTemplates: QuickTemplateForTaskSelector[],
  customExtraTasks: CustomExtraTask[],
  selectedMainTemplateKey?: string
): IncludedTask[] {
  const tasksFromQuickTemplates: IncludedTask[] = quickTemplates
    .filter((template) => template.area === area)
    .filter((template) => template.key !== selectedMainTemplateKey)
    .map((template) => ({
      id: `quick:${template.key}`,
      label: template.label,
      area: template.area,
      source: "quickTemplate",
      templateKey: template.key,
      standardMinutes: template.standardMinutes ?? null,
    }));

  const tasksFromCustomExtras: IncludedTask[] = customExtraTasks
    .filter((task) => task.area === area)
    .map((task) => ({
      id: `extra:${task.id}`,
      label: task.label,
      area: task.area,
      source: "customExtra",
      templateKey: null,
      standardMinutes: task.standardMinutes ?? null,
    }));

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
    (total, task) => total + (task.standardMinutes ?? 0),
    0
  );
}