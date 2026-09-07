// Iconos de acceso directo a los otros módulos, para la cabecera.
//
// Enseña un icono por cada módulo que la empresa tiene contratado Y al que el
// usuario tiene acceso (app_mis_modulos cruza licencia vigente y acceso). El
// superadmin los ve todos. Se omite el módulo en el que ya se está.
//
// Si la RPC no existe (base sin la fase SaaS) no se pinta nada: mejor un
// botón de menos que uno que lleva a un 403.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../modules/administracion/services/supabase";
import { esSuperadmin } from "../modules/superadmin";
import { ACCESOS_MODULOS } from "../config/accesosModulos";

export default function AccesosCabecera({ actual }: { actual: string }) {
  const navigate = useNavigate();
  const [modulos, setModulos] = useState<Set<string> | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (vivo) setModulos(null); return; }
        if (await esSuperadmin(user.id)) {
          if (vivo) setModulos(new Set(ACCESOS_MODULOS.map((m) => m.key)));
          return;
        }
        const { data, error } = await supabase.rpc("app_mis_modulos");
        if (error) throw error;
        if (vivo) setModulos(new Set((data ?? []).map((r: { modulo: string }) => r.modulo)));
      } catch { if (vivo) setModulos(null); }
    })();
    return () => { vivo = false; };
  }, []);

  if (!modulos) return null;
  const visibles = ACCESOS_MODULOS.filter((m) => m.key !== actual && modulos.has(m.key));
  if (!visibles.length) return null;

  return (
    <div className="flex items-center gap-1" aria-label="Otros módulos">
      {visibles.map((m) => (
        <button key={m.key} onClick={() => navigate(m.ruta)} title={m.label}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">
          {m.icono}
        </button>
      ))}
    </div>
  );
}
