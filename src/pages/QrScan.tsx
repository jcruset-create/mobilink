import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../modules/almacen-neumaticos/services/supabase";

type Tipo = "herramienta" | "maquina";

type Item = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  estado: string;
  foto_url: string | null;
  observaciones: string | null;
  proxima_revision?: string | null;
  ultima_revision?: string | null;
  requiere_autorizacion?: string | null;
  ubicacion?: string | null;
  categoria?: string | null;
};

const ESTADO_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  disponible:          { bg: "bg-green-100",  text: "text-green-800",  label: "Disponible" },
  en_uso:              { bg: "bg-blue-100",   text: "text-blue-800",   label: "En uso" },
  mantenimiento:       { bg: "bg-orange-100", text: "text-orange-800", label: "En mantenimiento" },
  danada:              { bg: "bg-red-100",    text: "text-red-800",    label: "Dañada" },
  perdida:             { bg: "bg-gray-200",   text: "text-gray-700",   label: "Perdida" },
  fuera_servicio:      { bg: "bg-gray-200",   text: "text-gray-700",   label: "Fuera de servicio" },
  pendiente_revision:  { bg: "bg-yellow-100", text: "text-yellow-800", label: "Pendiente revisión" },
  compartida:          { bg: "bg-purple-100", text: "text-purple-800", label: "En uso compartido" },
};

