/**
 * El gasto por proveedor: a quién se le paga.
 *
 * Mismo corte que el reparto por concepto —fecha de jornada, anulaciones
 * fuera, una liquidación contada por sus tickets—; solo cambia por qué se
 * agrupa. Cómo se reconoce a cada proveedor lo decide el servidor
 * (`server/cash/expensestats.ts`, «Por proveedor») y aquí se ENSEÑA: la
 * etiqueta de cada fila dice si se ha reconocido por el código de la ERP, por
 * el NIF del ticket o solo por el nombre escrito, que es el que puede fallar.
 *
 * El detalle de cada proveedor se pide al abrirlo y no con el informe: con un
 * año entero serían miles de líneas para enseñar, como mucho, un par de ellas.
 */

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyRow, TableWrap, thCls, tdCls } from "./ui";
import { euros } from "../utils/money";
import type { InformeProveedores, LineaProveedorGasto, PagoDeProveedor, ViaProveedor } from "../types";
import * as api from "../services/api";

/** Cuántos proveedores caben en las barras; el resto sigue en la tabla. */
const EN_BARRAS = 10;

const ETIQUETA_VIA: Record<ViaProveedor, string> = {
  ERP: "ERP",
  NIF: "Ticket · NIF",
  NOMBRE: "Nombre escrito",
};

const COLOR_VIA: Record<ViaProveedor, string> = {
  ERP: "bg-sky-900/60 text-sky-200",
  NIF: "bg-teal-900/60 text-teal-200",
  NOMBRE: "bg-amber-900/50 text-amber-200",
};

type Filtro = { desde: string; hasta: string; centro: string | null; conceptoId: number | null };

export default function GastoProveedores({ informe, filtro }: { informe: InformeProveedores; filtro: Filtro }) {
  const reconocidos = informe.proveedores.filter((p) => p.clave != null);
  const primero = reconocidos[0];
  const pct = (c: number) =>
    informe.totalCentimos > 0 ? `${((c / informe.totalCentimos) * 100).toFixed(1)} %` : "—";

  if (informe.operaciones === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-center text-[13px] text-slate-400">
        No hay ningún pago entre el {informe.desde} y el {informe.hasta}
        {informe.centroId ? " en este centro" : ""}. Prueba con otras fechas.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Gasto del periodo</div>
          <div className="text-2xl font-black tabular-nums text-slate-100">{euros(informe.totalCentimos)}</div>
          <div className="text-[11px] text-slate-500">
            {informe.operaciones} pago(s) · {reconocidos.length} proveedor(es)
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">El primero</div>
          {primero ? (
            <>
              <div className="truncate pt-1 text-lg font-bold text-slate-100" title={primero.nombre}>
                {primero.nombre}
              </div>
              <div className="text-[11px] text-slate-500">
                {euros(primero.importeCentimos)} · {pct(primero.importeCentimos)} del gasto
              </div>
            </>
          ) : (
            <div className="pt-1 text-[12px] text-slate-500">Ningún pago con proveedor.</div>
          )}
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sin proveedor</div>
          <div className="text-2xl font-black tabular-nums text-slate-300">{euros(informe.sinProveedorCentimos)}</div>
          <div className="text-[11px] text-slate-500">
            {/*
             * Se enseña aunque sea cero: dice que el total de arriba es TODO
             * el gasto, también lo que salió de la caja sin nombre.
             */}
            {informe.sinProveedorCentimos > 0
              ? `${pct(informe.sinProveedorCentimos)} del total: pagos sin nombre de proveedor`
              : "Todos los pagos llevan proveedor"}
          </div>
        </div>
      </div>

      <Barras informe={informe} />

      <Tabla informe={informe} filtro={filtro} pct={pct} />

      <p className="text-[11px] text-slate-500">
        <strong className="text-slate-400">Cómo se reconoce al proveedor.</strong> Un pago de una factura de la ERP se
        agrupa por el código de proveedor; un ticket de gastos de trabajadores, por el NIF del emisor; un pago a mano,
        por el nombre escrito, sin mayúsculas, tildes ni «S.L.» o «S.A.»: «Repsol» y «REPSOL, S.A.» son el mismo, pero
        «Gasolinera Repsol Valls» sale aparte.
      </p>
    </>
  );
}

// ── Las barras ─────────────────────────────────────────────────────────────

