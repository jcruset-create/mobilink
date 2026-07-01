import { useTyreAuth } from "../contexts/TyreAuthContext";

function Card({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-1 text-3xl font-black text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { perfil } = useTyreAuth();
  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Dashboard</h1>
      <p className="mb-3 text-sm text-slate-400">
        Bienvenido{perfil?.nombre ? `, ${perfil.nombre}` : ""}. Panel de SEA TyreControl.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Vehículos" value="—" hint="Fase 2" />
        <Card title="Neumáticos" value="—" hint="Fase 3" />
        <Card title="Inspecciones" value="—" hint="Fase 4" />
        <Card title="Alertas" value="—" hint="Fase 8" />
      </div>
    </div>
  );
}
