/**
 * Sonda: ¿cómo tendrá que autenticarse Assist para ESCRIBIR en TyreControl?
 *
 * ── Por qué hace falta comprobarlo ──────────────────────────────────────────
 *
 * Todos los RPC de escritura de TC (`tc_montar_neumatico`,
 * `tc_sustituir_neumatico`…) son `security definer` y deciden el permiso con
 * `tc_is_superadmin()`, `tc_is_admin()` y `tc_operador_ve_empresa()`, que se
 * apoyan en `auth.uid()` contra `tc_usuarios`.
 *
 * El servidor de Assist se conecta con la CLAVE DE SERVICIO. Leyendo el código
 * de esas funciones, `auth.uid()` debería ser NULL y todas devolver `false`,
 * lo que haría que cualquier escritura por RPC fallara con «Sin permiso». Pero
 * eso es una deducción, y una deducción no basta para decidir la arquitectura
 * de la fase siguiente. Esto lo comprueba de verdad.
 *
 * ── Por qué es segura ───────────────────────────────────────────────────────
 *
 * NO ejecuta ninguna operación que cambie datos. Solo llama a:
 *
 *   · `tc_is_superadmin()`, `tc_is_admin()`, `tc_auth_empresa_id()` — SQL puro,
 *     `stable`, sin escrituras. Responden literalmente «¿quién soy?».
 *   · `tc_revision_estado()` — `security invoker` y de solo lectura, que además
 *     enseña el efecto del RLS: con clave de servicio se ve todo, con un
 *     usuario solo lo suyo.
 *
 * No se monta, no se desmonta, no se crea ninguna intervención.
 */

import { createClient } from "@supabase/supabase-js";

import { supabase } from "../supabase.ts";

export type ResultadoSonda = {
  caso: "service_role" | "usuario_tc";
  ok: boolean;
  /** Lo que TC cree que somos. Es la respuesta que se busca. */
  identidad: {
    authUid: string | null;
    esSuperadmin: boolean | null;
    esAdmin: boolean | null;
    empresaId: string | null;
  };
  /** Cuántas filas devuelve una lectura sujeta a RLS. */
  filasVisibles: number | null;
  /** Conclusión en una línea, para el informe. */
  veredicto: string;
  error?: string;
};

/** Llama a las funciones de identidad con el cliente que se le pase. */
async function preguntarQuienSoy(cliente: any, uid: string | null): Promise<ResultadoSonda["identidad"]> {
  const [sup, adm, emp] = await Promise.all([
    cliente.rpc("tc_is_superadmin"),
    cliente.rpc("tc_is_admin"),
    cliente.rpc("tc_auth_empresa_id"),
  ]);
  return {
    authUid: uid,
    esSuperadmin: sup.error ? null : sup.data === true,
    esAdmin: adm.error ? null : adm.data === true,
    empresaId: emp.error ? null : (emp.data == null ? null : String(emp.data)),
  };
}

async function contarVisibles(cliente: any): Promise<number | null> {
  const r = await cliente.rpc("tc_revision_estado");
  if (r.error) return null;
  return Array.isArray(r.data) ? r.data.length : null;
}

/** Caso A: como se conecta hoy el servidor de Assist. */
export async function sondaServiceRole(): Promise<ResultadoSonda> {
  try {
    const identidad = await preguntarQuienSoy(supabase, null);
    const filasVisibles = await contarVisibles(supabase);
    const escribiria = identidad.esSuperadmin === true || identidad.esAdmin === true;
    return {
      caso: "service_role", ok: true, identidad, filasVisibles,
      veredicto: escribiria
        ? "La clave de servicio SÍ pasa los permisos de TC: los RPC de escritura funcionarían."
        : "La clave de servicio NO es nadie para TC (auth.uid() nulo): los RPC de escritura darían «Sin permiso».",
    };
  } catch (e: any) {
    return {
      caso: "service_role", ok: false,
      identidad: { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null },
      filasVisibles: null, veredicto: "No se ha podido comprobar", error: e?.message,
    };
  }
}

/**
 * Caso B: con un usuario de TyreControl de verdad.
 *
 * Las credenciales salen del entorno y NUNCA del código. Si no están puestas
 * se dice, en vez de fallar: es información para decidir, no una función del
 * producto.
 */
export async function sondaUsuarioTc(): Promise<ResultadoSonda> {
  const email = process.env.TC_SERVICE_USER_EMAIL;
  const password = process.env.TC_SERVICE_USER_PASSWORD;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;

  if (!email || !password) {
    return {
      caso: "usuario_tc", ok: false,
      identidad: { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null },
      filasVisibles: null,
      veredicto: "Sin comprobar: faltan TC_SERVICE_USER_EMAIL y TC_SERVICE_USER_PASSWORD.",
    };
  }
  if (!url || !anon) {
    return {
      caso: "usuario_tc", ok: false,
      identidad: { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null },
      filasVisibles: null,
      veredicto: "Sin comprobar: falta SUPABASE_URL o VITE_SUPABASE_ANON_KEY.",
    };
  }

  try {
    // Cliente propio con la clave anónima: es el mismo camino que hace la APK
    // de TyreControl al entrar (`signInWithPassword`).
    const cliente = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await cliente.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return {
        caso: "usuario_tc", ok: false,
        identidad: { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null },
        filasVisibles: null,
        veredicto: "El usuario de servicio no ha podido entrar.",
        // El mensaje de Supabase, sin la contraseña ni el token.
        error: error?.message ?? "sin sesión",
      };
    }

    const uid = data.user?.id ?? null;
    const identidad = await preguntarQuienSoy(cliente, uid);
    const filasVisibles = await contarVisibles(cliente);

    // ¿Está dado de alta en tc_usuarios? Sin eso, las funciones de permiso no
    // lo reconocen aunque el login funcione: son dos cosas distintas.
    const { data: fila } = await supabase
      .from("tc_usuarios").select("id, nombre, rol, es_superadmin, activo")
      .eq("id", uid).maybeSingle();

    await cliente.auth.signOut().catch(() => {});

    const reconocido = identidad.esSuperadmin === true || identidad.esAdmin === true
      || identidad.empresaId != null;
    return {
      caso: "usuario_tc", ok: true, identidad, filasVisibles,
      veredicto: !fila
        ? "Entra en Supabase Auth pero NO está en tc_usuarios: TC no lo reconoce."
        : reconocido
          ? `Reconocido por TC (rol ${fila.rol ?? "?"}): los RPC de escritura lo aceptarían.`
          : "Está en tc_usuarios pero las funciones de permiso no le dan acceso a ninguna empresa.",
    };
  } catch (e: any) {
    return {
      caso: "usuario_tc", ok: false,
      identidad: { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null },
      filasVisibles: null, veredicto: "No se ha podido comprobar", error: e?.message,
    };
  }
}

/** Las dos sondas, para el informe. */
export async function sondaCompleta(): Promise<{ serviceRole: ResultadoSonda; usuarioTc: ResultadoSonda }> {
  return {
    serviceRole: await sondaServiceRole(),
    usuarioTc: await sondaUsuarioTc(),
  };
}
