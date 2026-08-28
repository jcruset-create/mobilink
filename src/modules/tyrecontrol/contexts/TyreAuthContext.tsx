import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import type { Perfil } from "../types";
import { esSuperadmin, olvidarSuperadmin } from "../../superadmin";

type TyreAuthValue = {
  user: User | null;
  perfil: Perfil | null;
  /** Pantallas permitidas (usuarios unificados; null = todas las del rol). */
  pantallas: string[] | null;
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
  }

  // Un superadmin de la plataforma entra aunque no tenga ficha en tc_usuarios,
  // y si la tiene se le respeta el flag maestro aunque su fila no lo lleve.
  const superadmin = await esSuperadmin(userId);

  if (!data) {
    if (!superadmin) return null;
    return {
      id: userId,
      nombre: "Superadmin",
      rol: "administrador",
      activo: true,
      acceso_panel: true,
      acceso_apk: true,
      es_superadmin: true,
      empresa_id: null,
      empresa: null,
    } as unknown as Perfil;
  }

  const perfil = data as unknown as Perfil;
  if (superadmin) perfil.es_superadmin = true;

  // Carga de empresa aparte (best-effort; si falla, no bloquea el login)
  if (perfil.empresa_id) {
    const { data: emp } = await supabase.from("tc_empresas").select("*").eq("id", perfil.empresa_id).maybeSingle();
    perfil.empresa = (emp as any) ?? null;
  }
  return perfil;
}

// Pantallas permitidas del usuario en TyreControl (usuarios unificados,
// fase 11). Si la tabla no existe o no hay restricción, null = todas.
async function cargarPantallas(userId: string): Promise<string[] | null> {
  if (await esSuperadmin(userId)) return null; // sin restricción
  try {
    const { data, error } = await supabase
      .from("app_usuario_modulos")
      .select("pantallas")
      .eq("user_id", userId)
      .eq("modulo", "tyrecontrol")
      .maybeSingle();
    if (!error && Array.isArray(data?.pantallas)) return data.pantallas as string[];
  } catch {
    // Si la tabla de usuarios unificados no está, se sigue con la nativa.
  }
  try {
    // Clientes creados desde este panel: solo existen en tc_usuarios, así que
    // sus permisos viven en tc_permisos_cliente. Sin filas = sin restricción.
    const { data, error } = await supabase
      .from("tc_permisos_cliente")
      .select("pantalla, puede_ver")
      .eq("usuario_id", userId);
    if (error || !data || data.length === 0) return null;
    return data.filter((f: any) => f.puede_ver).map((f: any) => String(f.pantalla));
  } catch {
    return null;
  }
}

export function TyreAuthProvider({ children }: { children: ReactNode }) {
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
    olvidarSuperadmin();
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
    <TyreAuthContext.Provider value={{ user, perfil, pantallas, loading, error, refresh, signOut }}>
      {children}
    </TyreAuthContext.Provider>
  );
}

export function useTyreAuth() {
  const ctx = useContext(TyreAuthContext);
  if (!ctx) throw new Error("useTyreAuth debe usarse dentro de TyreAuthProvider");
  return ctx;
}
