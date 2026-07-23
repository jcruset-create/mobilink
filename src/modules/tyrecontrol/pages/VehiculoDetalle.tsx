import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obtenerVehiculo, listarPosiciones, listarMontajesVehiculo, listarMedidas, listarTiposLlanta, listarEjesVehiculo, listarRevisiones, listarDetalleRevision, listarOperaciones, listarIntervenciones } from "../services/data";
import type { Intervencion } from "../services/data";
import type { MontajeActual, PosicionVehiculo, Vehiculo, TipoLlanta, VehiculoEje, RevisionVehiculo as RevisionVehiculoT, RevisionDetalle, OperacionNeumatico } from "../types";
import { ORIGEN_KM_LABELS, tipoLlantaLabel, presionTxt, TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS, ESTADO_OPERACION_LABELS } from "../types";
import { resumenOperaciones } from "../services/resumenOperaciones";
import { Badge, Modal, TableWrap, tdCls, thCls } from "../components/ui";
import VehicleLayoutImage from "../components/VehicleLayoutImage";
import PlanoSnapshot from "../components/PlanoSnapshot";
import WebfleetVehiculo from "../components/WebfleetVehiculo";
import PlanMantenimientoVehiculo from "../components/PlanMantenimiento";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Fecha + hora de una revisión: el día de fecha_revision y la hora del
// created_at (marca de tiempo real), igual que en la pantalla de revisiones.
function fechaHora(r: RevisionVehiculoT): string {
  const fecha = r.fecha_revision ?? "";
  const hora = r.created_at ? new Date(r.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  return hora ? `${fecha} · ${hora}` : fecha;
}

export default function VehiculoDetalle() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [v, setV] = useState<Vehiculo | null>(null);
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[]>([]);
  const [montajes, setMontajes] = useState<MontajeActual[]>([]);
  const [medidasMap, setMedidasMap] = useState<Map<string, string>>(new Map());
  const [llantasMap, setLlantasMap] = useState<Map<string, TipoLlanta>>(new Map());
  const [ejes, setEjes] = useState<VehiculoEje[]>([]);
  const [revisiones, setRevisiones] = useState<RevisionVehiculoT[]>([]);
  const [fichaRevision, setFichaRevision] = useState<RevisionVehiculoT | null>(null);
  const [fichaDetalle, setFichaDetalle] = useState<RevisionDetalle[]>([]);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [operaciones, setOperaciones] = useState<OperacionNeumatico[]>([]);
  const [modalOps, setModalOps] = useState(false);
  const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
  const [verInterv, setVerInterv] = useState<null | { interv: Intervencion; ops: OperacionNeumatico[] }>(null);

  async function cargar() {
    const veh = await obtenerVehiculo(id);
    setV(veh);
    if (veh?.tipo_vehiculo_id) setPosiciones(await listarPosiciones(veh.tipo_vehiculo_id));
    setMontajes(await listarMontajesVehiculo(id));

    // Catálogos para traducir medida_id / tipo_llanta_id a etiquetas legibles.
    const [medidas, llantas] = await Promise.all([listarMedidas(), listarTiposLlanta()]);
    setMedidasMap(new Map(medidas.map((m) => [m.id, m.valor])));
    setLlantasMap(new Map(llantas.map((l) => [l.id, l])));

    setEjes(veh?.medidas_por_eje ? await listarEjesVehiculo(id) : []);
    setRevisiones(await listarRevisiones(id));
    setOperaciones(await listarOperaciones({ vehiculoId: id }).catch(() => []));
    setIntervenciones(await listarIntervenciones(id).catch(() => []));
  }

  async function abrirIntervencion(interv: Intervencion) {
    const ops = await listarOperaciones({ intervencionId: interv.id }).catch(() => []);
    setVerInterv({ interv, ops });
  }

  async function verFichaRevision(r: RevisionVehiculoT) {
    setFichaRevision(r); setCargandoFicha(true);
    try { setFichaDetalle(await listarDetalleRevision(r.id)); } finally { setCargandoFicha(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  const dato = (l: string, val?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{val || "—"}</div></div>
  );
  const medidaLabel = (mid?: string | null) => (mid ? medidasMap.get(mid) : null) ?? "—";
  const llantaLabel = (lid?: string | null) => { const l = lid ? llantasMap.get(lid) : null; return l ? tipoLlantaLabel(l) : "—"; };

  if (!v) return <div className="text-slate-400">Cargando ficha…</div>;

  const configEjesLabel = [v.config_ejes?.nombre, v.config_ejes?.descripcion].filter(Boolean).join(" · ") || "—";

  // Medida configurada del vehículo por posición (misma medida, o por eje),
  // para filtrar el almacén al montar en una posición vacía.
  const medidaPorPosicionId: Record<string, string> = {};
  {
    const ejeMedida = new Map<number, string>();
    if (v.medidas_por_eje) for (const e of ejes) { const l = medidaLabel(e.medida_id); if (l && l !== "—") ejeMedida.set(e.eje, l); }
    const def = v.medidas_por_eje ? null : medidaLabel(v.medida_id);
    for (const p of posiciones) {
      const m = v.medidas_por_eje ? ejeMedida.get(p.eje ?? -1) : (def && def !== "—" ? def : null);
      if (m) medidaPorPosicionId[p.id] = m;
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate("/tyrecontrol/vehiculos")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Vehículos</button>
        <h1 className="text-lg font-black">{v.matricula}{v.numero_unidad ? ` · Unidad ${v.numero_unidad}` : ""}</h1>
        <Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Datos generales */}
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Datos generales</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Empresa", v.empresa?.nombre)}{dato("Delegación", v.delegacion?.nombre)}
            {dato("Nº de unidad", v.numero_unidad)}
            {dato("Marca", v.marca)}{dato("Modelo", v.modelo)}
            {dato("Tipo", v.tipo?.descripcion ?? v.tipo?.nombre)}{dato("Bastidor", v.bastidor)}
            {dato("Fecha matriculación", v.fecha_matriculacion)}{dato("Webfleet ID", v.webfleet_vehicle_id)}
          </div>
        </div>

        {/* Kilometraje */}
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Kilometraje</div>
          <div className="text-3xl font-black">{Number(v.km_actual).toLocaleString("es-ES")} <span className="text-sm font-normal text-slate-400">km</span></div>
          <div className="mt-1 text-xs text-slate-500">Origen: {ORIGEN_KM_LABELS[v.origen_km]}</div>
        </div>
      </div>

      {/* Webfleet: enlazar vehículo y sincronizar km/posición */}
      {!esCliente && (
        <div className="mt-3">
          <WebfleetVehiculo vehiculo={v} onUpdated={cargar} />
        </div>
      )}

      {/* Plan de mantenimiento (revisiones periódicas) + historial */}
      <PlanMantenimientoVehiculo vehiculo={v} puedeEditar={!esCliente} />

      {/* Configuración de neumáticos */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Configuración de neumáticos</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {dato("Configuración de ejes", configEjesLabel)}
          {dato("Medidas por eje", v.medidas_por_eje ? "Sí · distintas por eje" : "No · misma medida")}
          {!v.medidas_por_eje && dato("Medida de neumático", medidaLabel(v.medida_id))}
          {!v.medidas_por_eje && dato("Tipo de llanta", llantaLabel(v.tipo_llanta_id))}
        </div>
        {v.medidas_por_eje && ejes.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] text-slate-400">Medida / llanta por eje</div>
            <div className="flex flex-wrap gap-2">
              {ejes.map((e) => (
                <div key={e.eje} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
                  <div className="text-[12px] font-bold text-sky-300">Eje {e.eje}{e.ruedas ? ` · ${e.ruedas} ruedas` : ""}</div>
                  <div className="text-[11px] text-slate-300">{medidaLabel(e.medida_id)}</div>
                  <div className="text-[10px] text-slate-500">{llantaLabel(e.tipo_llanta_id)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Plano gráfico del vehículo */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Plano del vehículo</div>
        <VehicleLayoutImage
          tipo={v.tipo}
          imagenFallback={v.config_ejes?.imagen_chasis_url ?? null}
          posiciones={posiciones}
          vehiculoId={v.id}
          empresaId={v.empresa_id}
          montajes={montajes}
          medidaPorPosicionId={medidaPorPosicionId}
          editable={!esCliente}
          puedeCalibrar={!!perfil?.es_superadmin}
          onFicha={(nid) => navigate(`/tyrecontrol/neumaticos/${nid}`)}
          onChanged={cargar}
          onTipoChanged={cargar}
        />
      </div>

      {/* Estructura de posiciones */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Estructura de posiciones ({posiciones.length})</div>
        {posiciones.length === 0 ? (
          <div className="text-sm text-slate-500">
            {v.tipo_vehiculo_id ? "Este tipo de vehículo no tiene posiciones definidas." : "Asigna un tipo de vehículo para ver sus posiciones."}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {posiciones.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-center">
                <div className="text-[13px] font-bold text-sky-300">{p.codigo_posicion}</div>
                <div className="text-[10px] text-slate-400">{p.nombre}</div>
                <div className="text-[9px] text-slate-500">Eje {p.eje ?? "—"} · {p.lado ?? ""}{p.interior_exterior ? ` · ${p.interior_exterior}` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inspecciones (revisiones del vehículo) */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Inspecciones ({revisiones.length})</div>
        {revisiones.length === 0 ? (
          <div className="text-sm text-slate-500">Este vehículo aún no tiene revisiones registradas.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {revisiones.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded bg-slate-900 px-3 py-2 text-[12px] text-slate-300">
                <span>
                  {fechaHora(r)} · {r.km_vehiculo ?? "—"} km
                  {r.tecnico_nombre ? <span className="text-slate-500"> · {r.tecnico_nombre}</span> : ""}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">{r.estado_revision}</span>
                  <button onClick={() => verFichaRevision(r)} className="text-sky-300 hover:underline">Ver ficha</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Operaciones del vehículo: informe resumido + histórico */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase text-slate-400">Operaciones ({operaciones.length})</span>
          {operaciones.length > 0 && (
            <button onClick={() => setModalOps(true)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">Ver histórico</button>
          )}
        </div>
        {(() => {
          if (operaciones.length === 0) return <div className="text-sm text-slate-500">Sin operaciones registradas.</div>;
          // Informe de la última jornada (la fecha de la operación más reciente).
          const ultimaFecha = operaciones[0]?.fecha_operacion;
          const delDia = operaciones.filter((o) => o.fecha_operacion === ultimaFecha);
          const lineas = resumenOperaciones(delDia);
          return (
            <div className="rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase text-emerald-300">Informe · {ultimaFecha}</div>
              {lineas.length === 0 ? (
                <div className="text-sm text-slate-400">Sin cambios que resumir.</div>
              ) : (
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-200 marker:text-emerald-400">
                  {lineas.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
            </div>
          );
        })()}

        {intervenciones.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Intervenciones ({intervenciones.length})</div>
            <div className="space-y-2">
              {intervenciones.map((iv) => (
                <div key={iv.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-900 p-3">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400">{iv.fecha} · {iv.n_operaciones} operación(es)</div>
                    <div className="text-sm text-slate-200">{iv.resumen_ia || iv.resumen || "—"}</div>
                  </div>
                  <button onClick={() => abrirIntervencion(iv)} className="shrink-0 rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-600/10">Visualizar</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {verInterv && (
        <Modal title={`Intervención · ${verInterv.interv.fecha}`} onClose={() => setVerInterv(null)}>
          <div className="mb-3 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase text-emerald-300">Informe</div>
            <div className="whitespace-pre-line text-sm text-slate-200">{verInterv.interv.resumen_ia || verInterv.interv.resumen || "—"}</div>
          </div>
          {verInterv.interv.incidencias && verInterv.interv.incidencias.length > 0 && (
            <div className="mb-3 rounded-lg border border-red-600/30 bg-red-500/5 p-3 text-sm">
              <div className="mb-1 text-[11px] font-semibold uppercase text-red-300">Avería de origen</div>
              <ul className="space-y-0.5 text-slate-200">
                {verInterv.interv.incidencias.map((i, k) => (
                  <li key={k}>{i.codigo ?? "—"}: <span className="text-red-300">{(i.averias ?? []).join(" · ")}</span>{i.gravedad ? ` (${i.gravedad})` : ""}</li>
                ))}
              </ul>
            </div>
          )}
          {(verInterv.interv.montaje_antes || verInterv.interv.montaje_despues) && (() => {
            const antes = verInterv.interv.montaje_antes ?? [];
            const despues = verInterv.interv.montaje_despues ?? [];
            const antesPorPos = new Map(antes.map((s) => [s.posicion_id ?? "", s]));
            const cambiadas = new Set(
              despues.filter((d) => {
                const a = antesPorPos.get(d.posicion_id ?? "");
                return !a || a.marca !== d.marca || a.medida !== d.medida || a.mm !== d.mm;
              }).map((d) => d.posicion_id ?? "")
            );
            return (
              <div className="mb-3 flex gap-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <PlanoSnapshot titulo="Antes (con la avería)" snap={antes} imagen={verInterv.interv.imagen_chasis} conAveria />
                <div className="flex items-center text-slate-500">→</div>
                <PlanoSnapshot titulo="Después" snap={despues} imagen={verInterv.interv.imagen_chasis} cambiadas={cambiadas} />
              </div>
            );
          })()}
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Tipo</th><th className={thCls}>Neumático</th><th className={thCls}>Posición</th><th className={thCls}>Motivo</th>
            </tr></thead>
            <tbody>
              {verInterv.ops.map((o) => (
                <tr key={o.id} className={`border-t border-slate-700/60 ${o.is_anulada ? "opacity-50" : ""}`}>
                  <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}{o.created_at ? " · " + new Date(o.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  <td className={tdCls + " text-slate-200"}>{TIPO_OPERACION_LABELS[o.tipo_operacion] ?? o.tipo_operacion}</td>
                  <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
                  <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}

      {fichaRevision && (
        <Modal title={`Revisión del ${fechaHora(fichaRevision)}`} onClose={() => setFichaRevision(null)}>
          <div className="mb-2 text-[12px] text-slate-400">
            {fichaRevision.km_vehiculo ?? "—"} km · Estado: {fichaRevision.estado_revision}
            {fichaRevision.tecnico_nombre ? ` · Técnico: ${fichaRevision.tecnico_nombre}` : ""}
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
                  <td className={tdCls + " text-slate-400"}>{d.no_accesible ? "—" : d.presion_bar != null ? `${presionTxt(d.presion_bar)} bar` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.estado_visual ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}

      {modalOps && (
        <Modal title="Histórico de operaciones" onClose={() => setModalOps(false)}>
          {(() => {
            const lineas = resumenOperaciones(operaciones);
            return lineas.length > 0 ? (
              <div className="mb-3 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
                <div className="mb-1 text-[11px] font-semibold uppercase text-emerald-300">Resumen general</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-200 marker:text-emerald-400">
                  {lineas.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ) : null;
          })()}
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Tipo</th><th className={thCls}>Estado</th>
              <th className={thCls}>Neumático</th><th className={thCls}>Posición</th><th className={thCls}>Motivo</th>
            </tr></thead>
            <tbody>
              {operaciones.map((o) => (
                <tr key={o.id} className={`border-t border-slate-700/60 ${o.is_anulada ? "opacity-50" : ""}`}>
                  <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}{o.created_at ? " · " + new Date(o.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  <td className={tdCls + " text-slate-200"}>{TIPO_OPERACION_LABELS[o.tipo_operacion] ?? o.tipo_operacion}{o.is_anulada ? " (anulada)" : ""}</td>
                  <td className={tdCls + " text-slate-400"}>{o.status ? ESTADO_OPERACION_LABELS[o.status] : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
                  <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}
    </div>
  );
}
