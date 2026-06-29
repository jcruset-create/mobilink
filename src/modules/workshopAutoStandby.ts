import type { WorkshopId } from "./workshops";

export const AUTO_STANDBY_TIMES = ["13:30", "18:30"] as const;
export const AUTO_STANDBY_GRACE_MINUTES = 20;

export function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getAutoStandbyTrigger(date: Date) {
  for (const time of AUTO_STANDBY_TIMES) {
    const [hours, minutes] = time.split(":").map(Number);
    const triggerAt = new Date(date);
    triggerAt.setHours(hours, minutes, 0, 0);

    const elapsedMs = date.getTime() - triggerAt.getTime();

    if (
      elapsedMs >= 0 &&
      elapsedMs < AUTO_STANDBY_GRACE_MINUTES * 60 * 1000
    ) {
      return time;
    }
  }

  return null;
}

export function getAutoStandbyStorageKey(workshopId: WorkshopId, time: string, date: Date) {
  return `sea-auto-standby:${workshopId}:${formatLocalDateKey(date)}:${time}`;
}
