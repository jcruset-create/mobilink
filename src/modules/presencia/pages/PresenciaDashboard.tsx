import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PresenciaLayout from "../components/PresenciaLayout";
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
    { label: "Presentes ahora", valor: presentes.length,   badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
    { label: "Han salido",      valor: completados.length, badge: "border-slate-500/30 bg-slate-500/15 text-slate-300" },
    { label: "Sin fichar hoy",  valor: ausentes,           badge: "border-orange-500/30 bg-orange-500/15 text-orange-300" },
    { label: "Total plantilla", valor: totalEmpleados,     badge: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  ];

  return (
    <PresenciaLayout
      title="Mobilink Presencia"
      subtitle={new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
      actions={
        <Link
          to="/presencia/fichajes"
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          Ver fichajes →
        </Link>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-lg border px-3 py-2 ${s.badge}`}>
            <div className="text-[9px] font-bold uppercase leading-tight">{s.label}</div>
            <div className="text-2xl font-black leading-tight">{s.valor}</div>
          </div>
        ))}
      </div>

      {cargando ? (
        <div className="flex h-40 items-center justify-center text-slate-500">Cargando...</div>
      ) : (
        <>
          {/* Presentes ahora */}
          {presentes.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2 border-b border-slate-800 bg-emerald-500/10 px-4 py-2.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-300">En planta ahora · {presentes.length}</h2>
              </div>
              <div className="divide-y divide-slate-800">
                {presentes.map((r) => {
                  const emp = r.sea_employees;
                  return (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50">
                      <div>
                        <div className="text-sm font-medium">{emp?.nombre} {emp?.apellidos}</div>
                        {emp?.cargo && <div className="text-xs text-slate-500">{emp.cargo}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-emerald-300">Entrada {fmt(r.hora_entrada)}</div>
                        <div className="text-xs capitalize text-slate-500">{r.tipo}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completados */}
          {completados.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="border-b border-slate-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-slate-300">Jornada completada · {completados.length}</h2>
              </div>
              <div className="divide-y divide-slate-800">
                {completados.map((r) => {
                  const emp = r.sea_employees;
                  return (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50">
                      <div>
                        <div className="text-sm font-medium">{emp?.nombre} {emp?.apellidos}</div>
                        {emp?.cargo && <div className="text-xs text-slate-500">{emp.cargo}</div>}
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-slate-300">{fmt(r.hora_entrada)} → {fmt(r.hora_salida)}</span>
                        <div className="text-xs text-slate-500">{duracion(r.hora_entrada, r.hora_salida)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {registros.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-10 text-center text-slate-500">
              <div className="mb-3 text-4xl">🏁</div>
              <div className="text-sm">Nadie ha fichado todavía hoy.</div>
            </div>
          )}
        </>
      )}
    </PresenciaLayout>
  );
}
