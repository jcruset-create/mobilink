/**
 * De qué empresa es el informe, y quién lo está pidiendo.
 *
 * ── Por qué existe este fichero ─────────────────────────────────────────────
 *
 * Los informes reciben la empresa en la petición (`?empresa=`) y la usan tal
 * cual. En la base eso estaría protegido —`tc_puede_ver_empresa()` y la RLS—,
 * pero el servidor habla con Supabase con `service_role`, que NO pasa por
 * RLS. Es decir: un usuario de rol `cliente` que teclee el UUID de otro
 * cliente en la URL recibiría su informe. El propio repositorio ya tenía la
 * lección escrita en `empresaAcceso.ts` («exactamente el agujero que
 * había»); los informes nacieron sin usarla.
 *
 * Aquí se resuelve en un solo sitio, porque tres copias del criterio es como
 * se acaba tapando el agujero en dos rutas y no en la tercera.
 *
 * ── Las dos preguntas ───────────────────────────────────────────────────────
 *
 *   · DE QUIÉN es el informe. Sin `?empresa=` es el de la empresa de quien
 *     lo pide, que es lo que quiere el 99% de las veces. Con `?empresa=` hay
 *     que poder verla: un técnico ve todas las flotas (decisión del
 *     proyecto), un cliente solo la suya.
 *   · QUÉ ÁMBITO puede pedir. El informe interno lleva nombres de técnico y
 *     códigos internos, así que es de administradores. Esto NO se leía del
 *     contexto de sesión —se buscaba en un `req.tcAdmin` que ese middleware
 *     no pone—, con lo que el ámbito interno no lo alcanzaba nadie.
 */

import type { Request } from "express";

import { puedeVerEmpresaDeRequest } from "../empresaAcceso.ts";

/**
 * El resultado, en una sola forma y no en una unión con discriminante: el
 * typecheck del servidor va con `strict: false`, y sin `strictNullChecks`
 * TypeScript no estrecha uniones por el `ok`. Una forma plana se lee igual
 * de bien y además compila.
 *
 * `empresa` a null significa que NO se le da el informe, y entonces
 * `estado` y `error` dicen qué responder.
 */
export interface Alcance {
  empresa: string | null;
  estado?: number;
  error?: string;
}

/**
 * La empresa del informe, ya comprobada.
 *
 * Al que pide otra empresa y no puede verla se le responde 403, no 404: no
 * tiene permiso, y no hace falta fingir que no existe para alguien que ya
 * está autenticado dentro del sistema.
 */
export async function empresaDelInforme(req: Request, pedida: unknown): Promise<Alcance> {
  const ctx = req.authCtx;
  if (!ctx) return { empresa: null, estado: 401, error: "Sesión requerida" };

  const p = String(pedida ?? "").trim();
  if (!p) {
    return ctx.empresaId
      ? { empresa: ctx.empresaId }
      : { empresa: null, estado: 400, error: "Falta la empresa" };
  }
  if (p === ctx.empresaId) return { empresa: p };

  return (await puedeVerEmpresaDeRequest(req, p))
    ? { empresa: p }
    : { empresa: null, estado: 403, error: "Sin acceso a esa empresa" };
}

/** Si quien pide es administrador (o el super-admin de Mobilink). */
export function esAdministrador(req: Request): boolean {
  const ctx = req.authCtx;
  return Boolean(ctx?.esSuperadmin || ctx?.esAdmin);
}
