import { useEffect, useState } from "react";
import { supabase } from "./administracion/services/supabase";

/**
 * ¿Quien está mirando es superadministrador de plataforma?
 *
 * Más estricto que `useEsAdministrador`: aquí no vale el administrador del
 * panel de taller. Es lo que abre Horarios en Core, que es control de la
 * empresa entera, no operación de un taller. El servidor lo comprueba otra
 * vez en cada petición; esto solo decide qué se enseña.
 */
export function useEsSuperadmin(): boolean | null {
  const [es, setEs] = useState<boolean | null>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!user) {
          if (activo) setEs(false);
          return;
        }
        const { data: u } = await supabase
          .from("app_usuarios")
          .select("es_superadmin")
          .eq("id", user.id)
          .maybeSingle();
        if (activo) setEs(Boolean(u?.es_superadmin));
      } catch {
        if (activo) setEs(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  return es;
}
