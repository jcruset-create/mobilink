/**
 * Centro de Inteligencia Operacional — ámbito de datos por usuario.
 *
 * Regla de seguridad del módulo (cap. 15): nadie ve datos fuera de su ámbito.
 * El ámbito NO viaja en la petición: se deriva del usuario Connect autenticado
 * (server/connect/rbac.ts), así que un parámetro manipulado no puede ampliarlo.
 *
 *   superadmin / cc_admin / supervisor / operator / analyst
 *        → toda la actividad de su centro de control
 *   provider_user
 *        → solo las asistencias de su empresa proveedora
 *
 * El ámbito de aseguradora/cliente corporativo se aplica cuando el usuario
 * Connect está vinculado a un cliente (connect_users.providerCompanyId es el
 * vínculo existente; el de cliente se resuelve por el campo `clientId` que se
 * añade aquí en cuanto exista esa relación en el modelo de usuarios).
 */

import type { ConnectUserContext } from "../rbac.ts";
import type { KpiFilters } from "./kpi.ts";

export interface OiScope {
  controlCenterId: number | null;
  providerCompanyId: number | null;
  clientId: number | null;
  role: string;
  /** true si el usuario puede ver la actividad completa del centro de control. */
  full: boolean;
}

export function scopeForUser(user: ConnectUserContext): OiScope {
  const provider = user.role === "provider_user" ? user.providerCompanyId : null;
  return {
    controlCenterId: user.controlCenterId,
    providerCompanyId: provider,
    clientId: null,
    role: user.role,
    full: user.role !== "provider_user",
  };
}

/** Filtros de KPI que impone el ámbito (siempre se aplican los últimos). */
export function scopeToFilters(scope: OiScope): Partial<KpiFilters> {
  return {
    providerCompanyId: scope.providerCompanyId ?? undefined,
    clientId: scope.clientId ?? undefined,
  };
}

/**
 * Combina los filtros que pide la pantalla con los del ámbito. Los del ámbito
 * mandan: si el usuario es de una empresa proveedora, no puede consultar otra.
 */
export function applyScope(filters: KpiFilters, scope: OiScope): KpiFilters {
  const out: KpiFilters = { ...filters };
  if (scope.providerCompanyId) out.providerCompanyId = scope.providerCompanyId;
  if (scope.clientId) out.clientId = scope.clientId;
  return out;
}
