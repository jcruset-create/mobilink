import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerEconomico } from "../../services/informes";
import type { EconomicoInformes } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { BarList } from "../../components/informes/charts";

const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 3 });

export default function InformeEconomico() {
  const { filtros } = useInformesFiltros();
  const [eco, setEco] = useState<EconomicoInformes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    obtenerEconomico(filtros)
      .then((e) => { if (vivo) setEco(e); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar el informe económico"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !eco) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!eco) return null;

  const costeVehiculo = eco.n_vehiculos > 0 ? eco.coste_total / eco.n_vehiculos : 0;
  const costeKm = eco.km_flota > 0 ? eco.coste_total / eco.km_flota : null;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Coste total" value={eur(eco.coste_total)} hint="Neumáticos + operaciones (periodo)" />
        <KpiCard title="Coste por vehículo" value={eur(costeVehiculo)} />
        <KpiCard title="Coste por km" value={costeKm != null ? eur2(costeKm) : "—"} hint="Sobre km de odómetro de la flota" />
        <KpiCard title="Ahorro por reparaciones" value={eur(eco.ahorro_reparaciones)} tono="ok" hint="vs. sustituir por nuevo" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Desglose de coste</div>
          <BarList
            color="#f59e0b"
            formato={eur}
            items={[
              { etiqueta: "Neumáticos (compras)", valor: eco.coste_neumaticos },
              { etiqueta: "Reparaciones", valor: eco.coste_reparaciones },
              { etiqueta: "Sustituciones", valor: eco.coste_sustituciones },
              { etiqueta: "Montajes / rotaciones", valor: eco.coste_montajes },
            ]}
          />
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Resumen</div>
          <div className="flex flex-col divide-y divide-slate-700/60 text-[13px]">
            <div className="flex justify-between py-1.5"><span className="text-slate-400">Coste de neumáticos</span><span className="font-semibold text-slate-100">{eur(eco.coste_neumaticos)}</span></div>
            <div className="flex justify-between py-1.5"><span className="text-slate-400">Coste de operaciones</span><span className="font-semibold text-slate-100">{eur(eco.coste_operaciones)}</span></div>
            <div className="flex justify-between py-1.5"><span className="text-slate-400">Vehículos activos</span><span className="font-semibold text-slate-100">{eco.n_vehiculos}</span></div>
            <div className="flex justify-between py-1.5"><span className="text-slate-400">Km de flota (odómetro)</span><span className="font-semibold text-slate-100">{eco.km_flota.toLocaleString("es-ES")} km</span></div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Los costes de operación se introducen en la pantalla de Operaciones. El coste de neumáticos sale del coste de compra registrado en cada neumático.
        Los precios de referencia (para los ahorros) se configuran en la ficha de la empresa. El recauchutado y las rotaciones se sumarán cuando existan como tipo de operación.
      </div>
    </div>
  );
}
