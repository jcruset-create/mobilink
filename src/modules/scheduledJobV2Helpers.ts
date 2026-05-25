import type { QuickTemplate } from "./workshopTypes";
import {
  getIncludedTasksMinutes,
  getIncludedTasksTotalPrice,
  type IncludedTask,
} from "./quickTaskSelector";

export type ScheduledJobV2Fields = {
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
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

export function getScheduledJobV2Quantity(
  scheduled: Partial<ScheduledJobV2Fields>
): number {
  return toPositiveNumber(scheduled.quantity) ?? 1;
}

export function getScheduledJobV2UnitMinutes({
  scheduled,
  template,
}: {
  scheduled?: Partial<ScheduledJobV2Fields & { estimatedMinutes?: number | null }>;
  template?: QuickTemplate | null;
}): number {
  return (
    toPositiveNumber(scheduled?.unitMinutes) ??
    toPositiveNumber(template?.unitMinutes) ??
    toPositiveNumber(template?.standardMinutes) ??
    toPositiveNumber(scheduled?.estimatedMinutes) ??
    0
  );
}

export function getScheduledJobV2UnitPrice({
  scheduled,
  template,
}: {
  scheduled?: Partial<ScheduledJobV2Fields>;
  template?: QuickTemplate | null;
}): number {
  return (
    toPositiveNumber(scheduled?.unitPrice) ??
    toPositiveNumber(template?.unitPrice) ??
    0
  );
}

export function getScheduledJobV2TotalMinutes({
  scheduled,
  template,
  includedTasks = [],
}: {
  scheduled?: Partial<ScheduledJobV2Fields & { estimatedMinutes?: number | null }>;
  template?: QuickTemplate | null;
  includedTasks?: IncludedTask[];
}): number {
  const quantity = getScheduledJobV2Quantity(scheduled ?? {});
  const unitMinutes = getScheduledJobV2UnitMinutes({ scheduled, template });

  const baseMinutes = template?.usesQuantity
    ? Math.round(quantity * unitMinutes)
    : Math.round(
        toPositiveNumber(scheduled?.estimatedMinutes) ??
          toPositiveNumber(template?.standardMinutes) ??
          unitMinutes
      );

  return baseMinutes + getIncludedTasksMinutes(includedTasks);
}

export function getScheduledJobV2TotalPrice({
  scheduled,
  template,
  includedTasks = [],
}: {
  scheduled?: Partial<ScheduledJobV2Fields>;
  template?: QuickTemplate | null;
  includedTasks?: IncludedTask[];
}): number {
  const explicitTotalPrice = toPositiveNumber(scheduled?.totalPrice);

  if (explicitTotalPrice != null) {
    return roundMoney(explicitTotalPrice);
  }

  const quantity = getScheduledJobV2Quantity(scheduled ?? {});
  const unitPrice = getScheduledJobV2UnitPrice({ scheduled, template });

  const basePrice = template?.usesQuantity
    ? quantity * unitPrice
    : unitPrice;

  return roundMoney(basePrice + getIncludedTasksTotalPrice(includedTasks));
}

export function buildScheduledJobV2FieldsFromTemplate({
  template,
  quantity,
  includedTasks = [],
}: {
  template: QuickTemplate;
  quantity?: number | string | null;
  includedTasks?: IncludedTask[];
}): Required<ScheduledJobV2Fields> & { estimatedMinutes: number } {
  const safeQuantity = toPositiveNumber(quantity) ?? 1;

  const unitMinutes =
    toPositiveNumber(template.unitMinutes) ??
    toPositiveNumber(template.standardMinutes) ??
    0;

  const unitPrice = toPositiveNumber(template.unitPrice) ?? 0;

  const estimatedMinutes = getScheduledJobV2TotalMinutes({
    scheduled: {
      quantity: template.usesQuantity ? safeQuantity : 1,
      unitMinutes,
      unitPrice,
    },
    template,
    includedTasks,
  });

  const totalPrice = getScheduledJobV2TotalPrice({
    scheduled: {
      quantity: template.usesQuantity ? safeQuantity : 1,
      unitMinutes,
      unitPrice,
    },
    template,
    includedTasks,
  });

  return {
    quantity: template.usesQuantity ? safeQuantity : 1,
    unitMinutes,
    unitPrice,
    totalPrice,
    estimatedMinutes,
  };
}