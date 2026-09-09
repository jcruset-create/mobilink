import { useEffect, useRef, useState } from "react";
import { profundidadVigente } from "../utils/profundidad";
import type { MontajeActual, Neumatico, PosicionVehiculo, TipoVehiculo } from "../types";
import { presionTxt } from "../types";
import {
  listarNeumaticosDisponibles, montarNeumatico, desmontarNeumatico,
  cambiarPosicion, intercambiarPosiciones, aplicarPlanTrabajo, listarMarcasRecauchutadas,
  actualizarImagenChasis, guardarCoordenadasPosicion, guardarOrdenRevisionPosicion, listarUltimasMedicionesVehiculo, listarPresionesCatalogoPorModelo,
  listarFotosCatalogoPorModelo, claveModeloCatalogo, listarProfundidadesCatalogoPorModelo,
  buscarNeumaticosParaCorregir, corregirMontado,
} from "../services/data";
import { inputCls, Modal } from "./ui";
import { mismaMedida } from "../services/medidas";
import ModalMontarDesdeFicha from "./ModalMontarDesdeFicha";
import ModalMontarFueraAlmacen from "./ModalMontarFueraAlmacen";
import ModalCopiarNeumatico from "./ModalCopiarNeumatico";
import { supabase } from "../services/supabase";
import { MARGEN_PLANO_X, MARGEN_PLANO_Y, aspectoPlano, coordAVista, vistaACoord } from "../../../../shared/planoMargen";

const BUCKET_CHASIS = "tc-chasis";

