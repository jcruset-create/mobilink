/**
 * Rendimiento kilométrico de los vehículos en SEGUIMIENTO DE RENDIMIENTO.
 *
 * Solo entran los vehículos marcados con «★ Seguir rendimiento» en su ficha:
 * son los que tienen punto de partida conocido (gomas de origen o km de
 * montaje), y por eso su km/mm es de fiar. Para la flota entera está «Km por mm».
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { agruparRendimiento, datosRendimiento, euros, eurPorKm, miles, type DatosRendimiento } from "../../services/rendimiento";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

const TIPO: Record<string, string> = { nuevo: "", recauchutado: "Recauchutado", reesculturado: "Reesculturado" };

export default function InformeRendimiento() {
  const { filtros } = useInformesFiltros();
  const [filas, setFilas] = useState<DatosRendimiento[]>([]);
  // De qué empresa son las filas cargadas: mientras no coincidan con el filtro, se está cargando.
  const [cargadoDe, setCargadoDe] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const empresa = filtros.empresaId ?? null;
  const cargando = cargadoDe !== empresa;

  useEffect(() => {
    let vivo = true;
    datosRendimiento({ empresaId: empresa })
      .then((d) => { if (vivo) { setFilas(d); setError(""); setCargadoDe(empresa); } })
      .catch((e) => { if (vivo) { setError(e?.message || "Error al calcular el rendimiento"); setCargadoDe(empresa); } });
    return () => { vivo = false; };
  }, [empresa]);

  const grupos = useMemo(() => agruparRendimiento(filas), [filas]);
  const vehiculos = useMemo(() => {
    const m = new Map<string, { id: string; matricula: string }>();
    for (const f of filas) m.set(f.vehiculo_id, { id: f.vehiculo_id, matricula: f.matricula });
    return [...m.values()];
  }, [filas]);

  if (cargando && filas.length === 0) return <div className="text-slate-400">Calculando el rendimiento…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  if (filas.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 text-sm text-slate-300">
        Ningún vehículo en seguimiento de rendimiento. Se activa en la ficha del vehículo con <b>«★ Seguir rendimiento»</b>.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <KpiCard title="Vehículos en seguimiento" value={vehiculos.length} hint={vehiculos.map((v) => v.matricula).join(", ")} />
        <KpiCard title="Neumáticos seguidos" value={filas.length} hint="Montados ahora en esos vehículos" />
        <KpiCard title="Grupos con proyección" value={grupos.filter((g) => g.vidaKm != null).length} hint="Modelo · eje · tipo" />
      </div>
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => descargarCSV("rendimiento-kilometrico.csv",
            ["Modelo", "Eje", "Tipo", "Gomas", "Con proyección", "km/mm medio", "Vida proyectada (km)", "€/km", "€/1000 km", "Vehículos"],
            grupos.map((g) => [g.modelo, g.eje ?? "", TIPO[g.tipo] || "Nuevo", g.gomas, g.conProyeccion, g.kmPorMm ?? "", g.vidaKm ?? "",
              g.eurKm != null ? g.eurKm.toFixed(5).replace(".", ",") : "", g.eurKm != null ? (g.eurKm * 1000).toFixed(2).replace(".", ",") : "",
              g.vehiculos.join(" ")]),
          )}
          className="rounded border border-slate-600 px-3 py-1 text-[12px] text-slate-200"
        >Exportar CSV</button>
      </div>
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Modelo</th><th className={thCls}>Eje</th><th className={thCls}>Gomas</th>
          <th className={thCls}>km/mm medio</th><th className={thCls}>Vida proyectada</th>
          <th className={thCls}>€ / km</th><th className={thCls}>€ / 1.000 km</th><th className={thCls}>Vehículos</th>
        </tr></thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.clave} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold"}>{g.modelo}
                {g.tipo !== "nuevo" && <span className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">{TIPO[g.tipo]}</span>}</td>
              <td className={tdCls}>{g.eje != null ? `Eje ${g.eje}` : "—"}</td>
              <td className={tdCls}>{g.gomas}{g.conProyeccion < g.gomas ? <span className="text-slate-500"> ({g.conProyeccion} con proyección)</span> : null}</td>
              <td className={tdCls + " font-bold text-emerald-300"}>{miles(g.kmPorMm)}</td>
              <td className={tdCls}>{g.vidaKm != null ? `≈ ${miles(g.vidaKm)} km` : "—"}</td>
              <td className={tdCls + " font-bold text-violet-300"} title={g.conCoste ? `${g.conCoste} de ${g.gomas} gomas con coste` : "Sin coste puesto"}>{eurPorKm(g.eurKm)}</td>
              <td className={tdCls + " text-violet-300"}>{euros(g.eurKm != null ? g.eurKm * 1000 : null)}</td>
              <td className={tdCls}>{g.vehiculos.map((m) => {
                const v = vehiculos.find((x) => x.matricula === m);
                return v ? <Link key={m} className="mr-2 text-sky-300 hover:underline" to={`/tyrecontrol/vehiculos/${v.id}`}>{m}</Link> : m;
              })}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <div className="mt-2 text-[11px] text-slate-500">
        Las recauchutadas y las reesculturadas van aparte para no mezclar vidas distintas. Con menos de 1 mm gastado una goma no tiene proyección todavía.
      </div>
    </div>
  );
}
