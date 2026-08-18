/**
 * Panel de integración con la ERP.
 *
 * Lo primero que tiene que dejar claro es que **ERP NO CONFIGURADA no es un
 * error**: es el modo por defecto, y con él se puede abrir caja, cobrar y pagar
 * a mano, arquear, ingresar en el banco y cerrar. Este panel solo existe para
 * cuando SÍ hay una ERP detrás.
 */

import { useCallback, useEffect, useState } from "react";
import { Plug, RefreshCw, RotateCcw } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Aviso,
  Cabecera,
  Card,
  EmptyRow,
  ErrorBox,
  TableWrap,
  thCls,
  tdCls,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "../components/ui";
import * as api from "../services/api";

type Estado = Awaited<ReturnType<typeof api.estadoErp>>;

const TEXTO_ESTADO: Record<string, string> = {
  NO_CONFIGURADA: "NO CONFIGURADA",
  DESACTIVADA: "DESACTIVADA",
  CONECTADA: "CONECTADA",
  ERROR: "ERROR",
};

export default function IntegracionErp() {
  const { puede } = useCash();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState("");

  const [connectorKey, setConnectorKey] = useState("mock");
  const [activo, setActivo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const e = await api.estadoErp();
      setEstado(e);
      if (e.connectorKey) setConnectorKey(e.connectorKey);
      setActivo(e.estado === "CONECTADA");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el estado de la integración");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(nombre: string, fn: () => Promise<string>) {
    setOcupado(nombre);
    setError("");
    setMensaje("");
    try {
      setMensaje(await fn());
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado("");
    }
  }

  const sinConfigurar = estado?.estado === "NO_CONFIGURADA";

  return (
    <div className="space-y-3">
      <Cabecera titulo="Integración ERP" descripcion="Conexión opcional con la ERP que emite las facturas." />

      {error && <ErrorBox>{error}</ErrorBox>}
      {mensaje && <Aviso tono="bien">{mensaje}</Aviso>}

      {sinConfigurar && (
        <Aviso tono="info">
          No hay ninguna ERP configurada, y <strong>no hace falta</strong>: Mobilink Cash funciona en
          modo autónomo. Se puede abrir caja, cobrar y pagar a mano, arquear, preparar el ingreso
          bancario y cerrar la jornada sin conectar nada.
        </Aviso>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estado</div>
          <div
            className={`mt-1 text-2xl font-black ${
              estado?.estado === "CONECTADA"
                ? "text-emerald-400"
                : estado?.estado === "ERROR"
                  ? "text-rose-400"
                  : "text-slate-400"
            }`}
          >
            {TEXTO_ESTADO[estado?.estado ?? ""] ?? "—"}
          </div>
          {estado?.displayName && <div className="text-[11px] text-slate-500">{estado.displayName}</div>}
        </div>
        <Card
          title="Última sincronización"
          value={
            estado?.config?.last_sync_at_ms
              ? new Date(Number(estado.config.last_sync_at_ms)).toLocaleString("es-ES")
              : "—"
          }
        />
        <Card title="Documentos recibidos" value={String(estado?.documentosRecibidos ?? 0)} />
        <Card
          title="Pendientes de enviar"
          value={String((estado?.outbox?.PENDING ?? 0) + (estado?.outbox?.RETRY_PENDING ?? 0))}
          hint={`${estado?.outbox?.ERROR ?? 0} con error`}
          accent={(estado?.outbox?.ERROR ?? 0) > 0 ? "text-rose-400" : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() =>
            accion("probar", async () => {
              const r = await api.probarErp();
              return r.mensaje;
            })
          }
          disabled={ocupado !== ""}
          className={btnSecondary}
        >
          <Plug className="mr-1 inline h-4 w-4" />
          {ocupado === "probar" ? "Probando…" : "Probar conexión"}
        </button>

        {puede("cash.erp.sync") && (
          <>
            <button
              onClick={() =>
                accion("sync", async () => {
                  const r = await api.sincronizarErp();
                  return `${r.importados} documento(s) importados de la ERP.`;
                })
              }
              disabled={ocupado !== "" || sinConfigurar}
              className={btnPrimary}
            >
              <RefreshCw className="mr-1 inline h-4 w-4" />
              {ocupado === "sync" ? "Sincronizando…" : "Sincronizar documentos"}
            </button>

            <button
              onClick={() =>
                accion("retry", async () => {
                  const r = await api.reintentarErp();
                  return `${r.reencolados} evento(s) reencolados, ${r.tratados} procesados.`;
                })
              }
              disabled={ocupado !== ""}
              className={btnSecondary}
            >
              <RotateCcw className="mr-1 inline h-4 w-4" />
              {ocupado === "retry" ? "Reintentando…" : "Reintentar errores"}
            </button>
          </>
        )}
      </div>

      <Aviso tono="info">
        Un cobro nunca se pierde porque la ERP esté caída. El movimiento de efectivo se guarda en la
        misma transacción que el evento de sincronización; si la ERP no contesta, el cobro queda
        firme y el aviso se reintenta solo. Nada revierte dinero que ya se movió físicamente.
      </Aviso>

      {puede("cash.erp.configure") && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Configuración</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Conector</span>
              <select value={connectorKey} onChange={(e) => setConnectorKey(e.target.value)} className={inputCls}>
                {(estado?.conectoresDisponibles ?? ["mock"]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <span className="text-sm text-slate-200">Integración activa</span>
            </label>
            <button
              onClick={() =>
                accion("guardar", async () => {
                  await api.guardarConfigErp({ connectorKey, activo });
                  return "Configuración guardada.";
                })
              }
              disabled={ocupado !== ""}
              className={btnPrimary}
            >
              Guardar
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Las credenciales de la ERP no se configuran aquí: viven en variables de entorno dentro
            del conector y nunca llegan al navegador.
          </p>
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Errores de sincronización
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Fecha</th>
              <th className={thCls}>Evento</th>
              <th className={thCls}>Operación</th>
              <th className={`${thCls} text-right`}>Intentos</th>
              <th className={thCls}>Error</th>
            </tr>
          </thead>
          <tbody>
            {(estado?.errores ?? []).length === 0 && <EmptyRow cols={5} text="No hay errores de sincronización." />}
            {(estado?.errores ?? []).map((e, i) => (
              <tr key={i} className="border-t border-slate-700">
                <td className={`${tdCls} text-[11px] text-slate-500`}>
                  {new Date(Number(e.created_at_ms)).toLocaleString("es-ES")}
                </td>
                <td className={tdCls}>{String(e.evento)}</td>
                <td className={`${tdCls} font-mono text-[11px]`}>{String(e.mobilink_id ?? "")}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{String(e.intentos)}</td>
                <td className={`${tdCls} text-[11px] text-rose-300`}>{String(e.last_error ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
