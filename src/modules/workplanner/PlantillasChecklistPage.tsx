import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw, GripVertical, Save, X } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../workshopApi";

/**
 * Plantillas de checklist.
 *
 * Aquí se define QUÉ hay que comprobar en cada tipo de trabajo; el técnico las
 * marca luego desde la tablet (WorkPlanner Taller). Al aplicar una plantilla a
 * un trabajo, sus ítems se COPIAN: editar la plantilla después no altera lo que
 * ya se comprobó, que es lo que se espera de un registro.
 */

type Item = { texto: string; obligatorio: boolean };

type Plantilla = {
  id: number;
  nombre: string;
  area: string | null;
  items: Item[];
  activo: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

const AREAS = ["", "camion", "movil", "tacografo", "turismo", "mecanica"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);
  return body as T;
}

export default function PlantillasChecklistPage() {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Plantilla | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setPlantillas(await api<Plantilla[]>("/api/checklist-plantillas"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las plantillas");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function nueva() {
    setEditando({
      id: 0,
      nombre: "",
      area: null,
      items: [{ texto: "", obligatorio: false }],
      activo: true,
      createdAtMs: 0,
      updatedAtMs: 0,
    });
  }

  async function guardar(p: Plantilla) {
    const cuerpo = JSON.stringify({
      nombre: p.nombre,
      area: p.area,
      items: p.items.filter((i) => i.texto.trim() !== ""),
      activo: p.activo,
    });

    try {
      if (p.id === 0) {
        await api("/api/checklist-plantillas", { method: "POST", body: cuerpo });
      } else {
        await api(`/api/checklist-plantillas/${p.id}`, { method: "PUT", body: cuerpo });
      }
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando la plantilla");
    }
  }

  async function desactivar(p: Plantilla) {
    // Baja lógica: los trabajos ya hechos conservan su copia del checklist.
    if (!window.confirm(`¿Retirar la plantilla "${p.nombre}"?\n\nLos trabajos que ya la usan no cambian.`)) {
      return;
    }
    try {
      await api(`/api/checklist-plantillas/${p.id}`, { method: "DELETE" });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error retirando la plantilla");
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 text-slate-100">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-black">Plantillas de checklist</h1>
          <p className="text-sm text-slate-400">
            Lo que el técnico tiene que comprobar en cada tipo de trabajo, marcable
            desde la tablet.
          </p>
        </div>
        <button
          onClick={() => void cargar()}
          className="ml-auto flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
        >
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
        <button
          onClick={nueva}
          className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium hover:bg-sky-500"
        >
          <Plus className="h-4 w-4" /> Nueva plantilla
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {editando && (
        <EditorPlantilla
          plantilla={editando}
          onCambio={setEditando}
          onGuardar={() => void guardar(editando)}
          onCancelar={() => setEditando(null)}
        />
      )}

      {cargando ? (
        <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>
      ) : plantillas.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-sm text-slate-400">
          Todavía no hay plantillas. Crea la primera con el botón de arriba.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plantillas.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-slate-700 bg-slate-800 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold">{p.nombre}</span>
                {p.area && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400">
                    {p.area}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-500">
                  {p.items.length} punto{p.items.length === 1 ? "" : "s"}
                </span>
              </div>

              <ul className="mb-3 space-y-1">
                {p.items.slice(0, 5).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" />
                    <span>
                      {item.texto}
                      {item.obligatorio && (
                        <span className="ml-1 text-[11px] font-bold text-amber-400">
                          obligatorio
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {p.items.length > 5 && (
                  <li className="text-[12px] text-slate-500">
                    +{p.items.length - 5} más
                  </li>
                )}
              </ul>

              <div className="flex gap-2">
                <button
                  onClick={() => setEditando(p)}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
                >
                  Editar
                </button>
                <button
                  onClick={() => void desactivar(p)}
                  className="flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Retirar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorPlantilla({
  plantilla,
  onCambio,
  onGuardar,
  onCancelar,
}: {
  plantilla: Plantilla;
  onCambio: (p: Plantilla) => void;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  function cambiarItem(indice: number, cambios: Partial<Item>) {
    onCambio({
      ...plantilla,
      items: plantilla.items.map((item, i) =>
        i === indice ? { ...item, ...cambios } : item
      ),
    });
  }

  function moverItem(indice: number, salto: number) {
    const destino = indice + salto;
    if (destino < 0 || destino >= plantilla.items.length) return;
    const items = [...plantilla.items];
    [items[indice], items[destino]] = [items[destino], items[indice]];
    onCambio({ ...plantilla, items });
  }

  const puedeGuardar =
    plantilla.nombre.trim() !== "" &&
    plantilla.items.some((i) => i.texto.trim() !== "");

  return (
    <div className="mb-4 rounded-2xl border border-sky-500/40 bg-slate-800 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-bold">
          {plantilla.id === 0 ? "Nueva plantilla" : `Editar: ${plantilla.nombre}`}
        </span>
        <button onClick={onCancelar} className="ml-auto text-slate-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <input
          value={plantilla.nombre}
          onChange={(e) => onCambio({ ...plantilla, nombre: e.target.value })}
          placeholder="Nombre (p. ej. Revisión de tacógrafo)"
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        <select
          value={plantilla.area ?? ""}
          onChange={(e) => onCambio({ ...plantilla, area: e.target.value || null })}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        >
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {a === "" ? "Cualquier área" : a}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {plantilla.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                onClick={() => moverItem(i, -1)}
                className="text-slate-500 hover:text-slate-300"
                title="Subir"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>
            <input
              value={item.texto}
              onChange={(e) => cambiarItem(i, { texto: e.target.value })}
              placeholder={`Punto ${i + 1}`}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
            <label className="flex shrink-0 items-center gap-1 text-[12px] text-slate-400">
              <input
                type="checkbox"
                checked={item.obligatorio}
                onChange={(e) => cambiarItem(i, { obligatorio: e.target.checked })}
              />
              Obligatorio
            </label>
            <button
              onClick={() =>
                onCambio({
                  ...plantilla,
                  items: plantilla.items.filter((_, j) => j !== i),
                })
              }
              className="text-slate-500 hover:text-red-400"
              title="Quitar"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          onCambio({
            ...plantilla,
            items: [...plantilla.items, { texto: "", obligatorio: false }],
          })
        }
        className="mt-2 flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
      >
        <Plus className="h-3.5 w-3.5" /> Añadir punto
      </button>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onGuardar}
          disabled={!puedeGuardar}
          className="flex items-center gap-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
        >
          <Save className="h-4 w-4" /> Guardar
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
