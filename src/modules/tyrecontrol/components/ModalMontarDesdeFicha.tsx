import { useEffect, useMemo, useState } from "react";
import { listarProductosAlmacen, montarDesdeAlmacen, sustituirNeumatico, esErrorMedidaIncompatible, stockAlmacenEmpresa, profundidadDibujoPorProducto, montarDesdeCatalogo, listarReferenciasNeumatico } from "../services/data";
import type { ProductoAlmacen, MotivoDesmontaje, DestinoDesmontaje, ReferenciaNeumatico } from "../types";
import { MOTIVO_DESMONTAJE_LABELS } from "../types";
import { Modal, Field, inputCls } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

interface Props {
  posicionNombre: string;
  vehiculoId: string;
  empresaId?: string; // para leer el stock disponible por producto (nuevo/usado)
  posicionId: string;
  montajeActualId?: string; // si viene informado, es una SUSTITUCIÓN (desmonta + monta)
  medidaActual?: string | null; // medida del neumático de la posición → filtra el almacén
  posicionesBulk?: string[]; // si viene, se monta el MISMO neumático en todas estas posiciones
  onClose: () => void;
  onDone: () => void;
}

// Medida base canónica (ancho/perfil R llanta), ignorando índice de carga y
// velocidad, para casar "385/65R22.5" (ficha) con "385/65 R22.5 158L" (almacén).
const baseMedida = (s?: string | null) => {
  const t = (s ?? "").toUpperCase().replace(/\s+/g, "");
  const m = t.match(/(\d{2,3})(?:\/(\d{2,3}))?R?(\d{1,2}(?:[.,]\d)?)/);
  if (!m) return t;
  return `${m[1]}${m[2] ? "/" + m[2] : ""}R${m[3].replace(",", ".")}`;
};

