/**
 * Qué puede hacer cada administrador en el router de empresas (`/api/admin`).
 *
 * Va en un fichero aparte, sin dependencias, para poder probarlo: `admin.ts`
 * importa la base y el cliente de Supabase, que exigen variables de entorno
 * en cuanto se cargan.
 */

/**
 * Lo único que un administrador de empresa puede pedir: la lista de empresas
 * -que se le devuelve con solo la suya- y las licencias de la suya. Todo lo
 * demás es del superadmin de Mobilink.
 *
 * Es una lista BLANCA a propósito. Poner `requireSuperadmin` ruta a ruta falla
 * en silencio: la ruta que alguien añada mañana sin acordarse del guard
 * quedaría abierta a todos los clientes. Así nace cerrada.
 */
const LECTURA_DE_EMPRESA: readonly RegExp[] = [
  /^\/empresas\/?$/,
  /^\/empresas\/[^/]+\/licencias\/?$/,
];

export function admiteAdminDeEmpresa(metodo: string, ruta: string): boolean {
  return metodo === "GET" && LECTURA_DE_EMPRESA.some((patron) => patron.test(ruta));
}

/**
 * ¿Puede mirar esta empresa? El superadmin, cualquiera; el administrador de un
 * cliente, solo la suya.
 */
export function puedeVerEmpresa(
  ctx: { esSuperadmin: boolean; empresaId: string } | undefined,
  empresaId: string
): boolean {
  if (!ctx) return false;
  return ctx.esSuperadmin || ctx.empresaId === empresaId;
}
