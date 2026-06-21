import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
  correcto:          "bg-green-100 text-green-800",
  con_deficiencias:  "bg-orange-100 text-orange-800",
  critico:           "bg-red-100 text-red-800",
};

const TIPOS = ["periodica","inicial","tras_accidente","auditoria"];

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
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inspecciones de seguridad</h1>
          <p className="text-sm text-gray-500">{filtrados.length} inspecciones</p>
        </div>
        <button onClick={() => { setForm({ titulo: "", tipo: "periodica", fecha: new Date().toISOString().substring(0, 16), resultado: "correcto", observaciones: "", proxima_inspeccion: "", realizado_por: "" }); setError(""); setModal(true); }}
          className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nueva inspección
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Resumen */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "", label: "Todas" },
          { key: "correcto",         label: `Correctas (${items.filter((i) => i.resultado === "correcto").length})` },
          { key: "con_deficiencias", label: `Con deficiencias (${items.filter((i) => i.resultado === "con_deficiencias").length})` },
          { key: "critico",          label: `Críticas (${items.filter((i) => i.resultado === "critico").length})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFiltroResultado(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              filtroResultado === key
                ? key === "critico" ? "bg-red-600 text-white border-red-600"
                  : key === "con_deficiencias" ? "bg-orange-500 text-white border-orange-500"
                  : "bg-yellow-500 text-white border-yellow-500"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="space-y-3">
          {filtrados.map((i) => {
            const proxima = i.proxima_inspeccion
              ? Math.ceil((new Date(i.proxima_inspeccion).getTime() - Date.now()) / 86400000)
              : null;
            return (
              <div key={i.id} className={`rounded-xl border bg-white p-4 border-l-4 ${
                i.resultado === "critico" ? "border-l-red-500" :
                i.resultado === "con_deficiencias" ? "border-l-orange-400" : "border-l-green-400"
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{i.titulo}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULTADO_BADGE[i.resultado] ?? "bg-gray-100"}`}>
                        {i.resultado.replace(/_/g, " ")}
                      </span>
                      <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-xs">{i.tipo}</span>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                      <span>📅 {new Date(i.fecha).toLocaleDateString("es-ES")}</span>
                      {(i.sea_employees as any)?.nombre && <span>👤 {(i.sea_employees as any).nombre}</span>}
                      {proxima !== null && (
                        <span className={`font-semibold ${proxima < 0 ? "text-red-600" : proxima < 30 ? "text-orange-600" : "text-gray-500"}`}>
                          Próxima: {proxima < 0 ? `Vencida (${Math.abs(proxima)}d)` : `en ${proxima}d`}
                        </span>
                      )}
                    </div>
                    {i.observaciones && <p className="text-sm text-gray-600 mt-2">{i.observaciones}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          {filtrados.length === 0 && (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-400">Sin inspecciones registradas.</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nueva inspección</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {TIPOS.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select></div>
                <div><label className="text-xs font-medium text-gray-600">Resultado</label>
                  <select value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="correcto">Correcto</option>
                    <option value="con_deficiencias">Con deficiencias</option>
                    <option value="critico">Crítico</option>
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Fecha</label>
                  <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Próxima inspección</label>
                  <input type="date" value={form.proxima_inspeccion} onChange={(e) => setForm({ ...form, proxima_inspeccion: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Realizado por</label>
                <select value={form.realizado_por} onChange={(e) => setForm({ ...form, realizado_por: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Sin asignar</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Observaciones</label>
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={crear} disabled={guardando} className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