export default function ModalMontarDesdeFicha({ posicionNombre, vehiculoId, empresaId, posicionId, montajeActualId, medidaActual, posicionesBulk, onClose, onDone }: Props) {
  const bulk = (posicionesBulk?.length ?? 0) > 1;
  const { perfil } = useTyreAuth();
  const esAdmin = !!(perfil?.es_superadmin || perfil?.rol === "administrador");
  const [productos, setProductos] = useState<ProductoAlmacen[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [productoId, setProductoId] = useState("");
  const [controlIndividual, setControlIndividual] = useState(false);
  const [datos, setDatos] = useState({ dot: "", numero_serie: "", rfid_epc: "", proveedor: "" });
  const [km, setKm] = useState("");
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState<MotivoDesmontaje>("desgaste");
  const [destino, setDestino] = useState<DestinoDesmontaje>("almacen");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [medidaIncompatible, setMedidaIncompatible] = useState(false);
  const [soloMedida, setSoloMedida] = useState(true); // filtrar el almacén por la medida de la ficha
  const [condicion, setCondicion] = useState<"nuevo" | "usado">("nuevo"); // consumir stock nuevo o usado
  const [profRestante, setProfRestante] = useState(""); // mm restantes al montar un usado
  const [stock, setStock] = useState<Record<string, { nuevo: number; usado: number }> | null>(null); // null = sin datos → no filtra por stock
  const [soloConStock, setSoloConStock] = useState(true);
  const [fMarcaProd, setFMarcaProd] = useState(""); // filtro por marca en el desplegable
  const [referencias, setReferencias] = useState<ReferenciaNeumatico[]>([]); // catálogo completo (todas las marcas)

  useEffect(() => { listarProductosAlmacen().then(setProductos); }, []);
  useEffect(() => { listarReferenciasNeumatico().then(setReferencias).catch(() => setReferencias([])); }, []);
  useEffect(() => {
    if (!empresaId) { setStock(null); return; }
    stockAlmacenEmpresa(empresaId)
      .then((ls) => setStock(Object.fromEntries(ls.map((l) => [l.producto_id, { nuevo: l.nuevo, usado: l.usado }]))))
      .catch(() => setStock(null));
  }, [empresaId]);
  const dispDe = (id: string) => stock ? (condicion === "usado" ? stock[id]?.usado ?? 0 : stock[id]?.nuevo ?? 0) : null;

  // Profundidad de dibujo (nueva) por producto de almacén.
  const [dibujo, setDibujo] = useState<Record<string, number | null> | null>(null);
  useEffect(() => { profundidadDibujoPorProducto().then(setDibujo).catch(() => setDibujo(null)); }, []);
  useEffect(() => { const t = setTimeout(() => listarProductosAlmacen(busqueda).then(setProductos), 250); return () => clearTimeout(t); }, [busqueda]);
  useEffect(() => { setMedidaIncompatible(false); }, [productoId]);

  // Lista unificada: productos de almacén (con stock) + referencias de catálogo
  // que no estén en el almacén (se montan sin descontar stock).
  type Item = { key: string; tipo: "almacen" | "catalogo"; id: string; marca: string; modelo: string | null; medida: string; dibujo: number | null };
  const claveId = (m?: string | null, mo?: string | null, me?: string | null) => `${(m ?? "").toLowerCase().trim()}|${(mo ?? "").toLowerCase().trim()}|${baseMedida(me)}`;
  const items: Item[] = useMemo(() => {
    const almClaves = new Set(productos.map((p) => claveId(p.marca, p.modelo, p.medida)));
    const alm: Item[] = productos.map((p) => ({ key: `alm:${p.id}`, tipo: "almacen", id: p.id, marca: p.marca, modelo: p.modelo ?? null, medida: p.medida, dibujo: dibujo?.[p.id] ?? null }));
    const cat: Item[] = referencias
      .filter((r) => !almClaves.has(claveId(r.modelo?.marca?.nombre, r.modelo?.nombre, r.tyre_size?.medida)))
      .map((r) => ({ key: `cat:${r.id}`, tipo: "catalogo", id: r.id, marca: r.modelo?.marca?.nombre ?? "", modelo: r.modelo?.nombre ?? null, medida: r.tyre_size?.medida ?? "", dibujo: r.profundidad_dibujo_mm ?? null }));
    return [...alm, ...cat];
  }, [productos, referencias, dibujo]);

  const sel = productoId ? items.find((i) => i.key === productoId) ?? null : null;
  const dibujoProducto = sel?.dibujo;
  const faltaDibujo = condicion === "nuevo" && !!sel && dibujoProducto == null && (sel.tipo === "catalogo" || dibujo != null);

  async function confirmar(forzar = false) {
    if (!sel) { setMsg("Selecciona un neumático"); return; }
    // Para un usado, la profundidad restante se pasa vía datos → profundidad_actual_mm.
    const datosFinal = condicion === "usado" && profRestante.trim() !== ""
      ? { ...datos, profundidad_actual_mm: profRestante.replace(",", ".") }
      : datos;
    const fecha = new Date().toISOString().slice(0, 10);
    const posiciones = bulk ? posicionesBulk! : [posicionId];
    const ctrlInd = bulk ? false : controlIndividual; // en bulk no se controlan individualmente
    setSaving(true); setMsg("");
    try {
      let ok = 0; let ultimo = "";
      for (const pid of posiciones) {
        try {
          if (sel.tipo === "catalogo") {
            await montarDesdeCatalogo({
              vehiculoId, posicionId: pid, referenciaId: sel.id, controlIndividual: ctrlInd, datos: datosFinal,
              km: km ? Number(km) : null, fecha, observaciones: obs || null, forzarMedida: forzar, condicion,
              montajeActualId: !bulk && montajeActualId ? montajeActualId : null, motivoDesmontaje: motivo, destinoRetirado: destino,
            });
          } else if (!bulk && montajeActualId) {
            await sustituirNeumatico({
              montajeActualId, productoAlmacenId: sel.id, controlIndividual: ctrlInd, datos: datosFinal,
              motivoDesmontaje: motivo, destinoRetirado: destino,
              km: km ? Number(km) : null, fecha, observaciones: obs || null, forzarMedida: forzar, condicion,
            });
          } else {
            await montarDesdeAlmacen({
              vehiculoId, posicionId: pid, productoAlmacenId: sel.id, controlIndividual: ctrlInd, datos: datosFinal,
              km: km ? Number(km) : null, fecha, observaciones: obs || null, forzarMedida: forzar, condicion,
            });
          }
          ok++;
        } catch (e: any) {
          const t = e?.message || "Error";
          if (esErrorMedidaIncompatible(t)) throw e; // permite forzar
          ultimo = t;
          if (/no hay stock|no hay producto/i.test(t)) break; // sin stock: no seguir
        }
      }
      if (ok === 0) { setMsg(ultimo || "No se pudo montar"); return; }
      if (bulk && ok < posiciones.length) {
        window.alert(`Montados ${ok} de ${posiciones.length} neumáticos.${ultimo ? "\n" + ultimo : ""}`);
      }
      onDone();
    } catch (e: any) {
      const texto = e?.message || "Error";
      if (esErrorMedidaIncompatible(texto)) {
        setMedidaIncompatible(true);
        setMsg(esAdmin
          ? "Esta medida no está homologada para este tipo de vehículo. Puedes forzar el montaje si estás seguro."
          : "Esta medida no está homologada para este tipo de vehículo. Solo un administrador puede forzar el montaje.");
      } else {
        setMsg(texto);
      }
    } finally { setSaving(false); }
  }

  return (
    <Modal title={bulk ? `Montar el mismo en ${posicionesBulk!.length} posiciones libres` : `${montajeActualId ? "Sustituir" : "Montar"} en ${posicionNombre}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        {medidaIncompatible && esAdmin ? (
          <button onClick={() => confirmar(true)} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            Forzar montaje (medida no homologada)
          </button>
        ) : (
          <button onClick={() => confirmar(false)} disabled={saving || !productoId || (medidaIncompatible && !esAdmin)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {bulk ? `Montar en ${posicionesBulk!.length}` : (montajeActualId ? "Sustituir" : "Montar")}
          </button>
        )}
      </div>}>
      <div className="grid gap-2">
        {montajeActualId && (
          <>
            <div className="text-[11px] font-bold uppercase text-slate-400">1. Neumático retirado</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Motivo de desmontaje">
                <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDesmontaje)}>
                  {(Object.keys(MOTIVO_DESMONTAJE_LABELS) as MotivoDesmontaje[]).map((m) => <option key={m} value={m}>{MOTIVO_DESMONTAJE_LABELS[m]}</option>)}
                </select>
              </Field>
              <Field label="Destino del retirado">
                <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value as DestinoDesmontaje)}>
                  <option value="almacen">Vuelve a almacén</option>
                  <option value="reparacion">Reparación</option>
                  <option value="descartado">Descarte</option>
                </select>
              </Field>
            </div>
            <div className="mt-1 text-[11px] font-bold uppercase text-slate-400">2. Neumático nuevo</div>
          </>
        )}

        <Field label="Condición del stock">
          <div className="flex gap-2">
            {(["nuevo", "usado"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCondicion(c)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${condicion === c ? (c === "usado" ? "border-amber-500 bg-amber-500/15 text-amber-200" : "border-emerald-500 bg-emerald-500/15 text-emerald-200") : "border-slate-600 text-slate-300"}`}>
                {c === "nuevo" ? "Nuevo" : "Usado"}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Si el neumático está en el almacén, se descuenta 1 unidad del stock {condicion}; los de solo catálogo se montan sin descuento.</div>
          {condicion === "usado" && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] text-slate-400">Profundidad restante (mm)</div>
              <input type="number" step="0.1" className={inputCls} placeholder="p. ej. 8.5" value={profRestante} onChange={(e) => setProfRestante(e.target.value)} />
              <div className="mt-1 text-[11px] text-slate-500">Milímetros que le quedan al neumático usado. Si lo dejas vacío, se registrará en la próxima revisión.</div>
            </div>
          )}
        </Field>

        <Field label="Neumático (almacén / catálogo) *">
          <input className={`${inputCls} mb-1`} placeholder="Buscar marca, modelo o medida…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {(() => {
            const q = busqueda.trim().toLowerCase();
            const filtrarMedida = soloMedida && !!medidaActual;
            let base = filtrarMedida ? items.filter((i) => baseMedida(i.medida) === baseMedida(medidaActual)) : items;
            if (q) base = base.filter((i) => `${i.marca} ${i.modelo ?? ""} ${i.medida}`.toLowerCase().includes(q));
            const marcas = Array.from(new Set(base.map((i) => i.marca).filter(Boolean))).sort();
            let visibles = fMarcaProd ? base.filter((i) => i.marca === fMarcaProd) : base;
            const hayStock = stock !== null;
            // el filtro de stock solo aplica a los de almacén; los de catálogo siempre salen (se montan sin descuento)
            if (hayStock && soloConStock) visibles = visibles.filter((i) => i.tipo === "catalogo" || (dispDe(i.id) ?? 0) > 0);
            visibles = [...visibles].sort((a, b) => (a.marca + (a.modelo ?? "")).localeCompare(b.marca + (b.modelo ?? "")));
            const etiqueta = (i: Item) => {
              const nom = `${i.marca} ${i.modelo ?? ""} · ${i.medida}`.replace(/\s+/g, " ").trim();
              if (i.tipo === "catalogo") return `${nom} · catálogo (sin stock)`;
              const d = dispDe(i.id);
              return d != null ? `${nom} · ${d} en stock` : nom;
            };
            return (
              <>
                <select className={`${inputCls} mb-1`} value={fMarcaProd} onChange={(e) => setFMarcaProd(e.target.value)}>
                  <option value="">Todas las marcas{marcas.length ? ` (${marcas.length})` : ""}</option>
                  {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className={inputCls} value={productoId} onChange={(e) => setProductoId(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {visibles.map((i) => <option key={i.key} value={i.key}>{etiqueta(i)}</option>)}
                </select>
                <div className="mt-1 flex flex-col gap-1 text-[11px] text-slate-400">
                  {hayStock && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
                      Mostrar solo con stock {condicion} disponible (el catálogo se muestra igualmente)
                    </label>
                  )}
                  {medidaActual && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!soloMedida} onChange={(e) => setSoloMedida(!e.target.checked)} />
                      Mostrar todas las medidas (por defecto solo {medidaActual})
                    </label>
                  )}
                </div>
                {visibles.length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-300">Sin resultados{filtrarMedida ? ` para la medida ${medidaActual}` : ""}.</div>
                )}
              </>
            );
          })()}
        </Field>

        {sel?.tipo === "catalogo" && (
          <div className="rounded-lg border border-sky-600/40 bg-sky-500/8 px-3 py-2 text-[12px] text-sky-200">
            Este modelo no está en el almacén: se montará <b>sin descontar stock</b> (como neumático de catálogo).
          </div>
        )}

        {condicion === "nuevo" && sel && dibujoProducto != null && (
          <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/8 px-3 py-2 text-[12px] text-emerald-200">
            Se registrará la profundidad de dibujo de la ficha: <b>{dibujoProducto} mm</b>.
          </div>
        )}
        {faltaDibujo && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            ⚠ El modelo <b>{sel ? `${sel.marca} ${sel.modelo ?? ""}`.trim() : "seleccionado"}</b> no tiene <b>profundidad de dibujo</b> en el catálogo, así que el neumático quedará sin profundidad hasta medirlo.
            Complétala en <b>Catálogo de neumáticos</b> (editar datos técnicos del modelo) y se aplicará <b>siempre</b> a los montajes nuevos.
          </div>
        )}

        {bulk && (
          <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/8 px-3 py-2 text-[12px] text-emerald-200">
            Se montará el mismo neumático en <b>{posicionesBulk!.length} posiciones libres</b>. Si es de almacén, se descontarán {posicionesBulk!.length} unidades.
          </div>
        )}
        {!bulk && (
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={controlIndividual} onChange={(e) => setControlIndividual(e.target.checked)} />
            Controlar este neumático individualmente (DOT, serie, RFID)
          </label>
        )}

        {controlIndividual && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-900 p-2">
            <Field label="DOT (4 dígitos)"><input className={inputCls} value={datos.dot} onChange={(e) => setDatos({ ...datos, dot: e.target.value })} /></Field>
            <Field label="Número de serie"><input className={inputCls} value={datos.numero_serie} onChange={(e) => setDatos({ ...datos, numero_serie: e.target.value })} /></Field>
            <Field label="RFID EPC"><input className={inputCls} value={datos.rfid_epc} onChange={(e) => setDatos({ ...datos, rfid_epc: e.target.value })} /></Field>
            <Field label="Proveedor"><input className={inputCls} value={datos.proveedor} onChange={(e) => setDatos({ ...datos, proveedor: e.target.value })} /></Field>
          </div>
        )}
        {!controlIndividual && (
          <div className="text-[11px] text-slate-500">Se creará un número interno automático; el resto de datos se hereda del producto de almacén o del catálogo.</div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Km vehículo"><input type="number" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
          <Field label="Observaciones"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        </div>
        {msg && <div className={`text-[11px] ${medidaIncompatible ? "text-amber-300" : "text-red-300"}`}>{msg}</div>}
      </div>
    </Modal>
  );
}
