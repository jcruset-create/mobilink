import { useTyreAuth } from "../contexts/TyreAuthContext";

function Card({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-1 text-3xl font-black text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { perfil } = useTyreAuth();
  return (
    <div>
      <h1 className="mb-1 text-xl font-black">Dashboard</h1>
      <p className="mb-4 text-sm text-slate-500">
        Bienvenido{perfil?.nombre ? `, ${perfil.nombre}` : ""}. Panel de SEA TyreControl.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Vehículos" value="—" hint="Disponible en Fase 2" />
        <Card title="Neumáticos" value="—" hint="Disponible en Fase 3" />
        <Card title="Inspecciones" value="—" hint="Disponible en Fase 4" />
        <Card title="Alertas" value="—" hint="Disponible en Fase 8" />
      </div>
    </div>
  );
}
