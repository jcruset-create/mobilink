/**
 * Mobilink Assist — Lugares conocidos (bases de clientes, talleres, parkings…)
 * como pantalla completa: lista con búsqueda, ver ficha, editar y crear con
 * el pin en el mapa.
 */

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, RefreshCw, Search, X, Navigation, Pencil, Eye, Trash2 } from "lucide-react";
import AssistSidebar from "../components/AssistSidebar";
import KnownPlaceMapModal from "../components/KnownPlaceMapModal";
import type { KnownPlace } from "../modules/roadsideAssistanceTypes";
import { fetchKnownPlaces, deleteKnownPlace } from "../modules/roadsideAssistanceApi";

const TIPO_LABELS: Record<string, string> = {
  base_cliente: "Base de cliente",
  taller: "Taller",
  otro: "Otro",
};

export default function LugaresPage() {
  const [places, setPlaces] = useState<KnownPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<KnownPlace | null>(null);
  const [editing, setEditing] = useState<"new" | KnownPlace | null>(null);

  async function load() {
    setLoading(true);
    try {
      setPlaces(await fetchKnownPlaces());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return places;
    return places.filter((p) =>
      [p.nombre, p.direccion, p.clientName, p.tipo]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(t))
    );
  }, [places, q]);

  function onSaved(saved: KnownPlace) {
    setPlaces((prev) => {
      const existe = prev.some((x) => x.id === saved.id);
      return existe ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
    });
  }

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      <AssistSidebar active="lugares" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 pl-14 backdrop-blur md:pl-4">
          <div className="flex items-center gap-3">
            <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-9 md:h-12" />
            <div>
              <h1 className="text-sm font-bold md:text-base">Lugares conocidos</h1>
              <div className="text-xs text-slate-400">{places.length} lugares</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEditing("new")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
            >
              <MapPin className="h-4 w-4" /> Nueva base
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" /> Actualizar
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl space-y-4 p-4">
          {/* Buscador */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, cliente, dirección o tipo…"
              className="w-full rounded-lg border border-slate-600 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/40"
            />
          </div>

          {/* Lista */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/60">
            <div className="divide-y divide-slate-700/60">
              {loading ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">Cargando…</div>
              ) : visibles.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  {q ? "Sin resultados para la búsqueda." : "Aún no hay lugares. Crea la primera base."}
                </div>
              ) : (
                visibles.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-100">{p.nombre}</div>
                      <div className="truncate text-xs text-slate-400">
                        {TIPO_LABELS[p.tipo] ?? p.tipo}
                        {p.clientName ? ` · ${p.clientName}` : ""}
                        {p.direccion ? ` · ${p.direccion}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => setViewing(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
                      >
                        <Eye className="h-3.5 w-3.5" /> Ver ficha
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-300 hover:bg-sky-500/25"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar ficha
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`¿Eliminar "${p.nombre}"?`)) return;
                          await deleteKnownPlace(p.id);
                          setPlaces((prev) => prev.filter((x) => x.id !== p.id));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Eliminar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Ficha (solo lectura) */}
      {viewing && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-10">
          <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-red-400" />
                <h2 className="text-base font-bold">{viewing.nombre}</h2>
              </div>
              <button onClick={() => setViewing(null)} className="rounded-full p-1 hover:bg-slate-700">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {viewing.lat != null && viewing.lng != null && (
                <div className="h-56">
                  <MapContainer
                    center={[viewing.lat, viewing.lng]}
                    zoom={15}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom={false}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[viewing.lat, viewing.lng]} />
                  </MapContainer>
                </div>
              )}
              <div className="space-y-2 p-5 text-sm">
                <Row label="Tipo" value={TIPO_LABELS[viewing.tipo] ?? viewing.tipo} />
                <Row label="Cliente" value={viewing.clientName || "—"} />
                <Row label="Dirección" value={viewing.direccion || "—"} />
                <Row
                  label="Coordenadas"
                  value={viewing.lat != null && viewing.lng != null ? `${viewing.lat}, ${viewing.lng}` : "—"}
                />
                {viewing.notas && <Row label="Notas" value={viewing.notas} />}
              </div>
              <div className="flex flex-wrap gap-2 px-5 pb-5">
                {viewing.lat != null && viewing.lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${viewing.lat},${viewing.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-600"
                  >
                    <Navigation className="h-4 w-4" /> Abrir en Google Maps
                  </a>
                )}
                <button
                  onClick={() => { setEditing(viewing); setViewing(null); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-sm font-black text-white hover:bg-orange-500"
                >
                  <Pencil className="h-4 w-4" /> Editar ficha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alta / edición con pin en el mapa */}
      {editing && (
        <KnownPlaceMapModal
          place={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-xs font-bold uppercase text-slate-500">{label}</span>
      <span className="font-semibold text-slate-200">{value}</span>
    </div>
  );
}
