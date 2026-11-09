/**
 * Qué empresa se lee en «Vehículos en bases» cuando quien pregunta es un
 * técnico y no un administrador.
 *
 * ── El problema que arregla ─────────────────────────────────────────────────
 *
 * El resto de la API de TyreControl resuelve la empresa con `empresaDe()`, que
 * a quien no es super-admin le da la de su perfil y le ignora la que pida. Para
 * el panel es correcto: un administrador de un cliente solo tiene esa flota.
 *
 * Para la tablet no. El técnico que baja al patio trabaja para varios clientes
 * —la asignación vive en `tc_operador_empresas`— y su perfil apunta a la
 * empresa de servicio, que no tiene flota. Con `empresaDe()` la pantalla no
 * fallaba: salía VACÍA, que es peor, porque parece que no hay trabajo.
 *
 * ── El criterio ─────────────────────────────────────────────────────────────
 *
 * Quien no pide empresa se queda como estaba: la de su perfil. Quien la pide,
 * la obtiene si puede verla, con el mismo criterio que la RLS
 * (`puedeVerEmpresa`, que es a su vez el de `tc_puede_ver_empresa`). Y si no
 * puede, se dice que no con un 403, en vez de darle otra flota en silencio.
 *
 * Nótese que esto es SOLO para leer. Barrer sigue siendo de administradores:
 * habla con el proveedor de telemática y gasta su cuota.
 */

import { puedeVerEmpresa } from "../empresaAcceso.ts";
import type { Solicitante } from "../conciliacion/router.ts";

/** Lo que hay que hacer con la petición. */
export type EmpresaPedida =
  /** Adelante con esta empresa. */
  | { empresaId: string }
  /** No tiene acceso a la que ha pedido → 403. */
  | { prohibida: true }
  /** No hay ninguna empresa que leer → 400. */
  | { sinEmpresa: true };

/** La comprobación de acceso, inyectable para poder probar esto sin base. */
export type ComprobarAcceso = (
  solicitante: Solicitante,
  empresaId: string,
) => Promise<boolean>;

const accesoReal: ComprobarAcceso = (solicitante, empresaId) =>
  puedeVerEmpresa(
    {
      userId: solicitante.usuarioId,
      empresaId: solicitante.empresaPropia,
      esSuperadmin: solicitante.esSuperadmin,
    },
    empresaId,
  );

/**
 * Resuelve qué empresa se va a leer.
 *
 * `pedida` es lo que venga en la petición: puede ser `undefined`, cadena vacía,
 * o incluso un array si alguien repite el parámetro en la URL. Todo lo que no
 * sea una cadena con algo dentro se trata como «no ha pedido ninguna».
 */
export async function empresaParaLeer(
  solicitante: Solicitante,
  pedida: unknown,
  comprobar: ComprobarAcceso = accesoReal,
): Promise<EmpresaPedida> {
  const p = typeof pedida === "string" ? pedida.trim() : "";

  // No pide ninguna: la de su perfil, como toda la vida. El panel entra por
  // aquí, así que su comportamiento no cambia en nada.
  if (!p) {
    return solicitante.empresaPropia
      ? { empresaId: solicitante.empresaPropia }
      : { sinEmpresa: true };
  }

  // Un super-admin puede nombrar cualquiera: es la regla que ya tenía
  // `empresaDe()` y no hace falta ir a la base para confirmarla.
  if (solicitante.esSuperadmin) return { empresaId: p };

  // La suya tampoco necesita consulta.
  if (p === solicitante.empresaPropia) return { empresaId: p };

  // Y si no, se pregunta. Ante un fallo al comprobar, `puedeVerEmpresa`
  // responde que no, que es lo que queremos: un permiso que no se ha podido
  // verificar no se concede.
  return (await comprobar(solicitante, p)) ? { empresaId: p } : { prohibida: true };
}
