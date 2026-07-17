import { useEffect, useMemo, useState } from "react";
import { listarReferenciasNeumatico, subirFotoModelo, eliminarFotoModelo, actualizarReferenciaNeumatico, eliminarReferenciaNeumatico, listarNeumaticosSinCatalogar, crearReferenciaNeumatico } from "../services/data";
import type { ComboSinCatalogar } from "../services/data";
import type { ReferenciaNeumatico, EjeRecomendado } from "../types";
import { presionTxt } from "../types";
import { Modal, inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

type CamposTecnicos = "profundidad_dibujo_mm" | "llanta_recomendada" | "diametro_exterior_mm" | "revoluciones_km" | "carga_maxima_kg" | "presion_maxima_bar" | "peso_kg"
  | "ply" | "ancho_seccion_mm" | "anchura_rodadura_mm" | "radio_carga_mm" | "etiqueta_rr" | "etiqueta_grip_humedo" | "etiqueta_ruido_db" | "etiqueta_ruido_clase";

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
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CamposTecnicos, string>>({
    profundidad_dibujo_mm: "", llanta_recomendada: "", diametro_exterior_mm: "", revoluciones_km: "", carga_maxima_kg: "", presion_maxima_bar: "", peso_kg: "",
    ply: "", ancho_seccion_mm: "", anchura_rodadura_mm: "", radio_carga_mm: "", etiqueta_rr: "", etiqueta_grip_humedo: "", etiqueta_ruido_db: "", etiqueta_ruido_clase: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [msgEdit, setMsgEdit] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  // Alta de referencias (Nueva referencia + Sin catalogar)
  type FormRef = { marca: string; modelo: string; medida: string; indiceCargaSimple: string; indiceCargaDoble: string; codigoVelocidad: string };
  const vacioRef: FormRef = { marca: "", modelo: "", medida: "", indiceCargaSimple: "", indiceCargaDoble: "", codigoVelocidad: "" };
  const [nuevaRef, setNuevaRef] = useState<FormRef | null>(null);
  const [creandoRef, setCreandoRef] = useState(false);
  const [msgRef, setMsgRef] = useState("");
  const [sinCatalogar, setSinCatalogar] = useState<ComboSinCatalogar[] | null>(null);
  const [cargandoSC, setCargandoSC] = useState(false);
  const [creandoClave, setCreandoClave] = useState<string | null>(null);

  function abrirNuevaRef(prefill?: Partial<FormRef>) {
    setMsgRef("");
    setNuevaRef({ ...vacioRef, ...prefill });
  }

  async function guardarNuevaRef() {
    if (!nuevaRef) return;
    setCreandoRef(true); setMsgRef("");
    try {
      await crearReferenciaNeumatico({
        marca: nuevaRef.marca, modelo: nuevaRef.modelo, medida: nuevaRef.medida,
        indiceCargaSimple: nuevaRef.indiceCargaSimple, indiceCargaDoble: nuevaRef.indiceCargaDoble || null,
        codigoVelocidad: nuevaRef.codigoVelocidad,
      });
      setNuevaRef(null);
      await cargar();
    } catch (e: any) { setMsgRef(e?.message || "Error al crear la referencia"); } finally { setCreandoRef(false); }
  }

  async function abrirSinCatalogar() {
    setSinCatalogar([]); setCargandoSC(true);
    try { setSinCatalogar(await listarNeumaticosSinCatalogar()); }
    catch { setSinCatalogar([]); } finally { setCargandoSC(false); }
  }

  function separarIndiceCarga(ic: string | null): { simple: string; doble: string } {
    if (!ic) return { simple: "", doble: "" };
    const [s, d] = ic.split("/");
    return { simple: (s ?? "").trim(), doble: (d ?? "").trim() };
  }

  async function crearDesdeCombo(c: ComboSinCatalogar) {
    const { simple, doble } = separarIndiceCarga(c.indice_carga);
    // Si faltan índices para crear el tyre_size, abrimos el formulario prefijado
    if (!simple || !c.indice_velocidad) {
      abrirNuevaRef({ marca: c.marca, modelo: c.modelo, medida: c.medida, indiceCargaSimple: simple, indiceCargaDoble: doble, codigoVelocidad: c.indice_velocidad ?? "" });
      return;
    }
    const clave = `${c.marca}|${c.modelo}|${c.medida}`;
    setCreandoClave(clave); setMsgRef("");
    try {
      await crearReferenciaNeumatico({
        marca: c.marca, modelo: c.modelo, medida: c.medida,
        indiceCargaSimple: simple, indiceCargaDoble: doble || null, codigoVelocidad: c.indice_velocidad,
      });
      setSinCatalogar((prev) => (prev ?? []).filter((x) => `${x.marca}|${x.modelo}|${x.medida}` !== clave));
      await cargar();
    } catch (e: any) {
      // si falla (p.ej. medida no parseable), abrimos el formulario para corregir
      abrirNuevaRef({ marca: c.marca, modelo: c.modelo, medida: c.medida, indiceCargaSimple: simple, indiceCargaDoble: doble, codigoVelocidad: c.indice_velocidad ?? "" });
      setMsgRef(e?.message || "Revisa los datos");
    } finally { setCreandoClave(null); }
  }

  function abrirEdicion(r: ReferenciaNeumatico) {
    setForm({
      profundidad_dibujo_mm: r.profundidad_dibujo_mm != null ? String(r.profundidad_dibujo_mm) : "",
      llanta_recomendada: r.llanta_recomendada ?? "",
      diametro_exterior_mm: r.diametro_exterior_mm != null ? String(r.diametro_exterior_mm) : "",
      revoluciones_km: r.revoluciones_km != null ? String(r.revoluciones_km) : "",
      carga_maxima_kg: r.carga_maxima_kg != null ? String(r.carga_maxima_kg) : "",
      presion_maxima_bar: r.presion_maxima_bar != null ? String(r.presion_maxima_bar) : "",
      peso_kg: r.peso_kg != null ? String(r.peso_kg) : "",
      ply: r.ply != null ? String(r.ply) : "",
      ancho_seccion_mm: r.ancho_seccion_mm != null ? String(r.ancho_seccion_mm) : "",
      anchura_rodadura_mm: r.anchura_rodadura_mm != null ? String(r.anchura_rodadura_mm) : "",
      radio_carga_mm: r.radio_carga_mm != null ? String(r.radio_carga_mm) : "",
      etiqueta_rr: r.etiqueta_rr ?? "",
      etiqueta_grip_humedo: r.etiqueta_grip_humedo ?? "",
      etiqueta_ruido_db: r.etiqueta_ruido_db != null ? String(r.etiqueta_ruido_db) : "",
      etiqueta_ruido_clase: r.etiqueta_ruido_clase ?? "",
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
        ply: num(form.ply),
        ancho_seccion_mm: num(form.ancho_seccion_mm),
        anchura_rodadura_mm: num(form.anchura_rodadura_mm),
        radio_carga_mm: num(form.radio_carga_mm),
        etiqueta_rr: form.etiqueta_rr.trim() === "" ? null : form.etiqueta_rr.trim().toUpperCase(),
        etiqueta_grip_humedo: form.etiqueta_grip_humedo.trim() === "" ? null : form.etiqueta_grip_humedo.trim().toUpperCase(),
        etiqueta_ruido_db: num(form.etiqueta_ruido_db),
        etiqueta_ruido_clase: form.etiqueta_ruido_clase.trim() === "" ? null : form.etiqueta_ruido_clase.trim().toUpperCase(),
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Catálogo de neumáticos</h1>
        {puedeEditar && (
          <div className="flex gap-2">
            <button onClick={abrirSinCatalogar} className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-600/10">Sin catalogar</button>
            <button onClick={() => abrirNuevaRef()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">+ Nueva referencia</button>
          </div>
        )}
      </div>

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
                <img
                  src={ficha.modelo.foto_modelo_url}
                  alt={ficha.modelo.nombre}
                  onClick={() => setFotoAmpliada(ficha.modelo!.foto_modelo_url!)}
                  className="h-32 w-32 cursor-zoom-in rounded-lg bg-white object-contain"
                />
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
              <Dato label="Presión máxima" v={ficha.presion_maxima_bar != null ? `${presionTxt(ficha.presion_maxima_bar)} bar` : null} />
              <Dato label="Peso" v={ficha.peso_kg != null ? `${ficha.peso_kg} kg` : null} />
              <Dato label="Ply" v={ficha.ply} />
              <Dato label="Ancho sección" v={ficha.ancho_seccion_mm != null ? `${ficha.ancho_seccion_mm} mm` : null} />
              <Dato label="Anchura rodadura" v={ficha.anchura_rodadura_mm != null ? `${ficha.anchura_rodadura_mm} mm` : null} />
              <Dato label="Radio de carga" v={ficha.radio_carga_mm != null ? `${ficha.radio_carga_mm} mm` : null} />
              <Dato label="Resistencia rodadura (UE)" v={ficha.etiqueta_rr} />
              <Dato label="Agarre en mojado (UE)" v={ficha.etiqueta_grip_humedo} />
              <Dato label="Ruido exterior (UE)" v={ficha.etiqueta_ruido_db != null ? `${ficha.etiqueta_ruido_db} dB` : null} />
              <Dato label="Clase de ruido (UE)" v={ficha.etiqueta_ruido_clase} />
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
                <Campo label="Ply" value={form.ply} onChange={(v) => setForm({ ...form, ply: v })} />
                <Campo label="Ancho sección (mm)" value={form.ancho_seccion_mm} onChange={(v) => setForm({ ...form, ancho_seccion_mm: v })} />
                <Campo label="Anchura rodadura (mm)" value={form.anchura_rodadura_mm} onChange={(v) => setForm({ ...form, anchura_rodadura_mm: v })} />
                <Campo label="Radio de carga (mm)" value={form.radio_carga_mm} onChange={(v) => setForm({ ...form, radio_carga_mm: v })} />
                <Campo label="Resistencia rodadura UE (A-G)" value={form.etiqueta_rr} onChange={(v) => setForm({ ...form, etiqueta_rr: v })} tipo="text" />
                <Campo label="Agarre mojado UE (A-G)" value={form.etiqueta_grip_humedo} onChange={(v) => setForm({ ...form, etiqueta_grip_humedo: v })} tipo="text" />
                <Campo label="Ruido exterior UE (dB)" value={form.etiqueta_ruido_db} onChange={(v) => setForm({ ...form, etiqueta_ruido_db: v })} />
                <Campo label="Clase de ruido UE" value={form.etiqueta_ruido_clase} onChange={(v) => setForm({ ...form, etiqueta_ruido_clase: v })} tipo="text" />
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

      {fotoAmpliada && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setFotoAmpliada(null)}
        >
          <img src={fotoAmpliada} alt="" className="max-h-full max-w-full rounded-lg bg-white object-contain" />
        </div>
      )}

      {nuevaRef && (
        <Modal title="Nueva referencia de catálogo" onClose={() => setNuevaRef(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setNuevaRef(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarNuevaRef} disabled={creandoRef || !nuevaRef.marca.trim() || !nuevaRef.modelo.trim() || !nuevaRef.medida.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{creandoRef ? "Creando…" : "Crear referencia"}</button>
          </div>}>
          <p className="mb-3 text-xs text-slate-400">Se reutilizan marca, modelo y medida si ya existen; si no, se crean. La medida se parsea (ancho/perfil/llanta) automáticamente.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Campo label="Marca" value={nuevaRef.marca} onChange={(v) => setNuevaRef({ ...nuevaRef, marca: v })} tipo="text" />
            <Campo label="Modelo" value={nuevaRef.modelo} onChange={(v) => setNuevaRef({ ...nuevaRef, modelo: v })} tipo="text" />
            <Campo label="Medida (ej. 315/80R22.5)" value={nuevaRef.medida} onChange={(v) => setNuevaRef({ ...nuevaRef, medida: v })} tipo="text" />
            <Campo label="Índice carga simple" value={nuevaRef.indiceCargaSimple} onChange={(v) => setNuevaRef({ ...nuevaRef, indiceCargaSimple: v })} tipo="text" />
            <Campo label="Índice carga doble (opc.)" value={nuevaRef.indiceCargaDoble} onChange={(v) => setNuevaRef({ ...nuevaRef, indiceCargaDoble: v })} tipo="text" />
            <Campo label="Código velocidad (ej. L)" value={nuevaRef.codigoVelocidad} onChange={(v) => setNuevaRef({ ...nuevaRef, codigoVelocidad: v })} tipo="text" />
          </div>
          {msgRef && <div className="mt-2 text-xs text-red-300">{msgRef}</div>}
        </Modal>
      )}

      {sinCatalogar !== null && (
        <Modal title="Neumáticos sin catalogar" onClose={() => setSinCatalogar(null)}>
          <p className="mb-3 text-xs text-slate-400">
            Combinaciones marca/modelo/medida presentes en neumáticos reales que aún no tienen referencia en el catálogo. Crea la que falte con un clic; si faltan índices se abre el formulario para completarlos.
          </p>
          {cargandoSC ? (
            <div className="text-sm text-slate-500">Analizando neumáticos…</div>
          ) : sinCatalogar.length === 0 ? (
            <div className="text-sm text-emerald-300">Todo catalogado. No hay combinaciones pendientes.</div>
          ) : (
            <TableWrap>
              <thead className="bg-slate-900"><tr>
                <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th>
                <th className={thCls}>Carga</th><th className={thCls}>Vel.</th><th className={thCls}>Uds.</th><th className={thCls}>Empresas</th><th className={thCls}></th>
              </tr></thead>
              <tbody>
                {sinCatalogar.map((c) => {
                  const clave = `${c.marca}|${c.modelo}|${c.medida}`;
                  return (
                    <tr key={clave} className="border-t border-slate-700/60">
                      <td className={tdCls + " font-semibold"}>{c.marca}</td>
                      <td className={tdCls + " text-slate-300"}>{c.modelo}</td>
                      <td className={tdCls + " text-slate-400"}>{c.medida}</td>
                      <td className={tdCls + " text-slate-400"}>{c.indice_carga ?? "—"}</td>
                      <td className={tdCls + " text-slate-400"}>{c.indice_velocidad ?? "—"}</td>
                      <td className={tdCls + " text-slate-400"}>{c.cantidad}</td>
                      <td className={tdCls + " text-[11px] text-slate-500"}>{c.empresas.join(", ")}</td>
                      <td className={tdCls}>
                        <button onClick={() => crearDesdeCombo(c)} disabled={creandoClave === clave}
                          className="rounded border border-emerald-600 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-50">
                          {creandoClave === clave ? "Creando…" : "Añadir al catálogo"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
          {msgRef && !nuevaRef && <div className="mt-2 text-xs text-red-300">{msgRef}</div>}
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
