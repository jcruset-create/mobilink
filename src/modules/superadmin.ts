import { supabase } from "./administracion/services/supabase";

/**
 * Superadmin de la plataforma.
 *
 * El flag maestro es `app_usuarios.es_superadmin`. Antes cada módulo miraba
 * (o no) su propio flag: TyreControl usaba `tc_usuarios.es_superadmin` y el
 * resto no comprobaba nada, así que un superadmin veía las tarjetas del hub
 * pero se quedaba fuera al entrar en cada módulo. Aquí se resuelve una sola
 * vez y todos los guardias preguntan a esta función.
 *
 * `tc_usuarios.es_superadmin` se sigue aceptando como fuente secundaria para
 * no dejar fuera a quien solo esté marcado allí.
 */

let cache: { userId: string; valor: boolean } | null = null;

/** Olvida el valor cacheado (al cerrar sesión o cambiar de usuario). */
export function olvidarSuperadmin(): void {
  cache = null;
}

export async function esSuperadmin(userId?: string): Promise<boolean> {
  let id = userId;
  if (!id) {
    const { data } = await supabase.auth.getSession();
    id = data.session?.user?.id;
  }
  if (!id) return false;
  if (cache?.userId === id) return cache.valor;

  let valor = false;

  const { data: maestro, error: errMaestro } = await supabase
    .from("app_usuarios")
    .select("es_superadmin")
    .eq("id", id)
    .maybeSingle();
  // Un error aquí NO se traga en silencio: dejaba al superadmin como usuario
  // normal sin que nada lo indicara.
  if (errMaestro) {
    console.error("[superadmin] app_usuarios:", errMaestro.message);
  } else if (maestro) {
    valor = Boolean(maestro.es_superadmin);
  }

  if (!valor) {
    const { data: tyre, error: errTyre } = await supabase
      .from("tc_usuarios")
      .select("es_superadmin")
      .eq("id", id)
      .maybeSingle();
    if (errTyre) {
      console.error("[superadmin] tc_usuarios:", errTyre.message);
    } else if (tyre) {
      valor = Boolean(tyre.es_superadmin);
    }
  }

  cache = { userId: id, valor };
  return valor;
}
