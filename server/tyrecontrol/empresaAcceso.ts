/**
 * ¿Puede este usuario acceder a los datos de esta empresa?
 *
 * En un solo sitio, por la misma razón que `matricula.ts`: había una copia en
 * `parte/index.ts` y ninguna en los endpoints de telemática, que es justo
 * donde hacía falta. Dos criterios distintos de «quién ve qué» es como se
 * acaba dejando entrar a alguien por una vía y no por otra.
 *
 * ── Por qué hace falta en el servidor ───────────────────────────────────────
 *
 * En la base de datos esto ya existe: `tc_puede_ver_empresa()`. Pero el
 * servidor habla con Supabase usando `service_role`, que NO pasa por RLS, así
 * que allí las políticas no protegen nada. Cuando un endpoint recibe una
 * empresa en la petición y va a usarla, tiene que comprobarlo a mano.
 *
 * ── El criterio ─────────────────────────────────────────────────────────────
 *
 * El mismo que `tc_puede_ver_empresa` en `tyrecontrol_fase2.sql`:
 *
 *   super-admin  →  todas
 *   su empresa   →  la suya
 *   operador     →  las que tenga asignadas en tc_operador_empresas
 *
 * Nótese que un operador tiene, por defecto, TODAS las empresas asignadas: el
 * trigger de la fase 33 se las añade al crearse cada empresa nueva, salvo que
 * lleve el flag `empresas_manual`. Es decir, esto no restringe a los técnicos
 * —«todo técnico ve todas las flotas» es una decisión deliberada del proyecto—
 * pero sí impide que un usuario de rol `cliente` alcance los datos de otro
 * cliente. Que es exactamente el agujero que había.
 *
 * ── Lo que esto NO es ───────────────────────────────────────────────────────
 *
 * No es permiso para leer una credencial. Ver los vehículos de una empresa y
 * poder usar su cuenta de telemática son cosas distintas, y la segunda tiene
 * que ser más estrecha. Aquí solo se responde a la primera.
 */

import { supabase } from "../supabase.ts";

/** Contexto mínimo que necesita la comprobación (el `req.authCtx` de core/auth). */
export type ContextoAcceso = {
  userId?: string;
  empresaId?: string;
  esSuperadmin?: boolean;
} | undefined;

/**
 * ¿El usuario del contexto puede ver los datos de `empresaId`?
 *
 * Devuelve `false` ante cualquier duda: sin sesión, sin usuario en la tabla,
 * usuario desactivado o error de consulta. Un fallo al comprobar el permiso
 * nunca puede resolverse concediéndolo.
 */
export async function puedeVerEmpresa(ctx: ContextoAcceso, empresaId: string): Promise<boolean> {
  const userId = ctx?.userId;
  if (!userId || !empresaId) return false;
  if (ctx?.esSuperadmin === true) return true;

  const { data: u, error } = await supabase
    .from("tc_usuarios").select("rol, empresa_id, es_superadmin, activo")
    .eq("id", userId).maybeSingle();
  if (error || !u || u.activo === false) return false;
  if (u.es_superadmin) return true;
  if (u.empresa_id === empresaId) return true;

  const { data: asignado } = await supabase
    .from("tc_operador_empresas").select("empresa_id")
    .eq("usuario_id", userId).eq("empresa_id", empresaId).maybeSingle();
  return !!asignado;
}

/**
 * La misma comprobación tomando el `req` de Express, para los sitios que ya
 * trabajan con la petición entera.
 */
export function puedeVerEmpresaDeRequest(
  req: { authCtx?: ContextoAcceso } | undefined,
  empresaId: string,
): Promise<boolean> {
  return puedeVerEmpresa(req?.authCtx, empresaId);
}
