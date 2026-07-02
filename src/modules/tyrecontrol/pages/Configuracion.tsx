import { useEffect, useState } from "react";
import {
  listarMarcas, crearMarca, actualizarMarca, eliminarMarca, subirLogoMarca,
  listarModelos, crearModelo, actualizarModelo, eliminarModelo,
  listarMedidas, crearMedida,
  listarIndicesCarga, crearIndiceCarga, listarIndicesVelocidad, crearIndiceVelocidad,
  listarTiposVehiculo, actualizarConfiguracionEjes,
  listarTiposDeMedida, fijarTiposDeMedida,
} from "../services/data";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad, TipoVehiculo } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

function FilaMarca({ marca, seleccionada, puedeEditar, onSeleccionar, onCambio }: {
  marca: MarcaNeumatico; seleccionada: boolean; puedeEditar: boolean; onSeleccionar: () => void; onCambio: () => void;
}) {
  const [editando, setEditando] = useState(false);
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
            <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:underline">editar</button>
            <button onClick={borrar} className="text-[10px] text-rose-400 hover:underline">borrar</button>
          </div>
        )}
      </div>
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
  const [marcaSel, setMarcaSel] = useState("");
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [nuevoModelo, setNuevoModelo] = useState("");
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    const [m, med, ic, iv, t] = await Promise.all([listarMarcas(), listarMedidas(), listarIndicesCarga(), listarIndicesVelocidad(), listarTiposVehiculo()]);
    setMarcas(m); setMedidas(med); setIndicesCarga(ic); setIndicesVelocidad(iv); setTipos(t);
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

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Configuración</h1>
      <p className="mb-3 text-sm text-slate-400">Ajustes de la empresa y la plataforma.</p>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Catálogo de neumáticos (marca / modelo / medida)</div>
        <div className="mb-3 text-[11px] text-slate-500">Alimenta los desplegables del alta de neumáticos en todas las empresas.{!puedeEditar && " Solo un administrador SEA puede añadir valores."}</div>

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
                <FilaMarca key={m.id} marca={m} seleccionada={marcaSel === m.id} puedeEditar={puedeEditar}
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
