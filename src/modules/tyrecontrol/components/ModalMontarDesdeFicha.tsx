import { useEffect, useState } from "react";
import { listarProductosAlmacen, montarDesdeAlmacen, sustituirNeumatico, esErrorMedidaIncompatible, stockAlmacenEmpresa } from "../services/data";
import type { ProductoAlmacen, MotivoDesmontaje, DestinoDesmontaje } from "../types";
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

export default function ModalMontarDesdeFicha({ posicionNombre, vehiculoId, empresaId, posicionId, montajeActualId, medidaActual, onClose, onDone }: Props) {
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
  const [stock, setStock] = useState<Record<string, { nuevo: number; usado: number }> | null>(null); // null = sin datos → no filtra por stock
  const [soloConStock, setSoloConStock] = useState(true);

  useEffect(() => { listarProductosAlmacen().then(setProductos); }, []);
  useEffect(() => {
    if (!empresaId) { setStock(null); return; }
    stockAlmacenEmpresa(empresaId)
      .then((ls) => setStock(Object.fromEntries(ls.map((l) => [l.producto_id, { nuevo: l.nuevo, usado: l.usado }]))))
      .catch(() => setStock(null));
  }, [empresaId]);
  const dispDe = (id: string) => stock ? (condicion === "usado" ? stock[id]?.usado ?? 0 : stock[id]?.nuevo ?? 0) : null;
  useEffect(() => { const t = setTimeout(() => listarProductosAlmacen(busqueda).then(setProductos), 250); return () => clearTimeout(t); }, [busqueda]);
  useEffect(() => { setMedidaIncompatible(false); }, [productoId]);

  async function confirmar(forzar = false) {
    if (!productoId) { setMsg("Selecciona un producto de almacén"); return; }
    setSaving(true); setMsg("");
    try {
      if (montajeActualId) {
        await sustituirNeumatico({
          montajeActualId, productoAlmacenId: productoId, controlIndividual, datos,
          motivoDesmontaje: motivo, destinoRetirado: destino,
          km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
          forzarMedida: forzar, condicion,
        });
      } else {
        await montarDesdeAlmacen({
          vehiculoId, posicionId, productoAlmacenId: productoId, controlIndividual, datos,
          km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
          forzarMedida: forzar, condicion,
        });
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
    <Modal title={`${montajeActualId ? "Sustituir" : "Montar"} en ${posicionNombre}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        {medidaIncompatible && esAdmin ? (
          <button onClick={() => confirmar(true)} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            Forzar montaje (medida no homologada)
          </button>
        ) : (
          <button onClick={() => confirmar(false)} disabled={saving || !productoId || (medidaIncompatible && !esAdmin)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {montajeActualId ? "Sustituir" : "Montar"}
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
          <div className="mt-1 text-[11px] text-slate-500">Se descuenta 1 unidad del stock {condicion} del cliente de almacén; si no hay, se bloquea.</div>
        </Field>

        <Field label="Producto de almacén (marca / medida) *">
          <input className={`${inputCls} mb-1`} placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {(() => {
            const filtrarMedida = soloMedida && !!medidaActual;
            let visibles = filtrarMedida ? productos.filter((p) => baseMedida(p.medida) === baseMedida(medidaActual)) : productos;
            const hayStock = stock !== null; // solo filtramos por stock si tenemos los datos
            if (hayStock && soloConStock) visibles = visibles.filter((p) => (dispDe(p.id) ?? 0) > 0);
            const etiqueta = (p: typeof productos[number]) => {
              const d = dispDe(p.id);
              const base = `${p.marca} ${p.modelo ?? ""} · ${p.medida}`.replace(/\s+/g, " ").trim();
              return d != null ? `${base} · ${d} en stock` : base;
            };
            return (
              <>
                <select className={inputCls} value={productoId} onChange={(e) => setProductoId(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {visibles.map((p) => <option key={p.id} value={p.id}>{etiqueta(p)}</option>)}
                </select>
                <div className="mt-1 flex flex-col gap-1 text-[11px] text-slate-400">
                  {hayStock && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
                      Mostrar solo con stock {condicion} disponible
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
                  <div className="mt-1 text-[11px] text-amber-300">
                    {hayStock && soloConStock
                      ? `No hay stock ${condicion}${filtrarMedida ? ` de la medida ${medidaActual}` : ""}. Desmarca «solo con stock» o cambia de condición.`
                      : `No hay productos de almacén${filtrarMedida ? ` con la medida ${medidaActual}` : ""}.`}
                  </div>
                )}
              </>
            );
          })()}
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={controlIndividual} onChange={(e) => setControlIndividual(e.target.checked)} />
          Controlar este neumático individualmente (DOT, serie, RFID)
        </label>

        {controlIndividual && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-900 p-2">
            <Field label="DOT (4 dígitos)"><input className={inputCls} value={datos.dot} onChange={(e) => setDatos({ ...datos, dot: e.target.value })} /></Field>
            <Field label="Número de serie"><input className={inputCls} value={datos.numero_serie} onChange={(e) => setDatos({ ...datos, numero_serie: e.target.value })} /></Field>
            <Field label="RFID EPC"><input className={inputCls} value={datos.rfid_epc} onChange={(e) => setDatos({ ...datos, rfid_epc: e.target.value })} /></Field>
            <Field label="Proveedor"><input className={inputCls} value={datos.proveedor} onChange={(e) => setDatos({ ...datos, proveedor: e.target.value })} /></Field>
          </div>
        )}
        {!controlIndividual && (
          <div className="text-[11px] text-slate-500">Se creará un número interno automático; el resto de datos se hereda del producto de almacén.</div>
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
