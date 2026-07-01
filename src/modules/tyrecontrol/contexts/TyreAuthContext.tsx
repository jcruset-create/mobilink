import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import type { Perfil } from "../types";

type TyreAuthValue = {
  user: User | null;
  perfil: Perfil | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const TyreAuthContext = createContext<TyreAuthValue | null>(null);

async function cargarPerfil(userId: string): Promise<Perfil | null> {
  // Consulta simple (sin join embebido, que puede fallar) + maybeSingle (no rompe con 0 filas)
  const { data, error } = await supabase
    .from("tc_usuarios")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[TyreControl] error cargando perfil:", error.message);
    return null;
  }
  if (!data) return null;

  const perfil = data as unknown as Perfil;

  // Carga de empresa aparte (best-effort; si falla, no bloquea el login)
  if (perfil.empresa_id) {
    const { data: emp } = await supabase.from("tc_empresas").select("*").eq("id", perfil.empresa_id).maybeSingle();
    perfil.empresa = (emp as any) ?? null;
  }
  return perfil;
}

export function TyreAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function sync(nextUser: User | null) {
    setUser(nextUser);
    if (!nextUser) {
      setPerfil(null);
      setLoading(false);
      return;
    }
    setError("");
    const p = await cargarPerfil(nextUser.id);
    if (!p) setError("No hay perfil activo vinculado a este usuario.");
    setPerfil(p);
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
    <TyreAuthContext.Provider value={{ user, perfil, loading, error, refresh, signOut }}>
      {children}
    </TyreAuthContext.Provider>
  );
}

export function useTyreAuth() {
  const ctx = useContext(TyreAuthContext);
  if (!ctx) throw new Error("useTyreAuth debe usarse dentro de TyreAuthProvider");
  return ctx;
}
