/**
 * Stock de caja: la respuesta rápida a "¿cuántos billetes de 50 € debería
 * haber ahora mismo?".
 *
 * Es el motivo de ser del módulo. Un total no sirve: hay que ver la
 * composición, pieza a pieza, y de un vistazo.
 */

import { useCash } from "../contexts/CashContext";
import { Aviso, Cabecera, Card } from "../components/ui";
import { euros } from "../utils/money";

export default function StockCaja() {
  const { jornada, denominaciones, refrescar } = useCash();

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta.</Aviso>;
  }

  const porValor = new Map(jornada.stock.map((l) => [l.valor, l.cantidad]));
  const billetes = denominaciones.filter((d) => d.tipo === "BILLETE");
  const monedas = denominaciones.filter((d) => d.tipo === "MONEDA");

  const totalDe = (grupo: typeof denominaciones) =>
    grupo.reduce((a, d) => a + (porValor.get(d.valor) ?? 0) * d.valor, 0);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Stock de caja" descripcion="Efectivo teórico ahora mismo, por denominación.">
        <button
          onClick={() => void refrescar()}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          ↺ Actualizar
        </button>
      </Cabecera>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card title="Total en caja" value={euros(jornada.totalStockCentimos)} accent="text-emerald-400" />
        <Card title="Billetes" value={euros(totalDe(billetes))} />
        <Card title="Monedas" value={euros(totalDe(monedas))} hint={`${jornada.piezas} piezas en total`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Grupo titulo="Billetes" denominaciones={billetes} porValor={porValor} />
        <Grupo titulo="Monedas" denominaciones={monedas} porValor={porValor} />
      </div>

      <p className="text-[11px] text-slate-500">
        Este stock no se guarda como saldo: se reconstruye sumando el libro mayor de movimientos de
        la jornada (fondo inicial + entradas − salidas). Por eso no puede quedarse desincronizado.
      </p>
    </div>
  );
}

function Grupo({
  titulo,
  denominaciones,
  porValor,
}: {
  titulo: string;
  denominaciones: { valor: number; etiqueta: string; piezasPorCartucho: number | null }[];
  porValor: Map<number, number>;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {titulo}
      </div>
      <div className="divide-y divide-slate-700/60">
        {denominaciones.map((d) => {
          const cantidad = porValor.get(d.valor) ?? 0;
          const cartuchos = d.piezasPorCartucho ? Math.floor(cantidad / d.piezasPorCartucho) : 0;
          return (
            <div
              key={d.valor}
              className={`flex items-center gap-3 px-3 py-1.5 ${cantidad === 0 ? "opacity-40" : ""}`}
            >
              <span className="w-16 text-sm font-bold tabular-nums text-slate-200">{d.etiqueta}</span>
              <span className="text-lg font-black tabular-nums text-slate-100">×{cantidad}</span>
              {cartuchos > 0 && (
                <span className="text-[10px] text-slate-500">
                  ({cartuchos} {cartuchos === 1 ? "cartucho" : "cartuchos"})
                </span>
              )}
              <span className="ml-auto text-sm tabular-nums text-slate-400">
                {cantidad > 0 ? euros(cantidad * d.valor) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
