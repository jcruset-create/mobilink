import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarVehiculos, crearVehiculo, actualizarVehiculo, listarEmpresas, listarDelegaciones, listarTiposVehiculo,
  listarConfigEjes, listarTiposLlanta, listarMedidas, listarEjesVehiculo, guardarEjesVehiculo,
  listarEstadoWebfleet, sincronizarWebfleet, listarRevisionEstado,
} from "../services/data";
import type {
  Delegacion, Empresa, TipoVehiculo, Vehiculo, VehiculoInput, OrigenKm,
  ConfigEjes, TipoLlanta, MedidaNeumatico, VehiculoEje,
  EstadoWebfleet, VehiculoWebfleetEstado, RevisionEstado,
} from "../types";
import { ORIGEN_KM_LABELS, tipoLlantaLabel, ESTADO_WEBFLEET_LABELS, ESTADO_WEBFLEET_BADGE, ESTADO_WEBFLEET_PUNTO } from "../types";
import { Badge, Modal, TableWrap, tdCls, thCls, inputCls, TextField, Field } from "../components/ui";

// "hace X" legible a partir de un ISO (para tiempo en base / última posición).
function duracionDesde(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
function fechaHoraCorta(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const VACIO: VehiculoInput = {
  empresa_id: "", delegacion_id: null, tipo_vehiculo_id: null, matricula: "", numero_unidad: "",
  marca: "", modelo: "", bastidor: "", fecha_matriculacion: null, webfleet_vehicle_id: "",
  km_actual: 0, origen_km: "manual", activo: true,
  config_ejes_id: null, medida_id: null, tipo_llanta_id: null, medidas_por_eje: false,
  revision_intervalo_dias: null, revision_intervalo_km: null,
};

// "2x2x2" → [2,2,2] (nº de ejes y ruedas por eje)
function ruedasDeConfig(nombre: string | undefined): number[] {
  if (!nombre) return [];
  return nombre.split(/x/i).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

type ModalState = { id: string | null; draft: VehiculoInput; ejes: VehiculoEje[] };

export default function Vehiculos() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  const [configEjes, setConfigEjes] = useState<ConfigEjes[]>([]);
  const [tiposLlanta, setTiposLlanta] = useState<TipoLlanta[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // filtros
  const [q, setQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fDele, setFDele] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState<"todos" | "activos" | "inactivos">("todos");

  const [modal, setModal] = useState<null | ModalState>(null);
  const [saving, setSaving] = useState(false);

  // Webfleet: estado por vehículo, estado de revisión, filtros y popup.
  const [estados, setEstados] = useState<Map<string, VehiculoWebfleetEstado>>(new Map());
  const [revEstados, setRevEstados] = useState<Map<string, RevisionEstado>>(new Map());
  const [sincronizando, setSincronizando] = useState(false);
  const [fWebfleet, setFWebfleet] = useState<"" | "en_base" | "en_ruta" | "pend_base" | "venc_base">("");
  const [popup, setPopup] = useState<null | { v: Vehiculo; est: VehiculoWebfleetEstado }>(null);

  async function refrescarWebfleet() {
    try {
      const [est, rev] = await Promise.all([listarEstadoWebfleet(), listarRevisionEstado()]);
      setEstados(new Map(est.map((e) => [e.vehiculo_id, e])));
      setRevEstados(new Map(rev.map((r) => [r.vehiculo_id, r])));
    } catch { /* módulo Webfleet aún no migrado: se ignora */ }
  }

  // Revisión pendiente = sin revisión, vencida o próxima. Vencida = sin revisión o vencida.
  const esPendiente = (id: string) => { const e = revEstados.get(id)?.estado; return e === "sin_revision" || e === "vencida" || e === "proxima"; };
  const esVencida = (id: string) => { const e = revEstados.get(id)?.estado; return e === "sin_revision" || e === "vencida"; };
  const revisarEnBase = (id: string) => estadoDe(id) === "en_base" && esPendiente(id);

  async function cargar() {
    setLoading(true);
    try {
      const [v, e, d, t, c, l, m] = await Promise.all([
        listarVehiculos(), listarEmpresas(), listarDelegaciones(), listarTiposVehiculo(),
        listarConfigEjes(), listarTiposLlanta(), listarMedidas(),
      ]);
      setItems(v); setEmpresas(e); setDelegaciones(d); setTipos(t);
      setConfigEjes(c); setTiposLlanta(l); setMedidas(m);
    } catch (er: any) { setMsg(er?.message || "Error cargando"); }
    finally { setLoading(false); }
    await refrescarWebfleet();
  }
  useEffect(() => { void cargar(); }, []);

  async function sincronizar() {
    setSincronizando(true); setMsg("");
    try {
      const r = await sincronizarWebfleet();
      if (r.error) setMsg(`Webfleet: ${r.error}`);
      else { await refrescarWebfleet(); setMsg(`✔ Webfleet sincronizado (${r.actualizados ?? 0} vehículos)`); }
    } catch (e: any) { setMsg(e?.message || "Error al sincronizar"); }
    finally { setSincronizando(false); }
  }

  const estadoDe = (id: string): EstadoWebfleet => estados.get(id)?.estado ?? "sin_dispositivo";

  // KPIs: en base, pendientes en base, vencidas en base, en ruta, sin conexión.
  const kpis = useMemo(() => {
    let en_base = 0, pend_base = 0, venc_base = 0, en_ruta = 0, sin_conexion = 0;
    for (const v of items) {
      const e = estados.get(v.id)?.estado ?? "sin_dispositivo";
      if (e === "en_ruta") en_ruta++;
      else if (e === "sin_conexion") sin_conexion++;
      else if (e === "en_base") {
        en_base++;
        const r = revEstados.get(v.id)?.estado;
        if (r === "sin_revision" || r === "vencida" || r === "proxima") pend_base++;
        if (r === "sin_revision" || r === "vencida") venc_base++;
      }
    }
    return { en_base, pend_base, venc_base, en_ruta, sin_conexion };
  }, [items, estados, revEstados]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((v) => {
      if (fEmpresa && v.empresa_id !== fEmpresa) return false;
      if (fDele && v.delegacion_id !== fDele) return false;
      if (fTipo && v.tipo_vehiculo_id !== fTipo) return false;
      if (fEstado === "activos" && !v.activo) return false;
      if (fEstado === "inactivos" && v.activo) return false;
      if (fWebfleet === "en_base" && estadoDe(v.id) !== "en_base") return false;
      if (fWebfleet === "en_ruta" && estadoDe(v.id) !== "en_ruta") return false;
      if (fWebfleet === "pend_base" && !revisarEnBase(v.id)) return false;
      if (fWebfleet === "venc_base" && !(estadoDe(v.id) === "en_base" && esVencida(v.id))) return false;
      if (s && !v.matricula.toLowerCase().includes(s) && !(v.numero_unidad ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, fEmpresa, fDele, fTipo, fEstado, fWebfleet, estados, revEstados]);

  const delegacionesForm = useMemo(
    () => delegaciones.filter((d) => !modal?.draft.empresa_id || d.empresa_id === modal.draft.empresa_id),
    [delegaciones, modal?.draft.empresa_id]
  );

  // Recalcula las filas de ejes a partir de la configuración elegida,
  // conservando la medida/llanta ya seleccionada por eje.
  function sincronizarEjes(configId: string | null | undefined, previos: VehiculoEje[]): VehiculoEje[] {
    const conf = configEjes.find((c) => c.id === configId);
    const ruedas = ruedasDeConfig(conf?.nombre);
    return ruedas.map((r, i) => {
      const prev = previos.find((e) => e.eje === i + 1);
      return { eje: i + 1, ruedas: r, medida_id: prev?.medida_id ?? null, tipo_llanta_id: prev?.tipo_llanta_id ?? null };
    });
  }

  async function abrirEditar(v: Vehiculo) {
    let ejes: VehiculoEje[] = [];
    if (v.medidas_por_eje) {
      try {
        const guardados = await listarEjesVehiculo(v.id);
        ejes = sincronizarEjes(v.config_ejes_id, guardados);
      } catch { /* sin ejes guardados */ }
    }
    setModal({ id: v.id, draft: { ...VACIO, ...v }, ejes });
  }

  // Cambia la configuración de ejes y re-sincroniza el desglose
  function cambiarConfig(configId: string | null) {
    if (!modal) return;
    setModal({
      ...modal,
      draft: { ...modal.draft, config_ejes_id: configId },
      ejes: modal.draft.medidas_por_eje ? sincronizarEjes(configId, modal.ejes) : modal.ejes,
    });
  }

  // Activa/desactiva el desglose por eje
  function cambiarPorEje(activo: boolean) {
    if (!modal) return;
    setModal({
      ...modal,
      draft: { ...modal.draft, medidas_por_eje: activo },
      ejes: activo ? sincronizarEjes(modal.draft.config_ejes_id, modal.ejes) : modal.ejes,
    });
  }

  async function guardar() {
    if (!modal) return;
    const d = modal.draft;
    if (!d.empresa_id) { setMsg("Selecciona empresa"); return; }
    if (!d.matricula.trim()) { setMsg("La matrícula es obligatoria"); return; }
    setSaving(true);
    try {
      let vehiculoId = modal.id;
      if (vehiculoId) await actualizarVehiculo(vehiculoId, d);
      else vehiculoId = await crearVehiculo(d);
      if (d.medidas_por_eje && vehiculoId) {
        await guardarEjesVehiculo(vehiculoId, modal.ejes);
      }
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un vehículo con esa matrícula en la empresa." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  const set = (p: Partial<VehiculoInput>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } });
  const setEje = (eje: number, p: Partial<VehiculoEje>) =>
    modal && setModal({ ...modal, ejes: modal.ejes.map((e) => (e.eje === eje ? { ...e, ...p } : e)) });

  const filasEjes = modal?.draft.medidas_por_eje ? modal.ejes : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Vehículos</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => navigate("/tyrecontrol/delegaciones")} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800" title="Las bases se definen en cada delegación">📍 Bases</button>
          <button onClick={sincronizar} disabled={sincronizando} className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
            {sincronizando ? "Sincronizando…" : "↻ Sincronizar Webfleet"}
          </button>
          <button onClick={() => setModal({ id: null, draft: { ...VACIO }, ejes: [] })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo vehículo</button>
        </div>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* KPIs (clicables para filtrar) */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {([
          ["en_base", "En base", kpis.en_base, "border-emerald-500/30", "🟢"],
          ["pend_base", "Pendientes en base", kpis.pend_base, "border-amber-500/30", "🔧"],
          ["venc_base", "Vencidas en base", kpis.venc_base, "border-rose-500/30", "⏰"],
          ["en_ruta", "En ruta", kpis.en_ruta, "border-amber-500/30", "🟠"],
          ["sin_conexion", "Sin conexión", kpis.sin_conexion, "border-slate-500/30", "⚪"],
        ] as [typeof fWebfleet, string, number, string, string][]).map(([k, label, val, br, icon]) => (
          <button key={k} onClick={() => setFWebfleet(fWebfleet === k ? "" : k)}
            className={`rounded-xl border ${br} bg-slate-800 p-3 text-left ${fWebfleet === k ? "ring-2 ring-sky-500" : ""}`}>
            <div className="text-2xl font-black text-slate-100">{val}</div>
            <div className="text-[11px] text-slate-400">{icon} {label}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[200px]`} placeholder="Buscar matrícula o nº unidad…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFDele(""); }}>
          <option value="">Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fDele} onChange={(e) => setFDele(e.target.value)}>
          <option value="">Todas las delegaciones</option>
          {delegaciones.filter((d) => !fEmpresa || d.empresa_id === fEmpresa).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as any)}>
          <option value="todos">Todos</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option>
        </select>
        <span className="text-xs text-slate-500">{visibles.length} vehículo(s)</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Empresa</th><th className={thCls}>Matrícula</th><th className={thCls}>Nº unidad</th><th className={thCls}>Delegación</th>
          <th className={thCls}>Marca</th><th className={thCls}>Config.</th><th className={thCls}>Medida</th>
          <th className={thCls}>Km</th><th className={thCls}>Webfleet</th><th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={11}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={11}>Sin vehículos.</td></tr>
          : visibles.map((v) => (
            <tr key={v.id} className={`border-t border-slate-700/60 ${revisarEnBase(v.id) ? "bg-amber-500/5" : ""}`}>
              <td className={tdCls + " text-slate-400"}>{v.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " font-bold"}>{v.matricula}</td>
              <td className={tdCls + " text-slate-400"}>{v.numero_unidad ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.delegacion?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.marca ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.config_ejes?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.medidas_por_eje ? "por eje" : (medidas.find((m) => m.id === v.medida_id)?.valor ?? "—")}</td>
              <td className={tdCls + " text-slate-400"}>{Number(v.km_actual).toLocaleString("es-ES")}</td>
              <td className={tdCls}>
                {(() => {
                  const est = estados.get(v.id);
                  const e = est?.estado ?? "sin_dispositivo";
                  const revisar = e === "en_base" && esPendiente(v.id);
                  return (
                    <button
                      onClick={() => est && setPopup({ v, est })}
                      disabled={!est}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${revisar ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/60" : ESTADO_WEBFLEET_BADGE[e]} ${est ? "cursor-pointer" : "cursor-default opacity-70"}`}
                      title={est ? "Ver detalle" : "Sin datos Webfleet"}
                    >
                      {revisar ? `🟢 EN BASE · REVISAR` : `${ESTADO_WEBFLEET_PUNTO[e]} ${ESTADO_WEBFLEET_LABELS[e].toUpperCase()}`}
                    </button>
                  );
                })()}
              </td>
              <td className={tdCls}><Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge></td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/vehiculos/${v.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  <button onClick={() => void abrirEditar(v)} className="text-slate-300 hover:underline">Editar</button>
                  <button onClick={async () => { await actualizarVehiculo(v.id, { activo: !v.activo }); await cargar(); }} className="text-amber-300 hover:underline">{v.activo ? "Desactivar" : "Activar"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar vehículo" : "Nuevo vehículo"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Empresa *">
              <select className={inputCls} value={modal.draft.empresa_id} onChange={(e) => set({ empresa_id: e.target.value, delegacion_id: null })}>
                <option value="">Selecciona…</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </Field>
            <Field label="Delegación">
              <select className={inputCls} value={modal.draft.delegacion_id ?? ""} onChange={(e) => set({ delegacion_id: e.target.value || null })}>
                <option value="">—</option>
                {delegacionesForm.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </Field>
            <TextField label="Matrícula *" value={modal.draft.matricula ?? ""} onChange={(v) => set({ matricula: v })} />
            <TextField label="Nº de unidad (flota)" value={modal.draft.numero_unidad ?? ""} onChange={(v) => set({ numero_unidad: v })} />
            <Field label="Tipo de vehículo">
              <select className={inputCls} value={modal.draft.tipo_vehiculo_id ?? ""} onChange={(e) => set({ tipo_vehiculo_id: e.target.value || null })}>
                <option value="">—</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
              </select>
            </Field>
            <TextField label="Marca" value={modal.draft.marca ?? ""} onChange={(v) => set({ marca: v })} />
            <TextField label="Modelo" value={modal.draft.modelo ?? ""} onChange={(v) => set({ modelo: v })} />
            <TextField label="Bastidor" value={modal.draft.bastidor ?? ""} onChange={(v) => set({ bastidor: v })} />

            {/* Configuración de neumáticos */}
            <Field label="Configuración de ejes">
              <select className={inputCls} value={modal.draft.config_ejes_id ?? ""} onChange={(e) => cambiarConfig(e.target.value || null)}>
                <option value="">—</option>
                {configEjes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.descripcion ? ` · ${c.descripcion}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Medidas diferentes por eje">
              <select className={inputCls} value={modal.draft.medidas_por_eje ? "1" : "0"} onChange={(e) => cambiarPorEje(e.target.value === "1")}>
                <option value="0">No · misma medida en todo el vehículo</option>
                <option value="1">Sí · indicar medida por cada eje</option>
              </select>
            </Field>

            {!modal.draft.medidas_por_eje && (
              <>
                <Field label="Medida de neumático">
                  <select className={inputCls} value={modal.draft.medida_id ?? ""} onChange={(e) => set({ medida_id: e.target.value || null })}>
                    <option value="">—</option>
                    {medidas.map((m) => <option key={m.id} value={m.id}>{m.valor}</option>)}
                  </select>
                </Field>
                <Field label="Tipo de llanta">
                  <select className={inputCls} value={modal.draft.tipo_llanta_id ?? ""} onChange={(e) => set({ tipo_llanta_id: e.target.value || null })}>
                    <option value="">—</option>
                    {tiposLlanta.map((l) => <option key={l.id} value={l.id}>{tipoLlantaLabel(l)}</option>)}
                  </select>
                </Field>
              </>
            )}

            <Field label="Fecha matriculación">
              <input type="date" className={inputCls} value={modal.draft.fecha_matriculacion ?? ""} onChange={(e) => set({ fecha_matriculacion: e.target.value || null })} />
            </Field>
            <Field label="Km actual">
              <input type="number" className={inputCls} value={modal.draft.km_actual} onChange={(e) => set({ km_actual: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Origen km">
              <select className={inputCls} value={modal.draft.origen_km} onChange={(e) => set({ origen_km: e.target.value as OrigenKm })}>
                {(Object.keys(ORIGEN_KM_LABELS) as OrigenKm[]).map((o) => <option key={o} value={o}>{ORIGEN_KM_LABELS[o]}</option>)}
              </select>
            </Field>
            <TextField label="Webfleet Vehicle ID" value={modal.draft.webfleet_vehicle_id ?? ""} onChange={(v) => set({ webfleet_vehicle_id: v })} />
            <Field label="Revisión cada (días)">
              <input type="number" className={inputCls} value={modal.draft.revision_intervalo_dias ?? ""} onChange={(e) => set({ revision_intervalo_dias: e.target.value === "" ? null : Number(e.target.value) })} placeholder="por defecto del tipo" />
            </Field>
            <Field label="Estado">
              <select className={inputCls} value={modal.draft.activo ? "1" : "0"} onChange={(e) => set({ activo: e.target.value === "1" })}>
                <option value="1">Activo</option><option value="0">Inactivo</option>
              </select>
            </Field>
          </div>

          {/* Desglose por eje */}
          {modal.draft.medidas_por_eje && (
            <div className="mt-3 rounded-lg border border-slate-700 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Medida y llanta por eje</div>
              {filasEjes.length === 0 ? (
                <div className="text-[12px] text-slate-500">Elige una configuración de ejes para desglosar los ejes.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filasEjes.map((f) => (
                    <div key={f.eje} className="grid items-center gap-2 sm:grid-cols-[110px_1fr_1fr]">
                      <span className="text-[12px] font-semibold text-slate-300">Eje {f.eje} · {f.ruedas} rueda{f.ruedas === 1 ? "" : "s"}</span>
                      <select className={inputCls} value={f.medida_id ?? ""} onChange={(e) => setEje(f.eje, { medida_id: e.target.value || null })}>
                        <option value="">Medida…</option>
                        {medidas.map((m) => <option key={m.id} value={m.id}>{m.valor}</option>)}
                      </select>
                      <select className={inputCls} value={f.tipo_llanta_id ?? ""} onChange={(e) => setEje(f.eje, { tipo_llanta_id: e.target.value || null })}>
                        <option value="">Llanta…</option>
                        {tiposLlanta.map((l) => <option key={l.id} value={l.id}>{tipoLlantaLabel(l)}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Popup de detalle del estado Webfleet */}
      {popup && (
        <Modal title={`Webfleet · ${popup.v.matricula}`} onClose={() => setPopup(null)}
          footer={<div className="flex justify-end"><button onClick={() => setPopup(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button></div>}>
          <div className="mb-3">
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${ESTADO_WEBFLEET_BADGE[popup.est.estado]}`}>
              {ESTADO_WEBFLEET_PUNTO[popup.est.estado]} {ESTADO_WEBFLEET_LABELS[popup.est.estado].toUpperCase()}
            </span>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Base detectada", popup.est.delegacion?.nombre ?? "—"],
              ["Hora de entrada", fechaHoraCorta(popup.est.entrada_base_at)],
              ["Tiempo en la base", popup.est.entrada_base_at ? duracionDesde(popup.est.entrada_base_at) : "—"],
              ["Última posición", popup.est.postext ?? (popup.est.lat != null ? `${popup.est.lat.toFixed(5)}, ${popup.est.lng?.toFixed(5)}` : "—")],
              ["Velocidad", popup.est.velocidad_kmh != null ? `${popup.est.velocidad_kmh} km/h` : "—"],
              ["Última actualización", fechaHoraCorta(popup.est.pos_time ?? popup.est.updated_at)],
            ].map(([l, val]) => (
              <div key={l as string} className="rounded-lg bg-slate-800 p-2">
                <div className="text-[10px] uppercase text-slate-500">{l}</div>
                <div className="text-slate-200">{val}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

    </div>
  );
}
