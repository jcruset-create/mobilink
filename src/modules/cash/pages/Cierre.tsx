/**
 * Cierre: repartir el efectivo contado entre lo que se queda como cambio para
 * mañana y lo que va al banco.
 *
 * El ingreso bancario no se teclea: se calcula restando. Es lo que garantiza
 * que el mismo billete no acabe asignado a los dos sitios, y que la relación
 * arqueo = cambio final + ingreso se cumpla también en piezas y no solo en
 * importe.
 */

import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import { Aviso, BotonAccion, Cabecera, Card, ErrorBox, inputCls } from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import type { LineaDenominacion } from "../types";
import * as api from "../services/api";

export default function Cierre() {
  const { jornada, denominaciones, refrescar } = useCash();

  const [objetivoTexto, setObjetivoTexto] = useState("300,00");
  const [cambioFinal, setCambioFinal] = useState<CantidadesPorValor>({});
  const [cambioFinalTubos, setCambioFinalTubos] = useState<LineaDenominacion[]>([]);
  const [ingreso, setIngreso] = useState<LineaDenominacion[]>([]);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cerrada, setCerrada] = useState<Awaited<ReturnType<typeof api.cerrarJornada>> | null>(null);

  const objetivo = aCentimos(objetivoTexto) ?? 0;
  const totalCambio = totalLineas(lineasDesde(cambioFinal));

  const pedirPropuesta = useCallback(async () => {
    if (!jornada || objetivo <= 0) return;
    setError("");
    try {
      const r = await api.proponerCierre(jornada.sesion.id, objetivo);
      setCambioFinal(cantidadesDesde(r.cambioFinal));
      setCambioFinalTubos(r.cambioFinalCartuchos ?? []);
      setIngreso(r.ingresoBancario);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido preparar el cierre");
    }
  }, [jornada, objetivo]);

  /*
   * El ingreso se recalcula en cuanto cambia el cambio final: siempre es "lo
   * contado menos lo que se queda", nunca un número que el operador teclea.
   *
   * Se trabaja sobre las monedas SUELTAS. Los tubos precintados van por su
   * cuenta y no se desglosan en la rejilla: un tubo entero se queda o se va, no
   * se parte —y si se partiera dejaría de ser un tubo.
   */
  useEffect(() => {
    if (!jornada) return;
    const contado = new Map((jornada.stockSueltas ?? []).map((l) => [l.valor, l.cantidad]));
    const restante: LineaDenominacion[] = [];
    for (const [valor, disponible] of contado) {
      const sequeda = cambioFinal[valor] ?? 0;
      if (disponible - sequeda > 0) restante.push({ valor, cantidad: disponible - sequeda });
    }
    setIngreso(restante.sort((a, b) => b.valor - a.valor));
  }, [cambioFinal, jornada]);

  if (!jornada) return <Aviso tono="aviso">No hay ninguna jornada abierta.</Aviso>;

  if (cerrada) return <Cerrada r={cerrada} />;

  const totalIngreso = totalLineas(ingreso);
  const contadoTotal = jornada.totalStockCentimos;

  // Valor de los tubos que se quedan y de los que se van al banco.
  const piezasDe = (valor: number) =>
    denominaciones.find((d) => d.valor === valor)?.piezasPorCartucho ?? 0;
  const valorTubos = (ls: LineaDenominacion[]) =>
    ls.reduce((a, l) => a + l.valor * l.cantidad * piezasDe(l.valor), 0);

  const tubosContados = jornada.stockCartuchos ?? [];
  const tubosQueSeVan = tubosContados
    .map((t) => ({
      valor: t.valor,
      cantidad: t.cantidad - (cambioFinalTubos.find((x) => x.valor === t.valor)?.cantidad ?? 0),
    }))
    .filter((t) => t.cantidad > 0);

  const totalCambioConTubos = totalCambio + valorTubos(cambioFinalTubos);
  const totalIngresoConTubos = totalIngreso + valorTubos(tubosQueSeVan);
  const cuadra = totalCambioConTubos + totalIngresoConTubos === contadoTotal;

  async function cerrar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.cerrarJornada(jornada!.sesion.id, {
        cambioFinal: lineasDesde(cambioFinal),
        cambioFinalCartuchos: cambioFinalTubos,
        notas: notas || undefined,
      });
      setCerrada(r);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cerrar la jornada");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Cierre de jornada"
        descripcion="Decide qué se queda en caja para mañana; el resto va al ingreso bancario."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <Aviso tono="info">
        Hay que hacer el arqueo antes de cerrar. Lo que se reparte es el efectivo <strong>contado</strong>,
        no el teórico: si hay descuadre, el dinero que existe de verdad es el contado, y la
        diferencia queda asentada como ajuste auditado.
      </Aviso>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Cambio que se queda para mañana
          </span>
          <input
            value={objetivoTexto}
            onChange={(e) => setObjetivoTexto(e.target.value)}
            inputMode="decimal"
            className={`${inputCls} w-40 text-lg font-bold tabular-nums`}
          />
        </label>
        <button
          onClick={() => void pedirPropuesta()}
          className="h-[38px] rounded-lg bg-slate-700 px-3 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          Proponer composición
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card title="Contado en el arqueo" value={euros(contadoTotal)} />
        <Card
          title="Se queda en caja"
          value={euros(totalCambioConTubos)}
          hint={cambioFinalTubos.length > 0 ? `incluye ${cambioFinalTubos.reduce((a, t) => a + t.cantidad, 0)} cartucho(s)` : undefined}
          accent="text-emerald-400"
        />
        <Card
          title="Ingreso bancario"
          value={euros(totalIngresoConTubos)}
          hint={tubosQueSeVan.length > 0 ? `incluye ${tubosQueSeVan.reduce((a, t) => a + t.cantidad, 0)} cartucho(s)` : undefined}
          accent="text-sky-300"
        />
      </div>

      {!cuadra && (
        <Aviso tono="mal">
          El cambio final más el ingreso no suman el efectivo contado. Revisa la composición.
        </Aviso>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <DenominationGrid
          titulo="Cambio final (se queda en caja)"
          denominaciones={denominaciones}
          cantidades={cambioFinal}
          onChange={setCambioFinal}
          disponible={Object.fromEntries((jornada.stockSueltas ?? []).map((l) => [l.valor, l.cantidad]))}
          mostrarDisponible
          objetivoCentimos={objetivo > 0 ? objetivo : null}
          deshabilitado={guardando}
        />

        <div className="space-y-3">
        {tubosContados.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-800">
            <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Cartuchos precintados
            </div>
            <div className="divide-y divide-slate-700/60">
              {tubosContados.map((t) => {
                const d = denominaciones.find((x) => x.valor === t.valor);
                const sequedan = cambioFinalTubos.find((x) => x.valor === t.valor)?.cantidad ?? 0;
                return (
                  <div key={t.valor} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="w-14 font-bold tabular-nums text-slate-200">{d?.etiqueta}</span>
                    <span className="text-slate-400">{t.cantidad} contados</span>
                    <div className="ml-auto flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">se quedan</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Cartuchos de ${d?.etiqueta} que se quedan en caja`}
                        value={sequedan === 0 ? "" : String(sequedan)}
                        placeholder="0"
                        onChange={(e) => {
                          const n = Math.min(t.cantidad, Number(e.target.value.replace(/\D/g, "") || 0));
                          setCambioFinalTubos((prev) => [
                            ...prev.filter((x) => x.valor !== t.valor),
                            ...(n > 0 ? [{ valor: t.valor, cantidad: n }] : []),
                          ]);
                        }}
                        className="h-9 w-14 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm font-bold tabular-nums text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="px-3 py-2 text-[11px] text-slate-500">
              Un tubo entero se queda o se va: no se parte. Los que se quedan siguen precintados
              mañana.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-slate-700 bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Preparación del ingreso bancario
            </span>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </button>
          </div>
          <div className="divide-y divide-slate-700/60">
            {ingreso.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-500">
                Todo el efectivo se queda en caja: no hay ingreso bancario.
              </p>
            )}
            {ingreso.map((l) => {
              const d = denominaciones.find((x) => x.valor === l.valor);
              return (
                <div key={l.valor} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-16 text-sm font-bold tabular-nums text-slate-200">
                    {d?.etiqueta ?? euros(l.valor)}
                  </span>
                  <span className="text-lg font-black tabular-nums text-slate-100">×{l.cantidad}</span>
                  <span className="ml-auto text-sm tabular-nums text-slate-400">
                    {euros(l.valor * l.cantidad)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-baseline justify-between border-t border-slate-700 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Total a ingresar</span>
            <span className="text-xl font-black tabular-nums text-sky-300">
              {euros(totalIngresoConTubos)}
            </span>
          </div>
        </div>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Notas del cierre</span>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className={inputCls} placeholder="Opcional" />
      </label>

      <BotonAccion tono="cierre" onClick={() => void cerrar()} disabled={guardando || !cuadra}>
        {guardando ? "Cerrando…" : "Cerrar jornada"}
      </BotonAccion>
    </div>
  );
}

function Cerrada({ r }: { r: Awaited<ReturnType<typeof api.cerrarJornada>> }) {
  return (
    <div className="space-y-3">
      <Cabecera titulo="Jornada cerrada" descripcion="El cambio final aparecerá mañana como fondo inicial." />

      <Aviso tono={r.diferenciaCentimos === 0 ? "bien" : "aviso"}>
        {r.diferenciaCentimos === 0
          ? "La caja cuadró exactamente."
          : `Se cerró con una diferencia de ${euros(r.diferenciaCentimos)}, asentada como ajuste auditado.`}
        {!r.denominacionesCuadran && " Las denominaciones no coincidían con el teórico."}
      </Aviso>

      <div className="grid gap-2 sm:grid-cols-2">
        <Card title="Cambio que queda en caja" value={euros(r.totalCambioCentimos)} accent="text-emerald-400" />
        <Card title="Ingreso bancario" value={euros(r.totalIngresoCentimos)} accent="text-sky-300" />
      </div>
    </div>
  );
}
