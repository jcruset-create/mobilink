import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import type { Perfil } from "../types";

type AdminAuthValue = {
  user: User | null;
  perfil: Perfil | null;
  /** Pantallas permitidas en Administración (null = todas las del rol). */
  pantallas: string[] | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

async function cargarPerfil(userId: string): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("adm_usuarios")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[Administración] error cargando perfil:", error.message);
    return null;
  }
  return (data as Perfil | null) ?? null;
}

// Pantallas permitidas del usuario en el módulo (unificación de usuarios,
// fase 11). Si la tabla no existe aún o no hay fila, null = sin restricción.
async function cargarPantallas(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("app_usuario_modulos")
      .select("pantallas")
      .eq("user_id", userId)
      .eq("modulo", "administracion")
      .maybeSingle();
    if (error) return null;
    return (data?.pantallas as string[] | null) ?? null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [pantallas, setPantallas] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function sync(nextUser: User | null) {
    setUser(nextUser);
    if (!nextUser) {
      setPerfil(null);
      setPantallas(null);
      setLoading(false);
      return;
    }
    setError("");
    const [p, pant] = await Promise.all([cargarPerfil(nextUser.id), cargarPantallas(nextUser.id)]);
    if (!p) setError("No hay perfil activo vinculado a este usuario.");
    setPerfil(p);
    setPantallas(pant);
    setLoading(false);
  }

  async function refresh() {
    const { data } = await supabase.auth.getUser();
    await sync(data.user ?? null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setPerfil(null);
  }

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) void sync(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void sync(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminAuthContext.Provider value={{ user, perfil, pantallas, loading, error, refresh, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth debe usarse dentro de AdminAuthProvider");
  return ctx;
}
