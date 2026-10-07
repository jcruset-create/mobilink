import { useEffect, useState } from "react";
import { supabase } from "./administracion/services/supabase";

/**
 * ¿Quien está mirando es administrador del panel o superadministrador?
 *
 * Es el mismo criterio que decide quién ve Personal y Ausencias: el rol del
 * login del panel (`sea-role`) o el superadmin de plataforma. Vive aquí, y no
 * dentro de una pantalla, porque lo necesitan varias: una regla de permisos
 * copiada en dos sitios acaba diciendo cosas distintas en cada uno.
 */
export function useEsAdministrador(): boolean {
  const [esAdmin, setEsAdmin] = useState(
    () => localStorage.getItem("sea-role") === "admin"
  );

  useEffect(() => {
    let activo = true;

    (async () => {
      if (localStorage.getItem("sea-role") === "admin") {
        if (activo) setEsAdmin(true);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!user) return;

        const { data: u } = await supabase
          .from("app_usuarios")
          .select("es_superadmin")
          .eq("id", user.id)
          .maybeSingle();

        if (activo && u?.es_superadmin) setEsAdmin(true);
      } catch {
        // Sin tablas SaaS: se queda con lo que diga el rol del panel.
      }
    })();

    return () => { activo = false; };
  }, []);

  return esAdmin;
}