function Barras({ informe }: { informe: InformeProveedores }) {
  /* «Sin proveedor» no compite en las barras: no es nadie a quien se le pague. */
  const top = informe.proveedores.filter((p) => p.clave != null).slice(0, EN_BARRAS);
  if (top.length === 0) return null;
  const maximo = Math.max(...top.map((p) => p.importeCentimos), 1);

  return (
    <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        A quién se le paga{informe.proveedores.length > EN_BARRAS + 1 ? ` · los ${EN_BARRAS} primeros` : ""}
      </div>
      {top.map((p) => (
        <div key={p.clave} className="flex items-center gap-2">
          <span className="w-40 shrink-0 truncate text-[12px] text-slate-300 sm:w-56" title={p.nombre}>
            {p.nombre}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-900">
            <div
              className="h-full rounded bg-sky-500/70"
              style={{ width: `${Math.max((p.importeCentimos / maximo) * 100, 1)}%` }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-slate-300">
            {euros(p.importeCentimos)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── La tabla, con el detalle de cada uno ───────────────────────────────────

function Tabla({
  informe,
  filtro,
  pct,
}: {
  informe: InformeProveedores;
  filtro: Filtro;
  pct: (c: number) => string;
}) {
  /** La fila abierta, por clave. `""` = la de sin proveedor; `undefined` = ninguna. */
  const [abierta, setAbierta] = useState<string | undefined>(undefined);
  const [pagos, setPagos] = useState<Record<string, PagoDeProveedor[] | "cargando" | "error">>({});

  /*
   * La caché va por consulta: si cambian las fechas o el centro, el componente
   * se vuelve a montar (lo hace el padre con `key`) y empieza vacía. Así nunca
   * se enseñan los pagos de octubre bajo las cifras de noviembre.
   */
  async function abrir(p: LineaProveedorGasto) {
    const k = p.clave ?? "";
    if (abierta === k) {
      setAbierta(undefined);
      return;
    }
    setAbierta(k);
    if (pagos[k] && pagos[k] !== "error") return;
    setPagos((x) => ({ ...x, [k]: "cargando" }));
    try {
      const r = await api.pagosDeProveedor(filtro, p.clave);
      setPagos((x) => ({ ...x, [k]: r.pagos }));
    } catch {
      setPagos((x) => ({ ...x, [k]: "error" }));
    }
  }

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Proveedor</th>
          <th className={thCls}>Reconocido por</th>
          <th className={thCls}>Concepto principal</th>
          <th className={`${thCls} text-right`}>Importe</th>
          <th className={`${thCls} text-right`}>% del total</th>
          <th className={`${thCls} text-right`}>Pagos</th>
        </tr>
      </thead>
      <tbody>
        {informe.proveedores.length === 0 && <EmptyRow cols={6} text="Ningún pago en este periodo." />}
        {informe.proveedores.map((p) => {
          const k = p.clave ?? "";
          const abiertaEsta = abierta === k;
          const sin = p.clave == null;
          return (
            <Fragment key={k || "sin"}>
              <tr className="hover:bg-slate-800/60">
                <td className={tdCls}>
                  <button
                    type="button"
                    onClick={() => void abrir(p)}
                    aria-expanded={abiertaEsta}
                    className="flex items-center gap-1.5 text-left"
                    title="Ver sus pagos"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${abiertaEsta ? "rotate-90" : ""}`}
                    />
                    <span className={sin ? "italic text-slate-500" : "font-medium text-slate-100"}>{p.nombre}</span>
                  </button>
                </td>
                <td className={tdCls}>
                  {p.via ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COLOR_VIA[p.via]}`}>
                      {ETIQUETA_VIA[p.via]}
                      {p.identificador ? ` · ${p.identificador}` : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">—</span>
                  )}
                </td>
                <td className={`${tdCls} text-slate-300`}>
                  {p.conceptoPrincipal ?? <span className="italic text-slate-500">Sin clasificar</span>}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(p.importeCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{pct(p.importeCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{p.operaciones}</td>
              </tr>
              {abiertaEsta && (
                <tr className="bg-slate-900/60">
                  <td colSpan={6} className="px-3 pb-3 pl-8 pt-1">
                    <Detalle estado={pagos[k]} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

function Detalle({ estado }: { estado: PagoDeProveedor[] | "cargando" | "error" | undefined }) {
  if (estado === undefined || estado === "cargando") {
    return <div className="py-2 text-[12px] text-slate-500">Cargando sus pagos…</div>;
  }
  if (estado === "error") {
    return <div className="py-2 text-[12px] text-rose-300">No se han podido cargar. Vuelve a abrirlo.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="py-1.5 pr-2 font-semibold">Jornada</th>
            <th className="px-2 py-1.5 font-semibold">Caja</th>
            <th className="px-2 py-1.5 font-semibold">Operación</th>
            <th className="px-2 py-1.5 font-semibold">Documento</th>
            <th className="px-2 py-1.5 font-semibold">Concepto · destino</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          {estado.map((x, i) => (
            <tr key={`${x.operacionId}-${i}`} className="border-t border-slate-800 text-slate-300">
              <td className="py-1.5 pr-2 font-mono">{x.fecha}</td>
              <td className="px-2 py-1.5">{x.caja}</td>
              <td className="px-2 py-1.5 font-mono">{x.numero}</td>
              <td className="px-2 py-1.5">{x.documento ?? "—"}</td>
              <td className="px-2 py-1.5">
                {x.concepto ?? <span className="italic text-slate-500">Sin clasificar</span>}
                {x.destino ? ` · ${x.destino}` : ""}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-slate-100">{euros(x.importeCentimos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
