import { useEffect, useMemo, useState } from "react";
import {
  listarValoresItv, listarHistorialItv, guardarValoresItv, borrarValorItv,
  type ValorItv, type CambioItv,
} from "../services/data";
import { Modal, inputCls } from "./ui";

/** Nombre legible de cada bloque de la ficha, en el orden de la tarjeta. */
const SECCIONES: Record<string, string> = {
  documento: "Documento",
  identificacion: "Identificación",
  titular: "Titular",
  masas: "Masas",
  dimensiones: "Dimensiones",
  homologacion: "Categoría, carrocería y homologación",
  ejes: "Ejes y ruedas",
  remolque: "Masas remolcables",
  motor: "Motor y combustible",
  plazas: "Plazas y velocidad",
  emisiones: "Ruido y emisiones",
};

const numeroEs = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 3 });

/** Cómo se lee un valor en pantalla, según lo que traiga normalizado. */
export function textoValor(v: ValorItv): string {
  const unidad = v.unidad ? ` ${v.unidad}` : "";
  const json = v.valor_json as Record<string, unknown> | unknown[] | null;

  if (json && !Array.isArray(json) && typeof json === "object") {
    const partes = Object.entries(json)
      .filter(([k]) => k !== "unidad")
      .map(([k, val]) => {
        const etiqueta = k.startsWith("eje_") ? `Eje ${k.slice(4)}` : k;
        return `${etiqueta}: ${typeof val === "number" ? numeroEs(val) : String(val)}`;
      });
    if (partes.length) return `${partes.join(" · ")}${unidad}`;
  }
  if (Array.isArray(json) && json.length) {
    return `${json.map((x) => (typeof x === "number" ? numeroEs(x) : String(x))).join(" · ")}${unidad}`;
  }
  if (v.valor_fecha) return new Date(`${v.valor_fecha}T00:00:00`).toLocaleDateString("es-ES");
  if (v.valor_booleano != null) return v.valor_booleano ? "Sí" : "No";
  if (v.valor_numero != null) return `${numeroEs(v.valor_numero)}${unidad}`;
  return `${v.valor_bruto ?? "—"}${unidad}`;
}

