/**
 * Pedidos a proveedor: listado y alta manual.
 *
 * El alta manual es la puerta de esta fase: el correo de Soledad la usará
 * después con los mismos campos. El formulario está pensado para teclear el
 * correo del proveedor tal cual llega (número, fecha, centro, origen,
 * transportista, usuario, líneas con descripción, cantidad y precio).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { ChipEstadoPedido, EmptyRow, ErrorBox, Modal, TableWrap, TextField, btnPrimary, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import Articulos from "../components/Articulos";
import { fmtCantidad, type FilaPedido } from "../types";
import { fmtFecha } from "../../administracion/types";

type LineaForm = { descripcionProveedor: string; referenciaProveedor: string; cantidadPedida: string; precio: string };
const lineaVacia = (): LineaForm => ({ descripcionProveedor: "", referenciaProveedor: "", cantidadPedida: "", precio: "" });

/** «248,45» → 24845. Quien convierte de euros a céntimos es el panel. */
function aCentimos(v: string): number | null {
  const s = v.trim().replace(/\./g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function Pedidos() {
  const { proveedores, centros, centroId, puede, vocabulario, refrescar } = useRecepciones();
  const [pedidos, setPedidos] = useState<FilaPedido[]>([]);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.listarPedidos({ q: q || undefined, estado: estado || undefined });
      setPedidos(r.pedidos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los pedidos");
    } finally {
      setCargando(false);
    }
  }, [q, estado]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-100">Pedidos a proveedor</h1>
          <p className="text-[12px] text-slate-400">Lo que se ha pedido y en qué punto está: pendiente de expedir, en tránsito o completado.</p>
        </div>
        {puede("recepciones.pedido.create") && (
          <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" /> Nuevo pedido
          </button>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <input className={`${inputCls} max-w-xs`} placeholder="Número de pedido, albarán o producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} max-w-[240px]`} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Cualquier estado</option>
          {(vocabulario?.estadosPedido ?? []).map((e) => (
            <option key={e} value={e}>
              {vocabulario?.etiquetas.estadoPedido[e] ?? e}
            </option>
          ))}
        </select>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Qué se pidió</th>
            <th className={thCls}>Pedido</th>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Origen</th>
            <th className={thCls}>Transportista</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.length === 0 && <EmptyRow cols={7} text={cargando ? "Cargando…" : "No hay pedidos."} />}
          {pedidos.map((p) => (
            <tr key={p.id} className="border-t border-slate-700/60 hover:bg-slate-700/30">
              {/* Lo que se encargó, primero: es lo que se busca al mirar. */}
              <td className={`${tdCls} min-w-[280px]`}>
                <Link to={`/recepciones/pedidos/${p.id}`} className="block hover:opacity-80">
                  <Articulos articulos={p.articulos} compacto />
                </Link>
                <div className="mt-1 text-[11px] uppercase text-slate-500">{p.proveedorNombre}</div>
              </td>
              <td className={`${tdCls} font-bold`}>
                <Link to={`/recepciones/pedidos/${p.id}`} className="hover:underline">
                  {p.numeroProveedor}
                </Link>
              </td>
              <td className={tdCls}>{fmtFecha(p.fechaPedido)}</td>
              <td className={tdCls}>{p.centroNombre || "—"}</td>
              <td className={tdCls}>{p.almacenOrigen ?? "—"}</td>
              <td className={tdCls}>{p.transportista ?? "—"}</td>
              <td className={tdCls}>
                <ChipEstadoPedido estado={p.estado} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {creando && (
        <NuevoPedido
          proveedores={proveedores}
          centros={centros}
          centroFijo={centroId}
          onClose={() => setCreando(false)}
          onCreado={async () => {
            setCreando(false);
            await Promise.all([cargar(), refrescar()]);
          }}
        />
      )}
    </div>
  );
}

function NuevoPedido({
  proveedores,
  centros,
  centroFijo,
  onClose,
  onCreado,
}: {
  proveedores: { id: string; nombre: string; activo: boolean }[];
  centros: { id: string; nombre: string; activo: boolean }[];
  centroFijo: string | null;
  onClose: () => void;
  onCreado: () => Promise<void>;
}) {
  const activos = proveedores.filter((p) => p.activo);
  const [proveedorId, setProveedorId] = useState(activos[0]?.id ?? "");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [centroId, setCentroId] = useState(centroFijo ?? centros.find((c) => c.activo)?.id ?? "");
  const [centroNombre, setCentroNombre] = useState("");
  const [origen, setOrigen] = useState("");
  const [transportista, setTransportista] = useState("");
  const [usuario, setUsuario] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia()]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const fijarLinea = (i: number, cambio: Partial<LineaForm>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)));

  async function guardar() {
    setGuardando(true);
    try {
      const centro = centros.find((c) => c.id === centroId);
      await api.crearPedido({
        proveedorId,
        numeroProveedor: numero,
        fechaPedido: fecha || undefined,
        centroId: centro?.id,
        centroNombre: centro?.nombre ?? centroNombre,
        almacenOrigen: origen || undefined,
        transportista: transportista || undefined,
        usuarioPedido: usuario || undefined,
        observaciones: observaciones || undefined,
        lineas: lineas
          .filter((l) => l.descripcionProveedor.trim())
          .map((l) => ({
            descripcionProveedor: l.descripcionProveedor,
            referenciaProveedor: l.referenciaProveedor || undefined,
            cantidadPedida: Number(l.cantidadPedida.replace(",", ".")),
            precioUnitarioCentimos: aCentimos(l.precio),
          })),
      });
      await onCreado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el pedido");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Nuevo pedido a proveedor"
      onClose={onClose}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void guardar()} disabled={guardando || !proveedorId || !numero.trim()}>
            {guardando ? "Guardando…" : "Crear pedido"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      {activos.length === 0 && (
        <p className="mb-3 text-sm text-amber-300">
          No hay proveedores. <Link to="/recepciones/proveedores" className="underline">Da de alta el primero</Link> (por ejemplo, NEUMÁTICOS SOLEDAD).
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Proveedor</span>
          <select className={inputCls} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            {activos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Número de pedido del proveedor" value={numero} onChange={setNumero} placeholder="5688837" />
        <TextField label="Fecha del pedido" value={fecha} onChange={setFecha} type="date" />
        {centros.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Centro destino</span>
            <select className={inputCls} value={centroId} onChange={(e) => setCentroId(e.target.value)} disabled={Boolean(centroFijo)}>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <TextField label="Centro destino" value={centroNombre} onChange={setCentroNombre} placeholder="TARRAGONA" />
        )}
        <TextField label="Almacén de origen" value={origen} onChange={setOrigen} placeholder="227 - ALMACEN MANRESA (CATALUÑA)" />
        <TextField label="Transportista" value={transportista} onChange={setTransportista} placeholder="TRANSAHER" />
        <TextField label="Usuario que hizo el pedido" value={usuario} onChange={setUsuario} placeholder="comercialseatarragona" />
        <TextField label="Observaciones" value={observaciones} onChange={setObservaciones} />
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Líneas</div>
        {lineas.map((l, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_80px_100px_36px] items-end gap-2 sm:grid-cols-[2fr_1fr_90px_110px_36px]">
            <input className={inputCls} placeholder="Producto, tal como lo escribe el proveedor" value={l.descripcionProveedor} onChange={(e) => fijarLinea(i, { descripcionProveedor: e.target.value })} />
            <input className={`${inputCls} hidden sm:block`} placeholder="Ref. proveedor" value={l.referenciaProveedor} onChange={(e) => fijarLinea(i, { referenciaProveedor: e.target.value })} />
            <input className={inputCls} inputMode="decimal" placeholder="Cant." value={l.cantidadPedida} onChange={(e) => fijarLinea(i, { cantidadPedida: e.target.value })} />
            <input className={inputCls} inputMode="decimal" placeholder="Precio €" value={l.precio} onChange={(e) => fijarLinea(i, { precio: e.target.value })} />
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600" onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Quitar línea">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" className={`${btnSecondary} flex items-center gap-1`} onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
          <Plus className="h-4 w-4" /> Añadir línea
        </button>
        <p className="mt-2 text-[11px] text-slate-500">
          Ejemplo real: «245/70X17.5 HANKOOK AH35 136M», cantidad 2, precio 248,45. Si el artículo no está mapeado, se recepciona igual por la descripción. Total líneas:{" "}
          {fmtCantidad(lineas.reduce((s, l) => s + (Number(l.cantidadPedida.replace(",", ".")) || 0), 0))} uds.
        </p>
      </div>
    </Modal>
  );
}
