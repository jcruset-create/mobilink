import { useEffect, useState } from "react";
import {
  listarMarcas, crearMarca, listarModelos, crearModelo, listarMedidas, crearMedida,
  listarIndicesCarga, crearIndiceCarga, listarIndicesVelocidad, crearIndiceVelocidad,
  listarTiposVehiculo, actualizarConfiguracionEjes,
} from "../services/data";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad, TipoVehiculo } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

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
                <div key={m.id} onClick={() => setMarcaSel(m.id === marcaSel ? "" : m.id)}
                  className={`cursor-pointer rounded px-2 py-1 text-[12px] ${marcaSel === m.id ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-300"}`}>
                  {m.nombre}
                </div>
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
              : modelos.map((m) => <div key={m.id} className="rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">{m.nombre}</div>)}
            </div>
          </div>

          <ListaSimple titulo="Medidas" placeholder="Ej. 315/80R22.5" items={medidas.map((m) => ({ id: m.id, valor: m.valor }))} puedeEditar={puedeEditar} onCrear={async (v) => { await crearMedida(v); await cargar(); }} />
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
