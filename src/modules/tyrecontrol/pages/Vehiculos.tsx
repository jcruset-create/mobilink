import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarVehiculos, actualizarVehiculo, listarEmpresas, listarDelegaciones, listarTiposVehiculo,
  listarMedidas,
  listarEstadoWebfleet, listarPresenciaEnBases, sincronizarWebfleet, listarRevisionEstado,
  listarVehiculosPendientes, validarVehiculo, eliminarVehiculo,
  listarMarcasVehiculo,
} from "../services/data";
import EditorVehiculo from "../components/EditorVehiculo";
import type {
  Delegacion, Empresa, TipoVehiculo, Vehiculo,
  MarcaVehiculo, MedidaNeumatico,
  EstadoWebfleet, VehiculoWebfleetEstado, PresenciaEnBase, RevisionEstado,
} from "../types";
import { ESTADO_WEBFLEET_LABELS, ESTADO_WEBFLEET_BADGE, ESTADO_WEBFLEET_PUNTO } from "../types";
import { enlacesTelematica } from "../services/conciliacion";
import { marcaDelCatalogo } from "../catalogo/logoMarca";
import { estadoUbicacion, etiquetaBase, ubicacionDeVehiculo } from "../services/presenciaVista";
import {
  conectoresDe, etiquetaTelematica, porVehiculo, type EnlaceTelematica,
} from "../services/telematicaVehiculo";
import { Badge, Modal, TableWrap, tdCls, thCls, inputCls } from "../components/ui";

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

/**
 * La marca del vehículo con su logo. Se ve de un vistazo en una lista de 726
 * vehículos, que es de lo que se trata; el nombre se queda debajo porque el
 * logo no dice si pone "MERCEDES" o "MERCEDES-BENZ", y eso importa cuando hay
 * que cuadrar la ficha.
 *
 * Si no hay logo —marca que no está en el catálogo, o que aún no tiene imagen
 * subida— se enseña solo el nombre, como hasta ahora.
 */
function CeldaMarca({ vehiculo, catalogo }: { vehiculo: Vehiculo; catalogo: MarcaVehiculo[] }) {
  const [falla, setFalla] = useState(false);
  const marca = marcaDelCatalogo(vehiculo, catalogo);
  const nombre = vehiculo.marca ?? marca?.nombre ?? null;

  if (!marca?.logo_url || falla) return <>{nombre ?? "—"}</>;
  return (
    <div className="flex items-center gap-2">
      <img
        src={marca.logo_url}
        alt={marca.nombre}
        title={marca.nombre}
        loading="lazy"
        onError={() => setFalla(true)}
        className="h-7 w-16 shrink-0 object-contain"
      />
      <span className="text-[11px] text-slate-500">{nombre}</span>
    </div>
  );
}

