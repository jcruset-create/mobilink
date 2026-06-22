import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PresenciaMenu from "../components/PresenciaMenu";
import { supabase } from "../services/supabase";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function duracion(entrada: string | null, salida: string | null): string {
  if (!entrada || !salida) return "—";
  const mins = Math.round((new Date(salida).getTime() - new Date(entrada).getTime()) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export default function PresenciaDashboard() {
  const hoy = new Date().toISOString().slice(0, 10);

  const [registros, setRegistros] = useState<any[]>([]);
  const [totalEmpleados, setTotalEmpleados] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: regs }, { count }] = await Promise.all([
      supabase.from("pres_records")
        .select("*, sea_employees(nombre, apellidos, cargo, departamento)")
        .eq("fecha", hoy)
        .order("hora_entrada", { ascending: true }),
      supabase.from("sea_employees")
        .select("*", { count: "exact", head: true })
        .eq("activo", true),
    ]);
    setRegistros(regs ?? []);
    setTotalEmpleados(count ?? 0);
    setCargando(false);
  }

  const presentes  = registros.filter((r) => r.hora_entrada && !r.hora_salida);
  const completados = registros.filter((r) => r.hora_entrada && r.hora_salida);
  const ausentes   = totalEmpleados - registros.length;

  const stats = [
    { label: "Presentes ahora",  valor: presentes.length,   color: "text-green-600",  bg: "bg-green-50",  border: "border-green-200", icon: "🟢" },
    { label: "Han salido",       valor: completados.length,  color: "text-gray-600",   bg: "bg-gray-50",   border: "border-gray-200",  icon: "✅" },
    { label: "Sin fichar hoy",   valor: ausentes,            color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", icon: "⏳" },
    { label: "Total plantilla",  valor: totalEmpleados,      color: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200",  icon: "👷" },
  ];

  return (
    <div className="p-6 space-y-6">
      <PresenciaMenu />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Presencia</h1>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <Link to="/presencia/fichajes"
          className="rounded-xl border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Ver todos los fichajes →
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-2xl border ${s.border} ${s.bg} p-5`}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className={`text-3xl font-black ${s.color}`}>{s.valor}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <>
          {/* Presentes ahora */}
          {presentes.length > 0 && (
            <div className="rounded-2xl border bg-white overflow-hidden">
              <div className="px-5 py-3 border-b bg-green-50 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <h2 className="font-semibold text-green-800">En planta ahora · {presentes.length}</h2>
              </div>
              <div className="divide-y">
                {presentes.map((r) => {
                  const emp = r.sea_employees;
                  return (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{emp?.nombre} {emp?.apellidos}</div>
                        {emp?.cargo && <div className="text-xs text-gray-400">{emp.cargo}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-green-700">Entrada {fmt(r.hora_entrada)}</div>
                        <div className="text-xs text-gray-400 capitalize">{r.tipo}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completados */}
          {completados.length > 0 && (
            <div className="rounded-2xl border bg-white overflow-hidden">
              <div className="px-5 py-3 border-b bg-gray-50">
                <h2 className="font-semibold text-gray-700">Jornada completada · {completados.length}</h2>
              </div>
              <div className="divide-y">
                {completados.map((r) => {
                  const emp = r.sea_employees;
                  return (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{emp?.nombre} {emp?.apellidos}</div>
                        {emp?.cargo && <div className="text-xs text-gray-400">{emp.cargo}</div>}
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-gray-600">{fmt(r.hora_entrada)} → {fmt(r.hora_salida)}</span>
                        <div className="text-xs text-gray-400">{duracion(r.hora_entrada, r.hora_salida)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {registros.length === 0 && (
            <div className="rounded-2xl border bg-white p-10 text-center text-gray-400">
              <div className="text-4xl mb-3">🏁</div>
              <div className="text-sm">Nadie ha fichado todavía hoy.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
