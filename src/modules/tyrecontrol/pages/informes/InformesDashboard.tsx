import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerKpis, obtenerEstadoFlota, inventarioPor } from "../../services/informes";
import type { KpisInformes, EstadoFlota, DimensionTotal } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { Donut, BarList } from "../../components/informes/charts";

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{titulo}</div>
      {children}
    </div>
  );
}

export default function InformesDashboard() {
  const { filtros } = useInformesFiltros();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<KpisInformes | null>(null);
  const [flota, setFlota] = useState<EstadoFlota | null>(null);
  const [medidas, setMedidas] = useState<DimensionTotal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    Promise.all([obtenerKpis(filtros), obtenerEstadoFlota(filtros), inventarioPor(filtros, "medida")])
      .then(([k, f, m]) => { if (!vivo) return; setKpis(k); setFlota(f); setMedidas(m); })
      .catch((e) => { if (vivo) setError(e?.message || "No se pudieron cargar los indicadores"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !kpis) return <div className="text-slate-400">Cargando indicadores…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!kpis) return null;

  const irInventario = () => navigate("/tyrecontrol/informes/inventario");
  const irFlota = () => navigate("/tyrecontrol/informes/estado-flota");

  return (
    <div>
      <Seccion titulo="Flota">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Vehículos activos" value={kpis.vehiculos_activos} onClick={irFlota} />
          <KpiCard title="Pendientes de revisión" value={kpis.vehiculos_pendientes} tono={kpis.vehiculos_pendientes > 0 ? "warn" : "ok"} onClick={irFlota} />
          <KpiCard title="Revisados (periodo)" value={kpis.vehiculos_revisados} tono="info" onClick={irFlota} />
          <KpiCard title="Revisiones realizadas" value={kpis.revisiones_total} hint="En el periodo del filtro" />
        </div>
      </Seccion>

      <Seccion titulo="Neumáticos">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Total controlados" value={kpis.neumaticos_total} onClick={irInventario} />
          <KpiCard title="Montados" value={kpis.neumaticos_montados} tono="info" onClick={irInventario} />
          <KpiCard title="En almacén" value={kpis.neumaticos_almacen} onClick={irInventario} />
          <KpiCard title="Bajo mínimo legal" value={kpis.neumaticos_bajo_minimo} tono={kpis.neumaticos_bajo_minimo > 0 ? "danger" : "ok"} hint="≤ 1,6 mm" onClick={irInventario} />
          <KpiCard title="Próximos a sustituir" value={kpis.neumaticos_proximos} tono={kpis.neumaticos_proximos > 0 ? "warn" : "ok"} hint="≤ 3,0 mm" onClick={irInventario} />
          <KpiCard title="En reparación" value={kpis.neumaticos_reparacion} />
          <KpiCard title="Descartados" value={kpis.neumaticos_descartados} />
          <KpiCard title="Técnicos activos" value={kpis.tecnicos_activos} />
        </div>
      </Seccion>

      <Seccion titulo="Operaciones (periodo)">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard title="Montajes" value={kpis.op_montajes} />
          <KpiCard title="Cambios de posición" value={kpis.op_rotaciones} />
          <KpiCard title="Reparaciones" value={kpis.op_reparaciones} />
          <KpiCard title="Sustituciones" value={kpis.op_sustituciones} />
          <KpiCard title="Descartes" value={kpis.op_descartes} />
        </div>
      </Seccion>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Estado de la flota</div>
          {flota && (
            <Donut
              segmentos={[
                { etiqueta: "Correcto", valor: flota.correcto, color: "#22c55e" },
                { etiqueta: "Revisar", valor: flota.revisar, color: "#f59e0b" },
                { etiqueta: "Urgente", valor: flota.urgente, color: "#ef4444" },
                { etiqueta: "Pendiente", valor: flota.pendiente, color: "#475569" },
              ]}
            />
          )}
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Neumáticos por medida (top)</div>
          <BarList items={medidas.slice(0, 8).map((m) => ({ etiqueta: m.etiqueta, valor: m.total }))} />
        </div>
      </div>
    </div>
  );
}
