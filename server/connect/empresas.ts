/**
 * Empresa como entidad maestra y su relación comercial con cada central.
 *
 * El problema que resuelve, con un ejemplo real de la red: «Taller XYZ SL» es
 * proveedor de la Central A, cliente de la Central A (le facturamos sus
 * propias reparaciones) y proveedor de la Central B. Hoy eso son tres fichas
 * distintas con el mismo CIF, y cuando cambia el domicilio fiscal hay que
 * acordarse de las tres. Peor: cada una arrastra sus condiciones, así que
 * nadie sabe cuál manda.
 *
 * La separación es la de siempre en un SaaS multiempresa:
 *
 *   IDENTIDAD           connect_provider_companies  (global, un CIF = una fila)
 *   RELACIÓN COMERCIAL  connect_tenant_companies    (una por central y empresa)
 *
 * La identidad no lleva condiciones: ni tarifas, ni SLA, ni forma de pago. Eso
 * depende de con quién se trate y vive en la relación. Si estuviera en la
 * identidad, cambiar el plazo de pago de la Central A se lo cambiaría a la B.
 *
 * Y de ahí sale además el aislamiento: una central ve una empresa **si tiene
 * relación con ella**, no porque la empresa exista. Es lo que impide que
 * cambiando un id en la URL se lea la cartera de la central de al lado.
 */

import { puedeFicha } from "./capacidades.ts";
import type { ConnectRole } from "./rbac.ts";

/* ────────────────────────────── Dominio ────────────────────────────────── */

/**
 * Papeles que una empresa puede desempeñar para una central. Son acumulables:
 * lo normal en la red es que un taller grande sea PROVIDER y WORKSHOP_OWNER a
 * la vez, y que alguno sea además CUSTOMER.
 */
export const ROLES_EMPRESA = ["CUSTOMER", "PROVIDER", "PARTNER", "WORKSHOP_OWNER"] as const;
export type RolEmpresa = (typeof ROLES_EMPRESA)[number];

export const ESTADOS_RELACION = ["active", "suspended", "ended"] as const;
export type EstadoRelacion = (typeof ESTADOS_RELACION)[number];

export function esRolEmpresa(v: unknown): v is RolEmpresa {
  return typeof v === "string" && (ROLES_EMPRESA as readonly string[]).includes(v);
}

/**
 * Normaliza la lista de roles que llega de fuera: quita lo que no reconoce,
 * quita duplicados y respeta el orden del catálogo para que dos relaciones con
 * los mismos papeles se guarden igual y se puedan comparar.
 *
 * Devuelve lista vacía si no queda nada válido. Quien llame decide si eso es
 * un error; aquí no se inventa un rol por defecto, porque adivinar que alguien
 * es PROVIDER cuando ha escrito una errata es exactamente cómo se cuela un
 * proveedor no autorizado en una asignación.
 */
export function normalizarRoles(entrada: unknown): RolEmpresa[] {
  const bruto = Array.isArray(entrada)
    ? entrada
    : typeof entrada === "string"
      ? entrada.split(",")
      : [];
  const vistos = new Set<RolEmpresa>();
  for (const v of bruto) {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (esRolEmpresa(s)) vistos.add(s);
  }
  return ROLES_EMPRESA.filter((r) => vistos.has(r));
}

/** Lee la columna `roles`, que se guarda como JSON de texto. */
export function leerRoles(valor: unknown): RolEmpresa[] {
  if (typeof valor === "string") {
    try {
      return normalizarRoles(JSON.parse(valor));
    } catch {
      return normalizarRoles(valor);
    }
  }
  return normalizarRoles(valor);
}

/** Comodidad para preguntar por un papel sobre el valor tal y como se guarda. */
export function tieneRol(roles: unknown, rol: RolEmpresa): boolean {
  return leerRoles(roles).includes(rol);
}

/**
 * Una relación está vigente si su estado es `active` y la fecha cae dentro de
 * la vigencia. Se comprueba con el mismo criterio que el motor de tarifas:
 * `validFrom` incluido, `validTo` excluido.
 */
export function relacionVigente(
  rel: { status?: unknown; validFromMs?: unknown; validToMs?: unknown } | null | undefined,
  ahoraMs: number,
): boolean {
  if (!rel || rel.status !== "active") return false;
  const desde = rel.validFromMs == null ? null : Number(rel.validFromMs);
  const hasta = rel.validToMs == null ? null : Number(rel.validToMs);
  if (desde != null && Number.isFinite(desde) && ahoraMs < desde) return false;
  if (hasta != null && Number.isFinite(hasta) && ahoraMs >= hasta) return false;
  return true;
}

export type CondicionesComerciales = {
  internalCode: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  creditLimit: number | null;
  authorizationLimit: number | null;
  slaAcceptMin: number | null;
  slaArrivalMin: number | null;
  notes: string | null;
};

/**
 * Valida las condiciones comerciales antes de guardarlas.
 *
 * Los límites e importes negativos se rechazan en vez de corregirse: un límite
 * de autorización de -500 € es un error de tecleo, y aceptarlo «como 0»
 * bloquearía silenciosamente a un proveedor que trabaja con normalidad.
 */
export function validarCondiciones(entrada: Record<string, unknown>): string[] {
  const fallos: string[] = [];
  for (const campo of ["creditLimit", "authorizationLimit"] as const) {
    const v = entrada[campo];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) fallos.push(`${campo} debe ser un número`);
    else if (n < 0) fallos.push(`${campo} no puede ser negativo`);
  }
  for (const campo of ["slaAcceptMin", "slaArrivalMin"] as const) {
    const v = entrada[campo];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n)) fallos.push(`${campo} debe ser un número entero de minutos`);
    else if (n <= 0) fallos.push(`${campo} debe ser mayor que cero`);
  }
  const desde = entrada.validFromMs == null || entrada.validFromMs === "" ? null : Number(entrada.validFromMs);
  const hasta = entrada.validToMs == null || entrada.validToMs === "" ? null : Number(entrada.validToMs);
  if (desde != null && hasta != null && Number.isFinite(desde) && Number.isFinite(hasta) && hasta <= desde) {
    fallos.push("La fecha de fin de la relación debe ser posterior a la de inicio");
  }
  if (entrada.status != null && entrada.status !== "" && !(ESTADOS_RELACION as readonly unknown[]).includes(entrada.status)) {
    fallos.push(`status debe ser uno de: ${ESTADOS_RELACION.join(", ")}`);
  }
  return fallos;
}

/**
 * Identificador fiscal normalizado para detectar duplicados.
 *
 * «B-12345678», «b12345678» y «ES B 12345678» son la misma empresa. Sin esto,
 * la ficha maestra no sirve de nada: se seguirían creando dos.
 */
export function normalizarCif(valor: unknown): string {
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/* ───────────────────────────── Capacidades ─────────────────────────────── */

/**
 * Los permisos NO se deciden aquí: se delegan en `capacidades.ts`, que es la
 * única tabla de política de las fichas. Estas dos funciones existen solo para
 * que el router lea bien y para no repetir el nombre de la capacidad en cada
 * endpoint; si se cambia quién puede qué, se cambia allí y esto lo sigue.
 */
export function puedeVerEmpresas(role: ConnectRole | null | undefined): boolean {
  return puedeFicha(role, "ver_empresas");
}

export function puedeEditarRelacion(role: ConnectRole | null | undefined): boolean {
  return puedeFicha(role, "gestionar_relacion_comercial");
}
