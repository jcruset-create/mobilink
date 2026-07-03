import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarEmpresas, listarVehiculos, listarPosiciones, listarMontajesVehiculo,
  listarNeumaticosDisponibles, montarNeumatico, desmontarNeumatico, montarFueraAlmacen,
  listarMarcas, listarModelos, listarReferenciasDeModelo, listarMotivosFueraAlmacen,
} from "../services/data";
import type {
  Empresa, Vehiculo, PosicionVehiculo, MontajeActual, Neumatico, MotivoDesmontaje, DestinoDesmontaje,
  MarcaNeumatico, ModeloNeumatico, ReferenciaNeumatico, MotivoFueraAlmacen,
} from "../types";
import { MOTIVO_DESMONTAJE_LABELS } from "../types";
import { Modal, inputCls, Field } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function MontajesActuales() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const navigate = useNavigate();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [empresaId, setEmpresaId] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [vehiculoId, setVehiculoId] = useState("");
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[]>([]);
  const [montajes, setMontajes] = useState<MontajeActual[]>([]);
  const [disponibles, setDisponibles] = useState<Neumatico[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [montarModal, setMontarModal] = useState<null | { posicion: PosicionVehiculo }>(null);
  const [mForm, setMForm] = useState({ neumaticoId: "", km: "", fecha: "", obs: "" });
  const [origenMontaje, setOrigenMontaje] = useState<"almacen" | "fuera">("almacen");
  const [fForm, setFForm] = useState({
    marca: "", modelo: "", medida: "", indiceCarga: "", indiceVelocidad: "", profundidadActual: "", motivo: "",
  });
  const [catMarcas, setCatMarcas] = useState<MarcaNeumatico[]>([]);
  const [catModelos, setCatModelos] = useState<ModeloNeumatico[]>([]);
  const [catReferencias, setCatReferencias] = useState<ReferenciaNeumatico[]>([]);
  const [catMotivos, setCatMotivos] = useState<MotivoFueraAlmacen[]>([]);
  const [fMarcaId, setFMarcaId] = useState("");
  const [fModeloId, setFModeloId] = useState("");
  const [fReferenciaId, setFReferenciaId] = useState("");
  const [desmontarModal, setDesmontarModal] = useState<null | { montaje: MontajeActual }>(null);
  const [dForm, setDForm] = useState({ km: "", motivo: "desgaste" as MotivoDesmontaje, destino: "almacen" as DestinoDesmontaje, obs: "" });

  useEffect(() => {
    listarEmpresas().then(setEmpresas);
    if (esCliente && perfil?.empresa_id) cargarVehiculos(perfil.empresa_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarVehiculos(emp: string) {
    setVehiculoId(""); setPosiciones([]); setMontajes([]);
    setVehiculos(emp ? await listarVehiculos({ empresaId: emp }) : []);
  }

  async function cargarVehiculo(vid: string) {
    setVehiculoId(vid);
    const veh = vehiculos.find((v) => v.id === vid);
    if (!veh) { setPosiciones([]); setMontajes([]); return; }
    const [pos, mon] = await Promise.all([
      veh.tipo_vehiculo_id ? listarPosiciones(veh.tipo_vehiculo_id) : Promise.resolve([]),
      listarMontajesVehiculo(vid),
    ]);
    setPosiciones(pos); setMontajes(mon);
  }

  const montajePorPosicion = useMemo(() => {
    const m = new Map<string, MontajeActual>();
    for (const x of montajes) m.set(x.posicion_id, x);
    return m;
  }, [montajes]);

  async function abrirMontar(posicion: PosicionVehiculo) {
    setMsg(""); setMForm({ neumaticoId: "", km: "", fecha: new Date().toISOString().slice(0, 10), obs: "" });
    setFForm({ marca: "", modelo: "", medida: "", indiceCarga: "", indiceVelocidad: "", profundidadActual: "", motivo: "" });
    setFMarcaId(""); setFModeloId(""); setFReferenciaId(""); setCatModelos([]); setCatReferencias([]);
    setOrigenMontaje("almacen");
    const [disp, marcas, motivos] = await Promise.all([listarNeumaticosDisponibles(empresaId), listarMarcas(), listarMotivosFueraAlmacen()]);
    setDisponibles(disp); setCatMarcas(marcas); setCatMotivos(motivos);
    setMontarModal({ posicion });
  }

  async function elegirMarcaFueraAlmacen(marcaId: string) {
    setFMarcaId(marcaId); setFModeloId(""); setFReferenciaId(""); setCatReferencias([]);
    setCatModelos(marcaId ? await listarModelos(marcaId) : []);
  }

  async function elegirModeloFueraAlmacen(modeloId: string) {
    setFModeloId(modeloId); setFReferenciaId("");
    setCatReferencias(modeloId ? await listarReferenciasDeModelo(modeloId) : []);
  }

  function elegirReferenciaFueraAlmacen(referenciaId: string) {
    setFReferenciaId(referenciaId);
    const ref = catReferencias.find((r) => r.id === referenciaId);
    const marca = catMarcas.find((m) => m.id === fMarcaId);
    const modelo = catModelos.find((m) => m.id === fModeloId);
    if (!ref) return;
    setFForm({
      ...fForm,
      marca: marca?.nombre || "", modelo: modelo?.nombre || "",
      medida: ref.tyre_size?.medida || "", indiceCarga: ref.tyre_size?.indice_carga_doble
        ? `${ref.tyre_size.indice_carga_simple}/${ref.tyre_size.indice_carga_doble}` : (ref.tyre_size?.indice_carga_simple || ""),
      indiceVelocidad: ref.tyre_size?.codigo_velocidad || "",
    });
  }

  async function confirmarMontar() {
    if (!montarModal) return;
    if (origenMontaje === "fuera") {
      if (!fForm.medida.trim()) { setMsg("Indica al menos la medida del neumático"); return; }
      if (!fForm.motivo.trim()) { setMsg("Indica el motivo (por qué se monta sin pasar por almacén)"); return; }
      setSaving(true);
      try {
        await montarFueraAlmacen({
          vehiculoId, posicionId: montarModal.posicion.id, controlIndividual: false,
          datos: {
            marca: fForm.marca, modelo: fForm.modelo, medida: fForm.medida,
            indice_carga: fForm.indiceCarga, indice_velocidad: fForm.indiceVelocidad,
            profundidad_actual_mm: fForm.profundidadActual,
          },
          motivo: fForm.motivo, km: mForm.km ? Number(mForm.km) : null, fecha: mForm.fecha || null, observaciones: mForm.obs || null,
        });
        setMontarModal(null); setMsg("✔ Montado"); await cargarVehiculo(vehiculoId);
      } catch (e: any) { setMsg(e?.message || "Error al montar"); } finally { setSaving(false); }
      return;
    }
    if (!mForm.neumaticoId) { setMsg("Selecciona un neumático"); return; }
    setSaving(true);
    try {
      await montarNeumatico({
        vehiculoId, neumaticoId: mForm.neumaticoId, posicionId: montarModal.posicion.id,
        km: mForm.km ? Number(mForm.km) : null, fecha: mForm.fecha || null, observaciones: mForm.obs || null,
      });
      setMontarModal(null); setMsg("✔ Montado"); await cargarVehiculo(vehiculoId);
    } catch (e: any) { setMsg(e?.message || "Error al montar"); } finally { setSaving(false); }
  }

  async function confirmarDesmontar() {
    if (!desmontarModal) return;
    setSaving(true);
    try {
      await desmontarNeumatico({
        montajeId: desmontarModal.montaje.id, km: dForm.km ? Number(dForm.km) : null,
        motivo: dForm.motivo, destino: dForm.destino, observaciones: dForm.obs || null,
      });
      setDesmontarModal(null); setMsg("✔ Desmontado"); await cargarVehiculo(vehiculoId);
    } catch (e: any) { setMsg(e?.message || "Error al desmontar"); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Montajes actuales</h1>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex flex-wrap gap-2">
        {!esCliente && (
          <select className={`${inputCls} w-auto`} value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); cargarVehiculos(e.target.value); }}>
            <option value="">Selecciona empresa…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={vehiculoId} onChange={(e) => cargarVehiculo(e.target.value)} disabled={!empresaId}>
          <option value="">Selecciona vehículo…</option>
          {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula} · {v.tipo?.nombre ?? ""}</option>)}
        </select>
      </div>

      {!vehiculoId ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-10 text-center text-sm text-slate-500">Selecciona empresa y vehículo para ver sus posiciones.</div>
      ) : posiciones.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-10 text-center text-sm text-slate-500">Este vehículo no tiene tipo/posiciones definidas.</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {posiciones.map((p) => {
            const m = montajePorPosicion.get(p.id);
            return (
              <div key={p.id} className="rounded-lg bg-slate-800 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-sky-300">{p.codigo_posicion}</span>
                  <span className="text-[10px] text-slate-500">Eje {p.eje ?? "—"} · {p.lado ?? ""}{p.interior_exterior ? `·${p.interior_exterior}` : ""}</span>
                </div>
                {m ? (
                  <div>
                    <div className="rounded bg-slate-900 p-2 text-[12px]">
                      <div className="font-bold">{m.neumatico?.codigo_interno ?? m.neumatico?.numero_serie ?? "Neumático"}</div>
                      <div className="text-slate-400">{m.neumatico?.marca ?? ""} {m.neumatico?.medida ?? ""}</div>
                      <div className="text-[10px] text-slate-500">Desde {m.fecha_montaje}{m.km_montaje != null ? ` · ${m.km_montaje} km` : ""}</div>
                    </div>
                    {!esCliente && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => { setDForm({ km: "", motivo: "desgaste", destino: "almacen", obs: "" }); setDesmontarModal({ montaje: m }); }} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">Desmontar</button>
                        {m.neumatico && <button onClick={() => navigate(`/tyrecontrol/neumaticos/${m.neumatico!.id}`)} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200">Ficha</button>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="rounded border border-dashed border-slate-600 p-2 text-center text-[11px] text-slate-500">Posición libre</div>
                    {!esCliente && <button onClick={() => abrirMontar(p)} className="mt-2 w-full rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">Montar</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal montar */}
      {montarModal && (
        <Modal title={`Montar en ${montarModal.posicion.codigo_posicion}`} onClose={() => setMontarModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setMontarModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={confirmarMontar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Montar</button>
          </div>}>
          <div className="grid gap-2">
            <div className="flex gap-2 rounded-lg bg-slate-900 p-1 text-[11px] font-bold">
              <button type="button" onClick={() => setOrigenMontaje("almacen")}
                className={`flex-1 rounded px-2 py-1.5 ${origenMontaje === "almacen" ? "bg-sky-600 text-white" : "text-slate-400"}`}>
                Desde almacén
              </button>
              <button type="button" onClick={() => setOrigenMontaje("fuera")}
                className={`flex-1 rounded px-2 py-1.5 ${origenMontaje === "fuera" ? "bg-amber-600 text-white" : "text-slate-400"}`}>
                Ya montado (sin almacén)
              </button>
            </div>

            {origenMontaje === "almacen" ? (
              <Field label="Neumático disponible (almacén)">
                <select className={inputCls} value={mForm.neumaticoId} onChange={(e) => setMForm({ ...mForm, neumaticoId: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {disponibles.map((n) => <option key={n.id} value={n.id}>{(n.codigo_interno ?? n.numero_serie ?? n.id)} · {n.marca ?? ""} {n.medida ?? ""}</option>)}
                </select>
                {disponibles.length === 0 && <div className="mt-1 text-[11px] text-amber-300">No hay neumáticos en almacén para esta empresa.</div>}
              </Field>
            ) : (
              <div className="grid gap-2 rounded-lg bg-slate-900 p-2">
                <div className="text-[11px] text-slate-400">
                  Para dar de alta el neumático que ya lleva montado el vehículo, sin descontarlo del almacén.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Marca (catálogo)">
                    <select className={inputCls} value={fMarcaId} onChange={(e) => elegirMarcaFueraAlmacen(e.target.value)}>
                      <option value="">Selecciona…</option>
                      {catMarcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>
                  </Field>
                  <Field label="Modelo (catálogo)">
                    <select className={inputCls} value={fModeloId} onChange={(e) => elegirModeloFueraAlmacen(e.target.value)} disabled={!fMarcaId}>
                      <option value="">Selecciona…</option>
                      {catModelos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Medida (catálogo) *">
                  <select className={inputCls} value={fReferenciaId} onChange={(e) => elegirReferenciaFueraAlmacen(e.target.value)} disabled={!fModeloId}>
                    <option value="">Selecciona…</option>
                    {catReferencias.map((r) => <option key={r.id} value={r.id}>{r.tyre_size?.referencia_completa || r.referencia_completa}</option>)}
                  </select>
                  {fModeloId && catReferencias.length === 0 && <div className="mt-1 text-[11px] text-amber-300">Este modelo no tiene medidas en el catálogo.</div>}
                </Field>
                <Field label="Profundidad actual (mm)">
                  <input type="number" step="0.1" className={inputCls} value={fForm.profundidadActual} onChange={(e) => setFForm({ ...fForm, profundidadActual: e.target.value })} />
                </Field>
                <Field label="Motivo *">
                  <select className={inputCls} value={fForm.motivo} onChange={(e) => setFForm({ ...fForm, motivo: e.target.value })}>
                    <option value="">Selecciona…</option>
                    {catMotivos.map((m) => <option key={m.id} value={m.motivo}>{m.motivo}</option>)}
                  </select>
                  {catMotivos.length === 0 && <div className="mt-1 text-[11px] text-amber-300">No hay motivos configurados. Añádelos en Configuración.</div>}
                </Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Km montaje"><input type="number" className={inputCls} value={mForm.km} onChange={(e) => setMForm({ ...mForm, km: e.target.value })} /></Field>
              <Field label="Fecha montaje"><input type="date" className={inputCls} value={mForm.fecha} onChange={(e) => setMForm({ ...mForm, fecha: e.target.value })} /></Field>
            </div>
            <Field label="Observaciones"><input className={inputCls} value={mForm.obs} onChange={(e) => setMForm({ ...mForm, obs: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {/* Modal desmontar */}
      {desmontarModal && (
        <Modal title="Desmontar neumático" onClose={() => setDesmontarModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setDesmontarModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={confirmarDesmontar} disabled={saving} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Desmontar</button>
          </div>}>
          <div className="grid gap-2">
            <Field label="Km desmontaje"><input type="number" className={inputCls} value={dForm.km} onChange={(e) => setDForm({ ...dForm, km: e.target.value })} /></Field>
            <Field label="Motivo">
              <select className={inputCls} value={dForm.motivo} onChange={(e) => setDForm({ ...dForm, motivo: e.target.value as MotivoDesmontaje })}>
                {(Object.keys(MOTIVO_DESMONTAJE_LABELS) as MotivoDesmontaje[]).map((m) => <option key={m} value={m}>{MOTIVO_DESMONTAJE_LABELS[m]}</option>)}
              </select>
            </Field>
            <Field label="Destino del neumático">
              <select className={inputCls} value={dForm.destino} onChange={(e) => setDForm({ ...dForm, destino: e.target.value as DestinoDesmontaje })}>
                <option value="almacen">Vuelve a almacén</option>
                <option value="reparacion">Reparación</option>
                <option value="descartado">Descarte</option>
              </select>
            </Field>
            <Field label="Observaciones"><input className={inputCls} value={dForm.obs} onChange={(e) => setDForm({ ...dForm, obs: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
