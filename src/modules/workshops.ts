export type WorkshopId = "sea-tarragona" | "sea-reus";

export type Workshop = {
  id: WorkshopId;
  name: string;
  shortName: string;
  city: string;
  active: boolean;
};

export const DEFAULT_WORKSHOP_ID: WorkshopId = "sea-tarragona";

export const WORKSHOPS: Workshop[] = [
  {
    id: "sea-tarragona",
    name: "Mobilink Tarragona",
    shortName: "Tarragona",
    city: "Tarragona",
    active: true,
  },
  {
    id: "sea-reus",
    name: "Mobilink Reus",
    shortName: "Reus",
    city: "Reus",
    active: true,
  },
];

export function isValidWorkshopId(value: unknown): value is WorkshopId {
  return WORKSHOPS.some((workshop) => workshop.id === value);
}

export function normalizeWorkshopId(value: unknown): WorkshopId {
  return isValidWorkshopId(value) ? value : DEFAULT_WORKSHOP_ID;
}

export function getWorkshopById(value?: string | null): Workshop {
  const safeWorkshopId = normalizeWorkshopId(value);

  return (
    WORKSHOPS.find((workshop) => workshop.id === safeWorkshopId) ??
    WORKSHOPS[0]
  );
}

export function getActiveWorkshops(): Workshop[] {
  return WORKSHOPS.filter((workshop) => workshop.active);
}

export function getAllowedWorkshops(allowedWorkshopIds: string[]): Workshop[] {
  const safeAllowedIds = Array.isArray(allowedWorkshopIds)
    ? allowedWorkshopIds
    : [];

  if (safeAllowedIds.length === 0) {
    return WORKSHOPS.filter(
      (workshop) => workshop.id === DEFAULT_WORKSHOP_ID
    );
  }

  return WORKSHOPS.filter(
    (workshop) =>
      workshop.active && safeAllowedIds.includes(workshop.id)
  );
}

export function getDefaultAllowedWorkshopId(
  allowedWorkshopIds: string[]
): WorkshopId {
  const allowedWorkshops = getAllowedWorkshops(allowedWorkshopIds);

  return allowedWorkshops[0]?.id ?? DEFAULT_WORKSHOP_ID;
}

export function ensureWorkshopId<T extends { workshopId?: string | null }>(
  item: T
): T & { workshopId: WorkshopId } {
  return {
    ...item,
    workshopId: normalizeWorkshopId(item.workshopId),
  };
}

export function filterByWorkshop<T extends { workshopId?: string | null }>(
  items: T[],
  selectedWorkshopId: WorkshopId
): (T & { workshopId: WorkshopId })[] {
  return items
    .map(ensureWorkshopId)
    .filter((item) => item.workshopId === selectedWorkshopId);
}

export function groupByWorkshop<T extends { workshopId?: string | null }>(
  items: T[]
): Record<WorkshopId, (T & { workshopId: WorkshopId })[]> {
  const grouped = WORKSHOPS.reduce((acc, workshop) => {
    acc[workshop.id] = [];
    return acc;
  }, {} as Record<WorkshopId, (T & { workshopId: WorkshopId })[]>);

  for (const item of items) {
    const normalizedItem = ensureWorkshopId(item);
    grouped[normalizedItem.workshopId].push(normalizedItem);
  }

  return grouped;
}