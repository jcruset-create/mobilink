import { useEffect, useMemo, useState } from "react";
import {
  listarEmpresas, listarVehiculos, listarPosiciones, listarMontajesVehiculo,
  crearRevision, guardarDetalleRevision, completarRevision, listarRevisiones, listarDetalleRevision,
  listarUltimasMedicionesVehiculo, listarPresionesCatalogoPorModelo, eliminarRevision,
} from "../services/data";
import type { Empresa, Vehiculo, PosicionVehiculo, MontajeActual, RevisionVehiculo as RevisionVehiculoT, RevisionDetalle } from "../types";
import { inputCls, Field, Modal, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

type Detalle = Partial<RevisionDetalle>;

export default function RevisionVehiculo() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [todosVehiculos, setTodosVehiculos] = useState<Vehiculo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [empresaId, setEmpresaId] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [vehiculoId, setVehiculoId] = useState("");
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[]>([]);
  const [montajes, setMontajes] = useState<MontajeActual[]>([]);
  const [historialRevisiones, setHistorialRevisiones] = useState<RevisionVehiculoT[]>([]);

  const [revision, setRevision] = useState<RevisionVehiculoT | null>(null);
  const [kmVehiculo, setKmVehiculo] = useState("");
  const [detalles, setDetalles] = useState<Record<string, Detalle>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [fichaRevision, setFichaRevision] = useState<RevisionVehiculoT | null>(null);
  const [fichaDetalle, setFichaDetalle] = useState<RevisionDetalle[]>([]);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [medicionesActuales, setMedicionesActuales] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});
  const [presionesCatalogo, setPresionesCatalogo] = useState<Record<string, number>>({});

  useEffect(() => {
    listarPresionesCatalogoPorModelo().then(setPresionesCatalogo).catch(() => setPresionesCatalogo({}));
  }, []);

  function referenciasDePosicion(posicionId: string) {
    const m = montajePorPosicion.get(posicionId);
    const neu = m?.neumatico;
    if (!neu) return { ultimaProfundidad: null as number | null, presionRecomendada: null as number | null };
    const medicion = medicionesActuales[neu.id];
    const ultimaProfundidad = medicion?.profundidad_mm ?? neu.profundidad_actual_mm ?? null;
    const claveCatalogo = neu.marca && neu.modelo && neu.medida ? `${neu.marca}|${neu.modelo}|${neu.medida}`.toLowerCase().replace(/\s+/g, "") : "";
    const presionRecomendada = medicion?.presion_bar ?? neu.producto_almacen?.referencia?.presion_maxima_bar ?? presionesCatalogo[claveCatalogo] ?? null;
    return { ultimaProfundidad, presionRecomendada };
  }

  async function verFichaRevision(r: RevisionVehiculoT) {
    setFichaRevision(r); setCargandoFicha(true);
    try { setFichaDetalle(await listarDetalleRevision(r.id)); } finally { setCargandoFicha(false); }
  }

  async function editarBorrador(r: RevisionVehiculoT) {
    setMsg("");
    const det = await listarDetalleRevision(r.id);
    const mapa: Record<string, Detalle> = {};
    for (const d of det) mapa[d.posicion_id] = d;
    setDetalles(mapa);
    setKmVehiculo(r.km_vehiculo != null ? String(r.km_vehiculo) : "");
    setRevision(r);
  }

  async function borrarBorrador(r: RevisionVehiculoT) {
    if (!window.confirm(`¿Eliminar el borrador de revisión del ${r.fecha_revision}? Esta acción no se puede deshacer.`)) return;
    setSaving(true); setMsg("");
    try {
      await eliminarRevision(r.id);
      setHistorialRevisiones(await listarRevisiones(vehiculoId));
      setMsg("✔ Borrador eliminado");
    } catch (e: any) { setMsg(e?.message || "Error al eliminar"); } finally { setSaving(false); }
  }

  useEffect(() => {
    if (!esCliente) { listarEmpresas().then(setEmpresas); listarVehiculos().then(setTodosVehiculos); }
    if (esCliente && perfil?.empresa_id) cargarVehiculos(perfil.empresa_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coincidencias = useMemo(() => {
    const s = busqueda.trim().toLowerCase();
    if (!s) return [];
    return todosVehiculos.filter((v) => v.matricula.toLowerCase().includes(s) || (v.numero_unidad ?? "").toLowerCase().includes(s)).slice(0, 8);
  }, [busqueda, todosVehiculos]);

  async function elegirDesdeBusqueda(v: Vehiculo) {
    setBusqueda("");
    setEmpresaId(v.empresa_id);
    setVehiculoId(""); setPosiciones([]); setMontajes([]); setRevision(null); setDetalles({});
    setVehiculos(await listarVehiculos({ empresaId: v.empresa_id }));
    await cargarVehiculo(v.id, v);
  }

  async function cargarVehiculos(emp: string) {
    setVehiculoId(""); setPosiciones([]); setMontajes([]); setRevision(null); setDetalles({});
    setVehiculos(emp ? await listarVehiculos({ empresaId: emp }) : []);
  }

  async function cargarVehiculo(vid: string, vehOverride?: Vehiculo) {
    setVehiculoId(vid); setRevision(null); setDetalles({});
    const veh = vehOverride ?? vehiculos.find((v) => v.id === vid);
    if (!veh) { setPosiciones([]); setMontajes([]); return; }
    setKmVehiculo(veh.km_actual != null ? String(veh.km_actual) : "");
    const [pos, mon, hist, medic] = await Promise.all([
      veh.tipo_vehiculo_id ? listarPosiciones(veh.tipo_vehiculo_id) : Promise.resolve([]),
      listarMontajesVehiculo(vid),
      listarRevisiones(vid),
      listarUltimasMedicionesVehiculo(vid),
    ]);
    setPosiciones(pos); setMontajes(mon); setHistorialRevisiones(hist); setMedicionesActuales(medic);
  }

  const montajePorPosicion = useMemo(() => {
    const m = new Map<string, MontajeActual>();
    for (const x of montajes) m.set(x.posicion_id, x);
    return m;
  }, [montajes]);

  async function iniciarRevision() {
    if (!vehiculoId || !empresaId) return;
    setSaving(true); setMsg("");
    try {
      const r = await crearRevision({ empresaId, vehiculoId, kmVehiculo: kmVehiculo ? Number(kmVehiculo) : null, tecnicoId: perfil?.id ?? null });
      setRevision(r);
      const inicial: Record<string, Detalle> = {};
      posiciones.forEach((p) => {
        inicial[p.id] = { posicion_id: p.id, neumatico_id: montajePorPosicion.get(p.id)?.neumatico_id ?? null };
      });
      setDetalles(inicial);
    } catch (e: any) { setMsg(e?.message || "Error al crear la revisión"); } finally { setSaving(false); }
  }

  function set(posicionId: string, patch: Partial<Detalle>) {
    setDetalles((prev) => ({ ...prev, [posicionId]: { ...prev[posicionId], posicion_id: posicionId, ...patch } }));
  }

  async function guardarBorrador() {
    if (!revision) return;
    setSaving(true); setMsg("");
    try {
      for (const p of posiciones) {
        const d = detalles[p.id];
        if (!d) continue;
        await guardarDetalleRevision({
          revision_id: revision.id, empresa_id: empresaId, vehiculo_id: vehiculoId, posicion_id: p.id,
          neumatico_id: d.neumatico_id ?? null,
          profundidad_mm: d.profundidad_mm ?? null, presion_bar: d.presion_bar ?? null, temperatura: d.temperatura ?? null,
          metodo_profundidad: d.profundidad_mm != null ? "manual" : null, metodo_presion: d.presion_bar != null ? "manual" : null,
          estado_visual: d.estado_visual ?? null, observaciones: d.observaciones ?? null,
          no_accesible: !!d.no_accesible, neumatico_ausente: !!d.neumatico_ausente,
        });
      }
      setMsg("✔ Borrador guardado");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setSaving(false); }
  }

  async function finalizar() {
    if (!revision) return;
    const faltan = posiciones.filter((p) => {
      const d = detalles[p.id];
      const ocupado = !!montajePorPosicion.get(p.id);
      if (!ocupado || d?.no_accesible || d?.neumatico_ausente) return false;
      return d?.profundidad_mm == null && d?.presion_bar == null;
    });
    if (faltan.length > 0) {
      setMsg(`Faltan posiciones por medir: ${faltan.map((p) => p.codigo_posicion).join(", ")}. Márcalas como "no accesible" si no se pueden medir, o complétalas.`);
      return;
    }
    setSaving(true); setMsg("");
    try {
      await guardarBorrador();
      await completarRevision(revision.id);
      setMsg("✔ Revisión completada");
      const hist = await listarRevisiones(vehiculoId);
      setHistorialRevisiones(hist);
      setRevision(null); setDetalles({});
    } catch (e: any) { setMsg(e?.message || "Error al finalizar"); } finally { setSaving(false); }
  }

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Revisión de vehículo</h1>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex flex-wrap items-start gap-2">
        {!esCliente && (
          <div className="relative">
            <input
              className={`${inputCls} w-56`}
              placeholder="Buscar matrícula o nº unidad…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {coincidencias.length > 0 && (
              <div className="absolute z-10 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
                {coincidencias.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => elegirDesdeBusqueda(v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] text-slate-200 hover:bg-slate-700"
                  >
                    <span className="font-bold">{v.matricula}</span>
                    <span className="text-slate-400">{v.numero_unidad ? `Unidad ${v.numero_unidad}` : ""} · {v.empresa?.nombre ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!esCliente && (
          <select className={`${inputCls} w-auto`} value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); cargarVehiculos(e.target.value); }}>
            <option value="">Selecciona empresa…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={vehiculoId} onChange={(e) => cargarVehiculo(e.target.value)} disabled={!empresaId}>
          <option value="">Selecciona vehículo…</option>
          {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}{v.numero_unidad ? ` · ${v.numero_unidad}` : ""}</option>)}
        </select>
      </div>

      {!vehiculoId ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-10 text-center text-sm text-slate-500">Selecciona empresa y vehículo.</div>
      ) : !revision ? (
        <div className="rounded-lg bg-slate-800 p-4">
          <Field label="Km actuales del vehículo">
            <input type="number" className={`${inputCls} max-w-xs`} value={kmVehiculo} onChange={(e) => setKmVehiculo(e.target.value)} />
          </Field>
          <button onClick={iniciarRevision} disabled={saving} className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Iniciar revisión</button>

          {historialRevisiones.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Revisiones anteriores</div>
              <div className="flex flex-col gap-1">
                {historialRevisiones.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded bg-slate-900 px-3 py-2 text-[12px] text-slate-300">
                    <span>{r.fecha_revision} · {r.km_vehiculo ?? "—"} km</span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500">{r.estado_revision}</span>
                      <button onClick={() => verFichaRevision(r)} className="text-sky-300 hover:underline">Ver ficha</button>
                      {r.estado_revision === "borrador" && (
                        <>
                          <button onClick={() => editarBorrador(r)} className="text-amber-300 hover:underline">Editar</button>
                          <button onClick={() => borrarBorrador(r)} disabled={saving} className="text-rose-400 hover:underline disabled:opacity-50">Eliminar</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-800 p-3 text-sm">
            <span>Revisión en curso · {new Date().toLocaleDateString("es-ES")} · {kmVehiculo} km</span>
            <div className="flex gap-2">
              <button onClick={guardarBorrador} disabled={saving} className="rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200 disabled:opacity-50">Guardar borrador</button>
              <button onClick={finalizar} disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Finalizar revisión</button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {posiciones.map((p) => {
              const m = montajePorPosicion.get(p.id);
              const d = detalles[p.id] ?? {};
              const { ultimaProfundidad, presionRecomendada } = referenciasDePosicion(p.id);
              return (
                <div key={p.id} className="rounded-lg bg-slate-800 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[13px] font-bold text-sky-300">{p.codigo_posicion}</span>
                    {d.alerta_generada && <span className="rounded-full bg-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-200">Alerta</span>}
                  </div>
                  <div className="mb-1 text-[11px] text-slate-400">
                    {m?.neumatico ? `${m.neumatico.numero_interno ?? m.neumatico.codigo_interno} · ${m.neumatico.marca ?? ""} ${m.neumatico.medida ?? ""}` : "Sin neumático montado"}
                  </div>
                  {m?.neumatico && (
                    <div className="mb-2 text-[10px] text-slate-500">
                      Última medición: {ultimaProfundidad != null ? `${ultimaProfundidad} mm` : "—"} · Presión recomendada: {presionRecomendada != null ? `${presionRecomendada} bar` : "—"}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Profundidad (mm)">
                      <input type="number" step="0.1" className={inputCls} value={d.profundidad_mm ?? ""} disabled={d.no_accesible || d.neumatico_ausente}
                        onChange={(e) => set(p.id, { profundidad_mm: e.target.value === "" ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label="Presión (bar)">
                      <input type="number" step="0.1" className={inputCls} value={d.presion_bar ?? ""} disabled={d.no_accesible || d.neumatico_ausente}
                        onChange={(e) => set(p.id, { presion_bar: e.target.value === "" ? null : Number(e.target.value) })} />
                    </Field>
                  </div>
                  <Field label="Estado visual">
                    <input className={inputCls} value={d.estado_visual ?? ""} disabled={d.no_accesible || d.neumatico_ausente}
                      onChange={(e) => set(p.id, { estado_visual: e.target.value })} placeholder="Correcto, desgaste irregular…" />
                  </Field>
                  <Field label="Observaciones">
                    <input className={inputCls} value={d.observaciones ?? ""} onChange={(e) => set(p.id, { observaciones: e.target.value })} />
                  </Field>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!d.no_accesible} onChange={(e) => set(p.id, { no_accesible: e.target.checked })} />
                      No accesible
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!d.neumatico_ausente} onChange={(e) => set(p.id, { neumatico_ausente: e.target.checked })} />
                      Neumático ausente
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fichaRevision && (
        <Modal title={`Revisión del ${fichaRevision.fecha_revision}`} onClose={() => setFichaRevision(null)}>
          <div className="mb-2 text-[12px] text-slate-400">
            {fichaRevision.km_vehiculo ?? "—"} km · Estado: {fichaRevision.estado_revision}
            {fichaRevision.observaciones ? ` · ${fichaRevision.observaciones}` : ""}
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Posición</th><th className={thCls}>Neumático</th><th className={thCls}>Profundidad</th>
              <th className={thCls}>Presión</th><th className={thCls}>Estado visual</th><th className={thCls}>Observaciones</th>
            </tr></thead>
            <tbody>
              {cargandoFicha ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Cargando…</td></tr>
              : fichaDetalle.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin datos.</td></tr>
              : fichaDetalle.map((d) => (
                <tr key={d.id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}>{d.posicion?.codigo_posicion ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.neumatico ? (d.neumatico.numero_interno ?? d.neumatico.codigo_interno) : (d.neumatico_ausente ? "Ausente" : "—")}</td>
                  <td className={tdCls + " text-slate-400"}>{d.no_accesible ? "No accesible" : d.profundidad_mm != null ? `${d.profundidad_mm} mm` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.no_accesible ? "—" : d.presion_bar != null ? `${d.presion_bar} bar` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.estado_visual ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}
    </div>
  );
}
