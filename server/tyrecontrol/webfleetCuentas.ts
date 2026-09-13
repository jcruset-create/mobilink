/**
 * Agrupar empresas por la cuenta de Webfleet que les toca.
 *
 * Vive fuera de `webfleetSync.ts` porque ahí dentro se importa el cliente de
 * Supabase, que lanza al cargarse sin `SUPABASE_URL`: probar esto arrastraría
 * media configuración de producción. Aquí no hay ni red ni base.
 *
 * ── Por qué agrupar ────────────────────────────────────────────────────────
 *
 * Diez clientes sin credenciales propias resuelven todos a las globales. Si se
 * llamara una vez por empresa serían diez peticiones idénticas cada cinco
 * minutos contra el mismo cupo de Webfleet. Agrupando, es una.
 */

import type { WebfleetCreds } from "./webfleetCredenciales.ts";

/**
 * Qué cuenta es esta.
 *
 * Cuenta, usuario y URL son lo que identifica a una cuenta de Webfleet. La
 * CONTRASEÑA no entra en la clave: no hace falta para distinguir dos cuentas
 * —si cambia la contraseña de una, sigue siendo la misma cuenta— y no tiene
 * por qué andar rodando por un mapa ni acabar en un registro por accidente.
 */
export function claveDeCuenta(c: WebfleetCreds): string {
  return `${c.account ?? ""}|${c.username ?? ""}|${c.baseUrl ?? ""}`;
}

export interface GrupoDeCuenta {
  creds: WebfleetCreds;
  empresas: string[];
}

/**
 * Las empresas repartidas en grupos, uno por cuenta distinta.
 *
 * El orden se conserva: el primero en llegar abre el grupo y presta sus
 * credenciales. Dos juegos de la misma cuenta con distinta contraseña son un
 * caso que no debería darse —y si se da, alguien ha cambiado la contraseña a
 * medias—; se usa el primero, que es determinista, en vez de elegir al azar.
 */
export function agruparPorCuenta(
  credsPorEmpresa: Iterable<[string, WebfleetCreds]>,
): GrupoDeCuenta[] {
  const grupos = new Map<string, GrupoDeCuenta>();
  for (const [empresaId, creds] of credsPorEmpresa) {
    const clave = claveDeCuenta(creds);
    const g = grupos.get(clave) ?? { creds, empresas: [] };
    g.empresas.push(empresaId);
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}
