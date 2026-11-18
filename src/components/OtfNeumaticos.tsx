import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { MARGEN_PLANO_X, MARGEN_PLANO_Y, aspectoPlano, coordAVista } from "../../shared/planoMargen";

/**
 * Cambio de neumáticos en un trabajo de OTF: el plano del vehículo tal como
 * está en TyreControl (su imagen y sus ruedas calibradas) para marcar las
 * posiciones, y el catálogo de neumáticos de TyreControl para elegir cuál se
 * monta.
 *
 * Si la matrícula ya está en TyreControl, el plano es el suyo y cada rueda
 * enseña lo que lleva montado. Si no está, se elige el tipo de vehículo y se
 * dará de alta al registrar el montaje.
 */

export type PosicionPlano = {
  id: string; codigo: string; nombre: string; eje: number | null; lado: string | null;
  interiorExterior: string | null; x: number | null; y: number | null; w: number | null; h: number | null;
  montado: string | null;
};
type Tipo = { id: string; nombre: string; config: string | null; imagenUrl: string | null };
type Plano = { tipo: Tipo; imagenUrl: string | null; posiciones: PosicionPlano[] };
type Vehiculo = {
  estado: "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "MAPPING_ERROR" | "SIN_MATRICULA";
  motivo?: string; tcEmpresaId: string | null; empresaNombre: string | null;
  vehiculo: { id: string; tipoId: string | null; tipoNombre: string | null; medida: string | null } | null;
  plano: Plano | null; tipos: Tipo[];
};
type Referencia = { id: string; marca: string; modelo: string; medida: string; eje: string | null; texto: string };

/** Lo que se envía con el trabajo (server/otf/neumaticosTc.ts lo valida). */
export type NeumaticosTrabajo = {
  tcEmpresaId: string | null; tcVehiculoId: string | null; tcTipoVehiculoId: string;
  tipoNombre: string | null; config: string | null; imagenUrl: string | null;
  posiciones: PosicionPlano[]; seleccion: string[];
  referenciaId: string | null; marca: string | null; modelo: string | null; medida: string;
  condicion: "nuevo" | "usado"; destinoRetirado: "descartado" | "almacen" | "reparacion";
};

async function leer<T>(ruta: string): Promise<T> {
  const r = await fetch(`${API_BASE}${ruta}`, { headers: getAdminHeaders() });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "No se ha podido consultar TyreControl");
  return r.json();
}

const corto = (p: PosicionPlano) => {
  if (p.eje == null) return p.codigo;
  const lado = /^d/i.test(p.lado ?? "") ? "DER" : "IZQ";
  const ie = /^int/i.test(p.interiorExterior ?? "") ? " INT" : /^ext/i.test(p.interiorExterior ?? "") ? " EXT" : "";
  return `E${p.eje} ${lado}${ie}`;
};