export default function Vehiculos() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  // Catálogo de marcas de vehículo: el desplegable de MARCA se filtra por el
  // tipo elegido (tractora → MAN/Scania…, semirremolque → Krone/Schmitz…).
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  // El catálogo de marcas de vehículo, con sus logos. La marca del vehículo
  // es texto libre ("MERCEDES", "MERCEDES-BENZ"), así que el logo se busca
  // emparejando contra este catálogo.
  const [marcasVeh, setMarcasVeh] = useState<MarcaVehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // Vehículos que un técnico dio de alta desde la tablet y nadie ha repasado.
  // Van arriba y no como una columna más: si no se ven, nadie los completa
  // nunca y la flota se llena de camiones sin marca ni modelo.
  const [pendientes, setPendientes] = useState<Vehiculo[]>([]);
  const [validando, setValidando] = useState<string | null>(null);
  const [msgPend, setMsgPend] = useState("");

  async function cargarPendientes() {
    try { setPendientes(await listarVehiculosPendientes()); }
    catch { /* la columna puede no estar aún: el listado sigue siendo útil */ }
  }
  useEffect(() => { void cargarPendientes(); }, []);

  async function validar(v: Vehiculo) {
    setValidando(v.id); setMsgPend("");
    try {
      await validarVehiculo(v.id);
      await cargarPendientes();
    } catch (e: any) { setMsgPend(e?.message || "No se ha podido validar"); }
    finally { setValidando(null); }
  }

  /*
   * Borrar un vehículo que no debería existir: un alta duplicada desde la
   * tablet, una matrícula de prueba, una importación equivocada.
   *
   * Se pregunta antes porque no tiene vuelta atrás, y la base solo deja
   * borrar lo que no tiene nada detrás. Si tiene historial, el mensaje que
   * llega ya explica qué tiene y que lo que toca es darlo de baja; se enseña
   * tal cual en vez de traducirlo, que es donde se pierden los matices.
   */
  const [borrando, setBorrando] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Vehiculo | null>(null);
  /*
   * Por qué no se ha podido borrar, DENTRO del diálogo.
   *
   * Antes esto salía en el aviso de arriba de la pantalla, a media página del
   * botón que se acababa de pulsar: el diálogo se quedaba abierto y sin decir
   * nada, y parecía que el botón no hacía nada. El motivo tiene que estar
   * donde está mirando quien lo pulsó.
   */
  const [motivoNoBorrado, setMotivoNoBorrado] = useState<string | null>(null);

  /**
   * Dar de baja, desde el mismo aviso que acaba de decir que no se puede
   * borrar. Es lo que toca hacer con un vehículo que ya tiene vida, y
   * obligar a cerrar el diálogo e ir a buscar «Desactivar» en su fila es
   * hacerle dar un rodeo para llegar a la única salida que le queda.
   *
   * Usa `actualizarVehiculo`, que es exactamente lo que hace ese botón: no se
   * inventa una segunda vía para lo mismo.
   */
  async function darDeBaja(v: Vehiculo) {
    setBorrando(v.id);
    try {
      await actualizarVehiculo(v.id, { activo: false });
      setABorrar(null); setMotivoNoBorrado(null);
      setMsgPend(`✔ ${v.matricula} dado de baja`);
      await cargarPendientes();
      await cargar();
    } catch (e: any) {
      setMotivoNoBorrado(e?.message || "No se ha podido dar de baja");
    } finally { setBorrando(null); }
  }

  async function eliminar(v: Vehiculo) {
    setBorrando(v.id); setMsgPend(""); setMotivoNoBorrado(null);
    try {
      await eliminarVehiculo(v.id);
      setABorrar(null);
      setMsgPend(`✔ ${v.matricula} eliminado`);
      await cargarPendientes();
      await cargar();
    } catch (e: any) {
      // El mensaje de la base ya está escrito para una persona («tiene
      // historial (2 revisión/es, …): dalo de baja para conservarlo»), así que
      // se enseña tal cual en vez de traducirlo.
      setMotivoNoBorrado(e?.message || "No se ha podido eliminar");
    }
    finally { setBorrando(null); }
  }

  // filtros
  const [q, setQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fDele, setFDele] = useState("");
  const [fTipo, setFTipo] = useState("");
  /*
   * Los de baja NO salen si no se piden.
   *
   * La lista es de trabajo diario y los vehículos dados de baja se quedan ahí
   * para siempre: con la flota de un cliente grande, la mitad de lo que se ve
   * al abrir la pantalla es histórico. Se empieza en «activos» y hay una
   * casilla para verlos; el filtro fijado sigue guardando lo que se elija.
   */
  const [fEstado, setFEstado] = useState<"todos" | "activos" | "inactivos">("activos");

  // Filtro fijado: para trabajar un rato con un solo cliente sin que se pierda
  // el filtro al ir y volver de una ficha. Se guarda en el navegador, así que
  // aguanta también un F5.
  const CLAVE_FIJADO = "tc.vehiculos.filtroFijado";
  const [fijado, setFijado] = useState(false);
  useEffect(() => {
    try {
      const g = localStorage.getItem(CLAVE_FIJADO);
      if (!g) return;
      const f = JSON.parse(g) as { empresa?: string; dele?: string; tipo?: string; estado?: string };
      setFEmpresa(f.empresa ?? ""); setFDele(f.dele ?? ""); setFTipo(f.tipo ?? "");
      setFEstado((f.estado as any) ?? "todos");
      setFijado(true);
    } catch { /* si el guardado está corrupto, se empieza sin filtro */ }
  }, []);
  // Mientras está fijado, cualquier cambio de filtro se guarda: el candado
  // conserva el cliente, no impide cambiarlo.
  useEffect(() => {
    if (!fijado) return;
    localStorage.setItem(CLAVE_FIJADO, JSON.stringify({ empresa: fEmpresa, dele: fDele, tipo: fTipo, estado: fEstado }));
  }, [fijado, fEmpresa, fDele, fTipo, fEstado]);

  function alternarFijado() {
    if (fijado) { localStorage.removeItem(CLAVE_FIJADO); setFijado(false); return; }
    setFijado(true);
  }

  // El formulario vive en EditorVehiculo: null = cerrado, undefined = nuevo.
  const [editando, setEditando] = useState<null | { vehiculo?: Vehiculo }>(null);

  // Webfleet: estado por vehículo, estado de revisión, filtros y popup.
  const [estados, setEstados] = useState<Map<string, VehiculoWebfleetEstado>>(new Map());
  /*
   * Dónde está cada vehículo según el barrido del Hub.
   *
   * Hace falta además del estado Webfleet porque ese solo sabe de los clientes
   * de Webfleet: para uno de Movertis está vacío, y entonces el aviso de los
   * vehículos de la tablet no podría decir en qué base están, que es justo
   * cuando conviene ir a completarles la ficha.
   */
  const [presencias, setPresencias] = useState<Map<string, PresenciaEnBase>>(new Map());
  // Con qué telemática está enlazado cada vehículo. Del Hub, no solo Webfleet.
  const [enlacesTel, setEnlacesTel] = useState<EnlaceTelematica[]>([]);
  const [revEstados, setRevEstados] = useState<Map<string, RevisionEstado>>(new Map());
  const [sincronizando, setSincronizando] = useState(false);
  const [fWebfleet, setFWebfleet] = useState<"" | "en_base" | "en_ruta" | "pend_base" | "venc_base">("");
  const [popup, setPopup] = useState<null | { v: Vehiculo; est: VehiculoWebfleetEstado }>(null);

  async function refrescarWebfleet() {
    try {
      const [est, rev, pres] = await Promise.all([
        listarEstadoWebfleet(),
        listarRevisionEstado(),
        // Mejor esfuerzo: si el barrido del Hub no está disponible, la página
        // sigue funcionando con lo de Webfleet, como hasta ahora.
        listarPresenciaEnBases().catch(() => [] as PresenciaEnBase[]),
      ]);
      setPresencias(new Map(pres.map((p) => [p.vehiculo_id, p])));
      // Los enlaces van aparte: que falten no puede dejar la lista sin estado
      // de Webfleet, que es lo que se miraba antes de que existiera esto.
      enlacesTelematica()
        .then((r) => setEnlacesTel(r.enlaces))
        .catch(() => setEnlacesTel([]));
      setEstados(new Map(est.map((e) => [e.vehiculo_id, e])));
      setRevEstados(new Map(rev.map((r) => [r.vehiculo_id, r])));
    } catch { /* módulo Webfleet aún no migrado: se ignora */ }
  }

  // Revisión pendiente = sin revisión, vencida o próxima. Vencida = sin revisión o vencida.
  const esPendiente = (id: string) => { const e = revEstados.get(id)?.estado; return e === "sin_revision" || e === "vencida" || e === "proxima"; };
  const esVencida = (id: string) => { const e = revEstados.get(id)?.estado; return e === "sin_revision" || e === "vencida"; };
  // "En base" a efectos de revisión = en su base asignada O en otra base de su empresa.
  /*
   * El estado de ubicación, venga del proveedor que venga.
   *
   * Antes salía solo de Webfleet, y para un cliente de Movertis eso eran cero
   * en base, cero en ruta y toda la flota «sin dispositivo»: los contadores de
   * arriba y sus filtros no servían para nada. `estadoUbicacion` mira primero
   * el barrido del Hub y cae a Webfleet, así que los mismos contadores valen
   * ahora para cualquier cliente.
   */
  const ubicacionDe = (id: string): EstadoWebfleet =>
    estadoUbicacion(presencias.get(id), estados.get(id));
  const enAlgunaBase = (id: string) => { const e = ubicacionDe(id); return e === "en_base" || e === "otra_base"; };
  const revisarEnBase = (id: string) => enAlgunaBase(id) && esPendiente(id);

  async function cargar() {
    setLoading(true);
    try {
      const [v, e, d, t, m, mv] = await Promise.all([
        listarVehiculos(), listarEmpresas(), listarDelegaciones(), listarTiposVehiculo(),
        listarMedidas(),
        // Sin logos el listado sigue siendo útil: se enseña el nombre.
        listarMarcasVehiculo().catch(() => [] as MarcaVehiculo[]),
      ]);
      setItems(v); setEmpresas(e); setDelegaciones(d); setTipos(t); setMedidas(m); setMarcasVeh(mv);
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

  const estadoDe = (id: string): EstadoWebfleet => ubicacionDe(id);
  const telematicaPorVehiculo = useMemo(() => porVehiculo(enlacesTel), [enlacesTel]);

  // KPIs: en base, pendientes en base, vencidas en base, en ruta, sin conexión.
  const kpis = useMemo(() => {
    let en_base = 0, pend_base = 0, venc_base = 0, en_ruta = 0, sin_conexion = 0;
    for (const v of items) {
      const e = estadoUbicacion(presencias.get(v.id), estados.get(v.id));
      if (e === "en_ruta") en_ruta++;
      else if (e === "sin_conexion") sin_conexion++;
      else if (e === "en_base" || e === "otra_base") {
        en_base++;
        const r = revEstados.get(v.id)?.estado;
        if (r === "sin_revision" || r === "vencida" || r === "proxima") pend_base++;
        if (r === "sin_revision" || r === "vencida") venc_base++;
      }
    }
    return { en_base, pend_base, venc_base, en_ruta, sin_conexion };
  }, [items, estados, presencias, revEstados]);

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((v) => {
      if (fEmpresa && v.empresa_id !== fEmpresa) return false;
      if (fDele && v.delegacion_id !== fDele) return false;
      if (fTipo && v.tipo_vehiculo_id !== fTipo) return false;
      if (fEstado === "activos" && !v.activo) return false;
      if (fEstado === "inactivos" && v.activo) return false;
      if (fWebfleet === "en_base" && !enAlgunaBase(v.id)) return false;
      if (fWebfleet === "en_ruta" && estadoDe(v.id) !== "en_ruta") return false;
      if (fWebfleet === "pend_base" && !revisarEnBase(v.id)) return false;
      if (fWebfleet === "venc_base" && !(enAlgunaBase(v.id) && esVencida(v.id))) return false;
      if (s && !v.matricula.toLowerCase().includes(s) && !(v.numero_unidad ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, fEmpresa, fDele, fTipo, fEstado, fWebfleet, estados, presencias, revEstados]);

  // ── Orden por columna ──────────────────────────────────────────────
  // Se pulsa la cabecera: primera vez ascendente, segunda descendente.
  type Columna = "empresa" | "matricula" | "unidad" | "delegacion" | "marca" | "config" | "medida" | "km" | "estado";
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: "matricula", asc: true });

  function ordenarPor(col: Columna) {
    setOrden((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: true }));
  }

  const visibles = useMemo(() => {
    const medidaDe = (v: Vehiculo) =>
      v.medidas_por_eje ? "por eje" : (medidas.find((m) => m.id === v.medida_id)?.valor ?? "");
    // El nº de unidad es un número escrito como texto ("1096"): ordenarlo
    // como texto pondría el 1000 antes que el 674.
    const comoNumero = (s: string) => {
      const n = Number(String(s).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && String(s).trim() !== "" ? n : null;
    };
    const valor = (v: Vehiculo): string | number => {
      switch (orden.col) {
        case "empresa": return v.empresa?.nombre ?? "";
        case "matricula": return v.matricula ?? "";
        case "unidad": return comoNumero(v.numero_unidad ?? "") ?? (v.numero_unidad ?? "");
        case "delegacion": return v.delegacion?.nombre ?? "";
        case "marca": return v.marca ?? "";
        case "config": return v.config_ejes?.nombre ?? "";
        case "medida": return medidaDe(v);
        case "km": return Number(v.km_actual) || 0;
        case "estado": return v.activo ? "Activo" : "Inactivo";
      }
    };
    const signo = orden.asc ? 1 : -1;
    return [...filtrados].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      // Lo que no tiene dato siempre al final, se ordene como se ordene.
      const vacioA = va === "" || va == null, vacioB = vb === "" || vb == null;
      if (vacioA !== vacioB) return vacioA ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * signo;
      return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * signo;
    });
  }, [filtrados, orden, medidas]);


  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Vehículos</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => navigate("/tyrecontrol/delegaciones")} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800" title="Las bases se definen en cada delegación">📍 Bases</button>
          <button onClick={sincronizar} disabled={sincronizando} className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
            {sincronizando ? "Sincronizando…" : "↻ Sincronizar Webfleet"}
          </button>
          <button onClick={() => setEditando({})} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo vehículo</button>
        </div>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Los que nacieron en la tablet. Solo salen si los hay. */}
      {pendientes.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-300">⚠</span>
            <h2 className="text-sm font-bold text-amber-200">
              {pendientes.length === 1
                ? "Un vehículo dado de alta desde la tablet"
                : `${pendientes.length} vehículos dados de alta desde la tablet`}
            </h2>
          </div>
          <p className="mt-1 text-[12px] text-amber-200/80">
            Nacieron con lo justo para poder hacer el parte: empresa, matrícula, tipo y
            medida. Complétales la marca, el modelo y la delegación, o fusiónalos si el
            camión ya estaba dado de alta con la matrícula escrita de otra manera.
          </p>
          {msgPend && <div className="mt-2 text-[12px] text-red-300">{msgPend}</div>}
          <div className="mt-3 flex flex-col gap-2">
            {pendientes.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-700 bg-slate-900/40 px-3 py-2">
                <span className="font-mono text-sm font-bold text-slate-100">{v.matricula}</span>
                <span className="text-[12px] text-slate-400">{v.empresa?.nombre ?? "—"}</span>
                <span className="text-[12px] text-slate-500">{v.tipo?.nombre ?? "sin tipo"}</span>
                {/*
                  Dónde está AHORA, si se sabe. Es lo que convierte este aviso
                  en algo accionable: el técnico puede ir al patio, mirarle la
                  marca y el modelo, y completarle la ficha de una vez, en vez
                  de esperar a que el camión aparezca por casualidad.
                */}
                {(() => {
                  const donde = etiquetaBase(presencias.get(v.id), estados.get(v.id));
                  if (!donde) return null;
                  return (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        donde.ahora
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-slate-700/60 text-slate-300"
                      }`}
                      title={
                        donde.ahora
                          ? "Está en esta base ahora mismo"
                          : "Aquí se le vio por última vez; su equipo lleva rato sin emitir"
                      }
                    >
                      📍 {donde.ahora ? "En" : "Última vez en"} {donde.base}
                    </span>
                  );
                })()}
                {/* Se dice qué le falta, no solo que está pendiente: así se
                    sabe si hay que abrirlo o basta con darlo por bueno. */}
                <span className="text-[12px] text-amber-300">
                  {[!v.marca && "marca", !v.modelo && "modelo", !v.delegacion_id && "delegación"]
                    .filter(Boolean).join(", ") || "nada obvio"}
                  {" pendiente"}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => navigate(`/tyrecontrol/vehiculos/${v.id}`)}
                    className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-700"
                  >
                    Abrir ficha
                  </button>
                  <button
                    onClick={() => validar(v)}
                    disabled={validando === v.id}
                    className="rounded bg-emerald-600 px-2 py-1 text-[12px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {validando === v.id ? "…" : "Está bien"}
                  </button>
                  <button
                    onClick={() => setABorrar(v)}
                    disabled={borrando === v.id}
                    title="Borrarlo del todo. Solo si no tiene historial."
                    className="rounded border border-rose-700 px-2 py-1 text-[12px] font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    {borrando === v.id ? "…" : "Eliminar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <button
          onClick={alternarFijado}
          title={fijado
            ? "El filtro se mantiene al cambiar de pantalla y al recargar. Pulsa para soltarlo."
            : "Fija el filtro actual para trabajar solo con este cliente sin que se pierda al ir y volver."}
          className={`rounded-lg border px-2 py-1.5 text-[12px] font-bold ${
            fijado ? "border-amber-500 bg-amber-500/15 text-amber-300" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}>
          {fijado ? "🔒 Fijado" : "🔓 Fijar"}
        </button>
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
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300"
          title="Los vehículos dados de baja no se enseñan salvo que los pidas"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-sky-500"
            checked={fEstado !== "activos"}
            onChange={(e) => setFEstado(e.target.checked ? "todos" : "activos")}
          />
          Ver también los de baja
        </label>
        <span className="text-xs text-slate-500">{visibles.length} vehículo(s)</span>
        {fijado && (
          <span className="text-[11px] text-amber-300">
            Filtro fijado{fEmpresa ? `: ${empresas.find((e) => e.id === fEmpresa)?.nombre ?? ""}` : ""} · se mantiene al salir y volver
          </span>
        )}
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          {([
            ["empresa", "Empresa"], ["matricula", "Matrícula"], ["unidad", "Nº unidad"], ["delegacion", "Delegación"],
            ["marca", "Marca"], ["config", "Config."], ["medida", "Medida"], ["km", "Km"],
          ] as [Columna, string][]).map(([col, label]) => (
            <th key={col} className={`${thCls} cursor-pointer select-none hover:text-slate-100`}
              onClick={() => ordenarPor(col)} title={`Ordenar por ${label.toLowerCase()}`}>
              {label}{orden.col === col && <span className="ml-1 text-sky-300">{orden.asc ? "▲" : "▼"}</span>}
            </th>
          ))}
          <th className={thCls}>Telemática</th>
          <th className={`${thCls} cursor-pointer select-none hover:text-slate-100`}
            onClick={() => ordenarPor("estado")} title="Ordenar por estado">
            Estado{orden.col === "estado" && <span className="ml-1 text-sky-300">{orden.asc ? "▲" : "▼"}</span>}
          </th>
          <th className={thCls}>Acciones</th>
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
              <td className={tdCls + " text-slate-400"}><CeldaMarca vehiculo={v} catalogo={marcasVeh} /></td>
              <td className={tdCls + " text-slate-400"}>{v.config_ejes?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.medidas_por_eje ? "por eje" : (medidas.find((m) => m.id === v.medida_id)?.valor ?? "—")}</td>
              <td className={tdCls + " text-slate-400"}>{Number(v.km_actual).toLocaleString("es-ES")}</td>
              <td className={tdCls}>
                {(() => {
                  const est = estados.get(v.id);
                  const e = est?.estado ?? "sin_dispositivo";
                  const conectores = conectoresDe(v, telematicaPorVehiculo);
                  /*
                   * El estado de Webfleet solo se enseña si el vehículo ES de
                   * Webfleet.
                   *
                   * La sincronización de Webfleet recorre TODOS los vehículos
                   * activos de TODAS las empresas y escribe `sin_dispositivo`
                   * al que no tiene `webfleet_vehicle_id`. Eso llenaba la
                   * columna de «SIN WEBFLEET» en autobuses de Movertis, donde
                   * es verdad y no significa nada: no les falta un equipo, es
                   * que su equipo es de otro proveedor.
                   */
                  const esDeWebfleet = conectores.includes("webfleet");
                  // Para los demás, dónde está según el barrido del Hub, que
                  // sí sabe de cualquier proveedor.
                  const ubic = esDeWebfleet
                    ? null
                    : ubicacionDeVehiculo({ presencia: presencias.get(v.id) });
                  const enBase = e === "en_base" || e === "otra_base";
                  const revisar = enBase && esPendiente(v.id);
                  // Nombre de la base donde está (delegación detectada por Webfleet).
                  const baseNom = est?.delegacion?.nombre;
                  const enBaseTxt = `EN BASE${baseNom ? " " + baseNom.toUpperCase() : ""}`;
                  // Posición con más de 30 min (GPS dormido, típico aparcado en
                  // base): se sigue mostrando en base, con aviso de antigüedad.
                  const posAntigua = enBase && est?.pos_time != null
                    && Date.now() - new Date(est.pos_time).getTime() > 30 * 60 * 1000;
                  return (
                    <div className="flex flex-col items-start gap-1">
                      {/*
                        Qué telemática lleva. Antes esta columna solo sabía de
                        Webfleet y le decía «SIN WEBFLEET» a un autobús con
                        Movertis montado desde hace meses.
                      */}
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          conectores.length
                            ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                            : "bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/40"
                        }`}
                      >
                        {etiquetaTelematica(conectores).toUpperCase()}
                      </span>
                      {/*
                        El estado de posición, que hoy solo lo da Webfleet. Va
                        aparte: es OTRA cosa que saber de quién es el equipo, y
                        cuando otro proveedor sepa darlo cabrá aquí igual.
                      */}
                      {/*
                        La ubicación de los que no son de Webfleet. No es un
                        botón: el detalle que abre el otro es de Webfleet y no
                        aplica aquí. Si no se sabe dónde está, no se pone nada:
                        la chapa de arriba ya dice de quién es el equipo.
                      */}
                      {ubic && ubic.tono !== "desconocido" && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            ubic.tono === "base"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : ubic.tono === "ruta"
                                ? "bg-sky-500/15 text-sky-300"
                                : "bg-amber-500/15 text-amber-300"
                          }`}
                          title={ubic.detalle}
                        >
                          {ubic.texto.toUpperCase()}
                        </span>
                      )}
                      {est && esDeWebfleet && (
                        <button
                          onClick={() => setPopup({ v, est })}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${revisar ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/60" : ESTADO_WEBFLEET_BADGE[e]}`}
                          title={posAntigua ? "Última posición con más de 30 min (GPS dormido) · Ver detalle" : "Ver detalle"}
                        >
                          {revisar
                            ? `🟢 ${enBaseTxt} · REVISAR`
                            : enBase
                              ? `${ESTADO_WEBFLEET_PUNTO[e]} ${enBaseTxt}${posAntigua ? " · POS. ANT." : ""}`
                              : `${ESTADO_WEBFLEET_PUNTO[e]} ${ESTADO_WEBFLEET_LABELS[e].toUpperCase()}${posAntigua ? " · POS. ANT." : ""}`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className={tdCls}><Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge></td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/vehiculos/${v.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  <button onClick={() => setEditando({ vehiculo: v })} className="text-slate-300 hover:underline">Editar</button>
                  <button onClick={async () => { await actualizarVehiculo(v.id, { activo: !v.activo }); await cargar(); }} className="text-amber-300 hover:underline">{v.activo ? "Desactivar" : "Activar"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {/*
        Confirmar el borrado. Se dice qué vehículo es y qué va a pasar, en
        vez de un «¿seguro?» que nadie lee: de la lista de pendientes, todas
        las matrículas se parecen.
      */}
      {aBorrar && (
        <Modal title="Eliminar vehículo" onClose={() => { setABorrar(null); setMotivoNoBorrado(null); }}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => { setABorrar(null); setMotivoNoBorrado(null); }} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">
              {motivoNoBorrado ? "Cerrar" : "Cancelar"}
            </button>
            {/* Si ya se sabe que no se puede borrar, se retira el botón: dejarlo
                ahí solo invita a pulsarlo otra vez para el mismo resultado. */}
            {!motivoNoBorrado && (
              <button onClick={() => void eliminar(aBorrar)} disabled={borrando === aBorrar.id}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {borrando === aBorrar.id ? "Eliminando…" : "Eliminar de verdad"}
              </button>
            )}
          </div>}>
          {motivoNoBorrado && (
            <div className="mb-3 rounded-lg border border-amber-600/50 bg-amber-500/10 p-3">
              <div className="text-[12px] font-bold uppercase text-amber-300">No se puede eliminar</div>
              <div className="mt-1 text-sm text-amber-100">{motivoNoBorrado}</div>
              <div className="mt-2 text-[12px] text-amber-200/80">
                Darlo de baja deja de sacarlo en las listas y conserva la vida de sus neumáticos.
              </div>
              <button
                onClick={() => void darDeBaja(aBorrar)}
                disabled={borrando === aBorrar.id}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {borrando === aBorrar.id ? "Dando de baja…" : `Dar de baja ${aBorrar.matricula}`}
              </button>
            </div>
          )}
          <div className="text-sm text-slate-200">
            Se va a borrar <span className="font-mono font-bold">{aBorrar.matricula}</span>
            {aBorrar.numero_unidad ? ` · unidad ${aBorrar.numero_unidad}` : ""} de{" "}
            {aBorrar.empresa?.nombre ?? "su empresa"}.
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-slate-400">
            <li>No tiene vuelta atrás.</li>
            <li>
              Solo se borra si no tiene <strong>nada</strong> detrás: ni revisiones, ni neumáticos
              montados, ni operaciones, ni intervenciones, ni incidencias. Si tiene algo, no se
              borra y se dice qué tiene.
            </li>
            <li>
              Para un vehículo que sí se ha usado, lo que toca es <strong>darlo de baja</strong>:
              deja de salir en las listas y conserva la vida de sus neumáticos.
            </li>
          </ul>
        </Modal>
      )}

      {editando && (
        <EditorVehiculo
          vehiculo={editando.vehiculo}
          matriculasExistentes={new Set(items.map((v) => v.matricula.toUpperCase()))}
          onClose={() => setEditando(null)}
          onGuardado={async () => { setMsg("✔ Guardado"); await cargar(); }}
        />
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
