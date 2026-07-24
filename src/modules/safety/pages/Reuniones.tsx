import { useEffect, useState } from "react";
import { CalendarDays, Check, Clock3, MapPin, Plus } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Reunion = {
  id: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  duracion_minutos: number | null;
  lugar: string | null;
  estado: string;
  lectura_obligatoria: boolean;
  acta_url: string | null;
};

const ESTADO_BADGE: Record<string, string> = {
  programada: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  realizada:  "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  cancelada:  "border-slate-500/30 bg-slate-500/20 text-slate-300",
};

const EMPTY = { titulo: "", descripcion: "", fecha: "", duracion_minutos: "", lugar: "", estado: "programada", lectura_obligatoria: true };

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Reuniones() {
  const [items, setItems] = useState<Reunion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from("sm_safety_meetings")
      .select("id, titulo, descripcion, fecha, duracion_minutos, lugar, estado, lectura_obligatoria, acta_url")
      .order("fecha", { ascending: false });
    setItems(data ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((r) => !filtroEstado || r.estado === filtroEstado);

  function abrir(r?: Reunion) {
    if (r) {
      setForm({ titulo: r.titulo, descripcion: r.descripcion ?? "", fecha: r.fecha.substring(0, 16),
        duracion_minutos: r.duracion_minutos ?? "", lugar: r.lugar ?? "",
        estado: r.estado, lectura_obligatoria: r.lectura_obligatoria });
      setEditId(r.id);
    } else {
      setForm({ ...EMPTY });
      setEditId(null);
    }
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.titulo?.trim() || !form.fecha) { setError("Título y fecha son obligatorios."); return; }
    setGuardando(true);
    const payload = {
      titulo: form.titulo.trim(), descripcion: form.descripcion || null,
      fecha: new Date(form.fecha).toISOString(),
      duracion_minutos: form.duracion_minutos ? parseInt(form.duracion_minutos) : null,
      lugar: form.lugar || null, estado: form.estado,
      lectura_obligatoria: form.lectura_obligatoria,
    };
    const { error: err } = editId
      ? await supabase.from("sm_safety_meetings").update(payload).eq("id", editId)
      : await supabase.from("sm_safety_meetings").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Reunión actualizada." : "Reunión creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from("sm_safety_meetings").update({ estado }).eq("id", id);
    cargar();
  }

  return (
    <SafetyLayout
      title="Reuniones de seguridad"
      subtitle={`${filtrados.length} reuniones`}
      actions={
        <button onClick={() => abrir()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva reunión</span>
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Filtro estado */}
      <div className="flex gap-2">
        {["", "programada", "realizada", "cancelada"].map((e) => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filtroEstado === e
                ? "border-amber-500 bg-amber-500 text-amber-950"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}>
            {e === "" ? "Todas" : e}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="space-y-3">
          {filtrados.map((r) => {
            const dias = Math.ceil((new Date(r.fecha).getTime() - Date.now()) / 86400000);

            return (
              <div key={r.id} className="rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-100">{r.titulo}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                        {r.estado}
                      </span>
                      {r.lectura_obligatoria && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs text-red-300">Obligatoria</span>
                      )}
                    </div>
                    {r.descripcion && <p className="mt-1 text-sm text-slate-400">{r.descripcion}</p>}
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {new Date(r.fecha).toLocaleString("es-ES")}</span>
                      {r.lugar && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {r.lugar}</span>}
                      {r.duracion_minutos && <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {r.duracion_minutos} min</span>}
                      {r.estado === "programada" && (
                        <span className={`font-semibold ${dias < 0 ? "text-red-400" : dias <= 3 ? "text-orange-400" : "text-sky-400"}`}>
                          {dias < 0 ? `Hace ${Math.abs(dias)} días` : dias === 0 ? "Hoy" : `En ${dias} días`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {r.estado === "programada" && (
                      <button onClick={() => cambiarEstado(r.id, "realizada")}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25">
                        <Check className="h-3.5 w-3.5" /> Realizada
                      </button>
                    )}
                    <button onClick={() => abrir(r)}
                      className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600">Editar</button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtrados.length === 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin reuniones.</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">{editId ? "Editar reunión" : "Nueva reunión de seguridad"}</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Fecha y hora *</label>
                  <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Duración (min)</label>
                  <input type="number" value={form.duracion_minutos} onChange={(e) => setForm({ ...form, duracion_minutos: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div><label className={LABEL}>Lugar</label>
                <input value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })}
                  className={`mt-1 ${INPUT}`} placeholder="Sala de reuniones" /></div>
              <div><label className={LABEL}>Descripción / Orden del día</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={`mt-1 resize-none ${INPUT}`} rows={3} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Estado</label>
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    <option value="programada">Programada</option>
                    <option value="realizada">Realizada</option>
                    <option value="cancelada">Cancelada</option>
                  </select></div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={form.lectura_obligatoria} onChange={(e) => setForm({ ...form, lectura_obligatoria: e.target.checked })} className="accent-amber-500" />
                    Firma obligatoria
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SafetyLayout>
  );
}
