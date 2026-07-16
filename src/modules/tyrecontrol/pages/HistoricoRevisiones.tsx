import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarRevisionesHistorico, listarEmpresas, listarUsuarios } from "../services/data";
import type { Empresa, Perfil } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";

// ── Estado de la revisión → etiqueta y color ─────────────────
const ESTADO_META: Record<string, { label: string; cls: string }> = {
  completada: { label: "Completada", cls: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" },
  completada_con_incidencias: { label: "Con incidencias solucionadas", cls: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30" },
  completada_incidencia_pendiente: { label: "Con incidencia pendiente", cls: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40" },
};

type Fila = {
  id: string;
  fecha: string;
  hora: string;
  matricula: string;
  unidad: string | null;
  cliente: string;
  base: string;
  tecnico: string;
  km: number | null;
  estado: string;
  incidencias: number;
  incidenciasAbiertas: number;
  vehiculoId?: string;
};

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function haceDiasISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inicioMesISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fechaCorta(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : iso;
}

export default function HistoricoRevisiones() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filtros (por defecto: últimos 7 días)
  const [desde, setDesde] = useState(haceDiasISO(7));
  const [hasta, setHasta] = useState(hoyISO());
  const [fEmpresa, setFEmpresa] = useState("");
  const [fTecnico, setFTecnico] = useState("");

  useEffect(() => {
    Promise.all([listarEmpresas(), listarUsuarios()])
      .then(([e, u]) => { setEmpresas(e); setUsuarios(u); })
      .catch(() => {/* los filtros quedan vacíos, la tabla sigue */});
  }, []);

  async function cargar() {
    setLoading(true); setError("");
    try {
      const data = await listarRevisionesHistorico({
        desde: desde || null,
        hasta: hasta || null,
        empresaId: fEmpresa || null,
        tecnicoId: fTecnico || null,
      });
      setFilas(data.map((r: any) => {
        const d = r.created_at ? new Date(r.created_at) : null;
        const incs = (r.incidencias ?? []) as { estado: string }[];
        return {
          id: r.id,
          fecha: r.fecha_revision ?? "",
          hora: d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "",
          matricula: r.vehiculo?.matricula ?? "—",
          unidad: r.vehiculo?.numero_unidad ?? null,
          cliente: r.vehiculo?.empresa?.nombre ?? "—",
          base: r.vehiculo?.delegacion?.nombre ?? "—",
          tecnico: r.tecnico?.nombre ?? "—",
          km: r.km_vehiculo != null ? Number(r.km_vehiculo) : null,
          estado: r.estado_revision ?? "completada",
          incidencias: incs.length,
          incidenciasAbiertas: incs.filter((i) => !["solucionada", "cancelada", "no_procede"].includes(i.estado)).length,
        };
      }));
    } catch (e: any) { setError(e?.message || "Error"); }
    finally { setLoading(false); }
  }
  // Recarga al cambiar cualquier filtro (la consulta filtra en el servidor).
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [desde, hasta, fEmpresa, fTecnico]);

  const rango = (d: string, h: string) => { setDesde(d); setHasta(h); };
  const esHoy = desde === hoyISO() && hasta === hoyISO();
  const es7 = desde === haceDiasISO(7) && hasta === hoyISO();
  const esMes = desde === inicioMesISO() && hasta === hoyISO();

  const resumen = useMemo(() => {
    const conInc = filas.filter((f) => f.incidencias > 0).length;
    const pend = filas.filter((f) => f.incidenciasAbiertas > 0).length;
    return { total: filas.length, conInc, pend };
  }, [filas]);

  const btnCls = (activo: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-bold ${activo ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Histórico de revisiones</h1>
      <p className="mb-3 text-sm text-slate-400">Revisiones realizadas, con filtro por fechas, cliente y operario.</p>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <button onClick={() => rango(hoyISO(), hoyISO())} className={btnCls(esHoy)}>Hoy</button>
        <button onClick={() => rango(haceDiasISO(7), hoyISO())} className={btnCls(es7)}>Últimos 7 días</button>
        <button onClick={() => rango(inicioMesISO(), hoyISO())} className={btnCls(esMes)}>Este mes</button>
        <label className="flex flex-col text-[10px] text-slate-500">Desde
          <input type="date" className={`${inputCls} w-auto`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Hasta
          <input type="date" className={`${inputCls} w-auto`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
          <option value="">Todos los clientes</option>
          {empresas.filter((e) => e.activo !== false).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTecnico} onChange={(e) => setFTecnico(e.target.value)}>
          <option value="">Todos los operarios</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <span className="pb-2 text-xs text-slate-500">
          {resumen.total} revisión(es) · {resumen.conInc} con incidencias · {resumen.pend} con incidencia pendiente
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">
          {error} <button onClick={cargar} className="ml-2 rounded bg-slate-700 px-2 py-0.5 text-slate-200">Reintentar</button>
        </div>
      )}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Fecha</th><th className={thCls}>Hora</th><th className={thCls}>Matrícula</th>
          <th className={thCls}>Cliente</th><th className={thCls}>Base</th><th className={thCls}>Operario</th>
          <th className={thCls}>Km</th><th className={thCls}>Incidencias</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Cargando…</td></tr>
          ) : filas.length === 0 ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Sin revisiones en este periodo.</td></tr>
          ) : filas.map((f) => {
            const meta = ESTADO_META[f.estado] ?? { label: f.estado, cls: "bg-slate-500/15 text-slate-300" };
            return (
              <tr key={f.id} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-300"}>{fechaCorta(f.fecha)}</td>
                <td className={tdCls + " text-slate-400"}>{f.hora || "—"}</td>
                <td className={tdCls + " font-bold"}>{f.matricula}{f.unidad ? <span className="ml-1 text-[11px] font-normal text-slate-500">· {f.unidad}</span> : null}</td>
                <td className={tdCls + " text-slate-400"}>{f.cliente}</td>
                <td className={tdCls + " text-slate-400"}>{f.base}</td>
                <td className={tdCls + " text-slate-300"}>{f.tecnico}</td>
                <td className={tdCls + " text-slate-400"}>{f.km != null ? f.km.toLocaleString("es-ES") : "—"}</td>
                <td className={tdCls}>
                  {f.incidencias === 0 ? <span className="text-slate-500">—</span> : (
                    <button onClick={() => navigate("/tyrecontrol/incidencias")}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${f.incidenciasAbiertas > 0 ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}
                      title={f.incidenciasAbiertas > 0 ? `${f.incidenciasAbiertas} abiertas` : "Todas solucionadas"}>
                      {f.incidencias}{f.incidenciasAbiertas > 0 ? ` (${f.incidenciasAbiertas} abiertas)` : " ✓"}
                    </button>
                  )}
                </td>
                <td className={tdCls}>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}
