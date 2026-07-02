import { useEffect, useState } from "react";
import { listarMarcas, crearMarca, listarModelos, crearModelo, listarMedidas, crearMedida } from "../services/data";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico } from "../types";
import { inputCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function Configuracion() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!perfil?.es_superadmin;

  const [marcas, setMarcas] = useState<MarcaNeumatico[]>([]);
  const [modelos, setModelos] = useState<ModeloNeumatico[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [marcaSel, setMarcaSel] = useState("");
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [nuevoModelo, setNuevoModelo] = useState("");
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    const [m, med] = await Promise.all([listarMarcas(), listarMedidas()]);
    setMarcas(m); setMedidas(med);
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
  async function guardarMedida() {
    if (!nuevaMedida.trim()) return;
    setMsg("");
    try { await crearMedida(nuevaMedida); setNuevaMedida(""); await cargar(); }
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

          {/* Medidas */}
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Medidas ({medidas.length})</div>
            {puedeEditar && (
              <div className="mb-2 flex gap-2">
                <input className={inputCls} placeholder="Ej. 315/80R22.5" value={nuevaMedida} onChange={(e) => setNuevaMedida(e.target.value)} />
                <button onClick={guardarMedida} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">+</button>
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {medidas.map((m) => <div key={m.id} className="rounded bg-slate-900 px-2 py-1 text-[12px] text-slate-300">{m.valor}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
