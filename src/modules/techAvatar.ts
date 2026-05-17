import type { Tech } from "./workshopTypes";
import { API_BASE } from "./workshopApi";

export function getTechAvatarUrl(tech?: Tech | null): string {
  if (!tech?.avatar) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      tech?.name || "Tecnico"
    )}`;
  }

  if (tech.avatar.startsWith("http")) return tech.avatar;

  return `${API_BASE}${tech.avatar}`;
}