async function subirImagenChasis(tipoId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop() || "png";
  const ruta = `${tipoId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET_CHASIS).upload(ruta, file, { upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET_CHASIS).getPublicUrl(ruta).data.publicUrl;
}

interface Coords { x: number; y: number; w: number; h: number; }

// Todos los recuadros miden lo mismo y son lo bastante grandes para que
// quepa dentro marca, modelo, medida, profundidad y presión.
const DEFAULT_W = 14;
const DEFAULT_H = 14;

// El ANCHO no lleva suelo en píxeles a propósito: el recuadro mide
// exactamente su porcentaje, que es lo único que garantiza que dos recuadros
// del mismo eje no se pisen entre ellos ni se metan encima del chasis por
// estrecha que sea la pantalla. El alto sí, porque crecer hacia abajo no
// invade a nadie: los ejes van bien separados.
const MIN_H_PX = "84px";

// Posición de partida en cascada para posiciones aún sin calibrar,
// para que sean visibles y arrastrables aunque no tengan pos_x/y en BD.
function defaultCoords(index: number): Coords {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return { x: col === 0 ? 8 : 83, y: 10 + row * 18, w: DEFAULT_W, h: DEFAULT_H };
}

// Etiqueta corta de la posición para encima del recuadro: "Eje 2 izq ext".
function etiquetaPosicion(p: PosicionVehiculo): string {
  if (p.eje == null) return p.nombre ?? p.codigo_posicion;
  return `Eje ${p.eje}${p.lado ? ` ${p.lado}` : ""}${p.interior_exterior ? ` ${p.interior_exterior}` : ""}`;
}

function coordsDe(p: PosicionVehiculo, index: number): Coords {
  if (p.pos_x != null && p.pos_y != null && p.pos_w != null && p.pos_h != null) {
    return { x: p.pos_x, y: p.pos_y, w: p.pos_w, h: p.pos_h };
  }
  return defaultCoords(index);
}

interface Props {
  tipo?: TipoVehiculo | null;
  posiciones: PosicionVehiculo[];
  vehiculoId: string;
  empresaId: string;
  montajes: MontajeActual[];
  editable: boolean;         // puede montar/desmontar/rotar
  puedeCalibrar: boolean;    // superadmin: puede editar imagen y coordenadas
  imagenConfig?: string | null; // imagen de la configuración de ejes: manda sobre la del tipo
  medidaPorPosicionId?: Record<string, string>; // medida configurada del vehículo por posición (para montar en vacío)
  onFicha?: (neumaticoId: string) => void;
  onChanged?: () => void;
  onTipoChanged?: () => void;
  onOperaciones?: () => void; // abre el histórico de operaciones del vehículo
}

// Acciones del plan de trabajo (mismo catálogo y orden que la APK).
const ACCIONES_PLAN: Record<string, { label: string; icono: string }> = {
  mover: { label: "Permutar / mover", icono: "⇄" },
  reescultura: { label: "Reesculturar", icono: "✂" },
  giro: { label: "Girar sobre llanta", icono: "↻" },
  pinchazo: { label: "Reparar pinchazo", icono: "🛠" },
  valvula: { label: "Cambiar válvula", icono: "◎" },
  equilibrado: { label: "Equilibrar", icono: "⚖" },
};
const MM_REESCULTURA_DEFECTO = 8;

function esDireccional(modelo?: string | null): boolean {
  const txt = (modelo ?? "").toUpperCase();
  return txt.includes("DIREC") || txt.endsWith(" D") || txt.includes(" DH");
}

export default function VehicleLayoutImage({
  tipo, posiciones, vehiculoId, empresaId, montajes, editable, puedeCalibrar, imagenConfig, medidaPorPosicionId, onFicha, onChanged, onTipoChanged, onOperaciones,
}: Props) {
  // Imagen efectiva del plano: manda la de la CONFIGURACIÓN DE EJES (un 2x4
  // se dibuja igual sea tractora o camión); la del tipo solo si la
  // configuración no tiene ninguna.
  const imagenBase = imagenConfig ?? tipo?.imagen_chasis_url ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Record<string, Coords>>({});
  const [ordenRev, setOrdenRev] = useState<Record<string, string>>({}); // posId → orden de revisión (texto)
  const [calibrando, setCalibrando] = useState(false);
  const [urlDraft, setUrlDraft] = useState(imagenBase ?? "");
  const [saving, setSaving] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState("");
  // El recuadro se ajusta a la proporción real de cada imagen: así el plano
  // se ve completo, sin franjas negras, y las ruedas caen donde se
  // calibraron (las coordenadas van en % de este recuadro).
  const [aspecto, setAspecto] = useState(16 / 9);
  const [medicionesActuales, setMedicionesActuales] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});
  const [presionesCatalogo, setPresionesCatalogo] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!vehiculoId) return;
    listarUltimasMedicionesVehiculo(vehiculoId).then(setMedicionesActuales).catch(() => setMedicionesActuales({}));
  }, [vehiculoId, montajes]);

  const [profundidadesCatalogo, setProfundidadesCatalogo] = useState<Record<string, number>>({});
  useEffect(() => {
    listarPresionesCatalogoPorModelo().then(setPresionesCatalogo).catch(() => setPresionesCatalogo({}));
    listarProfundidadesCatalogoPorModelo().then(setProfundidadesCatalogo).catch(() => setProfundidadesCatalogo({}));
  }, []);

  // Fotos de modelo del catálogo (heredadas por marca+modelo).
  const [fotosCatalogo, setFotosCatalogo] = useState<Record<string, string>>({});
  useEffect(() => {
    listarFotosCatalogoPorModelo().then(setFotosCatalogo).catch(() => setFotosCatalogo({}));
  }, []);

  async function onArchivoSeleccionado(file: File | undefined) {
    if (!file || !tipo) return;
    setSubiendo(true); setMsg("");
    try {
      const url = await subirImagenChasis(tipo.id, file);
      setUrlDraft(url);
    } catch (e: any) { setMsg(e?.message || "Error al subir la imagen"); } finally { setSubiendo(false); }
  }

  useEffect(() => {
    const next: Record<string, Coords> = {};
    const orden: Record<string, string> = {};
    posiciones.forEach((p, i) => {
      next[p.codigo_posicion] = coordsDe(p, i);
      orden[p.id] = p.orden_revision != null ? String(p.orden_revision) : "";
    });
    setCoords(next);
    setOrdenRev(orden);
    setUrlDraft(imagenBase ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posiciones, tipo?.id, imagenBase]);

  const posicionPorCodigo = new Map(posiciones.map((p) => [p.codigo_posicion, p]));
  const montajePorPosicionId = new Map(montajes.map((m) => [m.posicion_id, m]));
  const posicionesLibres = posiciones.filter((p) => !montajePorPosicionId.get(p.id));

  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [disponibles, setDisponibles] = useState<Neumatico[]>([]);
  // Por defecto solo se ofrecen los de la medida del vehículo; esto lo abre.
  const [verTodasMedidas, setVerTodasMedidas] = useState(false);
  const [neumaticoElegido, setNeumaticoElegido] = useState("");
  const [menuContextual, setMenuContextual] = useState<{ codigo: string; x: number; y: number } | null>(null);

  // "No coincide": la goma que hay puesta no es la que Mobilink dice. Es una
  // CORRECCIÓN DE FICHA, no un trabajo: no se monta ni se desmonta nada.
  const [correccion, setCorreccion] = useState<{ montajeId: string } | null>(null);
  const [correccionBusqueda, setCorreccionBusqueda] = useState("");
  const [correccionOpciones, setCorreccionOpciones] = useState<Neumatico[]>([]);
  const [correccionElegido, setCorreccionElegido] = useState("");
  const [correccionObs, setCorreccionObs] = useState("");
  const [correccionMsg, setCorreccionMsg] = useState("");
  const [modalFicha, setModalFicha] = useState<null | { sustitucion: boolean }>(null);
  const [modalBulk, setModalBulk] = useState(false);
  const [modalFueraAlmacen, setModalFueraAlmacen] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [zonaSobrevolada, setZonaSobrevolada] = useState<string | null>(null);

  // ── Copiar un neumático ya montado a varias posiciones libres ──
  // Primero se toca el neumático origen, después las posiciones destino.
  const [copiando, setCopiando] = useState(false);
  const [copiaOrigen, setCopiaOrigen] = useState<string | null>(null);   // código de posición
  const [copiaDestinos, setCopiaDestinos] = useState<string[]>([]);      // códigos de posición
  const [modalCopiar, setModalCopiar] = useState(false);

  function cerrarCopia() {
    setCopiando(false); setCopiaOrigen(null); setCopiaDestinos([]); setModalCopiar(false);
  }

  function tapCopia(p: PosicionVehiculo) {
    const ocupado = !!montajePorPosicionId.get(p.id)?.neumatico;
    if (!copiaOrigen) {
      if (!ocupado) { setMsg("Primero toca el neumático que quieres copiar (uno ya montado)."); return; }
      setMsg(""); setCopiaOrigen(p.codigo_posicion);
      return;
    }
    if (p.codigo_posicion === copiaOrigen) { setCopiaOrigen(null); setCopiaDestinos([]); return; }
    if (ocupado) { setMsg("Esa posición ya tiene neumático; solo se copia sobre posiciones libres."); return; }
    setMsg("");
    setCopiaDestinos((prev) => prev.includes(p.codigo_posicion)
      ? prev.filter((c) => c !== p.codigo_posicion)
      : [...prev, p.codigo_posicion]);
  }

  // ── Plan de trabajo (misma mecánica que la APK): se elige la acción y se
  // marcan las ruedas; nada toca la BD hasta "Aplicar plan". ──
  const [planAbierto, setPlanAbierto] = useState(false);
  const [accionActiva, setAccionActiva] = useState<string | null>(null);
  const [permutaA, setPermutaA] = useState<string | null>(null); // posición origen del movimiento en curso
  const [planMov, setPlanMov] = useState<Record<string, string>>({}); // posiciónDestino → montajeId
  const [marcasPlan, setMarcasPlan] = useState<Record<string, string[]>>({}); // montajeId → acciones
  const [mmRees, setMmRees] = useState<Record<string, number>>({}); // montajeId → mm tras el corte
  const [modalAplicar, setModalAplicar] = useState(false);

  // Marcas de recauchutado (INSA…): distintivo RECAUCH. heredado de la marca.
  const [marcasRecau, setMarcasRecau] = useState<Set<string>>(new Set());
  useEffect(() => { listarMarcasRecauchutadas().then(setMarcasRecau).catch(() => {}); }, []);
  const esRecauMarca = (marca?: string | null) => !!marca && marcasRecau.has(marca.trim().toUpperCase());

  const montajePorId = new Map(montajes.map((m) => [m.id, m]));
  const codigoPorPosId = new Map(posiciones.map((p) => [p.id, p.codigo_posicion]));

  // Qué rueda acabará en esta posición según el plan.
  function ocupantePrevisto(posId: string): string | null {
    if (planMov[posId]) return planMov[posId];
    const m = montajes.find((x) => x.posicion_id === posId);
    if (!m) return null;
    if (Object.values(planMov).includes(m.id)) return null; // se marcha a otro sitio
    return m.id;
  }

  const movimientosPlan = Object.entries(planMov)
    .map(([destinoId, montajeId]) => {
      const m = montajePorId.get(montajeId);
      if (!m || m.posicion_id === destinoId) return null;
      return { montajeId, origenId: m.posicion_id as string, destinoId };
    })
    .filter(Boolean) as Array<{ montajeId: string; origenId: string; destinoId: string }>;
  const totalMarcas = Object.values(marcasPlan).reduce((a, s) => a + s.length, 0);
  const totalPlan = movimientosPlan.length + totalMarcas;

  function cerrarPlan() {
    setPlanAbierto(false); setAccionActiva(null); setPermutaA(null);
    setPlanMov({}); setMarcasPlan({}); setMmRees({}); setModalAplicar(false);
  }

  function tapPlan(p: PosicionVehiculo) {
    if (!accionActiva) { setMsg("Elige una acción del plan (botones de arriba)."); return; }
    setMsg("");
    if (accionActiva === "mover") {
      if (!permutaA) {
        if (!ocupantePrevisto(p.id)) { setMsg("Empieza por una rueda: toca la que quieras mover."); return; }
        setPermutaA(p.id);
        return;
      }
      if (permutaA === p.id) { setPermutaA(null); return; }
      const ocupA = ocupantePrevisto(permutaA);
      const ocupB = ocupantePrevisto(p.id);
      if (!ocupA) { setPermutaA(null); return; }
      setPlanMov((prev) => {
        const next = { ...prev, [p.id]: ocupA };
        if (ocupB) next[permutaA] = ocupB; else delete next[permutaA];
        return next;
      });
      setPermutaA(null);
      return;
    }
    // Resto de acciones: un toque marca, otro desmarca.
    const ocupId = ocupantePrevisto(p.id);
    if (!ocupId) { setMsg("Esa posición no tiene neumático."); return; }
    const m = montajePorId.get(ocupId);
    const yaMarcada = (marcasPlan[ocupId] ?? []).includes(accionActiva);
    if (!yaMarcada && accionActiva === "giro" && esDireccional(m?.neumatico?.modelo)) {
      setMsg("Dibujo direccional: no se puede girar sobre la llanta.");
      return;
    }
    setMarcasPlan((prev) => {
      const set = new Set(prev[ocupId] ?? []);
      if (yaMarcada) set.delete(accionActiva); else set.add(accionActiva);
      const next = { ...prev };
      if (set.size) next[ocupId] = [...set]; else delete next[ocupId];
      return next;
    });
    if (accionActiva === "reescultura") {
      setMmRees((prev) => {
        const next = { ...prev };
        if (yaMarcada) delete next[ocupId]; else next[ocupId] = MM_REESCULTURA_DEFECTO;
        return next;
      });
    }
  }

  // Avisos que NO bloquean: medidas distintas y cruce de lado en los movimientos.
  function avisosPlan(): string[] {
    const avisos = new Set<string>();
    const izq = (c?: string | null) => (c ?? "").toUpperCase().includes("IZQ");
    const der = (c?: string | null) => (c ?? "").toUpperCase().includes("DER");
    for (const mv of movimientosPlan) {
      const na = montajePorId.get(mv.montajeId)?.neumatico;
      const nb = montajes.find((x) => x.posicion_id === mv.destinoId)?.neumatico;
      if (na?.medida && nb?.medida && na.medida !== nb.medida) {
        avisos.add(`Las medidas son distintas: ${na.medida} y ${nb.medida}.`);
      }
      const ca = codigoPorPosId.get(mv.origenId), cb = codigoPorPosId.get(mv.destinoId);
      if ((izq(ca) && der(cb)) || (der(ca) && izq(cb))) {
        avisos.add("Hay ruedas que cambian de lado: si el dibujo es direccional, girarían al revés.");
      }
    }
    return [...avisos];
  }

  async function confirmarAplicarPlan() {
    const acciones = [
      ...movimientosPlan.map((mv) => ({ tipo: "mover", montaje: mv.montajeId, posicion: mv.destinoId })),
      ...Object.entries(marcasPlan).flatMap(([mid, tipos]) =>
        tipos.map((t) => ({ tipo: t, montaje: mid, ...(t === "reescultura" ? { valor: mmRees[mid] ?? MM_REESCULTURA_DEFECTO } : {}) }))),
    ];
    if (!acciones.length) { setMsg("El plan está vacío: marca algo primero."); return; }
    setSaving(true); setMsg("");
    try {
      await aplicarPlanTrabajo({ vehiculoId, acciones });
      cerrarPlan();
      onChanged?.();
    } catch (e: any) { setMsg(e?.message || "No se pudo aplicar el plan"); setModalAplicar(false); }
    finally { setSaving(false); }
  }

  const posSeleccionada = seleccion ? posicionPorCodigo.get(seleccion) : null;
  const montajeSeleccionado = posSeleccionada ? montajePorPosicionId.get(posSeleccionada.id) : undefined;

  useEffect(() => {
    if (!seleccion || montajeSeleccionado || !editable || calibrando) { setDisponibles([]); return; }
    listarNeumaticosDisponibles(empresaId).then(setDisponibles);
  }, [seleccion, montajeSeleccionado, editable, calibrando, empresaId]);

  function puntoPct(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 };
  }

  // `coords` guarda el espacio de la base de datos; lo que se ve y se toca es
  // el plano dibujado (ver shared/planoMargen.ts), de ahí la conversión.
  function zonaEn(x: number, y: number): string | null {
    for (const [codigo, c0] of Object.entries(coords)) {
      const c = coordAVista(c0);
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return codigo;
    }
    return null;
  }

  function onPointerDownZona(e: React.PointerEvent, codigo: string) {
    if (calibrando) {
      if (!puedeCalibrar) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      setArrastrando(codigo);
      return;
    }
    // Con un plan abierto no se arrastra: el arrastre guarda al momento y se
    // mezclaría con lo apuntado sin aplicar. En modo copia solo se toca.
    if (planAbierto || copiando) return;
    if (!editable) return;
    const p = posicionPorCodigo.get(codigo);
    if (!p || !montajePorPosicionId.get(p.id)) return; // solo se arrastran posiciones ocupadas
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setArrastrando(codigo);
    setSeleccion(null);
  }

  function onPointerMoveContainer(e: React.PointerEvent) {
    if (!arrastrando) return;
    const p = puntoPct(e.clientX, e.clientY);
    if (calibrando) {
      setCoords((prev) => {
        const { w, h } = prev[arrastrando];
        // Se suelta en el plano dibujado y se guarda en el espacio de la BD.
        const v = { x: Math.max(0, Math.min(100 - w, p.x - w / 2)), y: Math.max(0, Math.min(100 - h, p.y - h / 2)), w, h };
        return { ...prev, [arrastrando]: vistaACoord(v) };
      });
    } else {
      const destino = zonaEn(p.x, p.y);
      setZonaSobrevolada(destino && destino !== arrastrando ? destino : null);
    }
  }

  async function onPointerUpContainer() {
    if (!arrastrando) return;
    if (calibrando) { setArrastrando(null); return; }
    const origenCodigo = arrastrando;
    const destinoCodigo = zonaSobrevolada;
    setArrastrando(null); setZonaSobrevolada(null);
    if (!origenCodigo || !destinoCodigo || origenCodigo === destinoCodigo) return;
    const posOrigen = posicionPorCodigo.get(origenCodigo);
    const posDestino = posicionPorCodigo.get(destinoCodigo);
    const montajeOrigen = posOrigen ? montajePorPosicionId.get(posOrigen.id) : undefined;
    if (!posOrigen || !posDestino || !montajeOrigen) return;
    setSaving(true); setMsg("");
    try {
      // Con traza: destino ocupado → intercambio; libre → cambio de posición.
      // (Antes se usaba tc_rotar_neumatico, que ni registraba la operación ni
      // dejaba moverla a un operador.)
      const montajeDestino = montajePorPosicionId.get(posDestino.id);
      if (montajeDestino) {
        await intercambiarPosiciones({ montajeAId: montajeOrigen.id, montajeBId: montajeDestino.id });
      } else {
        await cambiarPosicion({ montajeId: montajeOrigen.id, posicionDestinoId: posDestino.id });
      }
      onChanged?.();
    }
    catch (e: any) { setMsg(e?.message || "Error al mover"); } finally { setSaving(false); }
  }

  async function guardarCalibracion() {
    setSaving(true); setMsg("");
    try {
      // Solo se guarda en el tipo si el usuario cambió la URL respecto a la
      // imagen efectiva; así la heredada de la configuración de ejes no se
      // "copia" al tipo al calibrar posiciones sin tocar la imagen.
      if (tipo && urlDraft !== (imagenBase ?? "")) await actualizarImagenChasis(tipo.id, urlDraft || null);
      for (const p of posiciones) {
        const c = coords[p.codigo_posicion];
        if (c) await guardarCoordenadasPosicion(p.id, { pos_x: c.x, pos_y: c.y, pos_w: c.w, pos_h: c.h });
        // Orden de revisión: número o null si se deja vacío (recorrido por defecto).
        const raw = (ordenRev[p.id] ?? "").trim();
        const orden = raw === "" ? null : Number(raw);
        if (orden === null || Number.isFinite(orden)) {
          if ((p.orden_revision ?? null) !== orden) await guardarOrdenRevisionPosicion(p.id, orden);
        }
      }
      setCalibrando(false); onTipoChanged?.();
    } catch (e: any) { setMsg(e?.message || "Error al guardar calibración"); } finally { setSaving(false); }
  }

  async function confirmarMontar() {
    if (!posSeleccionada || !neumaticoElegido) return;
    setSaving(true); setMsg("");
    try {
      await montarNeumatico({ vehiculoId, neumaticoId: neumaticoElegido, posicionId: posSeleccionada.id, km: null, fecha: new Date().toISOString().slice(0, 10), observaciones: null });
      setSeleccion(null); setNeumaticoElegido(""); onChanged?.();
    } catch (e: any) { setMsg(e?.message || "Error al montar"); } finally { setSaving(false); }
  }

  // Se busca al abrir y a cada tecla, con una espera corta: el técnico teclea
  // el número que ve en el flanco y quiere verlo aparecer, no darle a un botón.
  useEffect(() => {
    if (!correccion) { setCorreccionOpciones([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      buscarNeumaticosParaCorregir(empresaId, correccionBusqueda)
        .then((r) => { if (vivo) setCorreccionOpciones(r); })
        .catch(() => { if (vivo) setCorreccionOpciones([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [correccion, correccionBusqueda, empresaId]);

  async function confirmarCorreccion() {
    if (!correccion || !correccionElegido) return;
    setSaving(true); setCorreccionMsg("");
    try {
      await corregirMontado({
        montajeId: correccion.montajeId,
        neumaticoCorrectoId: correccionElegido,
        observaciones: correccionObs.trim() || null,
        // Desde el panel se elige una ficha que ya existe, buscándola.
        metodo: "busqueda",
      });
      setCorreccion(null); setSeleccion(null); onChanged?.();
    } catch (e: any) {
      setCorreccionMsg(e?.message || "Error en la corrección");
    } finally { setSaving(false); }
  }

  async function confirmarDesmontar() {
    if (!montajeSeleccionado) return;
    setSaving(true); setMsg("");
    try { await desmontarNeumatico({ montajeId: montajeSeleccionado.id, km: null, motivo: "desgaste", destino: "almacen", observaciones: null }); setSeleccion(null); onChanged?.(); }
    catch (e: any) { setMsg(e?.message || "Error al desmontar"); } finally { setSaving(false); }
  }

  async function enviarA(codigo: string, destino: "reparacion" | "descartado") {
    const pos = posicionPorCodigo.get(codigo);
    const m = pos ? montajePorPosicionId.get(pos.id) : undefined;
    setMenuContextual(null);
    if (!m) return;
    setSaving(true); setMsg("");
    try { await desmontarNeumatico({ montajeId: m.id, km: null, motivo: destino === "reparacion" ? "reparacion" : "descarte", destino, observaciones: null }); setSeleccion(null); onChanged?.(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  if (!imagenBase && !calibrando) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-8 text-center text-sm text-slate-500">
        Este vehículo no tiene imagen de chasis. Súbela en Configuración → Configuración de ejes:
        la comparten todos los vehículos con la misma configuración. Si no, se usa la del tipo ({tipo?.nombre ?? "—"}).
        {puedeCalibrar ? (
          <div className="mt-3">
            <button onClick={() => setCalibrando(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">Añadir imagen y calibrar posiciones</button>
          </div>
        ) : (
          <div className="mt-1 text-[11px]">Usa la vista de lista más abajo. Pide a un administrador Mobilink que cargue la imagen.</div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <div>
        {/* Cabecera del plano: Cambiar (plan de trabajo, como en la APK) +
            Operaciones + calibración. */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {calibrando ? (
            <>
              <label className="rounded border border-sky-600 px-3 py-1.5 text-[12px] font-bold text-sky-300 cursor-pointer">
                {subiendo ? "Subiendo…" : "📁 Subir imagen desde el ordenador"}
                <input type="file" accept="image/*" className="hidden" disabled={subiendo}
                  onChange={(e) => onArchivoSeleccionado(e.target.files?.[0])} />
              </label>
              <input className={`${inputCls} flex-1 text-[12px]`} placeholder="…o pega la URL de la imagen" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
              <button onClick={guardarCalibracion} disabled={saving || subiendo} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Guardar calibración</button>
              <button onClick={() => setCalibrando(false)} className="rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200">Cancelar</button>
            </>
          ) : (
            <>
              {editable && !planAbierto && !copiando && (
                <button onClick={() => { setPlanAbierto(true); setAccionActiva("mover"); setSeleccion(null); }}
                  className="rounded-lg bg-sky-600 px-5 py-1.5 text-[13px] font-bold text-white hover:bg-sky-500">⇄ Cambiar</button>
              )}
              {editable && !planAbierto && !copiando && montajes.length > 0 && posicionesLibres.length > 0 && (
                <button onClick={() => { setCopiando(true); setSeleccion(null); setMsg(""); }}
                  className="rounded-lg border border-violet-600 px-3 py-1.5 text-[12px] font-bold text-violet-300 hover:bg-violet-900/40">⧉ Copiar</button>
              )}
              {onOperaciones && (
                <button onClick={onOperaciones} className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-slate-700">🕐 Operaciones</button>
              )}
              {puedeCalibrar && !planAbierto && !copiando && (
                <button onClick={() => setCalibrando(true)} className="rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200">✎ Editar posiciones / imagen</button>
              )}
            </>
          )}
        </div>

        {copiando && (
          <div className="mb-2 rounded-lg border border-violet-700/60 bg-violet-950/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[12px] font-bold text-violet-300">
                {!copiaOrigen
                  ? "COPIAR · Toca el neumático que quieres copiar."
                  : copiaDestinos.length === 0
                    ? `COPIAR ${posicionPorCodigo.get(copiaOrigen)?.nombre ?? copiaOrigen} · Ahora toca las posiciones libres donde quieres la copia.`
                    : `COPIAR ${posicionPorCodigo.get(copiaOrigen)?.nombre ?? copiaOrigen} · ${copiaDestinos.length} destino(s). Vuelve a tocar una para quitarla.`}
              </span>
              <button onClick={() => setModalCopiar(true)} disabled={!copiaOrigen || copiaDestinos.length === 0}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40">
                ⧉ Confirmar copia ({copiaDestinos.length})
              </button>
              <button onClick={cerrarCopia} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">Salir</button>
            </div>
          </div>
        )}

        {planAbierto && (
          <div className="mb-2 rounded-lg border border-sky-700/60 bg-sky-950/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[12px] font-bold text-sky-300">
                {accionActiva == null
                  ? "PLAN DE TRABAJO · Elige una acción y toca las ruedas. Nada se guarda hasta aplicar."
                  : accionActiva !== "mover"
                    ? `${ACCIONES_PLAN[accionActiva].label.toUpperCase()} · Toca las ruedas afectadas. Nada se guarda hasta aplicar.`
                    : permutaA == null
                      ? "PERMUTAR / MOVER · Toca la rueda que quieres mover."
                      : "PERMUTAR / MOVER · Ahora toca el sitio de destino. (Vuelve a tocar la marcada para soltarla.)"}
              </span>
              <button onClick={cerrarPlan} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">Salir</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(ACCIONES_PLAN).map(([tipo, a]) => {
                const activo = accionActiva === tipo;
                const n = tipo === "mover" ? movimientosPlan.length : Object.values(marcasPlan).filter((s) => s.includes(tipo)).length;
                return (
                  <button key={tipo}
                    onClick={() => { setAccionActiva(activo ? null : tipo); setPermutaA(null); }}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold ${activo ? "border-sky-500 bg-sky-600 text-white" : "border-sky-700/70 text-sky-300 hover:bg-sky-900/40"}`}>
                    {a.icono} {a.label}{n > 0 ? ` (${n})` : ""}
                  </button>
                );
              })}
            </div>
            {(movimientosPlan.length > 0 || totalMarcas > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {movimientosPlan.map((mv) => (
                  <span key={`mv-${mv.destinoId}`} className="flex items-center gap-1 rounded-full border border-sky-700 bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-slate-100">
                    ⇄ {codigoPorPosId.get(mv.origenId)} → {codigoPorPosId.get(mv.destinoId)}
                    <button onClick={() => setPlanMov((prev) => { const n = { ...prev }; delete n[mv.destinoId]; return n; })}
                      className="ml-0.5 text-slate-400 hover:text-white">✕</button>
                  </span>
                ))}
                {Object.entries(marcasPlan).flatMap(([mid, tipos]) => tipos.map((t) => {
                  const m = montajePorId.get(mid);
                  const codigo = m?.posicion_id ? codigoPorPosId.get(m.posicion_id) : "—";
                  return (
                    <span key={`mk-${mid}-${t}`} className="flex items-center gap-1 rounded-full border border-sky-700 bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-slate-100">
                      {ACCIONES_PLAN[t]?.icono} {codigo} · {ACCIONES_PLAN[t]?.label ?? t}
                      <button onClick={() => {
                        setMarcasPlan((prev) => { const set = (prev[mid] ?? []).filter((x) => x !== t); const n = { ...prev }; if (set.length) n[mid] = set; else delete n[mid]; return n; });
                        if (t === "reescultura") setMmRees((prev) => { const n = { ...prev }; delete n[mid]; return n; });
                      }} className="ml-0.5 text-slate-400 hover:text-white">✕</button>
                    </span>
                  );
                }))}
                <button onClick={() => { setPlanMov({}); setMarcasPlan({}); setMmRees({}); setPermutaA(null); }}
                  className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">🗑 Vaciar plan</button>
                <button onClick={() => setModalAplicar(true)} disabled={saving || totalPlan === 0}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">✓ Aplicar plan ({totalPlan})</button>
              </div>
            )}
          </div>
        )}

        <div
          ref={containerRef}
          className="relative mx-auto w-full max-w-3xl select-none overflow-hidden rounded-lg bg-slate-950"
          style={{ aspectRatio: String(aspecto) }}
          onPointerMove={onPointerMoveContainer}
          onPointerUp={onPointerUpContainer}
        >
          {(calibrando ? urlDraft : imagenBase) ? (
            <img
              src={calibrando ? urlDraft : imagenBase!}
              alt={tipo?.nombre}
              // La imagen va MÁS PEQUEÑA que el plano, con margen a los lados:
              // las coordenadas calibradas son del plano entero, así que los
              // recuadros de las ruedas exteriores pueden quedar al lado de la
              // rueda, fuera de la foto, sin salirse del área. Lo que sobra se
              // ve del fondo oscuro del contenedor (una imagen con
              // transparencia real se funde con él).
              className="absolute object-contain"
              style={{
                left: `${MARGEN_PLANO_X * 100}%`, top: `${MARGEN_PLANO_Y * 100}%`,
                width: `${(1 - 2 * MARGEN_PLANO_X) * 100}%`, height: `${(1 - 2 * MARGEN_PLANO_Y) * 100}%`,
              }}
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                if (naturalWidth && naturalHeight) setAspecto(aspectoPlano(naturalWidth / naturalHeight));
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">Sube o pega la URL de la imagen arriba…</div>
          )}

          {posiciones.map((p) => {
            const c0 = coords[p.codigo_posicion];
            if (!c0) return null;
            const c = coordAVista(c0);
            // En modo plan el plano enseña CÓMO VA A QUEDAR: cada posición
            // pinta la rueda que acabará ahí, con la etiqueta "viene de XX".
            const mReal = montajePorPosicionId.get(p.id);
            let m = mReal;
            let vieneDe: string | null = null;
            if (planAbierto) {
              const ocupId = ocupantePrevisto(p.id);
              m = ocupId ? montajePorId.get(ocupId) : undefined;
              if (m && m.posicion_id !== p.id) vieneDe = codigoPorPosId.get(m.posicion_id as string) ?? null;
            }
            const ocupado = !!m?.neumatico;
            const marcasDe = planAbierto && m ? (marcasPlan[m.id] ?? []) : [];
            const esOrigenPermuta = planAbierto && permutaA === p.id;
            const esArrastre = arrastrando === p.codigo_posicion;
            const esDestino = zonaSobrevolada === p.codigo_posicion;
            const esCopiaOrigen = copiando && copiaOrigen === p.codigo_posicion;
            const nCopia = copiando ? copiaDestinos.indexOf(p.codigo_posicion) + 1 : 0;
            const esCopiaDestino = nCopia > 0;
            return (
              <div
                key={p.id}
                className="absolute flex flex-col items-center justify-center rounded-lg border-2 pointer-events-auto"
                style={{
                  // El ancla es el CENTRO del recuadro, no su esquina: así el
                  // punto donde se suelta al calibrar es el mismo que se ve
                  // después, crezca o no el recuadro por su contenido.
                  left: `${c.x + c.w / 2}%`, top: `${c.y + c.h / 2}%`, transform: "translate(-50%, -50%)",
                  width: `${c.w}%`, height: `${c.h}%`, minHeight: MIN_H_PX,
                  borderColor: (esCopiaOrigen || esCopiaDestino) ? "#a855f7" : esOrigenPermuta ? "#38bdf8" : esDestino ? "#38bdf8" : calibrando ? "#f59e0b" : (planAbierto && (vieneDe || marcasDe.length)) ? "#38bdf8" : ocupado ? "#22c55e" : "#64748b",
                  borderWidth: esCopiaOrigen || esOrigenPermuta ? 3 : 2,
                  borderStyle: ocupado || calibrando || esCopiaDestino ? "solid" : "dashed",
                  background: esCopiaDestino ? "rgba(168,85,247,0.25)" : esDestino ? "rgba(56,189,248,0.25)" : ocupado ? "rgba(15,23,42,0.8)" : "rgba(15,23,42,0.25)",
                  opacity: esArrastre && !calibrando ? 0.35 : 1,
                  cursor: calibrando ? "move" : copiando ? "pointer" : (editable && ocupado && !planAbierto) ? "grab" : "pointer",
                }}
                onPointerDown={(e) => onPointerDownZona(e, p.codigo_posicion)}
                onClick={() => {
                  if (arrastrando || calibrando) return;
                  if (copiando) { tapCopia(p); return; }
                  if (planAbierto) { tapPlan(p); return; }
                  setSeleccion(seleccion === p.codigo_posicion ? null : p.codigo_posicion);
                }}
                onDoubleClick={() => { if (m?.neumatico && !calibrando) onFicha?.(m.neumatico.id); }}
                onContextMenu={(e) => {
                  if (!editable || calibrando || !m?.neumatico) return;
                  e.preventDefault();
                  setMenuContextual({ codigo: p.codigo_posicion, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Encima de cada recuadro, siempre, de qué rueda se trata. */}
                <span className={`pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-bold ${
                  esCopiaOrigen ? "bg-violet-600 text-white" : calibrando ? "bg-slate-900/90 text-amber-300" : "bg-slate-900/90 text-slate-300"}`}>
                  {esCopiaOrigen ? `ORIGEN · ${etiquetaPosicion(p)}` : etiquetaPosicion(p)}
                </span>
                {calibrando ? (
                  <span className="pointer-events-none px-1 text-center text-[10px] font-bold leading-tight text-slate-100">{p.codigo_posicion}</span>
                ) : ocupado ? (() => {
                  const neu = m!.neumatico!;
                  const medicion = medicionesActuales[neu.id];
                  const claveCatalogo = neu.marca && neu.modelo && neu.medida ? `${neu.marca}|${neu.modelo}|${neu.medida}`.toLowerCase().replace(/\s+/g, "") : "";
                  // Sin medición propia se enseña la de fábrica del catálogo,
                  // igual que hace la tablet: una rueda recién montada no está
                  // "sin datos", está nueva.
                  const profundidad = profundidadVigente(medicion, neu) ?? profundidadesCatalogo[claveCatalogo] ?? null;
                  const presion = medicion?.presion_bar ?? neu.producto_almacen?.referencia?.presion_maxima_bar ?? presionesCatalogo[claveCatalogo] ?? null;
                  const indices = [neu.indice_carga, neu.indice_velocidad].filter(Boolean).join("");
                  const distintivos = [
                    esRecauMarca(neu.marca) ? "RECAUCH." : null,
                    neu.reesculturado ? "REESC." : null,
                    neu.girado_en_llanta ? "GIRADO" : null,
                  ].filter(Boolean);
                  return (
                    <span className="pointer-events-none px-1 text-center text-[9px] leading-tight text-slate-100">
                      <div className="font-bold">{neu.marca ?? "—"}</div>
                      <div>{neu.modelo ?? "—"}</div>
                      <div>{neu.medida ?? "—"}{indices ? ` ${indices}` : ""}</div>
                      <div className="text-slate-300">
                        {profundidad != null ? `${profundidad}mm` : "— mm"}
                        {" · "}
                        {presion != null ? `${presionTxt(presion)}bar` : "— bar"}
                      </div>
                      {distintivos.length > 0 && (
                        <div className="font-bold text-sky-300">{distintivos.join(" · ")}</div>
                      )}
                      {vieneDe && <div className="mt-0.5 rounded bg-sky-600/80 px-1 font-bold text-white">viene de {vieneDe}</div>}
                      {marcasDe.length > 0 && (
                        <div className="mt-0.5 font-bold text-sky-300">
                          {marcasDe.map((t) => `${ACCIONES_PLAN[t]?.icono ?? ""} ${ACCIONES_PLAN[t]?.label ?? t}`).join(" · ")}
                        </div>
                      )}
                    </span>
                  );
                })() : (
                  <span className={`pointer-events-none px-1 text-center text-[10px] font-bold leading-tight ${esCopiaDestino ? "text-violet-200" : "text-slate-100"}`}>
                    {esCopiaDestino ? `COPIA ${nCopia}` : "Libre"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        {calibrando ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-400">
              Arrastra cada recuadro sobre la rueda correspondiente en la imagen. El recuadro se ve con su tamaño real y se ancla por el centro, así que queda donde lo sueltas. Encima de cada uno aparece la posición (eje y lado).
            </div>
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Orden de revisión (tablet)</div>
              <div className="mb-2 text-[11px] text-slate-500">
                Número en que el técnico revisa cada rueda (1, 2, 3…). Déjalo vacío para usar el recorrido en círculo por defecto (derecha delante→atrás, izquierda atrás→delante).
              </div>
              <div className="space-y-1">
                {[...posiciones]
                  .sort((a, b) => (a.orden_revision ?? 9999) - (b.orden_revision ?? 9999) || a.orden_visual - b.orden_visual)
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <input
                        type="number" min={1} inputMode="numeric"
                        className={`${inputCls} w-16 text-center text-[12px]`}
                        value={ordenRev[p.id] ?? ""}
                        onChange={(e) => setOrdenRev((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="—"
                      />
                      <span className="text-[12px] text-slate-200">{p.nombre ?? p.codigo_posicion}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : copiando ? (
          <div>
            <div className="text-[11px] font-bold uppercase text-violet-300">Modo copia</div>
            <div className="mt-1 text-xs text-slate-400">
              Toca primero el neumático que quieres copiar y después las posiciones libres donde quieres la copia.
              Se copian marca, modelo, medida e índices; no se descuenta stock.
            </div>
          </div>
        ) : !posSeleccionada ? (
          <div>
            <div className="text-sm text-slate-500">Selecciona una posición del plano.</div>
            {editable && posicionesLibres.length > 1 && (
              <button onClick={() => setModalBulk(true)} className="mt-3 w-full rounded bg-emerald-600 px-2 py-1.5 text-[12px] font-bold text-white">
                Montar el mismo en todas las libres ({posicionesLibres.length})
              </button>
            )}
          </div>
        ) : montajeSeleccionado?.neumatico ? (
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">{posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}</div>
            {(() => {
              const foto = fotosCatalogo[claveModeloCatalogo(montajeSeleccionado.neumatico.marca, montajeSeleccionado.neumatico.modelo)];
              return foto ? <img src={foto} alt={montajeSeleccionado.neumatico.modelo ?? ""} className="mt-2 max-h-28 w-full rounded bg-slate-950 object-contain" /> : null;
            })()}
            {(() => {
              const neu = montajeSeleccionado.neumatico;
              const medicion = medicionesActuales[neu.id];
              const claveCatalogo = neu.marca && neu.modelo && neu.medida ? `${neu.marca}|${neu.modelo}|${neu.medida}`.toLowerCase().replace(/\s+/g, "") : "";
              const profundidad = profundidadVigente(medicion, neu) ?? profundidadesCatalogo[claveCatalogo] ?? null;
              const presionMedida = medicion?.presion_bar ?? null;
              const presionRecom = neu.producto_almacen?.referencia?.presion_maxima_bar ?? presionesCatalogo[claveCatalogo] ?? null;
              const indices = [neu.indice_carga, neu.indice_velocidad].filter(Boolean).join("/");
              const fila = (l: string, v: string) => (
                <div className="flex justify-between gap-2 border-t border-slate-700/50 py-1">
                  <span className="text-[11px] text-slate-500">{l}</span>
                  <span className="text-right text-[12px] font-semibold text-slate-200">{v || "—"}</span>
                </div>
              );
              return (
                <div className="mt-2">
                  <div className="text-sm font-bold text-slate-100">{neu.codigo_interno ?? neu.numero_serie ?? "—"}</div>
                  <div className="mt-2">
                    {fila("Marca", neu.marca ?? "")}
                    {fila("Modelo", neu.modelo ?? "")}
                    {fila("Medida", neu.medida ?? "")}
                    {fila("IC / CV", indices)}
                    {neu.dot ? fila("DOT", neu.dot) : null}
                    {fila("Presión recom.", presionRecom != null ? `${presionTxt(presionRecom)} bar` : "")}
                    {fila("Última prof.", profundidad != null ? `${profundidad} mm` : "")}
                    {fila("Última pres.", presionMedida != null ? `${presionTxt(presionMedida)} bar` : "")}
                    {fila("Montado", `${montajeSeleccionado.fecha_montaje}${montajeSeleccionado.km_montaje != null ? ` · ${montajeSeleccionado.km_montaje} km` : ""}`)}
                  </div>
                </div>
              );
            })()}
            <div className="mt-3 flex flex-col gap-2">
              {/* Sin onFicha (cliente) el boton no llevaria a ninguna parte: la
                  ficha de neumatico es una pantalla de administrador. */}
              {onFicha && <button onClick={() => onFicha(montajeSeleccionado.neumatico!.id)} className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200">Ver ficha</button>}
              {editable && <button onClick={() => setModalFicha({ sustitucion: true })} className="rounded bg-sky-600 px-2 py-1 text-[12px] font-bold text-white">Sustituir</button>}
              {editable && <button onClick={confirmarDesmontar} disabled={saving} className="rounded bg-rose-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50">Desmontar</button>}
              {/* No va en la barra de Operaciones y no es un descuido: ahí
                  todo genera trabajo, y esto no. Confundir "corregir" con
                  "cambiar" es la forma más fácil de meter en el histórico un
                  montaje que nunca ocurrió. Va con la rueda, discreto, porque
                  es la excepción. */}
              {editable && (
                <button
                  onClick={() => {
                    setCorreccion({ montajeId: montajeSeleccionado.id });
                    setCorreccionBusqueda(""); setCorreccionElegido("");
                    setCorreccionObs(""); setCorreccionMsg("");
                  }}
                  className="rounded border border-amber-500 px-2 py-1 text-[12px] font-bold text-amber-300 hover:bg-amber-500/10"
                >
                  ⚠ No coincide
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">{posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}</div>
            <div className="mt-1 text-xs text-slate-500">Posición libre.</div>
            {editable && (
              <div className="mt-2 flex flex-col gap-2">
                <button onClick={() => setModalFicha({ sustitucion: false })} className="w-full rounded bg-emerald-600 px-2 py-1 text-[12px] font-bold text-white">Montar desde ficha genérica</button>
                {disponibles.length > 0 && (() => {
                  // Solo los que sirven para esta posición: la medida que el
                  // vehículo tiene configurada. Se compara la medida base
                  // porque el almacén la escribe con índices ("385/65 R22.5 158L").
                  const medidaPos = medidaPorPosicionId?.[posSeleccionada.id] ?? null;
                  const compatibles = medidaPos && !verTodasMedidas
                    ? disponibles.filter((n) => mismaMedida(n.medida, medidaPos))
                    : disponibles;
                  return (
                    <>
                      <select className={`${inputCls} text-[12px]`} value={neumaticoElegido} onChange={(e) => setNeumaticoElegido(e.target.value)}>
                        <option value="">…o elegir neumático ya existente</option>
                        {compatibles.map((n) => <option key={n.id} value={n.id}>{n.numero_interno ?? n.codigo_interno ?? n.numero_serie} · {n.marca} {n.medida}</option>)}
                      </select>
                      {medidaPos && (
                        <label className="flex items-center gap-1 text-[11px] text-slate-400">
                          <input type="checkbox" checked={verTodasMedidas} onChange={(e) => { setVerTodasMedidas(e.target.checked); setNeumaticoElegido(""); }} />
                          Ver todas las medidas (por defecto solo {medidaPos})
                        </label>
                      )}
                      {compatibles.length === 0 && (
                        <div className="text-[11px] text-amber-300">
                          No hay neumáticos libres de la medida {medidaPos}. Marca «ver todas» si quieres montar otra.
                        </div>
                      )}
                      <button onClick={confirmarMontar} disabled={saving || !neumaticoElegido} className="w-full rounded border border-emerald-600 px-2 py-1 text-[12px] font-bold text-emerald-300 disabled:opacity-50">Montar seleccionado</button>
                    </>
                  );
                })()}
                <button onClick={() => setModalFueraAlmacen(true)} className="w-full rounded border border-amber-600 px-2 py-1 text-[12px] font-bold text-amber-300">Montar fuera de almacén</button>
              </div>
            )}
          </div>
        )}
        {msg && <div className="mt-2 text-[11px] text-red-300">{msg}</div>}
      </div>

      {menuContextual && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuContextual(null)} />
          <div className="fixed z-50 min-w-[180px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl" style={{ left: menuContextual.x, top: menuContextual.y }}>
            <button onClick={() => { const p = posicionPorCodigo.get(menuContextual.codigo); const m = p ? montajePorPosicionId.get(p.id) : undefined; setMenuContextual(null); if (m?.neumatico) onFicha?.(m.neumatico.id); }} className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-slate-700">Ver ficha</button>
            <button onClick={() => enviarA(menuContextual.codigo, "reparacion")} className="block w-full px-3 py-1.5 text-left text-[12px] text-sky-300 hover:bg-slate-700">Enviar a reparación</button>
            <button onClick={() => enviarA(menuContextual.codigo, "descartado")} className="block w-full px-3 py-1.5 text-left text-[12px] text-rose-300 hover:bg-slate-700">Descartar neumático</button>
          </div>
        </>
      )}

      {modalFicha && posSeleccionada && (
        <ModalMontarDesdeFicha
          posicionNombre={posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}
          vehiculoId={vehiculoId}
          empresaId={empresaId}
          posicionId={posSeleccionada.id}
          montajeActualId={modalFicha.sustitucion ? montajeSeleccionado?.id : undefined}
          medidaActual={montajeSeleccionado?.neumatico?.medida ?? medidaPorPosicionId?.[posSeleccionada.id]}
          onClose={() => setModalFicha(null)}
          onDone={() => { setModalFicha(null); setSeleccion(null); onChanged?.(); }}
        />
      )}
      {modalBulk && posicionesLibres.length > 0 && (
        <ModalMontarDesdeFicha
          posicionNombre={`${posicionesLibres.length} posiciones libres`}
          vehiculoId={vehiculoId}
          empresaId={empresaId}
          posicionId={posicionesLibres[0].id}
          posicionesBulk={posicionesLibres.map((p) => p.id)}
          medidaActual={medidaPorPosicionId?.[posicionesLibres[0].id]}
          onClose={() => setModalBulk(false)}
          onDone={() => { setModalBulk(false); setSeleccion(null); onChanged?.(); }}
        />
      )}
      {modalFueraAlmacen && posSeleccionada && (
        <ModalMontarFueraAlmacen
          posicionNombre={posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}
          vehiculoId={vehiculoId}
          posicionId={posSeleccionada.id}
          medidaVehiculo={medidaPorPosicionId?.[posSeleccionada.id] ?? null}
          onClose={() => setModalFueraAlmacen(false)}
          onDone={() => { setModalFueraAlmacen(false); setSeleccion(null); onChanged?.(); }}
        />
      )}

      {modalCopiar && (() => {
        const pOrigen = copiaOrigen ? posicionPorCodigo.get(copiaOrigen) : null;
        const neu = pOrigen ? montajePorPosicionId.get(pOrigen.id)?.neumatico : null;
        if (!pOrigen || !neu) return null;
        return (
          <ModalCopiarNeumatico
            vehiculoId={vehiculoId}
            origen={neu}
            nombreOrigen={pOrigen.nombre ?? pOrigen.codigo_posicion}
            destinos={copiaDestinos.map((c) => {
              const p = posicionPorCodigo.get(c)!;
              return { id: p.id, nombre: p.nombre ?? p.codigo_posicion };
            })}
            onClose={() => setModalCopiar(false)}
            onDone={() => { cerrarCopia(); onChanged?.(); }}
          />
        );
      })()}

      {correccion && (() => {
        const m = montajes.find((x) => x.id === correccion.montajeId);
        const actual = m?.neumatico;
        const elegido = correccionOpciones.find((n) => n.id === correccionElegido);
        return (
          <Modal
            title="No coincide: corregir el neumático registrado"
            onClose={() => setCorreccion(null)}
            footer={
              <div className="flex justify-end gap-2">
                <button onClick={() => setCorreccion(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
                <button onClick={confirmarCorreccion} disabled={saving || !correccionElegido}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "Corrigiendo…" : "Corregir el registro"}
                </button>
              </div>
            }
          >
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-[12px] text-amber-200">
                Esto <b>no es un trabajo de taller</b>: no se registra montaje ni desmontaje y no
                genera coste ni mano de obra. Solo corrige qué neumático dice Mobilink que hay en
                esta posición, para que coincida con lo que hay de verdad.
                <div className="mt-1">
                  El que estaba mal registrado pasa a <b>no localizado</b>, no al almacén: que la
                  ficha estuviera mal no significa que la goma esté en la estantería.
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                  <div className="text-[11px] font-bold uppercase text-slate-500">Lo que hay registrado</div>
                  <div className="mt-1 font-semibold text-slate-100">{actual?.numero_interno ?? actual?.codigo_interno ?? actual?.numero_serie ?? "—"}</div>
                  <div className="text-[12px] text-slate-400">{[actual?.marca, actual?.modelo, actual?.medida].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/5 p-3">
                  <div className="text-[11px] font-bold uppercase text-emerald-500">Lo que hay de verdad</div>
                  <div className="mt-1 font-semibold text-slate-100">{elegido ? (elegido.numero_interno ?? elegido.codigo_interno ?? elegido.numero_serie ?? "—") : "Elígelo abajo"}</div>
                  <div className="text-[12px] text-slate-400">{elegido ? [elegido.marca, elegido.modelo, elegido.medida].filter(Boolean).join(" · ") : "—"}</div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase text-slate-400">Buscar la ficha</label>
                <input className={inputCls} placeholder="Nº interno, nº de serie, RFID o DOT"
                       value={correccionBusqueda} onChange={(e) => { setCorreccionBusqueda(e.target.value); setCorreccionElegido(""); }} />
                {/* No salen las montadas: ofrecer una que ya rueda en otro
                    vehículo solo sirve para que la base de datos lo rechace
                    después. Sí salen las no localizadas y las usadas, que es
                    donde suele estar la goma cuando el registro estaba mal. */}
                <select className={`${inputCls} mt-2`} size={8} value={correccionElegido}
                        onChange={(e) => setCorreccionElegido(e.target.value)}>
                  {correccionOpciones.map((n) => (
                    <option key={n.id} value={n.id}>
                      {(n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? n.id.slice(0, 8))}
                      {" · "}{[n.marca, n.medida].filter(Boolean).join(" ")}
                      {" · "}{n.estado}
                    </option>
                  ))}
                </select>
                {correccionOpciones.length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-300">
                    No hay ninguna ficha libre que encaje. Si la goma que has encontrado no está
                    dada de alta, créala primero desde el catálogo de neumáticos.
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase text-slate-400">Por qué se corrige</label>
                <input className={inputCls} placeholder="P. ej.: revisión en papel del 01/09, la rueda no era la fichada"
                       value={correccionObs} onChange={(e) => setCorreccionObs(e.target.value)} />
              </div>

              {correccionMsg && <div className="text-[12px] text-red-300">{correccionMsg}</div>}
            </div>
          </Modal>
        );
      })()}

      {modalAplicar && (
        <Modal title={`Aplicar plan (${totalPlan} acción${totalPlan === 1 ? "" : "es"})`} onClose={() => setModalAplicar(false)}
          footer={
            <>
              <button onClick={() => setModalAplicar(false)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              <button onClick={confirmarAplicarPlan} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "Aplicando…" : "Aplicar"}
              </button>
            </>
          }>
          <div className="space-y-1 text-[13px] text-slate-200">
            {movimientosPlan.map((mv) => (
              <div key={mv.destinoId}>⇄ {codigoPorPosId.get(mv.origenId)} → {codigoPorPosId.get(mv.destinoId)}</div>
            ))}
            {Object.keys(ACCIONES_PLAN).filter((t) => t !== "mover").map((tipo) => {
              const codigos = Object.entries(marcasPlan)
                .filter(([, tipos]) => tipos.includes(tipo))
                .map(([mid]) => { const m = montajePorId.get(mid); return m?.posicion_id ? codigoPorPosId.get(m.posicion_id) : "—"; });
              return codigos.length ? <div key={tipo} className="font-semibold">{ACCIONES_PLAN[tipo].icono} {ACCIONES_PLAN[tipo].label}: {codigos.join(", ")}</div> : null;
            })}
          </div>
          {Object.keys(mmRees).length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Profundidad que queda tras el corte (mm)</div>
              {Object.entries(mmRees).map(([mid, mm]) => {
                const m = montajePorId.get(mid);
                const codigo = m?.posicion_id ? codigoPorPosId.get(m.posicion_id) : "—";
                return (
                  <div key={mid} className="mt-1 flex items-center gap-2">
                    <span className="w-20 text-[13px] text-slate-200">{codigo}</span>
                    <input type="number" step="0.1" min="0" className={`${inputCls} w-24 text-[13px]`} value={mm}
                      onChange={(e) => { const d = parseFloat(e.target.value.replace(",", ".")); if (Number.isFinite(d)) setMmRees((prev) => ({ ...prev, [mid]: d })); }} />
                    <span className="text-[12px] text-slate-500">mm</span>
                  </div>
                );
              })}
            </div>
          )}
          {avisosPlan().length > 0 && (
            <div className="mt-3 space-y-1">
              {avisosPlan().map((a) => (
                <div key={a} className="text-[12px] font-semibold text-amber-300">⚠ {a}</div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
