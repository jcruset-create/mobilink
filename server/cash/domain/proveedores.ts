/**
 * Reconocer al proveedor de un gasto. Sin base: se prueba en
 * `proveedores.test.ts`. Quién lo usa y por qué en este orden:
 * `server/cash/expensestats.ts`, «Por proveedor».
 */

import { nifNormalizado } from "../expenseclaims/domain.ts";

export type ViaProveedor = "ERP" | "NIF" | "NOMBRE";

/** Formas jurídicas que se quitan del final: «s l», «sl», «s a u»… ya sin puntos. */
const FORMA_JURIDICA =
  /\s(?:s\s?l\s?u|s\s?l\s?l|s\s?l|s\s?a\s?u|s\s?a|s\s?c\s?p|s\s?coop|c\s?b|sociedad limitada|sociedad anonima)$/;

/**
 * El nombre con el que se agrupa un proveedor escrito a mano. Vacío = no hay
 * nombre.
 *
 * La forma jurídica se quita solo del FINAL y solo si queda algo delante: un
 * proveedor que se llame literalmente «S.A.» no se queda sin nombre.
 */
export function nombreDeProveedorNormalizado(nombre: string | null | undefined): string {
  let t = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (;;) {
    const sin = t.replace(FORMA_JURIDICA, "").trim();
    if (sin === t || sin === "") break;
    t = sin;
  }
  return t;
}

/**
 * El NIF con el que se agrupa. Como el de los duplicados de tickets, y además
 * sin el «ES» del NIF-IVA: «ESB43044379» y «B-43.044.379» son la misma empresa.
 */
export function nifDeProveedor(nif: string | null | undefined): string | null {
  const n = nifNormalizado(nif);
  if (n == null) return null;
  return /^ES[A-Z0-9]{9}$/.test(n) ? n.slice(2) : n;
}

/** La clave del proveedor de una fila de gasto, o `null` si no hay por dónde reconocerlo. */
export function proveedorDeFila(f: {
  erpCodigo: string | null;
  nif: string | null;
  nombre: string | null;
}): { clave: string; via: ViaProveedor; identificador: string | null } | null {
  const codigo = String(f.erpCodigo ?? "").trim();
  if (codigo) return { clave: `ERP:${codigo}`, via: "ERP", identificador: codigo };
  const nif = nifDeProveedor(f.nif);
  if (nif) return { clave: `NIF:${nif}`, via: "NIF", identificador: nif };
  const nombre = nombreDeProveedorNormalizado(f.nombre);
  if (nombre) return { clave: `NOMBRE:${nombre}`, via: "NOMBRE", identificador: null };
  return null;
}
