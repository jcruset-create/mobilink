/**
 * Movimientos de efectivo que no son un cobro ni un pago: ingresos y salidas
 * manuales, entregas o retiradas intermedias, ingresos bancarios y ajustes.
 *
 * Todos siguen la misma regla que el resto del módulo: hay que decir qué piezas
 * entran o salen. Un ajuste, además, exige motivo, porque un descuadre sin
 * explicar no es un ajuste, es un agujero.
 */

import { useState } from "react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, { type CantidadesPorValor, lineasDesde } from "../components/DenominationGrid";
import {
  Aviso,
  BotonAccion,
  Cabecera,
  ErrorBox,
  EmptyRow,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
} from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import { ETIQUETA_MOTIVO } from "../types";
import * as api from "../services/api";
import { useEffect } from "react";

type TipoMovimiento = "MANUAL_IN" | "MANUAL_OUT" | "CASH_DELIVERY" | "BANK_DEPOSIT" | "ADJUSTMENT";

const TIPOS: { valor: TipoMovimiento; etiqueta: string; entra: boolean; ayuda: string }[] = [
  { valor: "MANUAL_IN", etiqueta: "Ingreso manual", entra: true, ayuda: "Entra efectivo en la caja (aportación de cambio, devolución…)." },
  { valor: "MANUAL_OUT", etiqueta: "Salida manual", entra: false, ayuda: "Sale efectivo por un gasto o una necesidad puntual." },
  { valor: "CASH_DELIVERY", etiqueta: "Entrega / retirada", entra: false, ayuda: "Retirada intermedia de efectivo durante la jornada." },
  { valor: "BANK_DEPOSIT", etiqueta: "Ingreso bancario", entra: false, ayuda: "Efectivo que sale hacia el banco." },
  { valor: "ADJUSTMENT", etiqueta: "Ajuste", entra: true, ayuda: "Corrección auditada. Exige motivo." },
];

export default function Movimientos() {
  const { jornada, denominaciones, disponible, refrescar, puede } = useCash();

  const [tipo, setTipo] = useState<TipoMovimiento>("MANUAL_IN");
  const [importeTexto, setImporteTexto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [efectivo, setEfectivo] = useState<CantidadesPorValor>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  const definicion = TIPOS.find((t) => t.valor === tipo)!;
  const importe = aCentimos(importeTexto) ?? 0;
  const total = totalLineas(lineasDesde(efectivo));

  // El importe se deduce de las piezas: en un movimiento manual lo que manda es
  // lo que físicamente se mete o se saca, no un número tecleado aparte.
  useEffect(() => {
    if (total > 0) setImporteTexto(String(total / 100).replace(".", ","));
  }, [total]);

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }

  const esAjuste = tipo === "ADJUSTMENT";
  const puedeConfirmar =
    importe > 0 && total === importe && (!esAjuste || concepto.trim().length > 0) && !guardando;

  async function confirmar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.registrarMovimiento({
        sessionId: jornada!.sesion.id,
        tipo,
        importeCentimos: importe,
        efectivo: lineasDesde(efectivo),
        concepto,
      });
      setUltimo(r.numero);
      setEfectivo({});
      setImporteTexto("");
      setConcepto("");
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar el movimiento");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera titulo="Movimientos" descripcion="Ingresos, salidas, entregas, ingresos bancarios y ajustes." />

      {ultimo && <Aviso tono="bien">Movimiento <strong>{ultimo}</strong> registrado.</Aviso>}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tipo de movimiento</div>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((t) => {
                const bloqueado = t.valor === "ADJUSTMENT" && !puede("cash.adjustment.create");
                return (
                  <button
                    key={t.valor}
                    onClick={() => {
                      setTipo(t.valor);
                      setEfectivo({});
                    }}
                    disabled={bloqueado}
                    className={`rounded-xl px-3 py-2 text-[12px] font-bold disabled:opacity-30 ${
                      tipo === t.valor ? "bg-sky-600 text-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    }`}
                  >
                    {t.etiqueta}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{definicion.ayuda}</p>

            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Concepto {esAjuste && <span className="text-amber-300">(obligatorio)</span>}
              </span>
              <input
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                className={inputCls}
                placeholder={esAjuste ? "Motivo del ajuste" : "Descripción del movimiento"}
              />
            </label>

            <div className="mt-2 flex items-baseline justify-between rounded-lg bg-slate-900/60 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">
                {definicion.entra ? "Entra" : "Sale"}
              </span>
              <span className="text-2xl font-black tabular-nums text-slate-100">{euros(total)}</span>
            </div>
          </div>

          <BotonAccion onClick={() => void confirmar()} disabled={!puedeConfirmar}>
            {guardando ? "Registrando…" : `Confirmar ${definicion.etiqueta.toLowerCase()}`}
          </BotonAccion>
        </div>

        <DenominationGrid
          titulo={definicion.entra ? "Efectivo que entra" : "Efectivo que sale"}
          denominaciones={denominaciones}
          cantidades={efectivo}
          onChange={setEfectivo}
          disponible={definicion.entra ? undefined : disponible}
          mostrarDisponible={!definicion.entra}
          deshabilitado={guardando}
        />
      </div>

      <HistorialMovimientos sessionId={jornada.sesion.id} clave={ultimo} />
    </div>
  );
}

/** Libro mayor de piezas de la jornada: entra y sale, en orden. */
function HistorialMovimientos({ sessionId, clave }: { sessionId: number; clave: string | null }) {
  const [movs, setMovs] = useState<Awaited<ReturnType<typeof api.movimientosJornada>>["movimientos"]>([]);

  useEffect(() => {
    let vivo = true;
    api
      .movimientosJornada(sessionId)
      .then((r) => vivo && setMovs(r.movimientos.slice().reverse()))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [sessionId, clave]);

  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Movimientos de piezas de la jornada
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Hora</th>
            <th className={thCls}>Motivo</th>
            <th className={thCls}>Pieza</th>
            <th className={`${thCls} text-right`}>Cantidad</th>
            <th className={`${thCls} text-right`}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {movs.length === 0 && <EmptyRow cols={5} text="Todavía no hay movimientos." />}
          {movs.slice(0, 100).map((m) => (
            <tr key={m.id} className="border-t border-slate-700">
              <td className={`${tdCls} text-[11px] text-slate-500`}>
                {new Date(m.createdAtMs).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className={tdCls}>{ETIQUETA_MOTIVO[m.motivo] ?? m.motivo}</td>
              <td className={tdCls}>{euros(m.valor)}</td>
              <td className={`${tdCls} text-right font-bold tabular-nums ${m.direccion === "IN" ? "text-emerald-400" : "text-amber-300"}`}>
                {m.direccion === "IN" ? "+" : "−"}
                {m.cantidad}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{euros(m.importe)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
