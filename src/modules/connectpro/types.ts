/** Connect Pro — tipos compartidos del backoffice. */

export type ConnectRole = "superadmin" | "cc_admin" | "supervisor" | "operator" | "analyst" | "provider_user";

export const ROLE_LABELS: Record<ConnectRole, string> = {
  superadmin: "Superadministrador",
  cc_admin: "Admin. centro de control",
  supervisor: "Supervisor",
  operator: "Operador",
  analyst: "Analista",
  provider_user: "Usuario de empresa",
};

export type ConnectUser = {
  id: number;
  controlCenterId: number | null;
  email: string;
  name: string;
  role: ConnectRole;
  providerCompanyId: number | null;
};

export type ProviderCompany = {
  id: number;
  uuid: string;
  name: string;
  licenseUuid: string | null;
  coreInstance: "local" | "external";
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  notes: string | null;
  branches: number;
  workshops: number;
  createdAtMs: number;
};

export type Branch = {
  id: number;
  providerCompanyId: number;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
};

export type Authorization = {
  id: number;
  controlCenterId: number;
  providerCompanyId: number;
  providerName: string;
  branchId: number | null;
  branchName: string | null;
  status: string;
  serviceTypes: string;
  preferred: boolean;
  excluded: boolean;
  slaAcceptMin: number | null;
  slaArrivalMin: number | null;
};

export type ServiceType = { id: number; code: string; name: string; active: boolean };
export type VehicleType = { id: number; code: string; name: string; active: boolean };
export type RejectionReason = { id: number; code: string; label: string; active: boolean; affectsScoreDefault: boolean };

export const ASSISTANCE_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  searching: "Buscando proveedor",
  awaiting_acceptance: "Esperando aceptación",
  assigned: "Enviada al proveedor",
  technician_assigned: "Técnico asignado",
  en_route: "En desplazamiento",
  arrived: "En el lugar",
  in_progress: "En intervención",
  finished: "Finalizada",
  cancelled: "Cancelada",
  no_coverage: "Sin cobertura",
  assignment_failed: "Fallo de asignación",
};

export const ASSISTANCE_STATUS_STYLES: Record<string, string> = {
  draft: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  searching: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  awaiting_acceptance: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  assigned: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  technician_assigned: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  en_route: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  arrived: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  in_progress: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  finished: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-300",
  no_coverage: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  assignment_failed: "border-red-500/60 bg-red-500/15 text-red-300",
};

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(Number(ms)).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}
