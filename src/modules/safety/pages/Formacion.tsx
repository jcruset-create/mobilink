import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
  prl:       "bg-red-100 text-red-800",
  tecnica:   "bg-blue-100 text-blue-800",
  maquinaria:"bg-orange-100 text-orange-800",
  otro:      "bg-gray-100 text-gray-600",
};

const ESTADO_BADGE: Record<string, string> = {
  completado:    "bg-green-100 text-green-800",
  en_curso:      "bg-blue-100 text-blue-800",
  pendiente:     "bg-yellow-100 text-yellow-800",
  caducado:      "bg-red-100 text-red-800",
  no_presentado: "bg-gray-200 text-gray-600",
};

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
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Formación</h1>
          {caducadosCount > 0 && (
            <p className="text-sm text-red-600 font-medium">⚠ {caducadosCount} formaciones caducadas o próximas a caducar</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setForm({ titulo: "", tipo: "prl", descripcion: "", organismo: "", duracion_horas: "", vigencia_meses: "", obligatoria: false }); setError(""); setModal(true); }}
            className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50">+ Curso</button>
          <button onClick={() => { setFormReg({ training_id: "", employee_id: "", fecha_fin: "", fecha_caducidad: "", estado: "completado", aprobado: true }); setError(""); setModalReg(true); }}
            className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">+ Registrar asistencia</button>
        </div>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <div className="flex gap-2 border-b">
        {(["catalogo", "registros"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-yellow-500 text-yellow-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t === "catalogo" ? `Catálogo (${formaciones.length})` : `Registros (${registros.length})`}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> :
        tab === "catalogo" ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {formaciones.map((f) => (
              <div key={f.id} className="rounded-xl border bg-white p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{f.titulo}</div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${TIPO_BADGE[f.tipo] ?? "bg-gray-100"}`}>{f.tipo}</span>
                </div>
                {f.descripcion && <p className="text-xs text-gray-500">{f.descripcion}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  {f.organismo && <span>🏢 {f.organismo}</span>}
                  {f.duracion_horas && <span>⏱ {f.duracion_horas}h</span>}
                  {f.vigencia_meses && <span>📅 Vigencia: {f.vigencia_meses} meses</span>}
                  {f.obligatoria && <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5">Obligatoria</span>}
                </div>
              </div>
            ))}
            {formaciones.length === 0 && <p className="text-sm text-gray-400 col-span-3">Sin formaciones en el catálogo.</p>}
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border bg-white">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-gray-50 text-left">
                <tr><th className="p-3">Empleado</th><th className="p-3">Formación</th><th className="p-3">Fecha fin</th><th className="p-3">Caducidad</th><th className="p-3">Estado</th><th className="p-3">Aprobado</th></tr>
              </thead>
              <tbody>
                {registros.map((r) => {
                  const caduca = r.fecha_caducidad
                    ? Math.ceil((new Date(r.fecha_caducidad).getTime() - Date.now()) / 86400000)
                    : null;
                  return (
                    <tr key={r.id} className="border-t hover:bg-gray-50">
                      <td className="p-3 font-medium">{(r.sea_employees as any)?.nombre ?? "—"}</td>
                      <td className="p-3">
                        <div>{(r.sm_trainings as any)?.titulo ?? "—"}</div>
                        <span className={`rounded-full px-1.5 py-0.5 text-xs ${TIPO_BADGE[(r.sm_trainings as any)?.tipo] ?? "bg-gray-100"}`}>
                          {(r.sm_trainings as any)?.tipo ?? ""}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-gray-500">{r.fecha_fin ? new Date(r.fecha_fin).toLocaleDateString("es-ES") : "—"}</td>
                      <td className="p-3">
                        {caduca === null ? <span className="text-gray-400">—</span> : (
                          <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-600" : caduca < 30 ? "text-orange-600" : "text-gray-500"}`}>
                            {caduca < 0 ? `Caducada` : `${caduca}d`}
                          </span>
                        )}
                      </td>
                      <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "bg-gray-100"}`}>{r.estado}</span></td>
                      <td className="p-3">{r.aprobado === null ? "—" : r.aprobado ? "✅" : "❌"}</td>
                    </tr>
                  );
                })}
                {registros.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Sin registros.</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }

      {/* Modal nueva formación */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuevo curso</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {["prl","tecnica","maquinaria","otro"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="text-xs font-medium text-gray-600">Duración (h)</label>
                  <input type="number" step="0.5" value={form.duracion_horas} onChange={(e) => setForm({ ...form, duracion_horas: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Organismo</label>
                  <input value={form.organismo} onChange={(e) => setForm({ ...form, organismo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Vigencia (meses)</label>
                  <input type="number" value={form.vigencia_meses} onChange={(e) => setForm({ ...form, vigencia_meses: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.obligatoria} onChange={(e) => setForm({ ...form, obligatoria: e.target.checked })} />
                Formación obligatoria
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={crearFormacion} disabled={guardando} className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear curso"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal registrar asistencia */}
      {modalReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Registrar asistencia</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Formación *</label>
                <select value={formReg.training_id} onChange={(e) => setFormReg({ ...formReg, training_id: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Seleccionar...</option>
                  {formaciones.map((f) => <option key={f.id} value={f.id}>{f.titulo}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Empleado *</label>
                <select value={formReg.employee_id} onChange={(e) => setFormReg({ ...formReg, employee_id: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Seleccionar...</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Fecha realización</label>
                  <input type="date" value={formReg.fecha_fin} onChange={(e) => setFormReg({ ...formReg, fecha_fin: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Fecha caducidad</label>
                  <input type="date" value={formReg.fecha_caducidad} onChange={(e) => setFormReg({ ...formReg, fecha_caducidad: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1"><label className="text-xs font-medium text-gray-600">Estado</label>
                  <select value={formReg.estado} onChange={(e) => setFormReg({ ...formReg, estado: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {["completado","en_curso","pendiente","no_presentado"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={formReg.aprobado} onChange={(e) => setFormReg({ ...formReg, aprobado: e.target.checked })} />
                    Aprobado
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModalReg(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={registrarAsistencia} disabled={guardando} className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