export default function FichaTecnicaItv({ vehiculoId, puedeEditar, onCambio }: {
  vehiculoId: string; puedeEditar: boolean; onCambio?: () => void;
}) {
  const [valores, setValores] = useState<ValorItv[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<null | { valor: ValorItv; texto: string }>(null);
  const [borrando, setBorrando] = useState<ValorItv | null>(null);
  const [historial, setHistorial] = useState<CambioItv[] | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true); setError("");
    try { setValores(await listarValoresItv(vehiculoId)); }
    catch (e: any) { setError(e?.message ?? "No se pudieron cargar los datos de la ficha"); }
    finally { setCargando(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [vehiculoId]);

  // Solo se pintan las secciones que tienen algún dato: un bloque entero
  // sin valores no aparece.
  const secciones = useMemo(() => {
    const mapa = new Map<string, ValorItv[]>();
    for (const v of valores) {
      const cat = v.campo?.categoria ?? "otros";
      if (!mapa.has(cat)) mapa.set(cat, []);
      mapa.get(cat)!.push(v);
    }
    return [...mapa.entries()];
  }, [valores]);

  async function guardarEdicion() {
    if (!editando?.valor.campo_ficha_id) return;
    setGuardando(true); setError("");
    try {
      await guardarValoresItv(vehiculoId, [{
        campoFichaId: editando.valor.campo_ficha_id,
        valorBruto: editando.texto,
        origen: "manual",
      }]);
      setEditando(null);
      await cargar();
      onCambio?.();
    } catch (e: any) { setError(e?.message ?? "No se pudo guardar"); }
    finally { setGuardando(false); }
  }

  async function confirmarBorrado() {
    if (!borrando) return;
    setGuardando(true); setError("");
    try {
      await borrarValorItv(borrando);
      setBorrando(null);
      await cargar();
      onCambio?.();
    } catch (e: any) { setError(e?.message ?? "No se pudo eliminar"); }
    finally { setGuardando(false); }
  }

  async function abrirHistorial() {
    setHistorial([]);
    try { setHistorial(await listarHistorialItv(vehiculoId)); }
    catch (e: any) { setError(e?.message ?? "No se pudo cargar el historial"); setHistorial(null); }
  }

  return (
    <div className="mt-3 rounded-lg bg-slate-800 p-3">
      <button onClick={() => setAbierto(!abierto)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] text-slate-400">{abierto ? "▾" : "▸"}</span>
        <span className="flex-1 text-[11px] font-bold uppercase text-slate-400">Ficha técnica ITV</span>
        <span className="text-[11px] text-slate-500">
          {cargando ? "cargando…" : `${valores.length} campo${valores.length === 1 ? "" : "s"} con dato`}
        </span>
      </button>

      {error && <div className="mt-2 text-[12px] text-rose-300">{error}</div>}

      {abierto && (
        <div className="mt-3">
          {valores.length > 0 && (
            <div className="mb-2 flex justify-end">
              <button onClick={() => void abrirHistorial()} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                🕐 Ver historial
              </button>
            </div>
          )}

          {cargando ? (
            <div className="text-[12px] text-slate-500">Cargando ficha técnica…</div>
          ) : valores.length === 0 ? (
            <div className="text-[12px] text-slate-500">
              Este vehículo aún no tiene datos de ficha técnica. Adjunta la ficha ahí arriba y confirma la revisión.
            </div>
          ) : (
            <div className="space-y-3">
              {secciones.map(([cat, filas]) => (
                <div key={cat}>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {SECCIONES[cat] ?? cat}
                  </div>
                  <div className="divide-y divide-slate-700/50 rounded bg-slate-900">
                    {filas.map((v) => (
                      <div key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 py-1.5">
                        <span className="w-14 shrink-0 font-mono text-[11px] font-bold text-sky-300">
                          {v.campo?.codigo ?? v.codigo_origen ?? "—"}
                        </span>
                        <span className="flex-1 text-[12px] text-slate-400">
                          {v.campo?.descripcion ?? v.etiqueta_origen ?? v.clave_normalizada}
                        </span>
                        <span className="text-[13px] font-semibold text-slate-100">
                          {textoValor(v)}
                          {/* P.2: la ficha la da en kW pero aquí se trabaja en CV. */}
                          {v.clave_normalizada === "potencia" && v.valor_numero != null && (
                            <span className="font-normal text-slate-400"> · {Math.round(v.valor_numero * 1.35962)} CV</span>
                          )}
                        </span>
                        {!v.verificado_manualmente && v.confianza != null && v.confianza < 0.9 && (
                          <span className="rounded bg-amber-900/40 px-1 text-[10px] font-bold text-amber-300"
                            title="Detectado por OCR con confianza baja, sin revisar">
                            {Math.round(v.confianza * 100)}%
                          </span>
                        )}
                        {puedeEditar && (
                          <span className="flex gap-2">
                            <button onClick={() => setEditando({ valor: v, texto: v.valor_bruto ?? "" })}
                              className="text-[11px] text-sky-300 hover:underline">Editar</button>
                            <button onClick={() => setBorrando(v)}
                              className="text-[11px] text-rose-300 hover:underline">Eliminar</button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editando && (
        <Modal title={`Editar ${editando.valor.campo?.codigo ?? ""} · ${editando.valor.campo?.descripcion ?? ""}`}
          onClose={() => setEditando(null)}
          footer={<>
            <button onClick={() => setEditando(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={() => void guardarEdicion()} disabled={guardando}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </>}>
          <div className="grid gap-2">
            <div className="text-[11px] text-slate-500">
              Se guarda tal cual está en el documento; el valor para búsquedas se calcula solo.
              {editando.valor.campo?.unidad ? ` Unidad: ${editando.valor.campo.unidad}.` : ""}
            </div>
            <input className={inputCls} value={editando.texto} autoFocus
              onChange={(e) => setEditando({ ...editando, texto: e.target.value })} />
            <div className="text-[11px] text-slate-500">
              Si lo dejas vacío no se guardará: para quitar el dato usa «Eliminar».
            </div>
          </div>
        </Modal>
      )}

      {borrando && (
        <Modal title="Eliminar dato de la ficha" onClose={() => setBorrando(null)}
          footer={<>
            <button onClick={() => setBorrando(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={() => void confirmarBorrado()} disabled={guardando}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {guardando ? "Eliminando…" : "Eliminar"}
            </button>
          </>}>
          <div className="text-[13px] text-slate-200">
            Se va a eliminar <b>{borrando.campo?.codigo} · {borrando.campo?.descripcion}</b> con valor{" "}
            <b>{textoValor(borrando)}</b>.
          </div>
          <div className="mt-2 text-[12px] text-slate-400">
            El dato deja de verse en la ficha del vehículo, pero el cambio queda registrado en el historial.
          </div>
        </Modal>
      )}

      {historial && (
        <Modal title="Historial de la ficha técnica" size="xl" onClose={() => setHistorial(null)}
          footer={<button onClick={() => setHistorial(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button>}>
          {historial.length === 0 ? (
            <div className="text-[12px] text-slate-500">Sin cambios registrados.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-800 text-left text-slate-400">
                  <tr>
                    <th className="py-1">Fecha</th><th className="py-1">Campo</th>
                    <th className="py-1">Antes</th><th className="py-1">Después</th><th className="py-1">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h) => {
                    const antes = (h.valor_anterior as any)?.valor ?? null;
                    const despues = (h.valor_nuevo as any)?.valor ?? null;
                    return (
                      <tr key={h.id} className="border-t border-slate-700/60 align-top">
                        <td className="py-1 pr-2 text-slate-400">{new Date(h.created_at).toLocaleString("es-ES")}</td>
                        <td className="py-1 pr-2 text-slate-200">{h.campo?.codigo} · {h.campo?.descripcion}</td>
                        <td className="py-1 pr-2 text-slate-400">{antes ?? "—"}</td>
                        <td className="py-1 pr-2 font-semibold text-slate-100">{despues ?? <span className="text-rose-300">eliminado</span>}</td>
                        <td className="py-1 text-slate-500">{h.motivo_cambio}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
