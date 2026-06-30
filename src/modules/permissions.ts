export type UserRole = "admin" | "supervisor" | "pantallas" | "tv75";

export type AppView =
  | "operativo"
  | "operativo2"
  | "agenda"
  | "asistencias"
  | "asistencias_config"
  | "entradas"
  | "entradas2"
  | "ajustes"
  | "operarios"
  | "workshop_tv_75"
  | "pantalla"
  | "historico"
  | "ranking"
  | "tecnicos"
  | "whatsapp_inbox";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  pantallas: "Pantallas",
  tv75: "TV 75",
};

export const DEFAULT_VIEW_BY_ROLE: Record<UserRole, AppView> = {
  admin: "operativo",
  supervisor: "operativo",
  pantallas: "operarios",
  tv75: "workshop_tv_75",
};

export const VIEWS_BY_ROLE: Record<UserRole, AppView[]> = {
  admin: [
    "operativo",
    "operativo2",
    "agenda",
    "asistencias",
    "asistencias_config",
    "entradas",
    "entradas2",
    "ranking",
    "ajustes",
    "tecnicos",
    "operarios",
    "workshop_tv_75",
    "pantalla",
    "historico",
    "whatsapp_inbox",
  ],
  supervisor: [
    "operativo",
    "operativo2",
    "agenda",
    "asistencias",
    "entradas",
    "entradas2",
    "ranking",
    "tecnicos",
    "operarios",
    "workshop_tv_75",
    "pantalla",
    "historico",
    "whatsapp_inbox",
  ],
  pantallas: ["operarios", "pantalla"],
  tv75: ["workshop_tv_75"],
};

export function isValidUserRole(role: string | null): role is UserRole {
  return (
    role === "admin" ||
    role === "supervisor" ||
    role === "pantallas" ||
    role === "tv75"
  );
}

export function getDefaultViewForRole(role: UserRole | null): AppView {
  if (!role) return "operativo";
  return DEFAULT_VIEW_BY_ROLE[role];
}

export function canAccessView(role: UserRole | null, view: AppView) {
  if (!role) return false;
  return VIEWS_BY_ROLE[role].includes(view);
}

export function canUseAdminTools(role: UserRole | null) {
  return role === "admin";
}

export function canUseSupervisorTools(role: UserRole | null) {
  return role === "admin" || role === "supervisor";
}

export function canUseScreens(role: UserRole | null) {
  return role === "admin" || role === "supervisor" || role === "pantallas";
}
