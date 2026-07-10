import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerEstadoFlota } from "../../services/informes";
import type { EstadoFlota } from "../../types/informes";
import { Donut, ColumnChart } from "../../components/informes/charts";

function Semaforo({ color, label, valor }: { color: string; label: string; valor: number }) {
  return (
    <div className="rounded-lg bg-slate-800 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase text-slate-400">{label}</span>
      </div>
      <div className="mt-1 text-3xl font-black text-slate-100">{valor}</div>
    </div>
  );
}

export default function InformeEstadoFlota() {
  const { filtros } = useInformesFiltros();
  const [flota, setFlota] = useState<EstadoFlota | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    obtenerEstadoFlota(filtros)
      .then((f) => { if (vivo) setFlota(f); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar el estado de la flota"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !flota) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!flota) return null;

  const meses = flota.evolucion.map((e) => ({ etiqueta: e.mes.slice(5), valor: e.revisiones }));

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Semaforo color="#22c55e" label="🟢 Correcto" valor={flota.correcto} />
        <Semaforo color="#f59e0b" label="🟡 Revisar" valor={flota.revisar} />
        <Semaforo color="#ef4444" label="🔴 Urgente" valor={flota.urgente} />
        <Semaforo color="#475569" label="Pendientes" valor={flota.pendiente} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Distribución ({flota.total} vehículos)</div>
          <Donut
            segmentos={[
              { etiqueta: "Correcto", valor: flota.correcto, color: "#22c55e" },
              { etiqueta: "Revisar", valor: flota.revisar, color: "#f59e0b" },
              { etiqueta: "Urgente", valor: flota.urgente, color: "#ef4444" },
              { etiqueta: "Pendiente", valor: flota.pendiente, color: "#475569" },
            ]}
          />
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Revisiones por mes</div>
          <ColumnChart items={meses} />
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Clasificación por la profundidad mínima de la última revisión de cada vehículo: urgente ≤ 1,6 mm · revisar ≤ 3,0 mm.
        Cada vehículo se clasifica por su neumático en peor estado. Los umbrales son configurables por empresa y por medida en la ficha de la empresa (Empresas → ficha → Umbrales de profundidad).
      </div>
    </div>
  );
}
