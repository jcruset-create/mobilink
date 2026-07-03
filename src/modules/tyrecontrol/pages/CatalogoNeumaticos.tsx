import { useEffect, useMemo, useState } from "react";
import { listarReferenciasNeumatico, subirFotoModelo, eliminarFotoModelo, actualizarReferenciaNeumatico, eliminarReferenciaNeumatico } from "../services/data";
import type { ReferenciaNeumatico, EjeRecomendado } from "../types";
import { Modal, inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

type CamposTecnicos = "profundidad_dibujo_mm" | "llanta_recomendada" | "diametro_exterior_mm" | "revoluciones_km" | "carga_maxima_kg" | "presion_maxima_bar" | "peso_kg";

const EJE_LABELS: Record<EjeRecomendado, string> = {
  direccion: "Dirección", traccion: "Tracción", remolque: "Remolque", mixto: "Mixto",
};

export default function CatalogoNeumaticos() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!perfil?.es_superadmin;
  const [items, setItems] = useState<ReferenciaNeumatico[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fEje, setFEje] = useState("");
  const [fMs, setFMs] = useState("");
  const [fPmsf, setFPmsf] = useState("");
  const [ficha, setFicha] = useState<ReferenciaNeumatico | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [msgFoto, setMsgFoto] = useState("");
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CamposTecnicos, string>>({
    profundidad_dibujo_mm: "", llanta_recomendada: "", diametro_exterior_mm: "", revoluciones_km: "", carga_maxima_kg: "", presion_maxima_bar: "", peso_kg: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [msgEdit, setMsgEdit] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  function abrirEdicion(r: ReferenciaNeumatico) {
    setForm({
      profundidad_dibujo_mm: r.profundidad_dibujo_mm != null ? String(r.profundidad_dibujo_mm) : "",
      llanta_recomendada: r.llanta_recomendada ?? "",
      diametro_exterior_mm: r.diametro_exterior_mm != null ? String(r.diametro_exterior_mm) : "",
      revoluciones_km: r.revoluciones_km != null ? String(r.revoluciones_km) : "",
      carga_maxima_kg: r.carga_maxima_kg != null ? String(r.carga_maxima_kg) : "",
      presion_maxima_bar: r.presion_maxima_bar != null ? String(r.presion_maxima_bar) : "",
      peso_kg: r.peso_kg != null ? String(r.peso_kg) : "",
    });
    setMsgEdit("");
    setEditando(true);
  }

  async function guardarEdicion() {
    if (!ficha) return;
    setGuardando(true); setMsgEdit("");
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const cambios = {
        profundidad_dibujo_mm: num(form.profundidad_dibujo_mm),
        llanta_recomendada: form.llanta_recomendada.trim() === "" ? null : form.llanta_recomendada.trim(),
        diametro_exterior_mm: num(form.diametro_exterior_mm),
        revoluciones_km: num(form.revoluciones_km),
        carga_maxima_kg: num(form.carga_maxima_kg),
        presion_maxima_bar: num(form.presion_maxima_bar),
        peso_kg: num(form.peso_kg),
      };
      await actualizarReferenciaNeumatico(ficha.id, cambios);
      setFicha({ ...ficha, ...cambios });
      setEditando(false);
      await cargar();
    } catch (e: any) { setMsgEdit(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  async function darDeBaja() {
    if (!ficha) return;
    setBorrando(true);
    try {
      await eliminarReferenciaNeumatico(ficha.id);
      setConfirmarBaja(false);
      setFicha(null);
      await cargar();
    } catch (e: any) { setMsgEdit(e?.message || "Error al eliminar"); } finally { setBorrando(false); }
  }

  async function cargar() {
    setLoading(true);
    try { setItems(await listarReferenciasNeumatico()); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  async function subirFoto(file: File | undefined) {
    if (!file || !ficha?.modelo) return;
    setSubiendo(true); setMsgFoto("");
    try {
      const url = await subirFotoModelo(ficha.modelo.id, file);
      setFicha({ ...ficha, modelo: { ...ficha.modelo, foto_modelo_url: url } });
      await cargar();
    } catch (e: any) { setMsgFoto(e?.message || "Error al subir la imagen"); } finally { setSubiendo(false); }
  }

  async function quitarFoto() {
    if (!ficha?.modelo) return;
    setMsgFoto("");
    try {
      await eliminarFotoModelo(ficha.modelo.id);
      setFicha({ ...ficha, modelo: { ...ficha.modelo, foto_modelo_url: null } });
      await cargar();
    } catch (e: any) { setMsgFoto(e?.message || "Error"); }
  }

  const marcas = useMemo(() => Array.from(new Set(items.map((r) => r.modelo?.marca?.nombre).filter(Boolean))) as string[], [items]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((r) => {
      if (fMarca && r.modelo?.marca?.nombre !== fMarca) return false;
      if (fEje && r.modelo?.eje_recomendado !== fEje) return false;
      if (fMs === "si" && !r.modelo?.m_s) return false;
      if (fMs === "no" && r.modelo?.m_s) return false;
      if (fPmsf === "si" && !r.modelo?.tres_pmsf) return false;
      if (fPmsf === "no" && r.modelo?.tres_pmsf) return false;
      if (s && !r.referencia_completa.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, fMarca, fEje, fMs, fPmsf]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Catálogo de neumáticos</h1>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[240px]`} placeholder="Buscar (ej. AH51, 315/80, regional)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fMarca} onChange={(e) => setFMarca(e.target.value)}>
          <option value="">Todas las marcas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEje} onChange={(e) => setFEje(e.target.value)}>
          <option value="">Todos los ejes</option>
          {(Object.keys(EJE_LABELS) as EjeRecomendado[]).map((e) => <option key={e} value={e}>{EJE_LABELS[e]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fMs} onChange={(e) => setFMs(e.target.value)}>
          <option value="">M+S: todos</option><option value="si">Con M+S</option><option value="no">Sin M+S</option>
        </select>
        <select className={`${inputCls} w-auto`} value={fPmsf} onChange={(e) => setFPmsf(e.target.value)}>
          <option value="">3PMSF: todos</option><option value="si">Con 3PMSF</option><option value="no">Sin 3PMSF</option>
        </select>
        <span className="text-xs text-slate-500">{visibles.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida completa</th>
          <th className={thCls}>Eje</th><th className={thCls}>Aplicación</th><th className={thCls}>M+S</th><th className={thCls}>3PMSF</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin resultados.</td></tr>
          : visibles.map((r) => (
            <tr key={r.id} onClick={() => { setEditando(false); setConfirmarBaja(false); setFicha(r); }} className="cursor-pointer border-t border-slate-700/60 hover:bg-slate-800/60">
              <td className={tdCls + " font-semibold"}>{r.modelo?.marca?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-300"}>{r.modelo?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.tyre_size?.referencia_completa ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.modelo?.eje_recomendado ? EJE_LABELS[r.modelo.eje_recomendado] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.modelo?.aplicacion ?? "—"}</td>
              <td className={tdCls}>{r.modelo?.m_s ? <span className="text-emerald-400">Sí</span> : <span className="text-slate-500">—</span>}</td>
              <td className={tdCls}>{r.modelo?.tres_pmsf ? <span className="text-emerald-400">Sí</span> : <span className="text-slate-500">—</span>}</td>
              <td className={tdCls}><span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Activo</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {ficha && (
        <Modal title={ficha.referencia_completa} onClose={() => { setFicha(null); setEditando(false); setConfirmarBaja(false); }}>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div>
              {ficha.modelo?.foto_modelo_url ? (
                <img src={ficha.modelo.foto_modelo_url} alt={ficha.modelo.nombre} className="h-32 w-32 rounded-lg bg-white object-contain" />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-900 text-center text-[10px] text-slate-500">Imagen no disponible</div>
              )}
              {puedeEditar && (
                <div className="mt-2 flex flex-col gap-1">
                  <label className="cursor-pointer rounded border border-slate-600 px-2 py-1 text-center text-[10px] text-sky-300 hover:underline">
                    {subiendo ? "Subiendo…" : ficha.modelo?.foto_modelo_url ? "Cambiar foto" : "Subir foto"}
                    <input type="file" accept="image/*" className="hidden" disabled={subiendo} onChange={(e) => subirFoto(e.target.files?.[0])} />
                  </label>
                  {ficha.modelo?.foto_modelo_url && (
                    <button onClick={quitarFoto} className="rounded border border-rose-600 px-2 py-1 text-[10px] text-rose-300 hover:underline">Quitar foto</button>
                  )}
                  {msgFoto && <div className="text-[10px] text-red-300">{msgFoto}</div>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Dato label="Marca" v={ficha.modelo?.marca?.nombre} />
              <Dato label="Modelo" v={ficha.modelo?.nombre} />
              <Dato label="Gama" v={ficha.modelo?.gama} />
              <Dato label="Medida" v={ficha.tyre_size?.medida} />
              <Dato label="Índice carga" v={ficha.tyre_size ? (ficha.tyre_size.indice_carga_doble ? `${ficha.tyre_size.indice_carga_simple}/${ficha.tyre_size.indice_carga_doble}` : ficha.tyre_size.indice_carga_simple) : null} />
              <Dato label="Código velocidad" v={ficha.tyre_size?.codigo_velocidad} />
              <Dato label="Eje recomendado" v={ficha.modelo?.eje_recomendado ? EJE_LABELS[ficha.modelo.eje_recomendado] : null} />
              <Dato label="Aplicación" v={ficha.modelo?.aplicacion} />
              <Dato label="Tipo de vehículo" v={ficha.modelo?.tipo_vehiculo} />
              <Dato label="M+S" v={ficha.modelo?.m_s ? "Sí" : "No"} />
              <Dato label="3PMSF" v={ficha.modelo?.tres_pmsf ? "Sí" : "No"} />
              <Dato label="Reesculturable" v={ficha.modelo?.reesculturable ? "Sí" : "No"} />
              <Dato label="Recauchutable" v={ficha.modelo?.recauchutable ? "Sí" : "No"} />
              <Dato label="Profundidad dibujo" v={ficha.profundidad_dibujo_mm != null ? `${ficha.profundidad_dibujo_mm} mm` : null} />
              <Dato label="Llanta recomendada" v={ficha.llanta_recomendada} />
              <Dato label="Diámetro exterior" v={ficha.diametro_exterior_mm != null ? `${ficha.diametro_exterior_mm} mm` : null} />
              <Dato label="Revoluciones/km" v={ficha.revoluciones_km} />
              <Dato label="Carga máxima" v={ficha.carga_maxima_kg != null ? `${ficha.carga_maxima_kg} kg` : null} />
              <Dato label="Presión máxima" v={ficha.presion_maxima_bar != null ? `${ficha.presion_maxima_bar} bar` : null} />
              <Dato label="Peso" v={ficha.peso_kg != null ? `${ficha.peso_kg} kg` : null} />
            </div>
          </div>

          {puedeEditar && !editando && !confirmarBaja && (
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-700 pt-3">
              <button onClick={() => abrirEdicion(ficha)} className="rounded border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-600/10">Editar datos técnicos</button>
              <button onClick={() => setConfirmarBaja(true)} className="rounded border border-rose-600 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-600/10">Eliminar</button>
            </div>
          )}

          {puedeEditar && confirmarBaja && (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-700 pt-3 text-xs">
              <span className="text-slate-300">¿Dar de baja esta referencia del catálogo?</span>
              <button onClick={() => setConfirmarBaja(false)} className="rounded border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-700">Cancelar</button>
              <button onClick={darDeBaja} disabled={borrando} className="rounded border border-rose-600 bg-rose-600/20 px-3 py-1.5 font-semibold text-rose-200 hover:bg-rose-600/30 disabled:opacity-50">
                {borrando ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          )}

          {puedeEditar && editando && (
            <div className="mt-4 border-t border-slate-700 pt-3">
              <div className="mb-2 text-xs font-semibold text-slate-300">Editar datos técnicos</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Campo label="Profundidad dibujo (mm)" value={form.profundidad_dibujo_mm} onChange={(v) => setForm({ ...form, profundidad_dibujo_mm: v })} />
                <Campo label="Llanta recomendada" value={form.llanta_recomendada} onChange={(v) => setForm({ ...form, llanta_recomendada: v })} tipo="text" />
                <Campo label="Diámetro exterior (mm)" value={form.diametro_exterior_mm} onChange={(v) => setForm({ ...form, diametro_exterior_mm: v })} />
                <Campo label="Revoluciones/km" value={form.revoluciones_km} onChange={(v) => setForm({ ...form, revoluciones_km: v })} />
                <Campo label="Carga máxima (kg)" value={form.carga_maxima_kg} onChange={(v) => setForm({ ...form, carga_maxima_kg: v })} />
                <Campo label="Presión máxima (bar)" value={form.presion_maxima_bar} onChange={(v) => setForm({ ...form, presion_maxima_bar: v })} />
                <Campo label="Peso (kg)" value={form.peso_kg} onChange={(v) => setForm({ ...form, peso_kg: v })} />
              </div>
              {msgEdit && <div className="mt-2 text-xs text-red-300">{msgEdit}</div>}
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setEditando(false)} className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">Cancelar</button>
                <button onClick={guardarEdicion} disabled={guardando} className="rounded border border-sky-600 bg-sky-600/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-600/30 disabled:opacity-50">
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Dato({ label, v }: { label: string; v?: string | number | null }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-slate-200">{v ?? "—"}</div>
    </div>
  );
}

function Campo({ label, value, onChange, tipo = "number" }: { label: string; value: string; onChange: (v: string) => void; tipo?: "number" | "text" }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] text-slate-400">{label}</div>
      <input
        type={tipo}
        step={tipo === "number" ? "any" : undefined}
        className={`${inputCls} w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
