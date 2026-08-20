/**
 * Cierre: repartir el efectivo contado entre lo que se queda como cambio para
 * mañana y lo que va al banco.
 *
 * El ingreso bancario no se teclea: se calcula restando. Es lo que garantiza
 * que el mismo billete no acabe asignado a los dos sitios, y que la relación
 * arqueo = cambio final + ingreso se cumpla también en piezas y no solo en
 * importe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import {
  Aviso,
  BotonAccion,
  BotonInforme,
  Cabecera,
  Card,
  ErrorBox,
  inputCls,
} from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import type { LineaDenominacion } from "../types";
import { AvisoPendientes } from "./CambioBanco";
import { repartirIngreso, valorEnvasado } from "../utils/cierre";
import * as api from "../services/api";

export default function Cierre() {
  const { jornada, denominaciones, cajas, refrescar } = useCash();

  /*
   * El fondo fijo de esta caja: lo que el cajón tiene que tener SIEMPRE al
   * empezar el día. Es una decisión de la caja, no del cierre de hoy, así que
   * viene configurado y no se teclea cada tarde. Sigue siendo editable, porque
   * un día puede hacer falta dejar más o menos, pero eso es la excepción.
   */
  const fondoFijo = cajas.find((c) => c.id === jornada?.sesion.registerId)?.fondoObjetivoCentimos ?? 0;

  const [objetivoTexto, setObjetivoTexto] = useState(
    fondoFijo > 0 ? euros(fondoFijo).replace(" €", "") : "300,00"
  );
  /*
   * Lo que se teclea es lo que SE RETIRA para el banco, y el cambio que se
   * queda sale de restarlo a lo contado.
   *
   * Es el orden del mostrador —primero se aparta lo que va al banco, y lo que
   * queda en el cajón es el cambio— y además hace imposible el descuadre: los
   * dos lados no son dos cuentas que haya que hacer coincidir, sino una resta.
   */
  const [retirado, setRetirado] = useState<CantidadesPorValor>({});
  const [retiradoTubos, setRetiradoTubos] = useState<LineaDenominacion[]>([]);
  const [retiradoBolsas, setRetiradoBolsas] = useState<LineaDenominacion[]>([]);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cerrada, setCerrada] = useState<Awaited<ReturnType<typeof api.cerrarJornada>> | null>(null);

  const objetivo = aCentimos(objetivoTexto) ?? 0;

  /*
   * Con el fondo fijo configurado, la composición se propone SOLA al entrar.
   * Antes había que teclear el importe y pulsar «Proponer»; quien no lo hacía
   * veía «se queda 0 €, al banco 429,69 €», que es exactamente lo contrario de
   * lo que quiere hacer. La ref evita repetirlo si el usuario retoca a mano.
   */
  const yaPropuesto = useRef(false);

  const pedirPropuesta = useCallback(async () => {
    if (!jornada || objetivo <= 0) return;
    setError("");
    try {
      const r = await api.proponerCierre(jornada.sesion.id, objetivo);
      // De la propuesta se toma el lado del BANCO, que es el que se teclea. El
      // cambio que se queda se deriva restando, así que no hace falta fijarlo.
      setRetirado(cantidadesDesde(r.ingresoBancario));
      setRetiradoTubos(r.ingresoBancarioCartuchos ?? []);
      setRetiradoBolsas(r.ingresoBancarioBolsas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido preparar el cierre");
    }
  }, [jornada, objetivo]);

  /*
   * Propuesta automática al entrar, una sola vez y solo con el fondo fijo
   * configurado: si la caja no tiene fondo fijo no hay nada que suponer, y se
   * sigue preguntando como siempre.
   */
  useEffect(() => {
    if (yaPropuesto.current || fondoFijo <= 0 || !jornada) return;
    yaPropuesto.current = true;
    void pedirPropuesta();
  }, [fondoFijo, jornada, pedirPropuesta]);

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
  /**
   * Lo contado menos lo retirado, por denominación. Nunca negativo: la rejilla
   * ya acota cada casilla a lo que hay contado.
   */
  const restar = (
    contadas: readonly LineaDenominacion[],
    retiradas: CantidadesPorValor
  ): CantidadesPorValor => {
    const queda: CantidadesPorValor = {};
    for (const l of contadas) {
      const n = l.cantidad - (retiradas[l.valor] ?? 0);
      if (n > 0) queda[l.valor] = n;
    }
    return queda;
  };

  /*
   * El cambio que se queda NO se teclea: es lo contado menos lo retirado. Por
   * construcción los dos lados suman siempre el efectivo contado, así que el
   * cierre no puede quedarse a medias por un descuadre de composición.
   */
  const cambioFinal = restar(sueltasContadas, retirado);
  const cambioFinalTubos = lineasDesde(restar(tubosContados, cantidadesDesde(retiradoTubos)));
  const cambioFinalBolsas = lineasDesde(restar(bolsasContadas, cantidadesDesde(retiradoBolsas)));

  const ingreso = repartirIngreso({
    sueltasContadas,
    tubosContados,
    bolsasContadas,
    cambioFinalSueltas: cambioFinal,
    cambioFinalTubos,
    cambioFinalBolsas,
    denominaciones,
  });

  const totalCambio = totalLineas(lineasDesde(cambioFinal));

  /**
   * Lo que hay que sacar del cajón: lo contado menos el fondo fijo.
   *
   * Es el efectivo que ha entrado hoy —los cobros menos los pagos— y es el
   * número por el que se entra a esta pantalla. Nunca negativo: si el cajón no
   * llega al fondo fijo no hay nada que retirar, hay que reponer, y eso lo
   * dice el aviso de abajo.
   */
  const aRetirar = Math.max(0, contadoTotal - (fondoFijo > 0 ? fondoFijo : objetivo));

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
    setRetirado({});
    setRetiradoTubos([]);
    setRetiradoBolsas([]);
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

      {/*
        El cajón por debajo de su fondo fijo. No es un error —se puede cerrar
        igual— pero mañana se abre corto de cambio, y eso hay que decirlo hoy,
        que es cuando se puede ir al banco.
      */}
      {fondoFijo > 0 && contadoTotal < fondoFijo && (
        <Aviso tono="aviso">
          En el cajón hay {euros(contadoTotal)} y su fondo fijo es de {euros(fondoFijo)}: faltan{" "}
          <strong>{euros(fondoFijo - contadoTotal)}</strong>. No hay nada que ingresar; mañana la
          caja abre corta de cambio salvo que se reponga.
        </Aviso>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Fondo fijo de la caja
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
          Recalcular
        </button>
        <button
          onClick={quedarseloTodo}
          title="Copia el arqueo entero en el cambio final: no va nada al banco"
          className="h-[38px] rounded-lg bg-slate-700 px-3 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          Dejarlo todo en caja ({euros(contadoTotal)})
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
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
        {/*
          Lo que hay que sacar del cajón, dicho como número propio. Sale de la
          resta —contado menos fondo fijo— y no de lo que uno haya compuesto,
          así que se ve desde el primer momento, antes de tocar nada.
        */}
        <Card
          title="Efectivo a retirar"
          value={euros(aRetirar)}
          hint={
            fondoFijo > 0
              ? `${euros(contadoTotal)} contados − ${euros(fondoFijo)} de fondo fijo`
              : "Esta caja no tiene fondo fijo configurado"
          }
          accent="text-amber-300"
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

      {/*
        Red de seguridad, no un estado normal: desde que el paso 2 es una resta
        del paso 1, los dos lados suman siempre lo contado. Se deja porque es la
        invariante de la que depende que el cierre sea correcto, y si un cambio
        futuro la rompiera hay que verlo aquí y no en el arqueo de mañana.
      */}
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
            ? `En el paso 2 quedan ${euros(-desvioObjetivo)} menos que el fondo fijo (${euros(objetivo)}): estás retirando de más.`
            : `En el paso 2 quedan ${euros(desvioObjetivo)} más que el fondo fijo (${euros(objetivo)}): estás retirando de menos.`}{" "}
          {(tubosContados.length > 0 || bolsasContadas.length > 0) &&
            "Si el hueco es de un envase entero, ajústalo en las columnas «cart.» o «bols.» del paso 1. "}
          Puedes cerrar así igualmente: lo que retires es lo que va al banco.
        </Aviso>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {/*
            Paso 1: lo que se aparta para el banco. Es lo que se teclea, porque
            es lo que se hace primero con las manos: separar del cajón lo que se
            lleva uno. El paso 2 sale de restarlo, así que no hay dos cuentas
            que puedan discrepar.
          */}
          <DenominationGrid
            titulo="Paso 1 · Efectivo que se retira para el banco"
            denominaciones={denominaciones}
            cantidades={retirado}
            onChange={setRetirado}
            disponible={Object.fromEntries(sueltasContadas.map((l) => [l.valor, l.cantidad]))}
            mostrarDisponible
            cartuchos={cantidadesDesde(retiradoTubos)}
            onCartuchosChange={(c) => setRetiradoTubos(lineasDesde(c))}
            bolsas={cantidadesDesde(retiradoBolsas)}
            onBolsasChange={(c) => setRetiradoBolsas(lineasDesde(c))}
            disponibleCartuchos={Object.fromEntries(tubosContados.map((l) => [l.valor, l.cantidad]))}
            disponibleBolsas={Object.fromEntries(bolsasContadas.map((l) => [l.valor, l.cantidad]))}
            objetivoCentimos={aRetirar > 0 ? aRetirar : null}
            deshabilitado={guardando}
          />

          {/*
            Paso 2: lo que queda en el cajón. No se teclea —es una resta— y por
            eso va apagado: si se pudiera tocar, volverían a ser dos cuentas que
            hay que hacer coincidir a mano, que es justo lo que descuadraba.
          */}
          <DenominationGrid
            titulo="Paso 2 · Cambio que se queda en caja"
            denominaciones={denominaciones}
            cantidades={cambioFinal}
            onChange={() => {}}
            cartuchos={cantidadesDesde(cambioFinalTubos)}
            bolsas={cantidadesDesde(cambioFinalBolsas)}
            objetivoCentimos={objetivo > 0 ? objetivo : null}
            deshabilitado
          />

          <p className="text-[11px] text-slate-500">
            El paso 2 no se teclea: es lo contado menos lo que retiras. Los dos suman siempre el
            efectivo del arqueo, así que el cierre no puede quedarse a medias por un descuadre de
            composición — si el paso 2 no da el fondo fijo, corrige el paso 1.
          </p>
        </div>

        <div className="space-y-3">

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
      <BotonInforme
        ruta={`/sessions/${r.sesion.id}/report.pdf`}
        nombre={`cierre-${(r.sesion.fecha ?? "").slice(0, 10)}`}
        className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50"
      >
        Informe de cierre con los justificantes
      </BotonInforme>
    </div>
  );
}
