import { useEffect, useState } from "react";
import {
  listarMarcas, crearMarca, actualizarMarca, eliminarMarca, subirLogoMarca,
  listarModelos, crearModelo, actualizarModelo, eliminarModelo,
  listarMedidas, crearMedida,
  listarIndicesCarga, crearIndiceCarga, listarIndicesVelocidad, crearIndiceVelocidad,
  listarTiposVehiculo, actualizarConfiguracionEjes, actualizarIntervaloRevisionTipo,
  listarTiposDeMedida, fijarTiposDeMedida, actualizarMedidaCategoria,
  listarFabricantes, crearFabricante, actualizarFabricante, eliminarFabricante,
  listarContadoresMarcas,
  listarMotivosFueraAlmacen, crearMotivoFueraAlmacen, actualizarMotivoFueraAlmacen, eliminarMotivoFueraAlmacen,
  listarConfigEjes, crearConfigEjes, desactivarConfigEjes, subirImagenConfigEjes, actualizarImagenConfigEjes,
  listarTiposLlanta, crearTipoLlanta, desactivarTipoLlanta,
  listarPresionesObjetivo, guardarPresionObjetivo, eliminarPresionObjetivo, type PresionObjetivo,
} from "../services/data";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad, TipoVehiculo, Fabricante, MarcaContadores, SegmentoMarca, MotivoFueraAlmacen, ConfigEjes, TipoLlanta } from "../types";
import { tipoLlantaLabel, CATEGORIAS_NEUMATICO, CATEGORIA_NEUMATICO_LABELS } from "../types";
import { SEGMENTO_LABELS } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import ConfigWebfleet from "../components/ConfigWebfleet";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Fila de configuración de ejes con su imagen de chasis asociada: la imagen
// se sube una vez aquí y la heredan todos los vehículos con esa configuración.
function FilaConfigEjes({ config, puedeEditar, onCambio }: { config: ConfigEjes; puedeEditar: boolean; onCambio: () => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  async function onArchivo(file: File | undefined) {
    if (!file) return;
    setSubiendo(true); setErr("");
    try {
      const url = await subirImagenConfigEjes(config.id, file);
      await actualizarImagenConfigEjes(config.id, url);
      onCambio();
    } catch (e: any) { setErr(e?.message || "Error al subir la imagen"); } finally { setSubiendo(false); }
  }

  async function quitarImagen() {
    if (!window.confirm(`¿Quitar la imagen de la configuración "${config.nombre}"?`)) return;
    setErr("");
    try { await actualizarImagenConfigEjes(config.id, null); onCambio(); }
    catch (e: any) { setErr(e?.message || "Error"); }
  }

  async function borrar() {
    if (!window.confirm(`¿Eliminar la configuración "${config.nombre}"?`)) return;
    await desactivarConfigEjes(config.id); onCambio();
  }

  return (
    <div className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
      {config.imagen_chasis_url ? (
        <img src={config.imagen_chasis_url} alt={config.nombre} className="h-8 w-8 rounded border border-slate-700 object-contain bg-slate-950" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-600">sin img</div>
      )}
      <span className="flex-1"><b>{config.nombre}</b>{config.descripcion ? ` · ${config.descripcion}` : ""}</span>
      {err && <span className="text-[10px] text-rose-400">{err}</span>}
      {puedeEditar && (
        <>
          <label className="cursor-pointer text-[10px] text-sky-300 hover:underline">
            {subiendo ? "subiendo…" : config.imagen_chasis_url ? "cambiar" : "imagen"}
            <input type="file" accept="image/*" className="hidden" disabled={subiendo} onChange={(e) => { void onArchivo(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {config.imagen_chasis_url && (
            <button onClick={quitarImagen} className="text-[10px] text-amber-300 hover:underline">quitar img</button>
          )}
          <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
        </>
      )}
    </div>
  );
}

function FilaMotivo({ motivo, puedeEditar, onCambio }: { motivo: MotivoFueraAlmacen; puedeEditar: boolean; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(motivo.motivo);

  async function guardar() {
    if (!texto.trim() || texto === motivo.motivo) { setEditando(false); return; }
    await actualizarMotivoFueraAlmacen(motivo.id, texto.trim());
    setEditando(false); onCambio();
  }
  async function borrar() {
    if (!window.confirm(`¿Eliminar el motivo "${motivo.motivo}"?`)) return;
    await eliminarMotivoFueraAlmacen(motivo.id); onCambio();
  }

  return (
    <div className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
      {editando ? (
        <input autoFocus className="flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[12px] text-slate-100"
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()} onBlur={guardar} />
      ) : (
        <span className="flex-1">{motivo.motivo}</span>
      )}
      {puedeEditar && !editando && (
        <div className="flex gap-1">
          <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:underline">editar</button>
          <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
        </div>
      )}
    </div>
  );
}

function FilaFabricante({ fabricante, puedeEditar, onCambio }: { fabricante: Fabricante; puedeEditar: boolean; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(fabricante.nombre);

  async function guardar() {
    if (!nombre.trim() || nombre === fabricante.nombre) { setEditando(false); return; }
    await actualizarFabricante(fabricante.id, { nombre: nombre.trim() });
    setEditando(false); onCambio();
  }
  async function borrar() {
    if (!window.confirm(`¿Eliminar el fabricante "${fabricante.nombre}"? Las marcas ligadas quedarán sin fabricante.`)) return;
    await eliminarFabricante(fabricante.id); onCambio();
  }

  return (
    <div className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
      {editando ? (
        <input autoFocus className="flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[12px] text-slate-100"
          value={nombre} onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()} onBlur={guardar} />
      ) : (
        <span className="flex-1">{fabricante.nombre}</span>
      )}
      {puedeEditar && !editando && (
        <div className="flex gap-1">
          <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:underline">editar</button>
          <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
        </div>
      )}
    </div>
  );
}

function FilaMarca({ marca, fabricantes, contadores, seleccionada, puedeEditar, onSeleccionar, onCambio }: {
  marca: MarcaNeumatico; fabricantes: Fabricante[]; contadores?: MarcaContadores; seleccionada: boolean; puedeEditar: boolean;
  onSeleccionar: () => void; onCambio: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [nombre, setNombre] = useState(marca.nombre);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState("");

  async function guardarNombre() {
    if (!nombre.trim() || nombre === marca.nombre) { setEditando(false); return; }
    try { await actualizarMarca(marca.id, { nombre }); setEditando(false); onCambio(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  async function subirLogo(file: File | undefined) {
    if (!file) return;
    setSubiendo(true); setMsg("");
    try { const url = await subirLogoMarca(marca.id, file); await actualizarMarca(marca.id, { logo_url: url }); onCambio(); }
    catch (e: any) { setMsg(e?.message || "Error al subir logo"); } finally { setSubiendo(false); }
  }

  async function borrar() {
    if (!window.confirm(`¿Eliminar la marca "${marca.nombre}"?`)) return;
    try { await eliminarMarca(marca.id); onCambio(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div className={`rounded px-2 py-1.5 text-[12px] ${seleccionada ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-300"}`}>
      <div className="flex items-center gap-2">
        {marca.logo_url ? (
          <img src={marca.logo_url} alt={marca.nombre} className="h-5 w-5 rounded-sm object-contain bg-white" />
        ) : (
          <div className="h-5 w-5 rounded-sm bg-slate-700" />
        )}
        {editando ? (
          <input autoFocus className="flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[12px] text-slate-100"
            value={nombre} onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardarNombre()} onBlur={guardarNombre} />
        ) : (
          <span className="flex-1 cursor-pointer" onClick={onSeleccionar}>{marca.nombre}</span>
        )}
        {puedeEditar && !editando && (
          <div className="flex gap-1">
            <label className="cursor-pointer text-[10px] text-sky-300 hover:underline">
              {subiendo ? "…" : "logo"}
              <input type="file" accept="image/*" className="hidden" disabled={subiendo} onChange={(e) => subirLogo(e.target.files?.[0])} />
            </label>
            <button onClick={() => setDetalle((v) => !v)} className="text-[10px] text-sky-300 hover:underline">{detalle ? "cerrar" : "detalle"}</button>
            <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:underline">editar</button>
            <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
          </div>
        )}
      </div>
      {detalle && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded bg-slate-800 p-2">
          <label className="col-span-2 text-[10px] text-slate-400">
            Fabricante
            <select className={`${inputCls} mt-0.5 text-[11px]`} value={marca.fabricante_id ?? ""} disabled={!puedeEditar}
              onChange={async (e) => { await actualizarMarca(marca.id, { fabricante_id: e.target.value || null }); onCambio(); }}>
              <option value="">Sin fabricante</option>
              {fabricantes.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-400">
            Segmento
            <select className={`${inputCls} mt-0.5 text-[11px]`} value={marca.segmento ?? ""} disabled={!puedeEditar}
              onChange={async (e) => { await actualizarMarca(marca.id, { segmento: e.target.value || null }); onCambio(); }}>
              <option value="">—</option>
              {(Object.keys(SEGMENTO_LABELS) as SegmentoMarca[]).map((s) => <option key={s} value={s}>{SEGMENTO_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-400">
            País
            <input className={`${inputCls} mt-0.5 text-[11px]`} defaultValue={marca.pais_origen ?? ""} disabled={!puedeEditar}
              onBlur={async (e) => { if (e.target.value !== (marca.pais_origen ?? "")) { await actualizarMarca(marca.id, { pais_origen: e.target.value || null }); onCambio(); } }} />
          </label>
          {contadores && (
            <div className="col-span-2 flex gap-3 text-[10px] text-slate-500">
              <span>{contadores.num_modelos} modelo(s)</span>
              <span>{contadores.num_neumaticos} neumático(s)</span>
              <span>{contadores.num_vehiculos} vehículo(s)</span>
            </div>
          )}
        </div>
      )}
      {msg && <div className="mt-1 text-[10px] text-red-300">{msg}</div>}
    </div>
  );
}

function FilaModelo({ modelo, puedeEditar, onCambio }: { modelo: ModeloNeumatico; puedeEditar: boolean; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(modelo.nombre);

  async function guardar() {
    if (!nombre.trim() || nombre === modelo.nombre) { setEditando(false); return; }
    await actualizarModelo(modelo.id, nombre);
    setEditando(false); onCambio();
  }
  async function borrar() {
    if (!window.confirm(`¿Eliminar el modelo "${modelo.nombre}"?`)) return;
    await eliminarModelo(modelo.id); onCambio();
  }

  return (
    <div className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
      {editando ? (
        <input autoFocus className="flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[12px] text-slate-100"
          value={nombre} onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()} onBlur={guardar} />
      ) : (
        <span className="flex-1">{modelo.nombre}</span>
      )}
      {puedeEditar && !editando && (
        <div className="flex gap-1">
          <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:underline">editar</button>
          <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
        </div>
      )}
    </div>
  );
}

function FilaMedidaCompatibilidad({ medida, tipos, puedeEditar }: { medida: MedidaNeumatico; tipos: TipoVehiculo[]; puedeEditar: boolean }) {
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoria, setCategoria] = useState(medida.categoria ?? "");

  useEffect(() => { if (abierto) listarTiposDeMedida(medida.id).then(setSeleccionados); }, [abierto, medida.id]);

  async function cambiarCategoria(cat: string) {
    setCategoria(cat);
    try { await actualizarMedidaCategoria(medida.id, cat || null); } catch { /* la RLS o red; se reintenta al reeditar */ }
  }

  async function alternar(tipoId: string) {
    const next = seleccionados.includes(tipoId) ? seleccionados.filter((x) => x !== tipoId) : [...seleccionados, tipoId];
    setSeleccionados(next);
    setSaving(true);
    try { await fijarTiposDeMedida(medida.id, next); } finally { setSaving(false); }
  }

  return (
    <div className="rounded bg-slate-900 px-2 py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-200">{medida.valor}</span>
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-300"
            value={categoria}
            disabled={!puedeEditar}
            onChange={(e) => cambiarCategoria(e.target.value)}
            title="Categoría (para los umbrales por tipo)"
          >
            <option value="">Categoría…</option>
            {CATEGORIAS_NEUMATICO.map((c) => <option key={c} value={c}>{CATEGORIA_NEUMATICO_LABELS[c]}</option>)}
          </select>
          <button onClick={() => setAbierto((v) => !v)} className="text-[10px] text-sky-300 hover:underline">
            {abierto ? "cerrar" : "tipos de vehículo"}
          </button>
        </div>
      </div>
      {abierto && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tipos.map((t) => (
            <label key={t.id} className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${seleccionados.includes(t.id) ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400"}`}>
              <input type="checkbox" disabled={!puedeEditar || saving} checked={seleccionados.includes(t.id)} onChange={() => alternar(t.id)} />
              {t.nombre}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function FilaTipoVehiculo({ tipo, puedeEditar, onGuardado }: { tipo: TipoVehiculo; puedeEditar: boolean; onGuardado: () => void }) {
  const [valor, setValor] = useState(tipo.configuracion_ejes ?? "");
  const [dias, setDias] = useState(tipo.revision_intervalo_dias != null ? String(tipo.revision_intervalo_dias) : "");
  const [saving, setSaving] = useState(false);
  const cambiado = valor !== (tipo.configuracion_ejes ?? "") || dias !== (tipo.revision_intervalo_dias != null ? String(tipo.revision_intervalo_dias) : "");
  async function guardar() {
    setSaving(true);
    try {
      if (valor !== (tipo.configuracion_ejes ?? "")) await actualizarConfiguracionEjes(tipo.id, valor.trim() || null);
      const nd = dias.trim() === "" ? null : Number(dias);
      if (nd !== (tipo.revision_intervalo_dias ?? null)) await actualizarIntervaloRevisionTipo(tipo.id, nd);
      onGuardado();
    } finally { setSaving(false); }
  }
  return (
    <tr className="border-t border-slate-700/60">
      <td className={tdCls + " font-semibold"}>{tipo.nombre}</td>
      <td className={tdCls + " text-slate-400"}>{tipo.descripcion ?? "—"}</td>
      <td className={tdCls + " text-slate-400"}>{tipo.numero_ejes}</td>
      <td className={tdCls + " text-[11px]"}>{tipo.imagen_chasis_url ? <span className="text-emerald-400">Con imagen</span> : <span className="text-slate-500">Sin imagen</span>}</td>
      <td className={tdCls}>
        {puedeEditar ? (
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} max-w-[120px] text-[12px]`} placeholder="Ej. 2x2x2" value={valor} onChange={(e) => setValor(e.target.value)} />
            <input type="number" className={`${inputCls} max-w-[110px] text-[12px]`} placeholder="revisión (días)" value={dias} onChange={(e) => setDias(e.target.value)} title="Periodicidad de revisión en días" />
            <button onClick={guardar} disabled={saving || !cambiado} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50">Guardar</button>
          </div>
        ) : (tipo.configuracion_ejes ?? "—")}
      </td>
    </tr>
  );
}

function ListaSimple({ titulo, placeholder, items, puedeEditar, onCrear }: {
  titulo: string; placeholder: string; items: { id: string; valor: string }[]; puedeEditar: boolean; onCrear: (v: string) => Promise<void>;
}) {
  const [nuevo, setNuevo] = useState("");
  async function guardar() {
    if (!nuevo.trim()) return;
    await onCrear(nuevo);
    setNuevo("");
  }
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">{titulo} ({items.length})</div>
      {puedeEditar && (
        <div className="mb-2 flex gap-2">
          <input className={inputCls} placeholder={placeholder} value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
          <button onClick={guardar} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
        </div>
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {items.map((x) => <div key={x.id} className="rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">{x.valor}</div>)}
      </div>
    </div>
  );
}

export default function Configuracion() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!perfil?.es_superadmin;

  const [marcas, setMarcas] = useState<MarcaNeumatico[]>([]);
  const [modelos, setModelos] = useState<ModeloNeumatico[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [indicesCarga, setIndicesCarga] = useState<IndiceCarga[]>([]);
  const [indicesVelocidad, setIndicesVelocidad] = useState<IndiceVelocidad[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  const [fabricantes, setFabricantes] = useState<Fabricante[]>([]);
  const [contadores, setContadores] = useState<MarcaContadores[]>([]);
  const [motivosFueraAlmacen, setMotivosFueraAlmacen] = useState<MotivoFueraAlmacen[]>([]);
  const [nuevoMotivo, setNuevoMotivo] = useState("");
  const [configEjes, setConfigEjes] = useState<ConfigEjes[]>([]);
  const [tiposLlanta, setTiposLlanta] = useState<TipoLlanta[]>([]);
  const [presiones, setPresiones] = useState<PresionObjetivo[]>([]);
  const [presTipo, setPresTipo] = useState("");
  const [presEje, setPresEje] = useState("");
  const [presBar, setPresBar] = useState("");
  const [presMargen, setPresMargen] = useState("0.5");
  const [nuevaConfig, setNuevaConfig] = useState("");
  const [nuevaConfigDesc, setNuevaConfigDesc] = useState("");
  const [nuevaLlantaMat, setNuevaLlantaMat] = useState("aluminio");
  const [nuevaLlantaMed, setNuevaLlantaMed] = useState("");
  const [nuevaLlantaAguj, setNuevaLlantaAguj] = useState("");
  const [nuevaLlantaCentrado, setNuevaLlantaCentrado] = useState("");
  const [nuevaLlantaTapa, setNuevaLlantaTapa] = useState(false);
  const [marcaSel, setMarcaSel] = useState("");
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [nuevoModelo, setNuevoModelo] = useState("");
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [nuevoFabricante, setNuevoFabricante] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    const [m, med, ic, iv, t, f, c, mf, ce, tl, po] = await Promise.all([
      listarMarcas(), listarMedidas(), listarIndicesCarga(), listarIndicesVelocidad(),
      listarTiposVehiculo(), listarFabricantes(), listarContadoresMarcas(), listarMotivosFueraAlmacen(),
      listarConfigEjes(), listarTiposLlanta(), listarPresionesObjetivo().catch(() => []),
    ]);
    setMarcas(m); setMedidas(med); setIndicesCarga(ic); setIndicesVelocidad(iv); setTipos(t); setFabricantes(f); setContadores(c); setMotivosFueraAlmacen(mf);
    setConfigEjes(ce); setTiposLlanta(tl); setPresiones(po);
  }

  async function guardarPresion() {
    if (!presTipo || !presBar.trim()) { setMsg("Selecciona tipo y presión"); return; }
    setMsg("");
    try {
      await guardarPresionObjetivo({
        tipo_vehiculo_id: presTipo,
        eje: presEje ? parseInt(presEje, 10) : null,
        presion_objetivo_bar: parseFloat(presBar.replace(",", ".")),
        margen_bar: presMargen ? parseFloat(presMargen.replace(",", ".")) : 0.5,
      });
      setPresBar(""); setPresEje("");
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); }
  }
  async function guardarConfig() {
    if (!nuevaConfig.trim()) return;
    setMsg("");
    try { await crearConfigEjes(nuevaConfig, nuevaConfigDesc); setNuevaConfig(""); setNuevaConfigDesc(""); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }
  async function guardarLlanta() {
    if (!nuevaLlantaMat.trim() || !nuevaLlantaMed.trim()) return;
    setMsg("");
    try {
      await crearTipoLlanta({
        material: nuevaLlantaMat,
        medida: nuevaLlantaMed,
        agujeros: nuevaLlantaAguj ? parseInt(nuevaLlantaAguj, 10) : null,
        centrado: nuevaLlantaCentrado || null,
        tapacubo: nuevaLlantaTapa,
      });
      setNuevaLlantaMed(""); setNuevaLlantaAguj(""); setNuevaLlantaCentrado(""); setNuevaLlantaTapa(false);
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); }
  }
  async function guardarMotivo() {
    if (!nuevoMotivo.trim()) return;
    await crearMotivoFueraAlmacen(nuevoMotivo); setNuevoMotivo(""); await cargar();
  }
  useEffect(() => { void cargar(); }, []);
  useEffect(() => { listarModelos(marcaSel || undefined).then(setModelos); }, [marcaSel]);

  async function guardarMarca() {
    if (!nuevaMarca.trim()) return;
    setMsg("");
    try { await crearMarca(nuevaMarca); setNuevaMarca(""); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }
  async function guardarModelo() {
    if (!nuevoModelo.trim()) return;
    setMsg("");
    try { await crearModelo(marcaSel || null, nuevoModelo); setNuevoModelo(""); setModelos(await listarModelos(marcaSel || undefined)); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }
  async function guardarFabricante() {
    if (!nuevoFabricante.trim()) return;
    setMsg("");
    try { await crearFabricante(nuevoFabricante); setNuevoFabricante(""); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Configuración</h1>
      <p className="mb-3 text-sm text-slate-400">Ajustes de la empresa y la plataforma.</p>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      {puedeEditar && <ConfigWebfleet />}

      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Fabricantes ({fabricantes.length})</div>
        <div className="mb-3 text-[11px] text-slate-500">Grupo empresarial al que pertenece cada marca (ej. Michelin fabrica también BFGoodrich, Kleber…).{!puedeEditar && " Solo un administrador SEA puede añadir/editar."}</div>
        {puedeEditar && (
          <div className="mb-2 flex max-w-sm gap-2">
            <input className={inputCls} placeholder="Nuevo fabricante…" value={nuevoFabricante} onChange={(e) => setNuevoFabricante(e.target.value)} />
            <button onClick={guardarFabricante} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
          </div>
        )}
        <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {fabricantes.map((f) => <FilaFabricante key={f.id} fabricante={f} puedeEditar={puedeEditar} onCambio={cargar} />)}
        </div>
      </div>

      {/* Configuraciones de ejes */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Configuraciones de ejes ({configEjes.length})</div>
        <div className="mb-3 text-[11px] text-slate-500">Etiquetas para la ficha del vehículo (ej. 2x2x2, 2x4). Cada número es un eje y sus ruedas: 2 = sencillo, 4 = gemelo.</div>
        {puedeEditar && (
          <div className="mb-2 flex max-w-md flex-wrap gap-2">
            <input className={`${inputCls} max-w-[130px]`} placeholder="2x2x2" value={nuevaConfig} onChange={(e) => setNuevaConfig(e.target.value)} />
            <input className={inputCls} placeholder="Descripción (opcional)" value={nuevaConfigDesc} onChange={(e) => setNuevaConfigDesc(e.target.value)} />
            <button onClick={guardarConfig} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
          </div>
        )}
        <div className="mb-2 text-[11px] text-slate-500">La imagen de chasis asociada a cada configuración la heredan todos los vehículos que la usen (si el tipo de vehículo tiene imagen propia, esa tiene prioridad).</div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {configEjes.map((c) => <FilaConfigEjes key={c.id} config={c} puedeEditar={puedeEditar} onCambio={cargar} />)}
        </div>
      </div>

      {/* Presiones objetivo */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Presiones objetivo ({presiones.length})</div>
        <div className="mb-3 text-[11px] text-slate-500">Presión de referencia (bar) por tipo de vehículo y eje. La usa la APK para detectar presión baja/alta y para la operación "corregir presión". Un eje vacío aplica a todos. El override por vehículo se hace desde la ficha (próximamente).</div>
        {puedeEditar && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[10px] text-slate-500">Tipo de vehículo
              <select className={`${inputCls} max-w-[200px]`} value={presTipo} onChange={(e) => setPresTipo(e.target.value)}>
                <option value="">— Selecciona —</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Eje (vacío = todos)
              <input type="number" className={`${inputCls} max-w-[110px]`} placeholder="2" value={presEje} onChange={(e) => setPresEje(e.target.value)} />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Presión (bar)
              <input type="number" step="0.1" className={`${inputCls} max-w-[110px]`} placeholder="8.5" value={presBar} onChange={(e) => setPresBar(e.target.value)} />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Margen (±bar)
              <input type="number" step="0.1" className={`${inputCls} max-w-[110px]`} placeholder="0.5" value={presMargen} onChange={(e) => setPresMargen(e.target.value)} />
            </label>
            <button onClick={guardarPresion} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+ Añadir</button>
          </div>
        )}
        {presiones.length === 0 ? (
          <div className="text-[12px] text-slate-500">Sin presiones configuradas.</div>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {presiones.map((p) => {
              const tipo = tipos.find((t) => t.id === p.tipo_vehiculo_id);
              return (
                <div key={p.id} className="flex items-center justify-between rounded bg-slate-900 px-3 py-2 text-[12px]">
                  <span className="text-slate-200">
                    {tipo ? (tipo.descripcion ?? tipo.nombre) : (p.vehiculo_id ? "Vehículo" : "—")}
                    <span className="text-slate-500"> · {p.eje != null ? `Eje ${p.eje}` : "todos los ejes"}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold text-sky-300">{p.presion_objetivo_bar} bar <span className="font-normal text-slate-500">±{p.margen_bar}</span></span>
                    {puedeEditar && (
                      <button onClick={async () => { await eliminarPresionObjetivo(p.id); await cargar(); }} className="text-rose-300 hover:underline">Eliminar</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tipos de llanta */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Tipos de llanta ({tiposLlanta.length})</div>
        <div className="mb-3 text-[11px] text-slate-500">Material y medida de llanta (pulgadas) que se pueden elegir en la ficha del vehículo.</div>
        {puedeEditar && (
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[10px] text-slate-500">Material
              <select className={`${inputCls} max-w-[120px]`} value={nuevaLlantaMat} onChange={(e) => setNuevaLlantaMat(e.target.value)}>
                <option value="aluminio">Aluminio</option>
                <option value="hierro">Hierro</option>
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Medida
              <input className={`${inputCls} max-w-[140px]`} placeholder="22.5x11.75" value={nuevaLlantaMed} onChange={(e) => setNuevaLlantaMed(e.target.value)} />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Agujeros
              <input type="number" className={`${inputCls} max-w-[90px]`} placeholder="10" value={nuevaLlantaAguj} onChange={(e) => setNuevaLlantaAguj(e.target.value)} />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500">Offset
              <select className={`${inputCls} max-w-[130px]`} value={nuevaLlantaCentrado} onChange={(e) => setNuevaLlantaCentrado(e.target.value)}>
                <option value="">—</option>
                <option value="centrada">Centrada</option>
                <option value="desplazada">Desplazada</option>
              </select>
            </label>
            <label className="flex items-center gap-1 pb-2 text-[12px] text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={nuevaLlantaTapa} onChange={(e) => setNuevaLlantaTapa(e.target.checked)} />
              Tapacubo
            </label>
            <button onClick={guardarLlanta} className="mb-1 rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+ Añadir</button>
          </div>
        )}
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {tiposLlanta.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
              <span className="flex-1">{tipoLlantaLabel(l)}</span>
              {puedeEditar && (
                <button onClick={async () => { if (window.confirm("¿Eliminar este tipo de llanta?")) { await desactivarTipoLlanta(l.id); await cargar(); } }} className="text-[10px] text-rose-400 hover:underline">borrar</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Catálogo de neumáticos (marca / modelo / medida)</div>
        <div className="mb-3 text-[11px] text-slate-500">Alimenta los desplegables del alta de neumáticos en todas las empresas. Abre "detalle" en una marca para asignar fabricante, segmento y país, y ver cuántos neumáticos/vehículos la usan.{!puedeEditar && " Solo un administrador SEA puede añadir valores."}</div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Marcas */}
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Marcas ({marcas.length})</div>
            {puedeEditar && (
              <div className="mb-2 flex gap-2">
                <input className={inputCls} placeholder="Nueva marca…" value={nuevaMarca} onChange={(e) => setNuevaMarca(e.target.value)} />
                <button onClick={guardarMarca} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {marcas.map((m) => (
                <FilaMarca key={m.id} marca={m} fabricantes={fabricantes} contadores={contadores.find((c) => c.id === m.id)}
                  seleccionada={marcaSel === m.id} puedeEditar={puedeEditar}
                  onSeleccionar={() => setMarcaSel(m.id === marcaSel ? "" : m.id)} onCambio={cargar} />
              ))}
            </div>
          </div>

          {/* Modelos */}
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">
              Modelos ({modelos.length}){marcaSel ? " · " + (marcas.find((m) => m.id === marcaSel)?.nombre ?? "") : " · todas las marcas"}
            </div>
            {puedeEditar && (
              <div className="mb-2 flex gap-2">
                <input className={inputCls} placeholder={marcaSel ? "Nuevo modelo…" : "Selecciona una marca a la izquierda…"} value={nuevoModelo} onChange={(e) => setNuevoModelo(e.target.value)} disabled={!marcaSel} />
                <button onClick={guardarModelo} disabled={!marcaSel} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">+</button>
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {modelos.length === 0 ? <div className="text-[11px] text-slate-500">Sin modelos.</div>
              : modelos.map((m) => (
                <FilaModelo key={m.id} modelo={m} puedeEditar={puedeEditar}
                  onCambio={() => listarModelos(marcaSel || undefined).then(setModelos)} />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Medidas ({medidas.length})</div>
            {puedeEditar && (
              <div className="mb-2 flex gap-2">
                <input className={inputCls} placeholder="Ej. 315/80R22.5" value={nuevaMedida} onChange={(e) => setNuevaMedida(e.target.value)} />
                <button onClick={async () => { if (!nuevaMedida.trim()) return; await crearMedida(nuevaMedida); setNuevaMedida(""); await cargar(); }} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
              </div>
            )}
            <div className="mb-1 text-[10px] text-slate-500">Click en "tipos de vehículo" para marcar con qué tipos es compatible (filtra el desplegable al montar).</div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {medidas.map((m) => <FilaMedidaCompatibilidad key={m.id} medida={m} tipos={tipos} puedeEditar={puedeEditar} />)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <ListaSimple titulo="Índice de carga" placeholder="Ej. 156" items={indicesCarga.map((x) => ({ id: x.id, valor: x.valor }))} puedeEditar={puedeEditar} onCrear={async (v) => { await crearIndiceCarga(v); await cargar(); }} />
          <ListaSimple titulo="Código de velocidad" placeholder="Ej. L" items={indicesVelocidad.map((x) => ({ id: x.id, valor: x.valor }))} puedeEditar={puedeEditar} onCrear={async (v) => { await crearIndiceVelocidad(v); await cargar(); }} />
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Motivos de montaje fuera de almacén ({motivosFueraAlmacen.length})</div>
            {puedeEditar && (
              <div className="mb-2 flex gap-2">
                <input className={inputCls} placeholder="Nuevo motivo…" value={nuevoMotivo} onChange={(e) => setNuevoMotivo(e.target.value)} />
                <button onClick={guardarMotivo} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {motivosFueraAlmacen.map((m) => <FilaMotivo key={m.id} motivo={m} puedeEditar={puedeEditar} onCambio={cargar} />)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Configuración de vehículos</div>
        <div className="mb-3 text-[11px] text-slate-500">
          Etiqueta de configuración de ejes (ej. 2x2x2, 4x2, 6x4) por tipo de vehículo — identifica qué imagen de chasis (motor gráfico) corresponde a cada tipo.
          {!puedeEditar && " Solo un administrador SEA puede editarla."}
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Tipo</th><th className={thCls}>Descripción</th><th className={thCls}>Nº ejes</th>
            <th className={thCls}>Imagen chasis</th><th className={thCls}>Configuración de ejes</th>
          </tr></thead>
          <tbody>
            {tipos.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin tipos de vehículo.</td></tr>
            : tipos.map((t) => <FilaTipoVehiculo key={t.id} tipo={t} puedeEditar={puedeEditar} onGuardado={cargar} />)}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
