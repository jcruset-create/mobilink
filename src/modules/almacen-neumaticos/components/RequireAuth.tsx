import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../services/supabase";

type RequireAuthProps = { children: React.ReactNode };

// Pantallas permitidas en el almacén (usuarios unificados, fase 11).
// null = sin restricción (tabla sin migrar, sin fila de acceso o todas marcadas).
// Cache por usuario para no repetir la consulta en cada navegación.
let cachePantallas: { userId: string; value: string[] | null } | null = null;

async function cargarPantallasAlmacen(userId: string): Promise<string[] | null> {
  if (cachePantallas?.userId === userId) return cachePantallas.value;
  try {
    const { data, error } = await supabase
      .from("app_usuario_modulos")
      .select("pantallas")
      .eq("user_id", userId)
      .eq("modulo", "almacen")
      .maybeSingle();
    const value = error ? null : ((data?.pantallas as string[] | null) ?? null);
    cachePantallas = { userId, value };
    return value;
  } catch {
    return null;
  }
}

// Clave de pantalla a partir de la ruta /almacen-neumaticos/<seg>
function pantallaDesdeRuta(pathname: string): string | null {
  if (!pathname.startsWith("/almacen-neumaticos")) return null; // otras apps que reutilizan este guard
  const seg = pathname.split("/")[2] || "dashboard";
  if (seg === "login" || seg === "mobile") return null; // sin gating
  if (seg === "auditoria-traspasos") return "auditoria";
  return seg;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [pantallas, setPantallas] = useState<string[] | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null;
      setAuthed(!!user);
      if (user) setPantallas(await cargarPantallasAlmacen(user.id));
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return null;
  if (!authed) return <Navigate to="/almacen-neumaticos/login" replace />;

  const pantalla = pantallaDesdeRuta(location.pathname);
  if (pantalla && pantalla !== "dashboard" && pantallas && !pantallas.includes(pantalla)) {
    return (
      <div className="p-6">
        <div className="rounded-xl border bg-yellow-50 p-6 text-sm text-yellow-800">
          No tienes acceso a esta pantalla. Contacta con un administrador.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
