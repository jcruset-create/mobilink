import { useEffect, useRef, useState } from "react";
import type { MontajeActual, Neumatico, PosicionVehiculo, TipoVehiculo } from "../types";
import {
  listarNeumaticosDisponibles, montarNeumatico, desmontarNeumatico, rotarNeumatico,
  actualizarImagenChasis, guardarCoordenadasPosicion, listarUltimasMedicionesVehiculo, listarPresionesCatalogoPorModelo,
  listarFotosCatalogoPorModelo, claveModeloCatalogo,
} from "../services/data";
import { inputCls } from "./ui";
import ModalMontarDesdeFicha from "./ModalMontarDesdeFicha";
import ModalMontarFueraAlmacen from "./ModalMontarFueraAlmacen";
import { supabase } from "../services/supabase";

const BUCKET_CHASIS = "tc-chasis";

async function subirImagenChasis(tipoId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop() || "png";
  const ruta = `${tipoId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET_CHASIS).upload(ruta, file, { upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET_CHASIS).getPublicUrl(ruta).data.publicUrl;
}

interface Coords { x: number; y: number; w: number; h: number; }

const DEFAULT_W = 9;
const DEFAULT_H = 13;

// Posición de partida en cascada para posiciones aún sin calibrar,
// para que sean visibles y arrastrables aunque no tengan pos_x/y en BD.
function defaultCoords(index: number): Coords {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return { x: col === 0 ? 8 : 83, y: 10 + row * 18, w: DEFAULT_W, h: DEFAULT_H };
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
  imagenFallback?: string | null; // imagen heredada de la configuración de ejes (si el tipo no tiene propia)
  onFicha?: (neumaticoId: string) => void;
  onChanged?: () => void;
  onTipoChanged?: () => void;
}

export default function VehicleLayoutImage({
  tipo, posiciones, vehiculoId, empresaId, montajes, editable, puedeCalibrar, imagenFallback, onFicha, onChanged, onTipoChanged,
}: Props) {
  // Imagen efectiva del plano: la del tipo de vehículo si existe; si no,
  // la heredada de la configuración de ejes del vehículo.
  const imagenBase = tipo?.imagen_chasis_url ?? imagenFallback ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Record<string, Coords>>({});
  const [calibrando, setCalibrando] = useState(false);
  const [urlDraft, setUrlDraft] = useState(imagenBase ?? "");
  const [saving, setSaving] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState("");
  const [aspecto, setAspecto] = useState(16 / 9);
  const [medicionesActuales, setMedicionesActuales] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});
  const [presionesCatalogo, setPresionesCatalogo] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!vehiculoId) return;
    listarUltimasMedicionesVehiculo(vehiculoId).then(setMedicionesActuales).catch(() => setMedicionesActuales({}));
  }, [vehiculoId, montajes]);

  useEffect(() => {
    listarPresionesCatalogoPorModelo().then(setPresionesCatalogo).catch(() => setPresionesCatalogo({}));
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
    posiciones.forEach((p, i) => { next[p.codigo_posicion] = coordsDe(p, i); });
    setCoords(next);
    setUrlDraft(imagenBase ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posiciones, tipo?.id, imagenBase]);

  const posicionPorCodigo = new Map(posiciones.map((p) => [p.codigo_posicion, p]));
  const montajePorPosicionId = new Map(montajes.map((m) => [m.posicion_id, m]));

  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [disponibles, setDisponibles] = useState<Neumatico[]>([]);
  const [neumaticoElegido, setNeumaticoElegido] = useState("");
  const [menuContextual, setMenuContextual] = useState<{ codigo: string; x: number; y: number } | null>(null);
  const [modalFicha, setModalFicha] = useState<null | { sustitucion: boolean }>(null);
  const [modalFueraAlmacen, setModalFueraAlmacen] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [zonaSobrevolada, setZonaSobrevolada] = useState<string | null>(null);

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

  function zonaEn(x: number, y: number): string | null {
    for (const [codigo, c] of Object.entries(coords)) {
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
      setCoords((prev) => ({ ...prev, [arrastrando]: { ...prev[arrastrando], x: Math.max(0, Math.min(100 - prev[arrastrando].w, p.x - prev[arrastrando].w / 2)), y: Math.max(0, Math.min(100 - prev[arrastrando].h, p.y - prev[arrastrando].h / 2)) } }));
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
    try { await rotarNeumatico({ montajeOrigenId: montajeOrigen.id, posicionDestinoId: posDestino.id }); onChanged?.(); }
    catch (e: any) { setMsg(e?.message || "Error al rotar"); } finally { setSaving(false); }
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
        if (!c) continue;
        await guardarCoordenadasPosicion(p.id, { pos_x: c.x, pos_y: c.y, pos_w: c.w, pos_h: c.h });
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
        Este vehículo no tiene imagen de chasis: ni el tipo ({tipo?.nombre ?? "—"}) ni su configuración de ejes tienen una asociada.
        {puedeCalibrar ? (
          <div className="mt-3">
            <button onClick={() => setCalibrando(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">Añadir imagen y calibrar posiciones</button>
          </div>
        ) : (
          <div className="mt-1 text-[11px]">Usa la vista de lista más abajo. Pide a un administrador SEA que cargue la imagen.</div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <div>
        {puedeCalibrar && (
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
              <button onClick={() => setCalibrando(true)} className="rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200">✎ Editar posiciones / imagen</button>
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
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                if (naturalWidth && naturalHeight) setAspecto(naturalWidth / naturalHeight);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">Sube o pega la URL de la imagen arriba…</div>
          )}

          {posiciones.map((p) => {
            const c = coords[p.codigo_posicion];
            if (!c) return null;
            const m = montajePorPosicionId.get(p.id);
            const ocupado = !!m?.neumatico;
            const esArrastre = arrastrando === p.codigo_posicion;
            const esDestino = zonaSobrevolada === p.codigo_posicion;
            return (
              <div
                key={p.id}
                className="absolute flex flex-col items-center justify-center rounded-lg border-2 pointer-events-auto"
                style={{
                  left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`,
                  minWidth: ocupado && !calibrando ? "108px" : undefined, minHeight: ocupado && !calibrando ? "84px" : undefined,
                  borderColor: esDestino ? "#38bdf8" : calibrando ? "#f59e0b" : ocupado ? "#22c55e" : "#64748b",
                  borderStyle: ocupado || calibrando ? "solid" : "dashed",
                  background: esDestino ? "rgba(56,189,248,0.25)" : ocupado ? "rgba(15,23,42,0.8)" : "rgba(15,23,42,0.25)",
                  opacity: esArrastre && !calibrando ? 0.35 : 1,
                  cursor: calibrando ? "move" : (editable && ocupado) ? "grab" : "pointer",
                }}
                onPointerDown={(e) => onPointerDownZona(e, p.codigo_posicion)}
                onClick={() => { if (!arrastrando && !calibrando) setSeleccion(seleccion === p.codigo_posicion ? null : p.codigo_posicion); }}
                onDoubleClick={() => { if (m?.neumatico && !calibrando) onFicha?.(m.neumatico.id); }}
                onContextMenu={(e) => {
                  if (!editable || calibrando || !m?.neumatico) return;
                  e.preventDefault();
                  setMenuContextual({ codigo: p.codigo_posicion, x: e.clientX, y: e.clientY });
                }}
              >
                {calibrando ? (
                  <span className="pointer-events-none px-1 text-center text-[10px] font-bold leading-tight text-slate-100">{p.codigo_posicion}</span>
                ) : ocupado ? (() => {
                  const neu = m!.neumatico!;
                  const medicion = medicionesActuales[neu.id];
                  const profundidad = medicion?.profundidad_mm ?? neu.profundidad_actual_mm ?? null;
                  const claveCatalogo = neu.marca && neu.modelo && neu.medida ? `${neu.marca}|${neu.modelo}|${neu.medida}`.toLowerCase().replace(/\s+/g, "") : "";
                  const presion = medicion?.presion_bar ?? neu.producto_almacen?.referencia?.presion_maxima_bar ?? presionesCatalogo[claveCatalogo] ?? null;
                  const indices = [neu.indice_carga, neu.indice_velocidad].filter(Boolean).join("");
                  return (
                    <span className="pointer-events-none px-1 text-center text-[9px] leading-tight text-slate-100">
                      <div className="font-bold">{neu.marca ?? "—"}</div>
                      <div>{neu.modelo ?? "—"}</div>
                      <div>{neu.medida ?? "—"}{indices ? ` ${indices}` : ""}</div>
                      <div className="text-slate-300">
                        {profundidad != null ? `${profundidad}mm` : "— mm"}
                        {" · "}
                        {presion != null ? `${presion}bar` : "— bar"}
                      </div>
                    </span>
                  );
                })() : (
                  <span className="pointer-events-none px-1 text-center text-[10px] font-bold leading-tight text-slate-100">Libre</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        {calibrando ? (
          <div className="text-sm text-slate-400">
            Arrastra cada recuadro sobre la rueda correspondiente en la imagen. El tamaño por defecto es aproximado; ajusta la imagen para que encaje o pide una imagen recortada al chasis.
          </div>
        ) : !posSeleccionada ? (
          <div className="text-sm text-slate-500">Selecciona una posición del plano.</div>
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
              const profundidad = medicion?.profundidad_mm ?? neu.profundidad_actual_mm ?? null;
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
                    {fila("Presión recom.", presionRecom != null ? `${presionRecom} bar` : "")}
                    {fila("Última prof.", profundidad != null ? `${profundidad} mm` : "")}
                    {fila("Última pres.", presionMedida != null ? `${presionMedida} bar` : "")}
                    {fila("Montado", `${montajeSeleccionado.fecha_montaje}${montajeSeleccionado.km_montaje != null ? ` · ${montajeSeleccionado.km_montaje} km` : ""}`)}
                  </div>
                </div>
              );
            })()}
            <div className="mt-3 flex flex-col gap-2">
              <button onClick={() => onFicha?.(montajeSeleccionado.neumatico!.id)} className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200">Ver ficha</button>
              {editable && <button onClick={() => setModalFicha({ sustitucion: true })} className="rounded bg-sky-600 px-2 py-1 text-[12px] font-bold text-white">Sustituir</button>}
              {editable && <button onClick={confirmarDesmontar} disabled={saving} className="rounded bg-rose-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50">Desmontar</button>}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">{posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}</div>
            <div className="mt-1 text-xs text-slate-500">Posición libre.</div>
            {editable && (
              <div className="mt-2 flex flex-col gap-2">
                <button onClick={() => setModalFicha({ sustitucion: false })} className="w-full rounded bg-emerald-600 px-2 py-1 text-[12px] font-bold text-white">Montar desde ficha genérica</button>
                {disponibles.length > 0 && (
                  <>
                    <select className={`${inputCls} text-[12px]`} value={neumaticoElegido} onChange={(e) => setNeumaticoElegido(e.target.value)}>
                      <option value="">…o elegir neumático ya existente</option>
                      {disponibles.map((n) => <option key={n.id} value={n.id}>{n.numero_interno ?? n.codigo_interno ?? n.numero_serie} · {n.marca} {n.medida}</option>)}
                    </select>
                    <button onClick={confirmarMontar} disabled={saving || !neumaticoElegido} className="w-full rounded border border-emerald-600 px-2 py-1 text-[12px] font-bold text-emerald-300 disabled:opacity-50">Montar seleccionado</button>
                  </>
                )}
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
          posicionId={posSeleccionada.id}
          montajeActualId={modalFicha.sustitucion ? montajeSeleccionado?.id : undefined}
          onClose={() => setModalFicha(null)}
          onDone={() => { setModalFicha(null); setSeleccion(null); onChanged?.(); }}
        />
      )}
      {modalFueraAlmacen && posSeleccionada && (
        <ModalMontarFueraAlmacen
          posicionNombre={posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}
          vehiculoId={vehiculoId}
          posicionId={posSeleccionada.id}
          onClose={() => setModalFueraAlmacen(false)}
          onDone={() => { setModalFueraAlmacen(false); setSeleccion(null); onChanged?.(); }}
        />
      )}
    </div>
  );
}