export default function QrScan() {
  const { tipo, id } = useParams<{ tipo: string; id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  // Formulario incidencia
  const [mostrarForm, setMostrarForm] = useState(false);
  const [formInc, setFormInc] = useState({ descripcion: "", reportado_por: "", gravedad: "media" });
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState("");

  useEffect(() => {
    if (!id || !tipo) return;
    cargar(tipo as Tipo, id);
  }, [id, tipo]);

  async function cargar(t: Tipo, itemId: string) {
    setCargando(true);
    if (t === "herramienta") {
      const { data } = await supabase
        .from("tc_tools")
        .select(`
          id, codigo, nombre, descripcion, marca, modelo, numero_serie,
          estado, foto_url, observaciones, proxima_revision, ultima_revision,
          tc_categories(nombre), tc_locations!tc_tools_ubicacion_actual_id_fkey(nombre)
        `)
        .eq("id", itemId)
        .eq("activa", true)
        .single();

      if (!data) { setNoEncontrado(true); setCargando(false); return; }
      setItem({
        ...data,
        categoria:  (data as any).tc_categories?.nombre ?? null,
        ubicacion:  (data as any)["tc_locations"]?.nombre ?? null,
      });
    } else {
      const { data } = await supabase
        .from("tc_machines")
        .select(`
          id, codigo, nombre, descripcion, marca, modelo, numero_serie,
          estado, foto_url, observaciones,
          tc_categories(nombre), tc_locations!tc_machines_ubicacion_id_fkey(nombre),
          sea_authorizations(nombre)
        `)
        .eq("id", itemId)
        .eq("activa", true)
        .single();

      if (!data) { setNoEncontrado(true); setCargando(false); return; }
      setItem({
        ...data,
        categoria:            (data as any).tc_categories?.nombre ?? null,
        ubicacion:            (data as any)["tc_locations"]?.nombre ?? null,
        requiere_autorizacion:(data as any).sea_authorizations?.nombre ?? null,
      });
    }
    setCargando(false);
  }

  async function enviarIncidencia() {
    if (!formInc.descripcion.trim()) { setErrorEnvio("Describe la incidencia."); return; }
    setEnviando(true);
    setErrorEnvio("");
    const nombreReportador = formInc.reportado_por.trim() || "Anónimo (QR)";
    const payload = {
      tool_id:              tipo === "herramienta" ? id : null,
      machine_id:           tipo === "maquina"     ? id : null,
      titulo:               `QR · ${item!.nombre} · ${nombreReportador}`,
      descripcion:          formInc.descripcion.trim(),
      reportado_por_texto:  nombreReportador,
      gravedad:             formInc.gravedad,
      tipo:                 "averia",
      estado:               "abierta",
    };
    const { error } = await supabase.from("tc_incidents").insert(payload);
    setEnviando(false);
    if (error) { setErrorEnvio("No se pudo registrar. Inténtalo de nuevo."); return; }
    setEnviado(true);
    setMostrarForm(false);
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Cargando información...</p>
        </div>
      </div>
    );
  }

  if (noEncontrado || !item) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-3 max-w-xs">
          <div className="text-5xl">❓</div>
          <h1 className="text-xl font-bold text-gray-800">No encontrado</h1>
          <p className="text-sm text-gray-500">Este código QR no corresponde a ningún elemento activo del sistema.</p>
        </div>
      </div>
    );
  }

  const estado = ESTADO_COLOR[item.estado] ?? { bg: "bg-gray-100", text: "text-gray-700", label: item.estado };
  const esHerramienta = tipo === "herramienta";

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-blue-600 text-white px-5 py-4 flex items-center gap-3">
        <span className="text-2xl">{esHerramienta ? "🔧" : "⚙️"}</span>
        <div>
          <div className="text-xs font-medium opacity-80 uppercase tracking-wide">
            {esHerramienta ? "Herramienta" : "Máquina"} · {item.codigo}
          </div>
          <div className="font-bold text-lg leading-tight">{item.nombre}</div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Estado */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${estado.bg}`}>
          <div className={`text-2xl font-black ${estado.text}`}>
            {item.estado === "disponible" ? "✓" : item.estado === "en_uso" ? "●" : "!"}
          </div>
          <div>
            <div className={`font-bold text-lg ${estado.text}`}>{estado.label}</div>
            {item.ubicacion && (
              <div className={`text-sm ${estado.text} opacity-75`}>📍 {item.ubicacion}</div>
            )}
          </div>
        </div>

        {/* Foto */}
        {item.foto_url && (
          <div className="rounded-2xl overflow-hidden border bg-white">
            <img src={item.foto_url} alt={item.nombre} className="w-full object-cover max-h-48" />
          </div>
        )}

        {/* Detalles */}
        <div className="rounded-2xl border bg-white divide-y overflow-hidden">
          {[
            { label: "Categoría",      value: item.categoria },
            { label: "Marca / Modelo", value: [item.marca, item.modelo].filter(Boolean).join(" · ") || null },
            { label: "Nº serie",       value: item.numero_serie },
            { label: "Última revisión",value: item.ultima_revision ? new Date(item.ultima_revision).toLocaleDateString("es-ES") : null },
            { label: "Próxima revisión",value: item.proxima_revision ? new Date(item.proxima_revision).toLocaleDateString("es-ES") : null },
            { label: "Requiere autorización", value: item.requiere_autorizacion },
          ].filter((f) => f.value).map(({ label, value }) => (
            <div key={label} className="flex justify-between px-4 py-3 text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-right max-w-[60%]">{value}</span>
            </div>
          ))}
        </div>

        {/* Descripción / observaciones */}
        {(item.descripcion || item.observaciones) && (
          <div className="rounded-2xl border bg-white px-4 py-3 space-y-1">
            {item.descripcion && <p className="text-sm text-gray-700">{item.descripcion}</p>}
            {item.observaciones && <p className="text-sm text-gray-400 italic">{item.observaciones}</p>}
          </div>
        )}

        {/* Aviso revisión vencida */}
        {item.proxima_revision && new Date(item.proxima_revision) < new Date() && (
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 flex gap-2 items-start">
            <span className="text-red-500 text-lg shrink-0">⚠️</span>
            <p className="text-sm text-red-700 font-medium">
              La revisión estaba prevista para el {new Date(item.proxima_revision).toLocaleDateString("es-ES")} y está vencida.
            </p>
          </div>
        )}

        {/* Autorización requerida */}
        {item.requiere_autorizacion && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 px-4 py-3 flex gap-2 items-start">
            <span className="text-orange-500 text-lg shrink-0">🔒</span>
            <p className="text-sm text-orange-700 font-medium">
              Para operar esta máquina se requiere: <strong>{item.requiere_autorizacion}</strong>
            </p>
          </div>
        )}

        {/* Confirmación envío */}
        {enviado && (
          <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-4 flex gap-3 items-center">
            <span className="text-green-600 text-2xl">✓</span>
            <div>
              <p className="font-semibold text-green-800">Incidencia registrada</p>
              <p className="text-sm text-green-600">El equipo de mantenimiento ha sido notificado.</p>
            </div>
          </div>
        )}

        {/* Botón reportar incidencia */}
        {!enviado && !mostrarForm && (
          <button
            onClick={() => setMostrarForm(true)}
            className="w-full rounded-2xl bg-red-600 py-4 text-white font-bold text-base hover:bg-red-700 active:scale-95 transition-transform">
            ⚠️ Reportar incidencia
          </button>
        )}

        {/* Formulario incidencia */}
        {mostrarForm && !enviado && (
          <div className="rounded-2xl border bg-white p-5 space-y-4">
            <h2 className="font-bold text-lg">Reportar incidencia</h2>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tu nombre (opcional)</label>
              <input
                value={formInc.reportado_por}
                onChange={(e) => setFormInc({ ...formInc, reportado_por: e.target.value })}
                placeholder="Ej: Juan García"
                className="mt-1 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gravedad</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { value: "baja",  label: "Baja",  color: "border-green-300 bg-green-50 text-green-800" },
                  { value: "media", label: "Media", color: "border-orange-300 bg-orange-50 text-orange-800" },
                  { value: "alta",  label: "Alta",  color: "border-red-300 bg-red-50 text-red-800" },
                ].map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setFormInc({ ...formInc, gravedad: g.value })}
                    className={`rounded-xl border-2 py-2 text-sm font-semibold transition-all ${
                      formInc.gravedad === g.value ? g.color + " scale-105" : "border-gray-200 bg-white text-gray-600"
                    }`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descripción *</label>
              <textarea
                value={formInc.descripcion}
                onChange={(e) => setFormInc({ ...formInc, descripcion: e.target.value })}
                placeholder="Describe qué ha pasado o qué has observado..."
                rows={4}
                className="mt-1 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
            </div>

            {errorEnvio && <p className="text-sm text-red-600">{errorEnvio}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setMostrarForm(false)}
                className="flex-1 rounded-xl border py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={enviarIncidencia}
                disabled={enviando}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
                {enviando ? "Enviando..." : "Enviar incidencia"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pt-2">Mobilink Platform · ToolControl</p>
      </div>
    </div>
  );
}
