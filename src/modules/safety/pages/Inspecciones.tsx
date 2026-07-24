import { useEffect, useState } from "react";
import { CalendarDays, Plus, User } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Inspeccion = {
  id: string;
  titulo: string;
  tipo: string;
  fecha: string;
  resultado: string;
  observaciones: string | null;
  proxima_inspeccion: string | null;
  informe_url: string | null;
  sea_employees: { nombre: string } | null;
};

const RESULTADO_BADGE: Record<string, string> = {
  correcto:          "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  con_deficiencias:  "border-orange-500/30 bg-orange-500/15 text-orange-300",
  critico:           "border-red-500/30 bg-red-500/15 text-red-300",
};

const TIPOS = ["periodica","inicial","tras_accidente","auditoria"];

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Inspecciones() {
  const [items, setItems] = useState<Inspeccion[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroResultado, setFiltroResultado] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ titulo: "", tipo: "periodica", fecha: new Date().toISOString().substring(0, 16), resultado: "correcto", observaciones: "", proxima_inspeccion: "", realizado_por: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: insp }, { data: emps }] = await Promise.all([
      supabase.from("sm_inspections")
        .select("id, titulo, tipo, fecha, resultado, observaciones, proxima_inspeccion, informe_url, sea_employees(nombre)")
        .order("fecha", { ascending: false }).limit(100),
      supabase.from("sea_employees").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    setItems((insp ?? []) as any);
    setEmpleados(emps ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((i) => !filtroResultado || i.resultado === filtroResultado);

  async function crear() {
    if (!form.titulo?.trim()) { setError("Título obligatorio."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("sm_inspections").insert({
      titulo: form.titulo.trim(), tipo: form.tipo,
      fecha: new Date(form.fecha).toISOString(),
      resultado: form.resultado,
      observaciones: form.observaciones || null,
      proxima_inspeccion: form.proxima_inspeccion || null,
      realizado_por: form.realizado_por || null,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Inspección registrada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <SafetyLayout
      title="Inspecciones de seguridad"
      subtitle={`${filtrados.length} inspecciones`}
      actions={
        <button onClick={() => { setForm({ titulo: "", tipo: "periodica", fecha: new Date().toISOString().substring(0, 16), resultado: "correcto", observaciones: "", proxima_inspeccion: "", realizado_por: "" }); setError(""); setModal(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva inspección</span>
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Resumen / filtro */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "", label: "Todas" },
          { key: "correcto",         label: `Correctas (${items.filter((i) => i.resultado === "correcto").length})` },
          { key: "con_deficiencias", label: `Con deficiencias (${items.filter((i) => i.resultado === "con_deficiencias").length})` },
          { key: "critico",          label: `Críticas (${items.filter((i) => i.resultado === "critico").length})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFiltroResultado(key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filtroResultado === key
                ? key === "critico" ? "border-red-600 bg-red-600 text-white"
                  : key === "con_deficiencias" ? "border-orange-500 bg-orange-500 text-orange-950"
                  : "border-amber-500 bg-amber-500 text-amber-950"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="space-y-3">
          {filtrados.map((i) => {
            const proxima = i.proxima_inspeccion
              ? Math.ceil((new Date(i.proxima_inspeccion).getTime() - Date.now()) / 86400000)
              : null;
            return (
              <div key={i.id} className={`rounded-xl border border-l-4 border-slate-700 bg-slate-800 p-4 shadow-sm ${
                i.resultado === "critico" ? "border-l-red-500" :
                i.resultado === "con_deficiencias" ? "border-l-orange-400" : "border-l-emerald-400"
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-100">{i.titulo}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RESULTADO_BADGE[i.resultado] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                        {i.resultado.replace(/_/g, " ")}
                      </span>
                      <span className="rounded-full border border-slate-500/30 bg-slate-500/15 px-2 py-0.5 text-xs text-slate-300">{i.tipo}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {new Date(i.fecha).toLocaleDateString("es-ES")}</span>
                      {(i.sea_employees as any)?.nombre && <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {(i.sea_employees as any).nombre}</span>}
                      {proxima !== null && (
                        <span className={`font-semibold ${proxima < 0 ? "text-red-400" : proxima < 30 ? "text-orange-400" : "text-slate-400"}`}>
                          Próxima: {proxima < 0 ? `Vencida (${Math.abs(proxima)}d)` : `en ${proxima}d`}
                        </span>
                      )}
                    </div>
                    {i.observaciones && <p className="mt-2 text-sm text-slate-300">{i.observaciones}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          {filtrados.length === 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin inspecciones registradas.</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">Nueva inspección</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={`mt-1 ${INPUT}`}>
                    {TIPOS.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select></div>
                <div><label className={LABEL}>Resultado</label>
                  <select value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value })} className={`mt-1 ${INPUT}`}>
                    <option value="correcto">Correcto</option>
                    <option value="con_deficiencias">Con deficiencias</option>
                    <option value="critico">Crítico</option>
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Fecha</label>
                  <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Próxima inspección</label>
                  <input type="date" value={form.proxima_inspeccion} onChange={(e) => setForm({ ...form, proxima_inspeccion: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div><label className={LABEL}>Realizado por</label>
                <select value={form.realizado_por} onChange={(e) => setForm({ ...form, realizado_por: e.target.value })} className={`mt-1 ${INPUT}`}>
                  <option value="">Sin asignar</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div><label className={LABEL}>Observaciones</label>
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className={`mt-1 resize-none ${INPUT}`} rows={3} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={crear} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SafetyLayout>
  );
}
