import { supabase } from "./supabase";

export async function obtenerSesionActual() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return {
      session: null,
      user: null,
      error,
    };
  }

  return {
    session: data.session,
    user: data.session?.user || null,
    error: null,
  };
}

export async function cerrarSesion() {
  return supabase.auth.signOut({ scope: "local" });
}