import { useEffect, useState } from "react";
import { AlertTriangle, Building2, CalendarDays, Clock3, Plus } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Formacion = {
  id: string;
  titulo: string;
  tipo: string;
  descripcion: string | null;
  organismo: string | null;
  duracion_horas: number | null;
  vigencia_meses: number | null;
  obligatoria: boolean;
  activa: boolean;
};

type Registro = {
  id: string;
  fecha_fin: string | null;
  fecha_caducidad: string | null;
  estado: string;
  aprobado: boolean | null;
  sm_trainings: { titulo: string; tipo: string } | null;
  sea_employees: { nombre: string } | null;
};

const TIPO_BADGE: Record<string, string> = {
  prl:       "border-red-500/30 bg-red-500/15 text-red-300",
  tecnica:   "border-sky-500/30 bg-sky-500/15 text-sky-300",
  maquinaria:"border-orange-500/30 bg-orange-500/15 text-orange-300",
  otro:      "border-slate-500/30 bg-slate-500/15 text-slate-300",
};

const ESTADO_BADGE: Record<string, string> = {
  completado:    "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  en_curso:      "border-sky-500/30 bg-sky-500/15 text-sky-300",
  pendiente:     "border-amber-500/30 bg-amber-500/15 text-amber-300",
  caducado:      "border-red-500/30 bg-red-500/15 text-red-300",
  no_presentado: "border-slate-500/30 bg-slate-500/20 text-slate-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Formacion() {
  const [formaciones, setFormaciones] = useState<Formacion[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [tab, setTab] = useState<"catalogo" | "registros">("catalogo");
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [modalReg, setModalReg] = useState(false);
  const [form, setForm] = useState({ titulo: "", tipo: "prl", descripcion: "", organismo: "", duracion_horas: "", vigencia_meses: "", obligatoria: false });
  const [formReg, setFormReg] = useState({ training_id: "", employee_id: "", fecha_fin: "", fecha_caducidad: "", estado: "completado", aprobado: true });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: f }, { data: r }, { data: emps }] = await Promise.all([
      supabase.from("sm_trainings").select("*").eq("activa", true).order("titulo"),
      supabase.from("sm_training_records")
        .select("id, fecha_fin, fecha_caducidad, estado, aprobado, sm_trainings(titulo, tipo), sea_employees(nombre)")
        .order("fecha_fin", { ascending: false }).limit(200),
      supabase.from("sea_employees").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    setFormaciones(f ?? []);
    setRegistros((r ?? []) as any);
    setEmpleados(emps ?? []);
    setCargando(false);
  }

  async function crearFormacion() {
    if (!form.titulo?.trim()) { setError("Título obligatorio."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("sm_trainings").insert({
      titulo: form.titulo.trim(), tipo: form.tipo,
      descripcion: form.descripcion || null, organismo: form.organismo || null,
      duracion_horas: form.duracion_horas ? parseFloat(form.duracion_horas) : null,
      vigencia_meses: form.vigencia_meses ? parseInt(form.vigencia_meses) : null,
      obligatoria: form.obligatoria, activa: true,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Formación creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function registrarAsistencia() {
    if (!formReg.training_id || !formReg.employee_id) { setError("Formación y empleado obligatorios."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("sm_training_records").insert({
      training_id: formReg.training_id, employee_id: formReg.employee_id,
      fecha_fin: formReg.fecha_fin || null, fecha_caducidad: formReg.fecha_caducidad || null,
      estado: formReg.estado, aprobado: formReg.aprobado,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Registro añadido.");
    setModalReg(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  const caducadosCount = registros.filter((r) => r.estado === "caducado" ||
    (r.fecha_caducidad && new Date(r.fecha_caducidad) < new Date())).length;

  return (
    <SafetyLayout
      title="Formación"
      subtitle={`${formaciones.length} cursos · ${registros.length} registros`}
      actions={
        <>
          <button onClick={() => { setForm({ titulo: "", tipo: "prl", descripcion: "", organismo: "", duracion_horas: "", vigencia_meses: "", obligatoria: false }); setError(""); setModal(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Curso</span>
          </button>
          <button onClick={() => { setFormReg({ training_id: "", employee_id: "", fecha_fin: "", fecha_caducidad: "", estado: "completado", aprobado: true }); setError(""); setModalReg(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Registrar asistencia</span>
          </button>
        </>
      }
    >
      {caducadosCount > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm font-medium text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {caducadosCount} formaciones caducadas o próximas a caducar
        </p>
      )}

      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      <div className="flex gap-2 border-b border-slate-700">
        {(["catalogo", "registros"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "border-amber-500 text-amber-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {t === "catalogo" ? `Catálogo (${formaciones.length})` : `Registros (${registros.length})`}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> :
        tab === "catalogo" ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {formaciones.map((f) => (
              <div key={f.id} className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-100">{f.titulo}</div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${TIPO_BADGE[f.tipo] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>{f.tipo}</span>
                </div>
                {f.descripcion && <p className="text-xs text-slate-400">{f.descripcion}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                  {f.organismo && <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {f.organismo}</span>}
                  {f.duracion_horas && <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {f.duracion_horas}h</span>}
                  {f.vigencia_meses && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Vigencia: {f.vigencia_meses} meses</span>}
                  {f.obligatoria && <span className="rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-red-300">Obligatoria</span>}
                </div>
              </div>
            ))}
            {formaciones.length === 0 && <p className="col-span-3 text-sm text-slate-500">Sin formaciones en el catálogo.</p>}
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="p-3">Empleado</th><th className="p-3">Formación</th><th className="p-3">Fecha fin</th><th className="p-3">Caducidad</th><th className="p-3">Estado</th><th className="p-3">Aprobado</th></tr>
              </thead>
              <tbody>
                {registros.map((r) => {
                  const caduca = r.fecha_caducidad
                    ? Math.ceil((new Date(r.fecha_caducidad).getTime() - Date.now()) / 86400000)
                    : null;
                  return (
                    <tr key={r.id} className="border-t border-slate-700/70 hover:bg-slate-700/40">
                      <td className="p-3 font-medium text-slate-100">{(r.sea_employees as any)?.nombre ?? "—"}</td>
                      <td className="p-3">
                        <div className="text-slate-200">{(r.sm_trainings as any)?.titulo ?? "—"}</div>
                        <span className={`rounded-full border px-1.5 py-0.5 text-xs ${TIPO_BADGE[(r.sm_trainings as any)?.tipo] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                          {(r.sm_trainings as any)?.tipo ?? ""}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-slate-400">{r.fecha_fin ? new Date(r.fecha_fin).toLocaleDateString("es-ES") : "—"}</td>
                      <td className="p-3">
                        {caduca === null ? <span className="text-slate-500">—</span> : (
                          <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-400" : caduca < 30 ? "text-orange-400" : "text-slate-400"}`}>
                            {caduca < 0 ? `Caducada` : `${caduca}d`}
                          </span>
                        )}
                      </td>
                      <td className="p-3"><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>{r.estado}</span></td>
                      <td className="p-3">{r.aprobado === null ? <span className="text-slate-500">—</span> : r.aprobado ? <span className="font-bold text-emerald-400">Sí</span> : <span className="font-bold text-red-400">No</span>}</td>
                    </tr>
                  );
                })}
                {registros.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">Sin registros.</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }

      {/* Modal nueva formación */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">Nuevo curso</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={`mt-1 ${INPUT}`}>
                    {["prl","tecnica","maquinaria","otro"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className={LABEL}>Duración (h)</label>
                  <input type="number" step="0.5" value={form.duracion_horas} onChange={(e) => setForm({ ...form, duracion_horas: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Organismo</label>
                  <input value={form.organismo} onChange={(e) => setForm({ ...form, organismo: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Vigencia (meses)</label>
                  <input type="number" value={form.vigencia_meses} onChange={(e) => setForm({ ...form, vigencia_meses: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={form.obligatoria} onChange={(e) => setForm({ ...form, obligatoria: e.target.checked })} className="accent-amber-500" />
                Formación obligatoria
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={crearFormacion} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear curso"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal registrar asistencia */}
      {modalReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">Registrar asistencia</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>Formación *</label>
                <select value={formReg.training_id} onChange={(e) => setFormReg({ ...formReg, training_id: e.target.value })} className={`mt-1 ${INPUT}`}>
                  <option value="">Seleccionar...</option>
                  {formaciones.map((f) => <option key={f.id} value={f.id}>{f.titulo}</option>)}
                </select></div>
              <div><label className={LABEL}>Empleado *</label>
                <select value={formReg.employee_id} onChange={(e) => setFormReg({ ...formReg, employee_id: e.target.value })} className={`mt-1 ${INPUT}`}>
                  <option value="">Seleccionar...</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Fecha realización</label>
                  <input type="date" value={formReg.fecha_fin} onChange={(e) => setFormReg({ ...formReg, fecha_fin: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Fecha caducidad</label>
                  <input type="date" value={formReg.fecha_caducidad} onChange={(e) => setFormReg({ ...formReg, fecha_caducidad: e.target.value })} className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1"><label className={LABEL}>Estado</label>
                  <select value={formReg.estado} onChange={(e) => setFormReg({ ...formReg, estado: e.target.value })} className={`mt-1 ${INPUT}`}>
                    {["completado","en_curso","pendiente","no_presentado"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={formReg.aprobado} onChange={(e) => setFormReg({ ...formReg, aprobado: e.target.checked })} className="accent-amber-500" />
                    Aprobado
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModalReg(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={registrarAsistencia} disabled={guardando}
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