/** El plano: imagen de TyreControl y una caja por rueda. Sin coordenadas, por ejes. */
export function PlanoRuedas({
  plano, seleccion, onToggle, compacto = false,
}: { plano: Pick<Plano, "imagenUrl" | "posiciones">; seleccion: string[]; onToggle?: (codigo: string) => void; compacto?: boolean }) {
  const [aspecto, setAspecto] = useState(0.6);
  const calibrado = plano.posiciones.length > 0 && plano.posiciones.every((p) => p.x != null && p.y != null);
  const caja = (p: PosicionPlano, estilo?: React.CSSProperties) => {
    const on = seleccion.includes(p.codigo);
    return (
      <button
        key={p.codigo}
        type="button"
        disabled={!onToggle}
        onClick={() => onToggle?.(p.codigo)}
        aria-pressed={on}
        title={p.nombre}
        style={estilo}
        className={`flex flex-col items-center justify-center overflow-hidden rounded-md border-2 px-0.5 text-center leading-tight ${
          on ? "border-orange-300 bg-orange-600 text-white" : "border-slate-500 bg-slate-900/85 text-slate-300"
        } ${onToggle ? "cursor-pointer hover:border-orange-400" : "cursor-default"}`}
      >
        <span className={`font-black ${compacto ? "text-[8px]" : "text-[10px]"}`}>{on ? "✓ " : ""}{corto(p)}</span>
        {!compacto && <span className="w-full truncate text-[9px] font-medium opacity-80">{p.montado ?? "vacía"}</span>}
      </button>
    );
  };

  if (!calibrado) {
    const ejes = [...new Set(plano.posiciones.map((p) => p.eje ?? 0))].sort((a, b) => a - b);
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-950 p-3">
        <span className="text-[10px] tracking-widest text-slate-500">DELANTE</span>
        {ejes.map((e) => (
          <div key={e} className="flex items-center gap-1">
            {plano.posiciones.filter((p) => (p.eje ?? 0) === e).map((p) => caja(p, { width: compacto ? 34 : 76, height: compacto ? 22 : 52 }))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="relative mx-auto w-full select-none overflow-hidden rounded-lg bg-slate-950" style={{ aspectRatio: String(aspecto), maxWidth: compacto ? 140 : 420 }}>
      {plano.imagenUrl && (
        <img
          src={plano.imagenUrl}
          alt="Plano del vehículo"
          draggable={false}
          className="absolute object-contain"
          style={{
            left: `${MARGEN_PLANO_X * 100}%`, top: `${MARGEN_PLANO_Y * 100}%`,
            width: `${(1 - 2 * MARGEN_PLANO_X) * 100}%`, height: `${(1 - 2 * MARGEN_PLANO_Y) * 100}%`,
          }}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth && naturalHeight) setAspecto(aspectoPlano(naturalWidth / naturalHeight));
          }}
        />
      )}
      {plano.posiciones.map((p) => {
        const c = coordAVista({ x: p.x!, y: p.y!, w: p.w ?? 14, h: p.h ?? 14 });
        return caja(p, { position: "absolute", left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%` });
      })}
    </div>
  );
}

export default function OtfNeumaticos({
  otfId, plate, onChange, inicial,
}: {
  otfId: number; plate: string; onChange: (n: NeumaticosTrabajo | null, falta: string | null) => void;
  /** Al editar un trabajo: lo que tenía marcado. Se aplica una vez, cuando llega su plano. */
  inicial?: NeumaticosTrabajo | null;
}) {
  const [veh, setVeh] = useState<Vehiculo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipoId, setTipoId] = useState("");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [medida, setMedida] = useState("");
  const [busca, setBusca] = useState("");
  const [refs, setRefs] = useState<Referencia[]>([]);
  const [ref, setRef] = useState<Referencia | null>(null);
  const [condicion, setCondicion] = useState<"nuevo" | "usado">("nuevo");
  const [destino, setDestino] = useState<"descartado" | "almacen" | "reparacion">("descartado");
  const porAplicar = useRef<NeumaticosTrabajo | null>(inicial ?? null);

  // Editando: en cuanto está el plano del mismo tipo, se recupera lo marcado.
  useEffect(() => {
    const ini = porAplicar.current;
    if (!ini || !plano) return;
    if (plano.tipo.id !== ini.tcTipoVehiculoId) return;
    porAplicar.current = null;
    const codigos = new Set(plano.posiciones.map((p) => p.codigo));
    setSeleccion(ini.seleccion.filter((c) => codigos.has(c)));
    setMedida(ini.medida);
    setCondicion(ini.condicion);
    setDestino(ini.destinoRetirado);
    if (ini.referenciaId) {
      setRef({
        id: ini.referenciaId, marca: ini.marca ?? "", modelo: ini.modelo ?? "", medida: ini.medida, eje: null,
        texto: [ini.marca, ini.modelo, ini.medida].filter(Boolean).join(" "),
      });
    } else if (ini.modelo) {
      setBusca(ini.modelo);
    }
  }, [plano]);

  // La matrícula: ¿está en TyreControl? Con antirrebote, mientras se escribe.
  const limpia = plate.toUpperCase().replace(/\s+/g, "");
  useEffect(() => {
    setVeh(null); setPlano(null); setSeleccion([]); setTipoId(""); setError(null);
    if (limpia.length < 5) return;
    let vivo = true;
    const t = setTimeout(() => {
      leer<Vehiculo>(`/api/otf/${otfId}/tc-vehiculo?plate=${encodeURIComponent(limpia)}`)
        .then((v) => {
          if (!vivo) return;
          setVeh(v);
          if (v.plano) { setPlano(v.plano); setTipoId(v.plano.tipo.id); }
          else if (porAplicar.current) setTipoId(porAplicar.current.tcTipoVehiculoId);
          if (v.vehiculo?.medida && !porAplicar.current) setMedida(v.vehiculo.medida);
        })
        .catch((e) => vivo && setError(e.message));
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [otfId, limpia]);

  // Vehículo nuevo: el plano del tipo elegido.
  useEffect(() => {
    if (!tipoId || veh?.estado === "FOUND") return;
    let vivo = true;
    setSeleccion([]);
    leer<Plano>(`/api/otf/tc/tipos/${tipoId}/plano`).then((p) => vivo && setPlano(p)).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [tipoId, veh?.estado]);

  // El catálogo de la medida.
  useEffect(() => {
    // El elegido se conserva mientras siga siendo de esa medida (al editar llega ya elegido).
    const norm = (m: string) => m.replace(/\s/g, "").toUpperCase();
    setRef((r) => (r && norm(r.medida) === norm(medida) ? r : null));
    if (medida.replace(/\s/g, "").length < 7) { setRefs([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      leer<Referencia[]>(`/api/otf/tc/catalogo?medida=${encodeURIComponent(medida)}&q=${encodeURIComponent(busca)}`)
        .then((r) => vivo && setRefs(r)).catch(() => vivo && setRefs([]));
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [medida, busca]);

  const ejes = useMemo(() => [...new Set((plano?.posiciones ?? []).map((p) => p.eje).filter((e): e is number => e != null))].sort(), [plano]);
  const toggle = (codigo: string) => setSeleccion((s) => (s.includes(codigo) ? s.filter((c) => c !== codigo) : [...s, codigo]));
  const marcarEje = (eje: number) => {
    const suyos = (plano?.posiciones ?? []).filter((p) => p.eje === eje).map((p) => p.codigo);
    setSeleccion((s) => (suyos.every((c) => s.includes(c)) ? s.filter((c) => !suyos.includes(c)) : [...new Set([...s, ...suyos])]));
  };

  // Lo que se enviará, y qué falta.
  useEffect(() => {
    const falta = !plano ? (veh?.estado === "FOUND" ? "El vehículo no tiene plano en TyreControl." : "Elige el tipo de vehículo.")
      : seleccion.length === 0 ? "Marca las ruedas en el plano."
      : !medida.trim() ? "Indica la medida del neumático."
      : null;
    if (falta || !plano) { onChange(null, falta); return; }
    onChange({
      tcEmpresaId: veh?.tcEmpresaId ?? null, tcVehiculoId: veh?.vehiculo?.id ?? null,
      tcTipoVehiculoId: plano.tipo.id, tipoNombre: plano.tipo.nombre, config: plano.tipo.config, imagenUrl: plano.imagenUrl,
      posiciones: plano.posiciones, seleccion,
      referenciaId: ref?.id ?? null, marca: ref?.marca ?? null, modelo: ref?.modelo ?? (busca.trim() || null),
      medida: medida.trim().toUpperCase(), condicion, destinoRetirado: destino,
    }, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano, seleccion, medida, ref, condicion, destino, busca, veh]);

  const inputCls = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";
  if (limpia.length < 5) return <p className="text-xs text-slate-400">Escribe la matrícula para ver el plano del vehículo.</p>;
  if (error) return <p className="text-xs font-semibold text-amber-300">{error}</p>;
  if (!veh) return <p className="text-xs text-slate-400">Consultando TyreControl…</p>;

  const quitaOcupadas = (plano?.posiciones ?? []).some((p) => seleccion.includes(p.codigo) && p.montado);
  return (
    <div className="space-y-3">
      {veh.estado === "FOUND" ? (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-100">
          <b>{limpia} ya está en TyreControl</b>{veh.empresaNombre ? ` (${veh.empresaNombre})` : ""}. {veh.vehiculo?.tipoNombre ?? ""}
          {plano?.tipo.config ? ` · ${plano.tipo.config}` : ""}. El plano muestra lo que lleva montado en cada rueda.
        </div>
      ) : veh.estado === "NOT_FOUND" ? (
        <div className="rounded-lg border border-blue-700 bg-blue-950/60 px-3 py-2 text-xs text-blue-100">
          <b>{limpia} no está en TyreControl.</b>{" "}
          {veh.tcEmpresaId
            ? <>Se dará de alta en <b>{veh.empresaNombre}</b> al registrar el montaje, con el tipo que elijas, y quedará «pendiente de validar».</>
            : <span className="text-amber-300">{veh.motivo}</span>}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-700 bg-amber-950/60 px-3 py-2 text-xs text-amber-100">
          {veh.motivo ?? "No se ha podido identificar el vehículo en TyreControl."} Se guardarán las posiciones, pero no el montaje.
        </div>
      )}

      {veh.estado !== "FOUND" && (
        <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} className={inputCls} aria-label="Tipo de vehículo de TyreControl">
          <option value="">— Tipo de vehículo (TyreControl) —</option>
          {veh.tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.config ? ` · ${t.config}` : ""}</option>)}
        </select>
      )}

      {plano && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <PlanoRuedas plano={plano} seleccion={seleccion} onToggle={toggle} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ejes.map((e) => (
                <button key={e} type="button" onClick={() => marcarEje(e)} className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-orange-400">
                  Eje {e}
                </button>
              ))}
              <button type="button" onClick={() => setSeleccion(plano.posiciones.map((p) => p.codigo))} className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200">Todas</button>
              <button type="button" onClick={() => setSeleccion([])} className="rounded-md border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-400">Ninguna</button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-black text-slate-300">Neumático a montar · catálogo de TyreControl</div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Medida (315/70R22.5)" value={medida} onChange={(e) => setMedida(e.target.value.toUpperCase())} className={inputCls} />
              <select value={condicion} onChange={(e) => setCondicion(e.target.value as "nuevo" | "usado")} className={inputCls} aria-label="Estado del neumático">
                <option value="nuevo">Nuevo</option>
                <option value="usado">Usado</option>
              </select>
            </div>
            <input placeholder="Buscar marca o modelo" value={busca} onChange={(e) => setBusca(e.target.value)} className={inputCls} />
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-700">
              {refs.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">
                  {medida.replace(/\s/g, "").length < 7 ? "Escribe la medida para ver el catálogo." : "No hay nada en el catálogo con esa medida y ese texto."}
                </div>
              )}
              {refs.map((r) => (
                <button key={r.id} type="button" onClick={() => setRef(ref?.id === r.id ? null : r)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-left text-sm ${ref?.id === r.id ? "bg-orange-950 font-bold text-orange-200" : "text-slate-200 hover:bg-slate-800"}`}>
                  <span>{r.marca} · {r.modelo}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{r.eje ?? ""}{ref?.id === r.id ? " ✓" : ""}</span>
                </button>
              ))}
            </div>
            {!ref && medida.trim() && (
              <p className="text-[11px] text-amber-300">
                Sin elegir uno del catálogo se guardan las posiciones y el texto, pero el montaje no se podrá registrar en TyreControl.
              </p>
            )}
            {quitaOcupadas && (
              <label className="block text-[11px] text-slate-400">Los que se quitan
                <select value={destino} onChange={(e) => setDestino(e.target.value as typeof destino)} className={`${inputCls} mt-1`}>
                  <option value="descartado">De baja (se los lleva la furgoneta)</option>
                  <option value="almacen">Al almacén del cliente, como usados</option>
                  <option value="reparacion">A reparar</option>
                </select>
              </label>
            )}
            <div className="rounded-lg border border-orange-800 bg-orange-950/40 px-3 py-2 text-xs text-orange-100">
              <b>{seleccion.length} × {[ref?.marca, ref?.modelo ?? busca.trim(), medida].filter(Boolean).join(" ") || "neumático"} ({condicion})</b>
              <div className="text-orange-200/80">
                {seleccion.length === 0 ? "Marca las ruedas en el plano." : plano.posiciones.filter((p) => seleccion.includes(p.codigo)).map(corto).join(" · ")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
