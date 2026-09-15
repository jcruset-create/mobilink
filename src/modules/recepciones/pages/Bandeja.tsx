/**
 * Recepciones pendientes: los albaranes que están en tránsito o a medias.
 *
 * Cada fila es un albarán, que es contra lo que se recepciona. En escritorio,
 * tabla; en móvil, tarjetas con el botón de recibir bien grande.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PackageCheck, RefreshCw } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { ChipEstadoAlbaran, EmptyRow, ErrorBox, TableWrap, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import { fmtCantidad, type FilaBandeja } from "../types";
import { fmtFecha } from "../../administracion/types";

const PESTANAS = [
  { key: "pendientes", label: "Pendientes" },
  { key: "recibidos", label: "Recibidos" },
  { key: "todos", label: "Todos" },
];

export default function Bandeja() {
  const { contadores, fijarContadores, proveedores, centros, centroId, puede, vocabulario } = useRecepciones();
  const [pestana, setPestana] = useState("pendientes");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [centro, setCentro] = useState("");
  const [filas, setFilas] = useState<FilaBandeja[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.bandeja({ pestana, q: q || undefined, estado: estado || undefined, proveedorId: proveedorId || undefined, centroId: centro || undefined });
      setFilas(r.albaranes);
      fijarContadores(r.contadores);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la bandeja");
    } finally {
      setCargando(false);
    }
  }, [pestana, q, estado, proveedorId, centro, fijarContadores]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const contador = (k: string) => (k === "pendientes" ? contadores?.pendientes : k === "recibidos" ? contadores?.recibidos : undefined);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-100">Recepciones pendientes</h1>
          <p className="text-[12px] text-slate-400">Mercancía que el proveedor ya ha expedido y que hay que contar cuando llegue.</p>
        </div>
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 flex flex-wrap gap-1">
        {PESTANAS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPestana(p.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${pestana === p.key ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            {p.label}
            {contador(p.key) !== undefined ? ` · ${contador(p.key)}` : ""}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <input className={`${inputCls} max-w-xs`} placeholder="Pedido, albarán, producto, transportista…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} max-w-[200px]`} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {!centroId && centros.length > 0 && (
          <select className={`${inputCls} max-w-[200px]`} value={centro} onChange={(e) => setCentro(e.target.value)}>
            <option value="">Todos los centros</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        )}
        <select className={`${inputCls} max-w-[220px]`} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Cualquier estado</option>
          {(vocabulario?.estadosAlbaran ?? []).map((e) => (
            <option key={e} value={e}>
              {vocabulario?.etiquetas.estadoAlbaran[e] ?? e}
            </option>
          ))}
        </select>
      </div>

      {/* Móvil: tarjetas */}
      <div className="space-y-2 md:hidden">
        {filas.length === 0 && !cargando && <p className="py-6 text-center text-sm text-slate-500">Nada pendiente de recibir.</p>}
        {filas.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase text-slate-400">{a.proveedorNombre}</div>
              <ChipEstadoAlbaran estado={a.estado} />
            </div>
            <div className="mt-1 text-lg font-black">Albarán {a.numeroProveedor}</div>
            <div className="text-[13px] text-slate-300">
              Pedido {a.pedidoNumero} · {a.centroNombre || "—"} · {a.transportista ?? "—"}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-slate-400">Expedido</span> <b>{fmtCantidad(a.unidadesExpedidas)}</b> · <span className="text-slate-400">Recibido</span>{" "}
                <b>{fmtCantidad(a.unidadesRecibidas)}</b>
              </div>
              {puede("recepciones.recibir") && (a.estado === "EN_TRANSITO" || a.estado === "PARCIALMENTE_RECIBIDO") ? (
                <Link to={`/recepciones/recibir/${a.id}`} className="flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white">
                  <PackageCheck className="h-4 w-4" /> Recibir
                </Link>
              ) : (
                <Link to={`/recepciones/albaranes/${a.id}`} className={btnSecondary}>
                  Ver
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden md:block">
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Proveedor</th>
              <th className={thCls}>Albarán</th>
              <th className={thCls}>Pedido</th>
              <th className={thCls}>Expedición</th>
              <th className={thCls}>Centro</th>
              <th className={thCls}>Transportista</th>
              <th className={`${thCls} text-right`}>Expedidas</th>
              <th className={`${thCls} text-right`}>Recibidas</th>
              <th className={thCls}>Estado</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <EmptyRow cols={10} text={cargando ? "Cargando…" : "Nada pendiente de recibir."} />}
            {filas.map((a) => (
              <tr key={a.id} className="border-t border-slate-700/60 hover:bg-slate-700/30">
                <td className={tdCls}>{a.proveedorNombre}</td>
                <td className={`${tdCls} font-bold`}>
                  <Link to={`/recepciones/albaranes/${a.id}`} className="hover:underline">
                    {a.numeroProveedor}
                  </Link>
                  {a.incidenciasAbiertas > 0 && <span className="ml-2 rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-300">{a.incidenciasAbiertas} inc.</span>}
                </td>
                <td className={tdCls}>
                  <Link to={`/recepciones/pedidos/${a.pedidoId}`} className="hover:underline">
                    {a.pedidoNumero}
                  </Link>
                </td>
                <td className={tdCls}>{fmtFecha(a.fechaExpedicion)}</td>
                <td className={tdCls}>{a.centroNombre || "—"}</td>
                <td className={tdCls}>{a.transportista ?? "—"}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{fmtCantidad(a.unidadesExpedidas)}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{fmtCantidad(a.unidadesRecibidas)}</td>
                <td className={tdCls}>
                  <ChipEstadoAlbaran estado={a.estado} />
                </td>
                <td className={`${tdCls} text-right`}>
                  {puede("recepciones.recibir") && (a.estado === "EN_TRANSITO" || a.estado === "PARCIALMENTE_RECIBIDO") && (
                    <Link to={`/recepciones/recibir/${a.id}`} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500">
                      <PackageCheck className="h-4 w-4" /> Recibir
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
