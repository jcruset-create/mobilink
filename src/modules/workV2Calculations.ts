import type { Job, QuickTemplate } from "./workshopTypes";

export type WorkV2Role = "responsable" | "apoyo";

export type WorkV2RevenueSplit = {
  techName: string;
  role: WorkV2Role;
  weight: number;
  shareRatio: number;
  amount: number;
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

export function getWorkV2Quantity(job: Job): number {
  const quantity = toPositiveNumber(job.quantity);

  if (quantity != null) {
    return quantity;
  }

  return 1;
}

export function getWorkV2UnitMinutes(job: Job): number {
  const unitMinutes = toPositiveNumber(job.unitMinutes);

  if (unitMinutes != null) {
    return unitMinutes;
  }

  const standardMinutes = toPositiveNumber((job as any).standardMinutes);

  if (standardMinutes != null) {
    return standardMinutes;
  }

  return 0;
}

export function getWorkV2TotalMinutes(job: Job): number {
  const explicitStandardMinutes = toPositiveNumber((job as any).standardMinutes);

  if (explicitStandardMinutes != null && !toPositiveNumber(job.unitMinutes)) {
    return Math.round(explicitStandardMinutes);
  }

  const quantity = getWorkV2Quantity(job);
  const unitMinutes = getWorkV2UnitMinutes(job);

  return Math.round(quantity * unitMinutes);
}

export function getWorkV2UnitPrice(job: Job): number {
  const unitPrice = toPositiveNumber(job.unitPrice);

  if (unitPrice != null) {
    return unitPrice;
  }

  return 0;
}

export function getWorkV2TotalPrice(job: Job): number {
  const totalPrice = toPositiveNumber(job.totalPrice);

  if (totalPrice != null) {
    return roundMoney(totalPrice);
  }

  const quantity = getWorkV2Quantity(job);
  const unitPrice = getWorkV2UnitPrice(job);

  return roundMoney(quantity * unitPrice);
}

export function getWorkV2RoleWeight(role: WorkV2Role): number {
  return role === "responsable" ? 1 : 0.5;
}

export function getWorkV2RoleForIndex(index: number): WorkV2Role {
  return index === 0 ? "responsable" : "apoyo";
}

export function getWorkV2RevenueSplit(job: Job): WorkV2RevenueSplit[] {
  const assignedNames = Array.isArray(job.assignedNames)
    ? job.assignedNames.filter(Boolean)
    : [];

  if (assignedNames.length === 0) return [];

  const totalPrice = getWorkV2TotalPrice(job);

  if (totalPrice <= 0) {
    return assignedNames.map((techName, index) => {
      const role = getWorkV2RoleForIndex(index);
      const weight = getWorkV2RoleWeight(role);

      return {
        techName,
        role,
        weight,
        shareRatio: 0,
        amount: 0,
      };
    });
  }

  const weightedRoles = assignedNames.map((techName, index) => {
    const role = getWorkV2RoleForIndex(index);
    const weight = getWorkV2RoleWeight(role);

    return {
      techName,
      role,
      weight,
    };
  });

  const totalWeight = weightedRoles.reduce((sum, item) => sum + item.weight, 0);

  if (totalWeight <= 0) return [];

  return weightedRoles.map((item) => {
    const shareRatio = item.weight / totalWeight;

    return {
      ...item,
      shareRatio,
      amount: roundMoney(totalPrice * shareRatio),
    };
  });
}

export function getWorkV2QuantityLabel(job: Job): string {
  const quantity = getWorkV2Quantity(job);

  return quantity.toLocaleString("es-ES", {
    minimumFractionDigits: Number.isInteger(quantity) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function getWorkV2MoneyLabel(value: number): string {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getQuickTemplateV2UnitMinutes(template: QuickTemplate): number {
  const unitMinutes = toPositiveNumber(template.unitMinutes);

  if (unitMinutes != null) {
    return unitMinutes;
  }

  const standardMinutes = toPositiveNumber(template.standardMinutes);

  if (standardMinutes != null) {
    return standardMinutes;
  }

  return 0;
}

export function getQuickTemplateV2UnitPrice(template: QuickTemplate): number {
  const unitPrice = toPositiveNumber(template.unitPrice);

  if (unitPrice != null) {
    return unitPrice;
  }

  return 0;
}