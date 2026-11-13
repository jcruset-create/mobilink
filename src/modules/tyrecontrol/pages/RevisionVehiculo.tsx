import { useEffect, useMemo, useState } from "react";
import { profundidadVigente } from "../utils/profundidad";
import { useSearchParams } from "react-router-dom";
import {
  listarEmpresas, listarVehiculos, listarPosiciones, listarMontajesVehiculo, obtenerVehiculo,
  crearRevision, guardarDetalleRevision, completarRevision, listarRevisiones, listarDetalleRevision,
  cambiarFechaRevision, kilometrajeActualVehiculo,
  listarUltimasMedicionesVehiculo, listarPresionesCatalogoPorModelo, eliminarRevision,
} from "../services/data";
import type { LecturaKmActual } from "../services/data";
import type { Empresa, Vehiculo, PosicionVehiculo, MontajeActual, RevisionVehiculo as RevisionVehiculoT, RevisionDetalle } from "../types";
import { presionTxt } from "../types";
import { inputCls, Field, Modal, TableWrap, tdCls, thCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import ModalMontarDesdeFicha from "../components/ModalMontarDesdeFicha";
import {
  avisoKmDeOtroDia, hoyISO, juzgarFecha, origenDeLosKm, textoEnPapel,
} from "../services/revisionEnPapel";

type Detalle = Partial<RevisionDetalle>;

/**
 * «2026-11-09» → «09/11/2026». Se formatea a mano y no con
 * `toLocaleDateString`: la cadena de la columna es un día sin hora, y pasarla
 * por `new Date()` la interpreta en UTC y puede retroceder un día según la
 * zona de quien mira.
 */
function fechaES(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Fecha + hora de la revisión. La fecha viene de fecha_revision (solo día) y
// la hora del created_at (marca de tiempo real de creación).
function fechaHora(r: RevisionVehiculoT): string {
  const fecha = fechaES(r.fecha_revision);
  const hora = r.created_at ? new Date(r.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  return hora ? `${fecha} · ${hora}` : fecha;
}

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
  /*
   * El día en que se hizo la revisión, que no siempre es hoy: las que se hacen
   * en papel se teclean unos días después. Por defecto hoy, que es el caso
   * normal. Las reglas de qué fecha se admite están en
   * `services/revisionEnPapel.ts`.
   */
  const [fechaRevision, setFechaRevision] = useState(hoyISO());
  /* La posición en la que se va a reconocer una goma que el sistema no tiene. */
  const [montarEn, setMontarEn] = useState<PosicionVehiculo | null>(null);
  /*
   * Lo que ha contestado la telemática, para poder decir de dónde sale el
   * número en vez de dejarlo aparecer solo en la casilla.
   */
  const [lecturaKm, setLecturaKm] = useState<LecturaKmActual | null>(null);
  const [pidiendoKm, setPidiendoKm] = useState(false);
  /* Si el número que hay puesto lo trajo el proveedor. Decide `origen_km`. */
  const [kmDeTelematica, setKmDeTelematica] = useState(false);
  const [detalles, setDetalles] = useState<Record<string, Detalle>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [fichaRevision, setFichaRevision] = useState<RevisionVehiculoT | null>(null);
  const [fichaDetalle, setFichaDetalle] = useState<RevisionDetalle[]>([]);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [medicionesActuales, setMedicionesActuales] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});
  const [presionesCatalogo, setPresionesCatalogo] = useState<Record<string, number>>({});

  const [searchParams] = useSearchParams();

  useEffect(() => {
    listarPresionesCatalogoPorModelo().then(setPresionesCatalogo).catch(() => setPresionesCatalogo({}));
  }, []);

  // Deep-link desde "Vehículos disponibles para revisar": ?vehiculo=&empresa=
  useEffect(() => {
    const vid = searchParams.get("vehiculo");
    const emp = searchParams.get("empresa");
    if (!vid) return;
    (async () => {
      if (emp) { setEmpresaId(emp); await cargarVehiculos(emp); }
      const veh = await obtenerVehiculo(vid);
      if (veh) await cargarVehiculo(vid, veh);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function referenciasDePosicion(posicionId: string) {
    const m = montajePorPosicion.get(posicionId);
    const neu = m?.neumatico;
    if (!neu) return { ultimaProfundidad: null as number | null, presionRecomendada: null as number | null };
    const medicion = medicionesActuales[neu.id];
    const ultimaProfundidad = profundidadVigente(medicion, neu);
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
    // La fecha del borrador manda sobre la de hoy: si se empezó a pasar el
    // parte del día 9 y se sigue el 13, sigue siendo la revisión del día 9.
    if (r.fecha_revision) setFechaRevision(r.fecha_revision);
    setRevision(r);
  }

  /**
   * Pedirle el cuentakilómetros al proveedor de telemática.
   *
   * Mismo criterio que en el inventario inicial
   * (`components/ModalNeumaticosMontados.tsx`), y a propósito el mismo: NO
   * sobrescribe lo que haya tecleado una persona. Si el campo tiene algo
   * puesto a mano, la lectura se trae para enseñarla y el número se respeta;
   * quien quiera el del proveedor vacía la casilla y vuelve a pulsar.
   *
   * Pasa por el servidor porque la credencial de Movertis vive en el gestor de
   * secretos del Hub y no sale de ahí. No escribe nada: solo pregunta.
   */
  async function pedirKm(vid: string, automatico = false) {
    if (pidiendoKm || !vid) return;
    setPidiendoKm(true);
    try {
      const l = await kilometrajeActualVehiculo(vid);
      setLecturaKm(l);
      if (l.km != null) {
        /*
         * Se pisa lo que hubiera, y no hay guarda de «lo tecleado no se toca»
         * a propósito: las dos únicas llamadas vienen de sitios donde pisar es
         * lo correcto —al elegir vehículo, donde la casilla trae el `km_actual`
         * de la ficha que nadie ha tecleado (el 5399GWF trae un 0), y al pulsar
         * el botón, que es justo pedir que se pise—. Un guarda leería el estado
         * del render anterior y acabaría ignorando la lectura del vehículo
         * recién elegido.
         */
        setKmVehiculo(String(Math.round(l.km)));
        setKmDeTelematica(true);
      }
    } catch (e: any) {
      // En automático se calla: esta no es la pantalla de la telemática, y un
      // aviso al elegir vehículo sería ruido. A mano sí se dice, porque
      // alguien ha pulsado y está esperando respuesta.
      if (!automatico) setMsg(e?.message || "No se ha podido consultar la telemática");
    } finally { setPidiendoKm(false); }
  }

  /**
   * Corregir la fecha de la revisión en curso.
   *
   * Se comprueba con las mismas reglas que al empezar: una fecha futura o de
   * hace más de un año no entra ni por aquí. Si la base la rechaza, se deja la
   * de antes en la pantalla, para que no quede diciendo una fecha que no se ha
   * guardado.
   */
  async function corregirFecha(nueva: string) {
    if (!revision) return;
    const { error: errorFecha } = juzgarFecha(nueva);
    if (errorFecha) { setMsg(errorFecha); return; }
    const anterior = fechaRevision;
    setFechaRevision(nueva);
    setSaving(true); setMsg("");
    try {
      await cambiarFechaRevision(revision.id, nueva);
      setRevision({ ...revision, fecha_revision: nueva });
    } catch (e: any) {
      setFechaRevision(anterior);
      setMsg(e?.message || "No se ha podido cambiar la fecha");
    } finally { setSaving(false); }
  }

  /**
   * Después de reconocer una goma en una posición vacía.
   *
   * Hay que releer los montajes para que la posición deje de estar vacía y se
   * pueda medir; y hay que meter el `neumatico_id` nuevo en el detalle, que es
   * lo que enlaza la medición con la goma. Sin eso, la profundidad se
   * guardaría sin decir de qué neumático es.
   */
  async function trasMontar() {
    setMontarEn(null);
    const [mon, medic] = await Promise.all([
      listarMontajesVehiculo(vehiculoId),
      listarUltimasMedicionesVehiculo(vehiculoId),
    ]);
    setMontajes(mon); setMedicionesActuales(medic);
    const porPosicion = new Map(mon.map((m) => [m.posicion_id, m]));
    setDetalles((prev) => {
      const siguiente = { ...prev };
      for (const p of posiciones) {
        const neu = porPosicion.get(p.id)?.neumatico_id ?? null;
        siguiente[p.id] = { ...siguiente[p.id], posicion_id: p.id, neumatico_id: neu };
      }
      return siguiente;
    });
  }

  async function borrarBorrador(r: RevisionVehiculoT) {
    if (!window.confirm(`¿Eliminar el borrador de revisión del ${fechaES(r.fecha_revision)}? Esta acción no se puede deshacer.`)) return;
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
    // La lectura del vehículo anterior no dice nada de éste.
    setLecturaKm(null); setKmDeTelematica(false);
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

    /*
     * Y se le piden los kilómetros al proveedor, una vez, al elegir vehículo.
     *
     * Solo si la revisión es de HOY. El endpoint contesta el odómetro de ahora
     * y el histórico de Movertis no trae odómetro, así que para un parte de
     * hace cuatro días no hay nada que preguntar: gastaría cupo del proveedor
     * —que se comparte con el barrido de presencia en bases— para traer un
     * número que no es el de ese día.
     */
    if (fechaRevision === hoyISO()) void pedirKm(vid, true);
  }

  /* El vehículo elegido, para poder avisar de la casilla «KM.» del papel. */
  const vehiculoElegido = useMemo(
    () => vehiculos.find((v) => v.id === vehiculoId) ?? todosVehiculos.find((v) => v.id === vehiculoId) ?? null,
    [vehiculos, todosVehiculos, vehiculoId],
  );

  /* El aviso de «esta fecha es de hace mucho», si procede. */
  const avisoFecha = useMemo(() => juzgarFecha(fechaRevision).aviso, [fechaRevision]);

  const montajePorPosicion = useMemo(() => {
    const m = new Map<string, MontajeActual>();
    for (const x of montajes) m.set(x.posicion_id, x);
    return m;
  }, [montajes]);

  async function iniciarRevision() {
    if (!vehiculoId || !empresaId) return;
    // La fecha se comprueba ANTES de crear la fila: una revisión con la fecha
    // mal puesta no da un error, da una proyección de desgaste equivocada
    // meses después.
    const { error: errorFecha } = juzgarFecha(fechaRevision);
    if (errorFecha) { setMsg(errorFecha); return; }
    setSaving(true); setMsg("");
    try {
      const r = await crearRevision({
        empresaId, vehiculoId, kmVehiculo: kmVehiculo ? Number(kmVehiculo) : null,
        tecnicoId: perfil?.id ?? null, fechaRevision,
        // `telematica` solo si lo trajo el proveedor Y la revisión es de hoy;
        // si no, es una aproximación que ha aceptado una persona. Ver
        // `origenDeLosKm` en `services/revisionEnPapel.ts`.
        origenKm: origenDeLosKm(kmDeTelematica, fechaRevision),
      });
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
          <div className="flex flex-wrap gap-4">
            <Field label="Fecha de la revisión">
              <input
                type="date" max={hoyISO()} className={`${inputCls} max-w-[12rem]`}
                value={fechaRevision} onChange={(e) => setFechaRevision(e.target.value)}
              />
            </Field>
            <Field label="Km actuales del vehículo">
              <input
                type="number" className={`${inputCls} max-w-xs`} value={kmVehiculo}
                onChange={(e) => {
                  setKmVehiculo(e.target.value);
                  // A partir de aquí el número es de quien lo escribe, así que
                  // `origen_km` deja de ser de la telemática.
                  setKmDeTelematica(false);
                }}
              />
            </Field>
            {/*
              Para reintentar cuando la telemática no ha contestado, o para
              recuperar la lectura después de haber tecleado.
            */}
            <div className="self-end pb-[2px]">
              <button
                onClick={() => void pedirKm(vehiculoId)}
                disabled={pidiendoKm || !vehiculoId}
                title="Pregunta el cuentakilómetros al proveedor de telemática"
                className="rounded-lg border border-slate-600 px-3 py-2 text-[13px] font-bold text-slate-200 hover:bg-slate-700/40 disabled:opacity-50"
              >
                {pidiendoKm ? "Consultando…" : "Pedir kilómetros"}
              </button>
            </div>
          </div>

          {/*
            Lo que ha dicho la telemática, con su antigüedad. El número a secas
            no basta: una lectura de hace dos días y una de hace dos minutos se
            escriben igual y no valen lo mismo. Mismo texto que en el
            inventario inicial, que es de donde sale el criterio.
          */}
          {lecturaKm && (
            <div className={`mt-1 text-[11px] ${lecturaKm.km != null ? "text-slate-400" : "text-amber-400"}`}>
              {lecturaKm.km != null
                ? <>Telemática: <b>{Math.round(lecturaKm.km).toLocaleString("es-ES")} km</b>
                    {lecturaKm.antiguedadMin != null && <> · leído hace {lecturaKm.antiguedadMin} min</>}
                    {lecturaKm.proveedor && <> · {lecturaKm.proveedor}</>}
                    {lecturaKm.aviso && <span className="ml-1 text-amber-400">· {lecturaKm.aviso}</span>}</>
                : lecturaKm.texto}
            </div>
          )}

          {/*
            Y el cruce con la fecha: para un parte de otro día, el odómetro de
            ahora no es el de ese día. Se dice en vez de ofrecer un número que
            parecería medido entonces.
          */}
          {avisoKmDeOtroDia(fechaRevision) && (
            <div className="mt-1 text-[11px] text-amber-300/80">{avisoKmDeOtroDia(fechaRevision)}</div>
          )}

          {/*
            * El parte de papel trae una casilla «KM.» que NO siempre son
            * kilómetros: en los partes de Plana lleva el número de unidad
            * (5399GWF → «KM. 1482», y 1482 es la unidad, no los km). Si se
            * teclea ahí, el vehículo pasa a tener 1.482 km y el cálculo de
            * desgaste por kilómetro se va al suelo.
            */}
          {vehiculoElegido?.numero_unidad && (
            <div className="mt-1 text-[11px] text-amber-300/80">
              Ojo: la casilla «KM.» del parte de papel suele llevar el nº de unidad
              (esta es la {vehiculoElegido.numero_unidad}), no los kilómetros.
            </div>
          )}

          {/*
            * Un parte de hace meses se deja guardar, pero se avisa: puede ser
            * un papel que apareció en un cajón, o puede ser el año mal
            * tecleado. Quien tiene el papel delante lo sabe; la pantalla no.
            */}
          {avisoFecha && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              {avisoFecha}
            </div>
          )}

          <button onClick={iniciarRevision} disabled={saving} className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Iniciar revisión</button>

          {historialRevisiones.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Revisiones anteriores</div>
              <div className="flex flex-col gap-1">
                {historialRevisiones.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded bg-slate-900 px-3 py-2 text-[12px] text-slate-300">
                    <span>
                      {fechaHora(r)} · {r.km_vehiculo ?? "—"} km
                      {r.tecnico_nombre ? <span className="text-slate-500"> · {r.tecnico_nombre}</span> : ""}
                    </span>
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
            {/*
              * La fecha que se enseña es la de la REVISIÓN, no la de hoy.
              * Antes ponía `new Date()`, que en una revisión pasada a mano
              * decía un día distinto del que se estaba guardando.
              */}
            <span className="flex flex-wrap items-center gap-2">
              <span>Revisión en curso del</span>
              {/*
                * Editable: la fecha se elige antes de teclear y quien se
                * equivoca lo descubre a mitad de las ocho posiciones. Sin
                * poder corregirla aquí, la única salida sería borrar el
                * borrador y empezar de nuevo, y entonces el camino cómodo
                * sería dejar la fecha mal.
                */}
              <input
                type="date" max={hoyISO()} value={fechaRevision} disabled={saving}
                onChange={(e) => void corregirFecha(e.target.value)}
                className={`${inputCls} w-auto py-0.5 text-[12px]`}
                title="La fecha en que se hizo la revisión"
              />
              <span>· {kmVehiculo} km</span>
              {textoEnPapel(revision) && (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-200"
                  title="Sin cronómetro ni coordenadas: no se hizo con la tablet">
                  {textoEnPapel(revision)}
                </span>
              )}
            </span>
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
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>
                      {m?.neumatico ? `${m.neumatico.numero_interno ?? m.neumatico.codigo_interno} · ${m.neumatico.marca ?? ""} ${m.neumatico.medida ?? ""}` : "Sin neumático montado"}
                    </span>
                    {/*
                      * El parte de papel trae MEDIDA, MARCA y MODELO de cada
                      * posición, y a veces el sistema no tiene nada montado
                      * ahí. Entonces no hay nada que medir: primero hay que
                      * reconocer la goma que el papel dice que está puesta.
                      *
                      * Se monta con la FECHA DE LA REVISIÓN, no con la de hoy:
                      * de ahí salen los kilómetros que lleva la goma.
                      */}
                    {!m && (
                      <button
                        onClick={() => setMontarEn(p)}
                        className="shrink-0 rounded border border-sky-600/60 px-2 py-0.5 text-[11px] font-bold text-sky-300 hover:bg-sky-600/20"
                        title="Dar de alta la goma que el parte dice que está en esta posición"
                      >
                        Reconocer goma
                      </button>
                    )}
                  </div>
                  {m?.neumatico && (
                    <div className="mb-2 text-[10px] text-slate-500">
                      Última medición: {ultimaProfundidad != null ? `${ultimaProfundidad} mm` : "—"} · Presión recomendada: {presionRecomendada != null ? `${presionTxt(presionRecomendada)} bar` : "—"}
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

      {montarEn && revision && (
        <ModalMontarDesdeFicha
          posicionNombre={montarEn.codigo_posicion ?? "la posición"}
          vehiculoId={vehiculoId}
          empresaId={empresaId}
          posicionId={montarEn.id}
          fecha={revision.fecha_revision ?? undefined}
          onClose={() => setMontarEn(null)}
          onDone={trasMontar}
        />
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
    </div>
  );
}
