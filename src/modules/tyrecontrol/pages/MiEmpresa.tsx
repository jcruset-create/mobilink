import { useEffect, useState } from "react";
import { obtenerEmpresa } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Empresa } from "../types";

export default function MiEmpresa() {
  const { perfil } = useTyreAuth();
  const [empresa, setEmpresa] = useState<Empresa | null>(perfil?.empresa ?? null);

  useEffect(() => {
    if (perfil?.empresa_id) obtenerEmpresa(perfil.empresa_id).then(setEmpresa);
  }, [perfil?.empresa_id]);

  const dato = (l: string, v?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{v || "—"}</div></div>
  );

  if (!empresa) return <div className="text-slate-400">Cargando…</div>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-3 text-lg font-black">{empresa.nombre}</h1>
      <div className="grid gap-2 rounded-lg bg-slate-800 p-4 sm:grid-cols-3">
        {dato("CIF", empresa.cif)}{dato("Teléfono", empresa.telefono)}{dato("Email", empresa.email)}
        {dato("Dirección", empresa.direccion)}{dato("Ciudad", empresa.ciudad)}{dato("Provincia", empresa.provincia)}
        {dato("C. Postal", empresa.codigo_postal)}{dato("País", empresa.pais)}
      </div>
      <p className="mt-3 text-xs text-slate-500">Vista de solo lectura. Para cambios, contacta con el administrador.</p>
    </div>
  );
}
