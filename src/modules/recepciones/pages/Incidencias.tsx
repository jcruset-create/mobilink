/**
 * Incidencias de recepción: lo que llegó distinto de lo que decía el albarán.
 * Cada fila es estructurada (producto, esperado, recibido, diferencia, tipo)
 * y un gestor la pasa a «en gestión» o la resuelve diciendo cómo.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { ChipEstadoIncidencia, EmptyRow, ErrorBox, Modal, TableWrap, TextAreaField, btnMini, btnPrimary, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import { fmtCantidad, fmtDiferencia, type Incidencia } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function Incidencias() {
  const { puede, etiquetaTipoIncidencia, refrescar, proveedores } = useRecepciones();
  const [estado, setEstado] = useState("abiertas");
  const [proveedorId, setProveedorId] = useState("");
  const [filas, setFilas] = useState<Incidencia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [resolviendo, setResolviendo] = useState<{ incidencia: Incidencia; estado: "RESUELTA" | "CANCELADA" } | null>(null);
  const [resolucion, setResolucion] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.listarIncidencias({ estado, proveedorId: proveedorId || undefined });
      setFilas(r.incidencias);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar las incidencias");
    } finally {
      setCargando(false);
    }
  }, [estado, proveedorId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiar(i: Incidencia, nuevo: string, texto?: string) {
    try {
      await api.cambiarEstadoIncidencia(i.id, nuevo, texto);
      setResolviendo(null);
      setResolucion("");
      await Promise.all([cargar(), refrescar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar la incidencia");
    }
  }

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-black text-slate-100">Incidencias de recepción</h1>
        <p className="text-[12px] text-slate-400">Diferencias entre lo que decía el albarán y lo que se contó en el muelle.</p>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <select className={`${inputCls} max-w-[200px]`} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="abiertas">Abiertas y en gestión</option>
          <option value="ABIERTA">Abiertas</option>
          <option value="EN_GESTION">En gestión</option>
          <option value="RESUELTA">Resueltas</option>
          <option value="CANCELADA">Canceladas</option>
        </select>
        <select className={`${inputCls} max-w-[220px]`} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Proveedor / albarán</th>
            <th className={thCls}>Producto</th>
            <th className={thCls}>Tipo</th>
            <th className={`${thCls} text-right`}>Esperado</th>
            <th className={`${thCls} text-right`}>Recibido</th>
            <th className={`${thCls} text-right`}>Dif.</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <EmptyRow cols={9} text={cargando ? "Cargando…" : "Ninguna incidencia. Buena noticia."} />}
          {filas.map((i) => (
            <tr key={i.id} className="border-t border-slate-700/60 align-top hover:bg-slate-700/30">
              <td className={tdCls}>
                <div>{fmtFechaHora(i.createdAt)}</div>
                <div className="text-[11px] text-slate-500">{i.creadaNombre}</div>
              </td>
              <td className={tdCls}>
                <div>{i.proveedorNombre}</div>
                <Link to={`/recepciones/albaranes/${i.albaranId}`} className="text-[12px] text-sky-300 hover:underline">
                  Albarán {i.albaranNumero}
                </Link>
                <div className="text-[11px] text-slate-500">
                  Pedido {i.pedidoNumero} · {i.recepcionNumero}
                  {i.transportista ? ` · ${i.transportista}` : ""}
                </div>
              </td>
              <td className={tdCls}>
                <b>{i.descripcionProducto}</b>
                {i.observaciones && <div className="text-[12px] italic text-slate-400">«{i.observaciones}»</div>}
                {i.resolucion && <div className="text-[12px] text-emerald-300">Resolución: {i.resolucion}</div>}
              </td>
              <td className={tdCls}>{etiquetaTipoIncidencia(i.tipo)}</td>
              <td className={`${tdCls} text-right tabular-nums`}>{fmtCantidad(i.cantidadEsperada)}</td>
              <td className={`${tdCls} text-right tabular-nums`}>{fmtCantidad(i.cantidadRecibida)}</td>
              <td className={`${tdCls} text-right font-bold tabular-nums ${i.diferencia < 0 ? "text-rose-300" : i.diferencia > 0 ? "text-amber-300" : ""}`}>{fmtDiferencia(i.diferencia)}</td>
              <td className={tdCls}>
                <ChipEstadoIncidencia estado={i.estado} />
              </td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                {puede("recepciones.incidencia.manage") && (i.estado === "ABIERTA" || i.estado === "EN_GESTION") && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {i.estado === "ABIERTA" && (
                      <button className={btnMini} onClick={() => void cambiar(i, "EN_GESTION")}>
                        En gestión
                      </button>
                    )}
                    <button className={`${btnMini} bg-emerald-700 hover:bg-emerald-600`} onClick={() => setResolviendo({ incidencia: i, estado: "RESUELTA" })}>
                      Resolver
                    </button>
                    <button className={btnMini} onClick={() => setResolviendo({ incidencia: i, estado: "CANCELADA" })}>
                      Cancelar
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {resolviendo && (
        <Modal
          title={resolviendo.estado === "RESUELTA" ? "Resolver incidencia" : "Cancelar incidencia"}
          onClose={() => setResolviendo(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setResolviendo(null)}>
                Volver
              </button>
              <button className={btnPrimary} disabled={!resolucion.trim()} onClick={() => void cambiar(resolviendo.incidencia, resolviendo.estado, resolucion)}>
                Confirmar
              </button>
            </div>
          }
        >
          <p className="mb-2 text-sm text-slate-300">
            <b>{resolviendo.incidencia.descripcionProducto}</b> · {etiquetaTipoIncidencia(resolviendo.incidencia.tipo)} · diferencia {fmtDiferencia(resolviendo.incidencia.diferencia)}
          </p>
          <TextAreaField
            label={resolviendo.estado === "RESUELTA" ? "Cómo se ha resuelto" : "Por qué se cancela"}
            value={resolucion}
            onChange={setResolucion}
            placeholder={resolviendo.estado === "RESUELTA" ? "Nueva entrega el 18/09 · abono nº … · diferencia aceptada" : "Error de conteo, ya rectificado"}
          />
        </Modal>
      )}
    </div>
  );
}
