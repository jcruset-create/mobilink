import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SafetyMenu from "../components/SafetyMenu";
import { supabase } from "../services/supabase";

type Stats = {
  total_epis: number;
  epis_stock_bajo: number;
  entregas_activas: number;
  docs_pendientes_lectura: number;
  reuniones_proximas: number;
  formaciones_caducadas: number;
};

export default function SafetyDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [episStockBajo, setEpisStockBajo] = useState<any[]>([]);
  const [docsRecientes, setDocsRecientes] = useState<any[]>([]);
  const [reunionesProximas, setReunionesProximas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [
      { data: epis },
      { data: stockBajo },
      { data: docs },
      { data: reuniones },
    ] = await Promise.all([
      supabase.from("sm_epis").select("id, stock_actual, stock_minimo").eq("activo", true),
      supabase.from("sm_epis").select("id, nombre, codigo, stock_actual, stock_minimo")
        .eq("activo", true).filter("stock_actual", "lte", "stock_minimo").order("stock_actual").limit(5),
      supabase.from("sm_safety_documents").select("id, titulo, tipo, publicado, fecha_publicacion, lectura_obligatoria")
        .eq("publicado", true).order("fecha_publicacion", { ascending: false }).limit(5),
      supabase.from("sm_safety_meetings").select("id, titulo, fecha, estado")
        .eq("estado", "programada").gte("fecha", new Date().toISOString())
        .order("fecha").limit(5),
    ]);

    const totalEpis = epis?.length ?? 0;
    const stockBajoCount = epis?.filter((e) => e.stock_actual <= e.stock_minimo).length ?? 0;

    setStats({
      total_epis:             totalEpis,
      epis_stock_bajo:        stockBajoCount,
      entregas_activas:       0,
      docs_pendientes_lectura: 0,
      reuniones_proximas:     reuniones?.length ?? 0,
      formaciones_caducadas:  0,
    });
    setEpisStockBajo(stockBajo ?? []);
    setDocsRecientes(docs ?? []);
    setReunionesProximas(reuniones ?? []);
    setCargando(false);
  }

  if (cargando) return (
    <div className="p-6"><SafetyMenu />
      <div className="flex items-center justify-center h-40 text-gray-400">Cargando...</div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <SafetyMenu />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mobilink Safety Manager</h1>
          <p className="text-sm text-gray-500">Gestión de EPIs, PRL y documentación preventiva</p>
        </div>
        <Link to="/safety/epis" className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nuevo EPI
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Total EPIs",      value: stats?.total_epis,             color: "bg-gray-50 border-gray-200",     text: "text-gray-800" },
          { label: "Stock bajo",      value: stats?.epis_stock_bajo,        color: "bg-red-50 border-red-200",       text: "text-red-800" },
          { label: "Entregas activas",value: stats?.entregas_activas,       color: "bg-blue-50 border-blue-200",     text: "text-blue-800" },
          { label: "Docs pendientes", value: stats?.docs_pendientes_lectura,color: "bg-orange-50 border-orange-200", text: "text-orange-800" },
          { label: "Reuniones próx.", value: stats?.reuniones_proximas,     color: "bg-purple-50 border-purple-200", text: "text-purple-800" },
          { label: "Form. caducadas", value: stats?.formaciones_caducadas,  color: "bg-yellow-50 border-yellow-200", text: "text-yellow-800" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
            <div className={`text-3xl font-black ${s.text}`}>{s.value ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* EPIs stock bajo */}
        <div className="rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-semibold text-red-700">⚠ EPIs con stock bajo</h2>
            <Link to="/safety/epis" className="text-xs text-blue-600 hover:underline">Ver todos →</Link>
          </div>
          <div className="divide-y">
            {episStockBajo.length === 0
              ? <p className="p-4 text-sm text-gray-400">Stock correcto en todos los EPIs</p>
              : episStockBajo.map((e) => (
                <div key={e.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-sm font-medium">{e.nombre}</div>
                    <div className="text-xs text-gray-400">{e.codigo}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-red-600">{e.stock_actual}</div>
                    <div className="text-xs text-gray-400">mín. {e.stock_minimo}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Documentos recientes */}
        <div className="rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-semibold">📄 Documentos recientes</h2>
            <Link to="/safety/documentos" className="text-xs text-blue-600 hover:underline">Ver todos →</Link>
          </div>
          <div className="divide-y">
            {docsRecientes.length === 0
              ? <p className="p-4 text-sm text-gray-400">Sin documentos publicados</p>
              : docsRecientes.map((d) => (
                <div key={d.id} className="p-3">
                  <div className="text-sm font-medium">{d.titulo}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{d.tipo}</span>
                    {d.lectura_obligatoria && (
                      <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs">Obligatorio</span>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Reuniones próximas */}
        <div className="rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-semibold text-purple-700">📅 Reuniones programadas</h2>
            <Link to="/safety/reuniones" className="text-xs text-blue-600 hover:underline">Ver todas →</Link>
          </div>
          <div className="divide-y">
            {reunionesProximas.length === 0
              ? <p className="p-4 text-sm text-gray-400">Sin reuniones programadas</p>
              : reunionesProximas.map((r) => {
                const dias = Math.ceil((new Date(r.fecha).getTime() - Date.now()) / 86400000);
                return (
                  <div key={r.id} className="p-3">
                    <div className="text-sm font-medium">{r.titulo}</div>
                    <div className={`text-xs font-semibold mt-0.5 ${dias <= 1 ? "text-red-600" : dias <= 7 ? "text-orange-600" : "text-gray-400"}`}>
                      {dias === 0 ? "Hoy" : dias === 1 ? "Mañana" : `En ${dias} días`}
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { to: "/safety/epis",        label: "EPIs",        icon: "🦺", color: "bg-yellow-50 hover:bg-yellow-100 border-yellow-200" },
          { to: "/safety/entregas",    label: "Entregas",    icon: "📦", color: "bg-blue-50 hover:bg-blue-100 border-blue-200" },
          { to: "/safety/documentos",  label: "Documentos",  icon: "📄", color: "bg-green-50 hover:bg-green-100 border-green-200" },
          { to: "/safety/formacion",   label: "Formación",   icon: "🎓", color: "bg-purple-50 hover:bg-purple-100 border-purple-200" },
        ].map((a) => (
          <Link key={a.to} to={a.to}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors ${a.color}`}>
            <span className="text-2xl">{a.icon}</span>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
