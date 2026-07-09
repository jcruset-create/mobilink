import { useEffect, useState } from "react";
import {
  listarMarcas, crearMarca, actualizarMarca, eliminarMarca, subirLogoMarca,
  listarModelos, crearModelo, actualizarModelo, eliminarModelo,
  listarMedidas, crearMedida,
  listarIndicesCarga, crearIndiceCarga, listarIndicesVelocidad, crearIndiceVelocidad,
  listarTiposVehiculo, actualizarConfiguracionEjes,
  listarTiposDeMedida, fijarTiposDeMedida,
  listarFabricantes, crearFabricante, actualizarFabricante, eliminarFabricante,
  listarContadoresMarcas,
  listarMotivosFueraAlmacen, crearMotivoFueraAlmacen, actualizarMotivoFueraAlmacen, eliminarMotivoFueraAlmacen,
  listarConfigEjes, crearConfigEjes, desactivarConfigEjes,
  listarTiposLlanta, crearTipoLlanta, desactivarTipoLlanta,
} from "../services/data";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad, TipoVehiculo, Fabricante, MarcaContadores, SegmentoMarca, MotivoFueraAlmacen, ConfigEjes, TipoLlanta } from "../types";
import { SEGMENTO_LABELS } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

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

  useEffect(() => { if (abierto) listarTiposDeMedida(medida.id).then(setSeleccionados); }, [abierto, medida.id]);

  async function alternar(tipoId: string) {
    const next = seleccionados.includes(tipoId) ? seleccionados.filter((x) => x !== tipoId) : [...seleccionados, tipoId];
    setSeleccionados(next);
    setSaving(true);
    try { await fijarTiposDeMedida(medida.id, next); } finally { setSaving(false); }
  }

  return (
    <div className="rounded bg-slate-900 px-2 py-1.5 text-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-slate-200">{medida.valor}</span>
        <button onClick={() => setAbierto((v) => !v)} className="text-[10px] text-sky-300 hover:underline">
          {abierto ? "cerrar" : "tipos de vehículo"}
        </button>
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
  const [saving, setSaving] = useState(false);
  async function guardar() {
    setSaving(true);
    try { await actualizarConfiguracionEjes(tipo.id, valor.trim() || null); onGuardado(); }
    finally { setSaving(false); }
  }
  return (
    <tr className="border-t border-slate-700/60">
      <td className={tdCls + " font-semibold"}>{tipo.nombre}</td>
      <td className={tdCls + " text-slate-400"}>{tipo.descripcion ?? "—"}</td>
      <td className={tdCls + " text-slate-400"}>{tipo.numero_ejes}</td>
      <td className={tdCls + " text-[11px]"}>{tipo.imagen_chasis_url ? <span className="text-emerald-400">Con imagen</span> : <span className="text-slate-500">Sin imagen</span>}</td>
      <td className={tdCls}>
        {puedeEditar ? (
          <div className="flex gap-2">
            <input className={`${inputCls} max-w-[140px] text-[12px]`} placeholder="Ej. 2x2x2" value={valor} onChange={(e) => setValor(e.target.value)} />
            <button onClick={guardar} disabled={saving || valor === (tipo.configuracion_ejes ?? "")} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50">Guardar</button>
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
  const [nuevaConfig, setNuevaConfig] = useState("");
  const [nuevaConfigDesc, setNuevaConfigDesc] = useState("");
  const [nuevaLlantaMat, setNuevaLlantaMat] = useState("acero");
  const [nuevaLlantaMed, setNuevaLlantaMed] = useState("");
  const [marcaSel, setMarcaSel] = useState("");
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [nuevoModelo, setNuevoModelo] = useState("");
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [nuevoFabricante, setNuevoFabricante] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    const [m, med, ic, iv, t, f, c, mf, ce, tl] = await Promise.all([
      listarMarcas(), listarMedidas(), listarIndicesCarga(), listarIndicesVelocidad(),
      listarTiposVehiculo(), listarFabricantes(), listarContadoresMarcas(), listarMotivosFueraAlmacen(),
      listarConfigEjes(), listarTiposLlanta(),
    ]);
    setMarcas(m); setMedidas(med); setIndicesCarga(ic); setIndicesVelocidad(iv); setTipos(t); setFabricantes(f); setContadores(c); setMotivosFueraAlmacen(mf);
    setConfigEjes(ce); setTiposLlanta(tl);
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
    try { await crearTipoLlanta(nuevaLlantaMat, nuevaLlantaMed); setNuevaLlantaMed(""); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
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
        <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {configEjes.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
              <span className="flex-1"><b>{c.nombre}</b>{c.descripcion ? ` · ${c.descripcion}` : ""}</span>
              {puedeEditar && (
                <button onClick={async () => { if (window.confirm(`¿Eliminar la configuración "${c.nombre}"?`)) { await desactivarConfigEjes(c.id); await cargar(); } }} className="text-[10px] text-rose-400 hover:underline">borrar</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tipos de llanta */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Tipos de llanta ({tiposLlanta.length})</div>
        <div className="mb-3 text-[11px] text-slate-500">Material y medida de llanta (pulgadas) que se pueden elegir en la ficha del vehículo.</div>
        {puedeEditar && (
          <div className="mb-2 flex max-w-md flex-wrap gap-2">
            <select className={`${inputCls} max-w-[130px]`} value={nuevaLlantaMat} onChange={(e) => setNuevaLlantaMat(e.target.value)}>
              <option value="acero">Acero</option>
              <option value="aluminio">Aluminio</option>
              <option value="otros">Otros</option>
            </select>
            <input className={`${inputCls} max-w-[150px]`} placeholder="22.5x11.75" value={nuevaLlantaMed} onChange={(e) => setNuevaLlantaMed(e.target.value)} />
            <button onClick={guardarLlanta} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
          </div>
        )}
        <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {tiposLlanta.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">
              <span className="flex-1">{l.material.charAt(0).toUpperCase() + l.material.slice(1)} {l.medida}</span>
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
