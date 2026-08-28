/**
 * Connect Pro — capacidades sobre las fichas maestras (proveedores, clientes,
 * integración con el ERP).
 *
 * NO es un sistema de roles nuevo: son los mismos seis roles de rbac.ts y el
 * mismo patrón que `pricing/permissions.ts` usa para lo económico. Aquí está
 * la tabla de quién puede qué sobre las fichas, para poder leer la política de
 * una vez en lugar de reconstruirla juntando `requireConnectRole` sueltos por
 * el router.
 *
 * La tabla reproduce EXACTAMENTE lo que ya hacían esos guardas: ver con rango
 * de analista, crear y editar con rango de administrador de centro. No se
 * quita ni se da acceso a nadie al introducirla; lo que cambia es que ahora la
 * política se puede afinar en un sitio.
 */

import type { ConnectRole } from "./rbac.ts";

export type CapacidadFicha =
  | "ver_proveedores"
  | "crear_proveedores"
  | "editar_proveedores"
  | "ver_clientes"
  | "crear_clientes"
  | "editar_clientes"
  | "configurar_erp";   // credenciales y mapeos contra SAP, BC, Sage…

const VER = ["ver_proveedores", "ver_clientes"] as const;
const TODO: CapacidadFicha[] = [
  "ver_proveedores", "crear_proveedores", "editar_proveedores",
  "ver_clientes", "crear_clientes", "editar_clientes",
  "configurar_erp",
];

/**
 * `provider_user` es el taller: no ve la cartera de proveedores ni de clientes
 * del centro de control. Está fuera a propósito, no por olvido.
 */
const CAPACIDADES: Record<ConnectRole, readonly CapacidadFicha[]> = {
  superadmin: TODO,
  cc_admin: TODO,
  supervisor: VER,
  operator: VER,
  analyst: VER,
  provider_user: [],
};

export function puedeFicha(role: ConnectRole | null | undefined, capacidad: CapacidadFicha): boolean {
  if (!role) return false;
  return CAPACIDADES[role].includes(capacidad);
}

/** La lista completa de un usuario, para que el panel enseñe u oculte. */
export function capacidadesDe(role: ConnectRole | null | undefined): CapacidadFicha[] {
  if (!role) return [];
  return [...CAPACIDADES[role]];
}
