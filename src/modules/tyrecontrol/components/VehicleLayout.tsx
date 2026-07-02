import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MontajeActual, Neumatico, PosicionVehiculo, TipoVehiculo } from "../types";
import type { ZoneRect } from "../vehicle-layouts/zones";
import { categoriaDeTipo, firmaDePosiciones, resolverLayout } from "../vehicle-layouts/manifest";
import TirePosition, { COLOR_ESTADO_VISUAL } from "./TirePosition";
import { listarNeumaticosDisponibles, montarNeumatico, desmontarNeumatico, rotarNeumatico } from "../services/data";
import { inputCls } from "./ui";

function puntoSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function zonaEn(zones: ZoneRect[], x: number, y: number): ZoneRect | null {
  return zones.find((z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height) ?? null;
}

interface VehicleLayoutProps {
  tipo?: TipoVehiculo | null;
  posiciones: PosicionVehiculo[];
  vehiculoId: string;
  empresaId: string;
  montajes: MontajeActual[];
  editable: boolean;
  onFicha?: (neumaticoId: string) => void;
  onChanged?: () => void;
}

// Motor gráfico de vehículos (Vehicle Layout Engine) — v1.
// Carga el plano SVG correcto según la geometría real del vehículo
// (derivada de sus posiciones, no de marca/modelo) y superpone los
// neumáticos como componentes React sobre las zonas del plano.
export default function VehicleLayout({ tipo, posiciones, vehiculoId, empresaId, montajes, editable, onFicha, onChanged }: VehicleLayoutProps) {
  const [markup, setMarkup] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState("0 0 1000 760");
  const [zones, setZones] = useState<ZoneRect[]>([]);
  const [noDisponible, setNoDisponible] = useState(false);
  const chassisRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  const [arrastrando, setArrastrando] = useState<string | null>(null); // codigo_posicion de origen
  const [zonaSobrevolada, setZonaSobrevolada] = useState<string | null>(null);
  const [rotando, setRotando] = useState(false);
  const [menuContextual, setMenuContextual] = useState<{ codigo: string; x: number; y: number } | null>(null);

  const categoria = categoriaDeTipo(tipo);
  const signature = firmaDePosiciones(posiciones);

  useEffect(() => {
    let cancel = false;
    setMarkup(null); setZones([]); setNoDisponible(false);
    if (!categoria || posiciones.length === 0) { setNoDisponible(true); return; }
    resolverLayout(categoria, signature).then((res) => {
      if (cancel) return;
      if (!res) { setNoDisponible(true); return; }
      setViewBox(res.viewBox); setMarkup(res.markup);
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, JSON.stringify(signature), posiciones.length]);

  // Tras montar el chasis SVG en el DOM, se leen las bboxes reales de
  // cada zona — nunca se calculan coordenadas a mano en React.
  useLayoutEffect(() => {
    if (!markup || !chassisRef.current) return;
    const nodes = Array.from(chassisRef.current.querySelectorAll<SVGGraphicsElement>("[data-position]"));
    const rects: ZoneRect[] = nodes.map((n) => {
      const bbox = n.getBBox();
      return {
        id: n.getAttribute("data-position")!,
        x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height,
        axle: n.getAttribute("data-axle") ? Number(n.getAttribute("data-axle")) : null,
        side: (n.getAttribute("data-side") as "izq" | "der") || null,
        io: (n.getAttribute("data-io") as "int" | "ext") || null,
      };
    });
    setZones(rects);
  }, [markup]);

  const posicionPorCodigo = new Map(posiciones.map((p) => [p.codigo_posicion, p]));
  const montajePorPosicionId = new Map(montajes.map((m) => [m.posicion_id, m]));

  const [seleccion, setSeleccion] = useState<string | null>(null); // codigo_posicion
  const [disponibles, setDisponibles] = useState<Neumatico[]>([]);
  const [neumaticoElegido, setNeumaticoElegido] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const posSeleccionada = seleccion ? posicionPorCodigo.get(seleccion) : null;
  const montajeSeleccionado = posSeleccionada ? montajePorPosicionId.get(posSeleccionada.id) : undefined;

  useEffect(() => {
    if (!seleccion || montajeSeleccionado || !editable) { setDisponibles([]); return; }
    listarNeumaticosDisponibles(empresaId).then(setDisponibles);
  }, [seleccion, montajeSeleccionado, editable, empresaId]);

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
    try {
      await desmontarNeumatico({ montajeId: montajeSeleccionado.id, km: null, motivo: "desgaste", destino: "almacen", observaciones: null });
      setSeleccion(null); onChanged?.();
    } catch (e: any) { setMsg(e?.message || "Error al desmontar"); } finally { setSaving(false); }
  }

  async function enviarA(codigo: string, destino: "reparacion" | "descartado") {
    const pos = posicionPorCodigo.get(codigo);
    const m = pos ? montajePorPosicionId.get(pos.id) : undefined;
    setMenuContextual(null);
    if (!m) return;
    setSaving(true); setMsg("");
    try {
      await desmontarNeumatico({ montajeId: m.id, km: null, motivo: destino === "reparacion" ? "reparacion" : "descarte", destino, observaciones: null });
      setSeleccion(null); onChanged?.();
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  // ── Drag & drop: rotar / intercambiar sobre el propio plano ──
  function iniciarArrastre(e: React.PointerEvent, codigo: string) {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setArrastrando(codigo);
    setSeleccion(null);
  }

  function moverArrastre(e: React.PointerEvent) {
    if (!arrastrando || !overlayRef.current) return;
    const p = puntoSvg(overlayRef.current, e.clientX, e.clientY);
    const z = zonaEn(zones, p.x, p.y);
    setZonaSobrevolada(z && z.id !== arrastrando ? z.id : null);
  }

  async function soltarArrastre() {
    const origenCodigo = arrastrando;
    const destinoCodigo = zonaSobrevolada;
    setArrastrando(null); setZonaSobrevolada(null);
    if (!origenCodigo || !destinoCodigo || origenCodigo === destinoCodigo) return;

    const posOrigen = posicionPorCodigo.get(origenCodigo);
    const posDestino = posicionPorCodigo.get(destinoCodigo);
    const montajeOrigen = posOrigen ? montajePorPosicionId.get(posOrigen.id) : undefined;
    if (!posOrigen || !posDestino || !montajeOrigen) return;

    setRotando(true); setMsg("");
    try {
      await rotarNeumatico({ montajeOrigenId: montajeOrigen.id, posicionDestinoId: posDestino.id });
      onChanged?.();
    } catch (e: any) { setMsg(e?.message || "Error al rotar"); } finally { setRotando(false); }
  }

  if (noDisponible) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-8 text-center text-sm text-slate-500">
        No hay un plano gráfico disponible todavía para esta configuración de vehículo.
        <div className="mt-1 text-[11px]">Usa la vista de lista más abajo. (Motor gráfico: se añaden planos progresivamente.)</div>
      </div>
    );
  }
  if (!markup) return <div className="rounded-lg bg-slate-800 p-8 text-center text-sm text-slate-500">Cargando plano…</div>;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <div className="relative w-full overflow-hidden rounded-lg bg-slate-950">
        <svg ref={chassisRef} viewBox={viewBox} className="absolute inset-0 h-full w-full text-slate-500" dangerouslySetInnerHTML={{ __html: markup }} />
        <svg
          ref={overlayRef}
          viewBox={viewBox}
          className="relative h-full w-full"
          style={{ aspectRatio: "1000 / 760" }}
          onPointerMove={moverArrastre}
          onPointerUp={soltarArrastre}
        >
          {zones.map((z) => (
            <TirePosition
              key={z.id}
              zone={z}
              montaje={montajePorPosicionId.get(posicionPorCodigo.get(z.id)?.id ?? "")}
              seleccionado={seleccion === z.id}
              draggable={editable}
              dragging={arrastrando === z.id}
              dragOver={zonaSobrevolada === z.id}
              onClick={() => { if (!arrastrando) setSeleccion(seleccion === z.id ? null : z.id); }}
              onDoubleClick={() => {
                const m = montajePorPosicionId.get(posicionPorCodigo.get(z.id)?.id ?? "");
                if (m?.neumatico) onFicha?.(m.neumatico.id);
              }}
              onContextMenu={(e) => {
                const m = montajePorPosicionId.get(posicionPorCodigo.get(z.id)?.id ?? "");
                if (!editable || !m?.neumatico) return;
                e.preventDefault();
                setMenuContextual({ codigo: z.id, x: e.clientX, y: e.clientY });
              }}
              onPointerDown={(e) => iniciarArrastre(e, z.id)}
            />
          ))}
        </svg>
        {rotando && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 text-xs font-bold text-slate-200">Rotando…</div>}
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-slate-400">
          {(Object.entries(COLOR_ESTADO_VISUAL) as [string, string][]).filter(([k]) => k !== "descartado").map(([k, c]) => (
            <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>
          ))}
        </div>
        {!posSeleccionada ? (
          <div className="text-sm text-slate-500">Selecciona una posición del plano.</div>
        ) : montajeSeleccionado?.neumatico ? (
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">{posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}</div>
            <div className="mt-1 text-sm font-bold text-slate-100">{montajeSeleccionado.neumatico.codigo_interno ?? montajeSeleccionado.neumatico.numero_serie}</div>
            <div className="text-xs text-slate-400">{montajeSeleccionado.neumatico.marca} {montajeSeleccionado.neumatico.medida}</div>
            <div className="mt-1 text-[10px] text-slate-500">Desde {montajeSeleccionado.fecha_montaje}{montajeSeleccionado.km_montaje != null ? ` · ${montajeSeleccionado.km_montaje} km` : ""}</div>
            <div className="mt-3 flex flex-col gap-2">
              <button onClick={() => onFicha?.(montajeSeleccionado.neumatico!.id)} className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200">Ver ficha</button>
              {editable && <button onClick={confirmarDesmontar} disabled={saving} className="rounded bg-rose-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50">Desmontar</button>}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">{posSeleccionada.nombre ?? posSeleccionada.codigo_posicion}</div>
            <div className="mt-1 text-xs text-slate-500">Posición libre.</div>
            {editable && (
              <div className="mt-2">
                <select className={`${inputCls} text-[12px]`} value={neumaticoElegido} onChange={(e) => setNeumaticoElegido(e.target.value)}>
                  <option value="">Elegir neumático de almacén…</option>
                  {disponibles.map((n) => <option key={n.id} value={n.id}>{n.codigo_interno ?? n.numero_serie} · {n.marca} {n.medida}</option>)}
                </select>
                <button onClick={confirmarMontar} disabled={saving || !neumaticoElegido} className="mt-2 w-full rounded bg-emerald-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50">Montar</button>
              </div>
            )}
          </div>
        )}
        {msg && <div className="mt-2 text-[11px] text-red-300">{msg}</div>}
      </div>

      {menuContextual && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuContextual(null)} />
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
            style={{ left: menuContextual.x, top: menuContextual.y }}
          >
            <button
              onClick={() => {
                const m = montajePorPosicionId.get(posicionPorCodigo.get(menuContextual.codigo)?.id ?? "");
                setMenuContextual(null);
                if (m?.neumatico) onFicha?.(m.neumatico.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-slate-700"
            >Ver ficha</button>
            <button onClick={() => enviarA(menuContextual.codigo, "reparacion")} className="block w-full px-3 py-1.5 text-left text-[12px] text-sky-300 hover:bg-slate-700">Enviar a reparación</button>
            <button onClick={() => enviarA(menuContextual.codigo, "descartado")} className="block w-full px-3 py-1.5 text-left text-[12px] text-rose-300 hover:bg-slate-700">Descartar neumático</button>
          </div>
        </>
      )}
    </div>
  );
}
