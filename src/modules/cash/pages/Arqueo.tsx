/**
 * Arqueo: contar lo que hay de verdad y compararlo con lo que debería haber.
 *
 * La pantalla enseña los DOS cuadres por separado, que es lo que un total no
 * detecta: la caja puede tener exactamente los 1.000 € que tocaban y aun así
 * faltar dos billetes de 20 € y sobrar cuatro de 10 €. Eso normalmente
 * significa que alguien dio mal un cambio, y hay que verlo.
 */

import { useState } from "react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, { type CantidadesPorValor, cantidadesDesde } from "../components/DenominationGrid";
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
import { euros, eurosConSigno } from "../utils/money";
import type { ResultadoArqueo } from "../types";
import * as api from "../services/api";

export default function Arqueo() {
  const { jornada, denominaciones, refrescar } = useCash();

  const [contado, setContado] = useState<CantidadesPorValor>({});
  const [cartuchos, setCartuchos] = useState<CantidadesPorValor>({});
  const [notas, setNotas] = useState("");
  const [resultado, setResultado] = useState<ResultadoArqueo | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta.</Aviso>;
  }

  /**
   * Copia el teórico como punto de partida: acelera el arqueo de una caja que
   * cuadra.
   *
   * Copia las dos dimensiones por separado. Volcar el total de piezas en la
   * columna de sueltas —que es lo que hacía antes— contaba las monedas de los
   * tubos como si estuvieran sueltas y dejaba los cartuchos a cero: al cerrar,
   * los tubos precintados desaparecían sin que nadie los hubiera abierto.
   */
  function precargarTeorico() {
    setContado(cantidadesDesde(jornada!.stockSueltas ?? []));
    setCartuchos(cantidadesDesde(jornada!.stockCartuchos ?? []));
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.guardarArqueo(jornada!.sesion.id, {
        contado: Object.entries(contado)
          .map(([valor, cantidad]) => ({ valor: Number(valor), cantidad }))
          .filter((l) => l.cantidad > 0),
        cartuchos: Object.entries(cartuchos)
          .map(([valor, cantidad]) => ({ valor: Number(valor), cantidad }))
          .filter((l) => l.cantidad > 0),
        notas: notas || undefined,
      });
      setResultado(r);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar el arqueo");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera titulo="Arqueo" descripcion="Cuenta el efectivo físico y compáralo con el teórico.">
        <button
          onClick={precargarTeorico}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          Partir del teórico
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      {resultado && <ResumenArqueo r={resultado} />}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <DenominationGrid
            titulo="Efectivo contado"
            denominaciones={denominaciones}
            cantidades={contado}
            onChange={setContado}
            cartuchos={cartuchos}
            onCartuchosChange={setCartuchos}
            deshabilitado={guardando}
          />
          <p className="text-[11px] text-slate-500">
            La columna estrecha de la derecha en las monedas es para cartuchos: se cuentan aparte y
            el sistema los convierte a piezas con la configuración de cada denominación.
          </p>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Notas del arqueo</span>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className={inputCls} placeholder="Opcional" />
          </label>

          <BotonAccion tono="cierre" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar arqueo y comparar"}
          </BotonAccion>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800">
          <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Teórico actual
          </div>
          <div className="divide-y divide-slate-700/60">
            {jornada.stock.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-500">La caja está a cero.</p>
            )}
            {jornada.stock.map((l) => {
              const d = denominaciones.find((x) => x.valor === l.valor);
              return (
                <div key={l.valor} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-16 text-sm font-bold tabular-nums text-slate-200">
                    {d?.etiqueta ?? euros(l.valor)}
                  </span>
                  <span className="text-lg font-black tabular-nums text-slate-100">×{l.cantidad}</span>
                  <span className="ml-auto text-sm tabular-nums text-slate-400">{euros(l.valor * l.cantidad)}</span>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-700 px-3 py-2 text-right">
            <span className="text-xl font-black tabular-nums text-slate-100">
              {euros(jornada.totalStockCentimos)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumenArqueo({ r }: { r: ResultadoArqueo }) {
  const tonoImporte = r.diferencia === 0 ? "text-emerald-400" : r.diferencia > 0 ? "text-sky-300" : "text-rose-400";
  const textoEstado = { CUADRADA: "CAJA CUADRADA", SOBRANTE: "SOBRANTE", FALTANTE: "FALTANTE" }[r.estado];

  return (
    <div className="space-y-2">
      {/* Doble cuadre: los dos resultados por separado, siempre. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div
          className={`rounded-xl border p-3 ${
            r.cuadraImporte ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10"
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Cuadre monetario</div>
          <div className={`text-2xl font-black ${tonoImporte}`}>{textoEstado}</div>
          <div className="mt-1 text-[12px] text-slate-400">
            Teórico {euros(r.totalTeorico)} · contado {euros(r.totalContado)} ·{" "}
            <strong className={tonoImporte}>{eurosConSigno(r.diferencia)}</strong>
          </div>
        </div>

        <div
          className={`rounded-xl border p-3 ${
            r.cuadranDenominaciones ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Cuadre de denominaciones</div>
          <div className={`text-2xl font-black ${r.cuadranDenominaciones ? "text-emerald-400" : "text-amber-300"}`}>
            {r.cuadranDenominaciones ? "COINCIDEN" : "NO COINCIDEN"}
          </div>
          <div className="mt-1 text-[12px] text-slate-400">
            {r.piezasTeoricas} piezas teóricas · {r.piezasContadas} contadas
          </div>
        </div>
      </div>

      {r.cuadraImporte && !r.cuadranDenominaciones && (
        <Aviso tono="aviso">
          El importe total cuadra pero las piezas no. Suele significar que se ha dado mal un cambio:
          revisa las denominaciones de abajo.
        </Aviso>
      )}

      {r.descuadres.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Diferencias detectadas
          </div>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Denominación</th>
                <th className={`${thCls} text-right`}>Teórico</th>
                <th className={`${thCls} text-right`}>Contado</th>
                <th className={`${thCls} text-right`}>Diferencia</th>
                <th className={`${thCls} text-right`}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {r.descuadres.map((d) => (
                <tr key={d.valor} className="border-t border-slate-700">
                  <td className={`${tdCls} font-bold`}>{euros(d.valor)}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{d.teorico}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{d.contado}</td>
                  <td
                    className={`${tdCls} text-right font-bold tabular-nums ${
                      d.diferencia > 0 ? "text-sky-300" : "text-rose-400"
                    }`}
                  >
                    {d.diferencia > 0 ? `+${d.diferencia}` : d.diferencia}
                  </td>
                  <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                    {eurosConSigno(d.importeDiferencia)}
                  </td>
                </tr>
              ))}
              {r.descuadres.length === 0 && <EmptyRow cols={5} text="Todo cuadra." />}
            </tbody>
          </TableWrap>
        </div>
      )}
    </div>
  );
}
