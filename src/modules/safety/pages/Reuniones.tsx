import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
  programada: "bg-blue-100 text-blue-800",
  realizada:  "bg-green-100 text-green-800",
  cancelada:  "bg-gray-200 text-gray-600",
};

const EMPTY = { titulo: "", descripcion: "", fecha: "", duracion_minutos: "", lugar: "", estado: "programada", lectura_obligatoria: true };

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
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reuniones de seguridad</h1>
          <p className="text-sm text-gray-500">{filtrados.length} reuniones</p>
        </div>
        <button onClick={() => abrir()}
          className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nueva reunión
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtro estado */}
      <div className="flex gap-2">
        {["", "programada", "realizada", "cancelada"].map((e) => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              filtroEstado === e ? "bg-yellow-500 text-white border-yellow-500" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}>
            {e === "" ? "Todas" : e}
          </button>
        ))}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="space-y-3">
          {filtrados.map((r) => {
            const dias = Math.ceil((new Date(r.fecha).getTime() - Date.now()) / 86400000);

            return (
              <div key={r.id} className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{r.titulo}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "bg-gray-100"}`}>
                        {r.estado}
                      </span>
                      {r.lectura_obligatoria && (
                        <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs">Obligatoria</span>
                      )}
                    </div>
                    {r.descripcion && <p className="text-sm text-gray-500 mt-1">{r.descripcion}</p>}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                      <span>📅 {new Date(r.fecha).toLocaleString("es-ES")}</span>
                      {r.lugar && <span>📍 {r.lugar}</span>}
                      {r.duracion_minutos && <span>⏱ {r.duracion_minutos} min</span>}
                      {r.estado === "programada" && (
                        <span className={`font-semibold ${dias < 0 ? "text-red-600" : dias <= 3 ? "text-orange-600" : "text-blue-600"}`}>
                          {dias < 0 ? `Hace ${Math.abs(dias)} días` : dias === 0 ? "Hoy" : `En ${dias} días`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {r.estado === "programada" && (
                      <button onClick={() => cambiarEstado(r.id, "realizada")}
                        className="rounded-lg bg-green-50 px-3 py-1 text-xs text-green-700 font-medium hover:bg-green-100">
                        ✓ Realizada
                      </button>
                    )}
                    <button onClick={() => abrir(r)} className="rounded-lg bg-gray-100 px-3 py-1 text-xs hover:bg-gray-200">Editar</button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtrados.length === 0 && (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-400">Sin reuniones.</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar reunión" : "Nueva reunión de seguridad"}</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Fecha y hora *</label>
                  <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Duración (min)</label>
                  <input type="number" value={form.duracion_minutos} onChange={(e) => setForm({ ...form, duracion_minutos: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Lugar</label>
                <input value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Sala de reuniones" /></div>
              <div><label className="text-xs font-medium text-gray-600">Descripción / Orden del día</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Estado</label>
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="programada">Programada</option>
                    <option value="realizada">Realizada</option>
                    <option value="cancelada">Cancelada</option>
                  </select></div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.lectura_obligatoria} onChange={(e) => setForm({ ...form, lectura_obligatoria: e.target.checked })} />
                    Firma obligatoria
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
