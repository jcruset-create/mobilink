import type { Job, QuickTemplate } from "./workshopTypes";
import type { IncludedTask } from "./quickTaskSelector";
import {
  getIncludedTasksMinutes,
  getIncludedTasksTotalPrice,
} from "./quickTaskSelector";
import {
  buildScheduledJobV2FieldsFromTemplate,
  getScheduledJobV2Quantity,
  getScheduledJobV2TotalMinutes,
  getScheduledJobV2TotalPrice,
  getScheduledJobV2UnitMinutes,
  getScheduledJobV2UnitPrice,
} from "./scheduledJobV2Helpers";

export type ScheduledJobLikeForWorkV2 = {
  templateKey: string;
  estimatedMinutes?: number | null;
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  includedTasks?: IncludedTask[];
};

export type ScheduledJobWorkV2Fields = {
  quantity: number;
  unitMinutes: number | null;
  unitPrice: number | null;
  standardMinutes: number | null;
  totalPrice: number | null;
};

function toNullablePositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildScheduledJobWorkV2Fields({
  scheduled,
  template,
}: {
  scheduled: ScheduledJobLikeForWorkV2;
  template?: QuickTemplate | null;
}): ScheduledJobWorkV2Fields {
  const includedTasks = scheduled.includedTasks ?? [];

  if (template) {
    const templateFields = buildScheduledJobV2FieldsFromTemplate({
      template,
      quantity: scheduled.quantity ?? 1,
      includedTasks,
    });

    const quantity =
      toNullablePositiveNumber(scheduled.quantity) ??
      templateFields.quantity ??
      1;

    const unitMinutes =
      toNullablePositiveNumber(scheduled.unitMinutes) ??
      templateFields.unitMinutes ??
      null;

    const unitPrice =
      toNullablePositiveNumber(scheduled.unitPrice) ??
      templateFields.unitPrice ??
      null;

    const standardMinutes =
      toNullablePositiveNumber(scheduled.estimatedMinutes) ??
      getScheduledJobV2TotalMinutes({
        scheduled,
        template,
        includedTasks,
      }) ??
      templateFields.estimatedMinutes ??
      null;

    const totalPrice =
      toNullablePositiveNumber(scheduled.totalPrice) ??
      getScheduledJobV2TotalPrice({
        scheduled,
        template,
        includedTasks,
      }) ??
      templateFields.totalPrice ??
      null;

    return {
      quantity,
      unitMinutes,
      unitPrice,
      standardMinutes,
      totalPrice: totalPrice == null ? null : roundMoney(totalPrice),
    };
  }

  const quantity = getScheduledJobV2Quantity(scheduled);

  const unitMinutes = getScheduledJobV2UnitMinutes({
    scheduled,
    template: null,
  });

  const unitPrice = getScheduledJobV2UnitPrice({
    scheduled,
    template: null,
  });

  const includedTasksMinutes = getIncludedTasksMinutes(includedTasks);
  const includedTasksPrice = getIncludedTasksTotalPrice(includedTasks);

  const standardMinutes =
    toNullablePositiveNumber(scheduled.estimatedMinutes) ??
    Math.round(quantity * unitMinutes + includedTasksMinutes);

  const totalPrice =
    toNullablePositiveNumber(scheduled.totalPrice) ??
    roundMoney(quantity * unitPrice + includedTasksPrice);

  return {
    quantity,
    unitMinutes: unitMinutes || null,
    unitPrice: unitPrice || null,
    standardMinutes: standardMinutes || null,
    totalPrice: totalPrice || null,
  };
}

export function applyScheduledJobV2FieldsToJob({
  job,
  scheduled,
  template,
}: {
  job: Job;
  scheduled: ScheduledJobLikeForWorkV2;
  template?: QuickTemplate | null;
}): Job {
  const v2Fields = buildScheduledJobWorkV2Fields({
    scheduled,
    template,
  });

  return {
    ...job,
    quantity: v2Fields.quantity,
    unitMinutes: v2Fields.unitMinutes,
    unitPrice: v2Fields.unitPrice,
    standardMinutes: v2Fields.standardMinutes,
    totalPrice: v2Fields.totalPrice,
  };
}