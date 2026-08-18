/**
 * Cierre: repartir el efectivo contado entre lo que se queda como cambio para
 * mañana y lo que va al banco.
 *
 * El ingreso bancario no se teclea: se calcula restando. Es lo que garantiza
 * que el mismo billete no acabe asignado a los dos sitios, y que la relación
 * arqueo = cambio final + ingreso se cumpla también en piezas y no solo en
 * importe.
 */

import { useCallback, useState } from "react";
import { FileDown, Minus, Plus, Printer } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import { Aviso, BotonAccion, Cabecera, Card, ErrorBox, inputCls } from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import type { Denominacion, LineaDenominacion } from "../types";
import { AvisoPendientes } from "./CambioBanco";
import { repartirIngreso, valorEnvasado } from "../utils/cierre";
import * as api from "../services/api";

export default function Cierre() {
  const { jornada, denominaciones, refrescar } = useCash();

  const [objetivoTexto, setObjetivoTexto] = useState("300,00");
  const [cambioFinal, setCambioFinal] = useState<CantidadesPorValor>({});
  const [cambioFinalTubos, setCambioFinalTubos] = useState<LineaDenominacion[]>([]);
  const [cambioFinalBolsas, setCambioFinalBolsas] = useState<LineaDenominacion[]>([]);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cerrada, setCerrada] = useState<Awaited<ReturnType<typeof api.cerrarJornada>> | null>(null);

  const objetivo = aCentimos(objetivoTexto) ?? 0;
  const totalCambio = totalLineas(lineasDesde(cambioFinal));

  /**
   * Fija cuántos envases de una denominación se quedan en caja.
   *
   * Un solo sitio donde se tocan las listas de precintos: las tocaban los
   * botones y la cajita por separado, y el tope —no puedes quedarte más
   * envases de los que has contado— tenía que repetirse en cada uno.
   */
  function fijarEnvases(
    fijar: React.Dispatch<React.SetStateAction<LineaDenominacion[]>>,
    valor: number,
    cantidad: number,
    contados: number
  ) {
    const n = Math.max(0, Math.min(contados, cantidad));
    fijar((prev) => [
      ...prev.filter((x) => x.valor !== valor),
      ...(n > 0 ? [{ valor, cantidad: n }] : []),
    ]);
  }

  const pedirPropuesta = useCallback(async () => {
    if (!jornada || objetivo <= 0) return;
    setError("");
    try {
      const r = await api.proponerCierre(jornada.sesion.id, objetivo);
      // El ingreso no se guarda: se deriva de lo contado menos lo que se
      // queda, así que basta con fijar el cambio final.
      setCambioFinal(cantidadesDesde(r.cambioFinal));
      setCambioFinalTubos(r.cambioFinalCartuchos ?? []);
      setCambioFinalBolsas(r.cambioFinalBolsas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido preparar el cierre");
    }
  }, [jornada, objetivo]);

  if (!jornada) return <Aviso tono="aviso">No hay ninguna jornada abierta.</Aviso>;

  if (cerrada) return <Cerrada r={cerrada} />;

  /*
   * Lo que se reparte es EL ARQUEO, no el stock teórico.
   *
   * Antes esto era `jornada.totalStockCentimos`, que es el teórico. Mientras la
   * caja cuadraba nadie lo notaba, porque son el mismo número. Con un descuadre
   * la pantalla pedía repartir un dinero que físicamente no estaba —381,62 €
   * cuando en el cajón había 376,00 €— y como el reparto no podía cuadrar
   * nunca, el botón de cerrar no se activaba y la jornada no había forma de
   * cerrarla.
   *
   * El servidor ya lo hacía bien: su propuesta sale del último arqueo. Era la
   * pantalla la que iba por otro sitio.
   */
  const arqueo = jornada.ultimoArqueo;
  const contadoTotal = arqueo?.totalCentimos ?? jornada.totalStockCentimos;
  const sueltasContadas = arqueo?.sueltas ?? jornada.stockSueltas ?? [];
  const tubosContados = arqueo?.cartuchos ?? jornada.stockCartuchos ?? [];
  const bolsasContadas = arqueo?.bolsas ?? jornada.stockBolsas ?? [];
  /** Diferencia del arqueo: se asienta sola como ajuste auditado al cerrar. */
  const descuadre = arqueo?.diferenciaCentimos ?? 0;

  /*
   * El ingreso es siempre "lo contado menos lo que se queda", nunca un número
   * que el operador teclea, y se recalcula en cuanto cambia el cambio final.
   *
   * Un solo reparto para lo que se enseña y para lo que se suma. Antes eran dos
   * cuentas distintas y se separaron: el total contaba los cartuchos y la lista
   * no los pintaba, así que la hoja del ingreso se dejaba 75 € por el camino.
   *
   * Las tres dimensiones van aparte: los envases precintados no se desglosan
   * en la rejilla porque un cartucho o una bolsa entera se queda o se va, no se
   * parte —y si se partiera dejaría de ser un precinto.
   */
  const ingreso = repartirIngreso({
    sueltasContadas,
    tubosContados,
    bolsasContadas,
    cambioFinalSueltas: cambioFinal,
    cambioFinalTubos,
    cambioFinalBolsas,
    denominaciones,
  });

  const valorTubosCambio =
    valorEnvasado(cambioFinalTubos, denominaciones, "cartucho") +
    valorEnvasado(cambioFinalBolsas, denominaciones, "bolsa");
  const totalCambioConTubos = totalCambio + valorTubosCambio;
  /** Lo que falta (o sobra) para el cambio pedido, contando ya los cartuchos. */
  const desvioObjetivo = objetivo > 0 ? totalCambioConTubos - objetivo : 0;
  const totalIngresoConTubos = ingreso.totalCentimos;
  const cuadra = totalCambioConTubos + totalIngresoConTubos === contadoTotal;

  /**
   * Vuelca el arqueo entero en el cambio final: todo se queda en caja.
   *
   * Es el cierre de un día que no va al banco, que en un mostrador son la
   * mayoría. Sin esto había que teclear denominación por denominación lo mismo
   * que se acababa de contar en el arqueo —cientos de piezas— y cualquier
   * despiste dejaba el reparto sin cuadrar y el botón de cerrar apagado.
   *
   * El objetivo se pone también al total contado: pedir 350 € y quedárselo
   * todo se contradicen, y dejarlo como estaba marcaría un "sobran 26 €" que
   * no significa nada.
   */
  function quedarseloTodo() {
    setCambioFinal(cantidadesDesde(sueltasContadas));
    setCambioFinalTubos(tubosContados);
    setCambioFinalBolsas(bolsasContadas);
    setObjetivoTexto(euros(contadoTotal).replace(" €", ""));
  }

  async function cerrar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.cerrarJornada(jornada!.sesion.id, {
        cambioFinal: lineasDesde(cambioFinal),
        cambioFinalCartuchos: cambioFinalTubos,
        cambioFinalBolsas,
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

      {/* Se puede cerrar con dinero fuera —el banco no contesta el mismo día y
          el empleado vuelve mañana—, pero quien cierra tiene que verlo. */}
      <AvisoPendientes />

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
        <button
          onClick={quedarseloTodo}
          title="Copia el arqueo entero en el cambio final: no va nada al banco"
          className="h-[38px] rounded-lg bg-slate-700 px-3 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          Dejarlo todo en caja ({euros(contadoTotal)})
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card
          title="Contado en el arqueo"
          value={euros(contadoTotal)}
          hint={
            arqueo
              ? descuadre === 0
                ? "Cuadra con el teórico"
                : `${descuadre > 0 ? "Sobran" : "Faltan"} ${euros(Math.abs(descuadre))} sobre el teórico`
              : "Sin arqueo: se está usando el teórico"
          }
          accent={descuadre !== 0 ? "text-amber-300" : undefined}
        />
        <Card
          title="Se queda en caja"
          value={euros(totalCambioConTubos)}
          hint={pistaPrecintos(cambioFinalTubos, cambioFinalBolsas)}
          accent="text-emerald-400"
        />
        <Card
          title="Ingreso bancario"
          value={euros(totalIngresoConTubos)}
          hint={pistaPrecintos(ingreso.tubos, ingreso.bolsas)}
          accent="text-sky-300"
        />
      </div>

      {/*
        El descuadre, dicho antes de cerrar y con lo que va a pasar con él.
        Sin esto, quien cierra ve un total que no es el que calculó el sistema
        y no sabe si se ha equivocado él o la máquina.
      */}
      {descuadre !== 0 && (
        <Aviso tono="aviso">
          El arqueo salió con <strong>{euros(Math.abs(descuadre))}</strong> de{" "}
          {descuadre > 0 ? "sobrante" : "faltante"} sobre el teórico. Se reparte lo{" "}
          <strong>contado</strong>, que es el dinero que existe de verdad, y al cerrar se asienta
          solo un <strong>ajuste auditado</strong> con la diferencia, pieza a pieza. No tienes que
          hacer nada más: quedará como una operación propia en Movimientos.
        </Aviso>
      )}

      {!cuadra && (
        <Aviso tono="mal">
          El cambio final más el ingreso no suman el efectivo contado. Revisa la composición.
        </Aviso>
      )}

      {/*
        El desvío contra el objetivo, dicho en euros y contando los cartuchos.
        No es un error —se puede cerrar dejando lo que se quiera— pero si pides
        338,59 € y has compuesto 336,09 €, saberlo evita el cierre a medias.
      */}
      {cuadra && desvioObjetivo !== 0 && (
        <Aviso tono="aviso">
          {desvioObjetivo < 0
            ? `Faltan ${euros(-desvioObjetivo)} para el cambio que has pedido (${euros(objetivo)}).`
            : `Sobran ${euros(desvioObjetivo)} sobre el cambio que has pedido (${euros(objetivo)}).`}{" "}
          {(tubosContados.length > 0 || bolsasContadas.length > 0) &&
            "Si el hueco es de un envase entero, ajústalo en «Cartuchos precintados» o «Bolsas precintadas». "}
          Puedes cerrar así igualmente: el resto va al ingreso bancario.
        </Aviso>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <DenominationGrid
          titulo="Cambio final (se queda en caja)"
          denominaciones={denominaciones}
          cantidades={cambioFinal}
          onChange={setCambioFinal}
          disponible={Object.fromEntries(sueltasContadas.map((l) => [l.valor, l.cantidad]))}
          mostrarDisponible
          /*
           * El objetivo de la rejilla es el que queda DESPUÉS de los cartuchos:
           * la rejilla solo cuenta monedas sueltas, así que con un tubo de 2,50 €
           * apartado marcaba en ámbar «336,09 de 338,59» cuando el reparto era
           * exacto. Descontarlos la deja en verde cuando de verdad cuadra.
           */
          objetivoCentimos={objetivo > 0 ? objetivo - valorTubosCambio : null}
          deshabilitado={guardando}
        />

        <div className="space-y-3">
        <PanelEnvases
          titulo="Cartuchos precintados"
          nombre="cartucho"
          plural="cartuchos"
          contados={tubosContados}
          sequedan={cambioFinalTubos}
          piezasDe={(d) => d?.piezasPorCartucho ?? 0}
          denominaciones={denominaciones}
          onFijar={(valor, n, contados) => fijarEnvases(setCambioFinalTubos, valor, n, contados)}
          deshabilitado={guardando}
        />

        <PanelEnvases
          titulo="Bolsas precintadas"
          nombre="bolsa"
          plural="bolsas"
          contados={bolsasContadas}
          sequedan={cambioFinalBolsas}
          piezasDe={(d) => d?.piezasPorBolsa ?? 0}
          denominaciones={denominaciones}
          onFijar={(valor, n, contados) => fijarEnvases(setCambioFinalBolsas, valor, n, contados)}
          deshabilitado={guardando}
        />

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
            {ingreso.sueltas.length === 0 &&
              ingreso.tubos.length === 0 &&
              ingreso.bolsas.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-500">
                Todo el efectivo se queda en caja: no hay ingreso bancario.
              </p>
              )}
            {ingreso.sueltas.map((l) => {
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

            {/* Los envases que se van al banco, en su propia línea. Sin esto,
                el total contaba 75 € de cartuchos que no aparecían por ninguna
                parte y la hoja del ingreso no cuadraba con lo que se lleva. */}
            {[...ingreso.tubos, ...ingreso.bolsas].map((t) => {
              const d = denominaciones.find((x) => x.valor === t.valor);
              const nombre =
                t.tipo === "cartucho"
                  ? t.cantidad === 1
                    ? "cartucho"
                    : "cartuchos"
                  : t.cantidad === 1
                    ? "bolsa"
                    : "bolsas";
              return (
                <div key={`${t.tipo}-${t.valor}`} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-16 text-sm font-bold tabular-nums text-slate-200">
                    {d?.etiqueta ?? euros(t.valor)}
                  </span>
                  <span className="text-lg font-black tabular-nums text-slate-100">
                    ×{t.cantidad}
                  </span>
                  <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                    {nombre} de {t.piezasPorEnvase}
                  </span>
                  <span className="ml-auto text-sm tabular-nums text-slate-400">
                    {euros(t.importe)}
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

/** «incluye 2 cartuchos y 1 bolsa», o nada si no hay precintos. */
function pistaPrecintos(
  tubos: readonly { cantidad: number }[],
  bolsas: readonly { cantidad: number }[]
): string | undefined {
  const nT = tubos.reduce((a, t) => a + t.cantidad, 0);
  const nB = bolsas.reduce((a, t) => a + t.cantidad, 0);
  const partes = [
    nT > 0 ? `${nT} ${nT === 1 ? "cartucho" : "cartuchos"}` : null,
    nB > 0 ? `${nB} ${nB === 1 ? "bolsa" : "bolsas"}` : null,
  ].filter(Boolean);
  return partes.length > 0 ? `incluye ${partes.join(" y ")}` : undefined;
}

/**
 * Panel de envases precintados que se quedan en caja.
 *
 * Cartuchos y bolsas se reparten igual —el envase entero se queda o se va, no
 * se parte— así que comparten panel. Lo único que cambia entre los dos es de
 * dónde sale el número de piezas y cómo se llama la cosa en pantalla.
 */
function PanelEnvases({
  titulo,
  nombre,
  plural,
  contados,
  sequedan,
  piezasDe,
  denominaciones,
  onFijar,
  deshabilitado,
}: {
  titulo: string;
  nombre: string;
  plural: string;
  contados: readonly LineaDenominacion[];
  sequedan: readonly LineaDenominacion[];
  piezasDe: (d: Denominacion | undefined) => number;
  denominaciones: readonly Denominacion[];
  onFijar: (valor: number, cantidad: number, contados: number) => void;
  deshabilitado: boolean;
}) {
  if (contados.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {titulo}
      </div>
      <div className="divide-y divide-slate-700/60">
        {contados.map((t) => {
          const d = denominaciones.find((x) => x.valor === t.valor);
          const quedan = sequedan.find((x) => x.valor === t.valor)?.cantidad ?? 0;
          const valorEnvase = t.valor * piezasDe(d);
          return (
            <div key={t.valor} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-bold tabular-nums text-slate-200">{d?.etiqueta}</div>
                {/* Cuánto mueve cada envase: sin esto no se sabe qué cambia al pulsar. */}
                <div className="text-[10px] tabular-nums text-slate-500">
                  {t.cantidad} contado{t.cantidad === 1 ? "" : "s"} · {euros(valorEnvase)} cada uno
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <span className="mr-1 text-[11px] text-slate-500">se quedan</span>
                {/*
                  Mismos botones −/+ de 44 px que la rejilla de monedas. Antes
                  aquí solo había una cajita de texto: no parecía tocable, y
                  quedarse un cartucho —lo normal— no se veía posible.
                */}
                <button
                  type="button"
                  aria-label={`Quitar un ${nombre} de ${d?.etiqueta} del cambio final`}
                  onClick={() => onFijar(t.valor, quedan - 1, t.cantidad)}
                  disabled={deshabilitado || quedan === 0}
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-30"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`${titulo} de ${d?.etiqueta} que se quedan en caja`}
                  value={quedan === 0 ? "" : String(quedan)}
                  placeholder="0"
                  onChange={(e) =>
                    onFijar(t.valor, Number(e.target.value.replace(/\D/g, "") || 0), t.cantidad)
                  }
                  onFocus={(e) => e.target.select()}
                  disabled={deshabilitado}
                  className="h-11 w-12 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm font-bold tabular-nums text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  aria-label={`Añadir un ${nombre} de ${d?.etiqueta} al cambio final`}
                  onClick={() => onFijar(t.valor, quedan + 1, t.cantidad)}
                  disabled={deshabilitado || quedan >= t.cantidad}
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-3 py-2 text-[11px] text-slate-500">
        Un envase entero se queda o se va: no se parte. Los {plural} que se quedan siguen
        precintados mañana.
      </p>
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

      {/* El papeleo del día en un solo PDF: el cierre y los escaneos detrás. */}
      <a
        href={api.urlInformeCierre(r.sesion.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-500"
      >
        <FileDown className="h-4 w-4" /> Informe de cierre con los justificantes
      </a>
    </div>
  );
}
