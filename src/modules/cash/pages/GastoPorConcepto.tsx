/**
 * En qué se va el dinero.
 *
 * Gasto por concepto y por periodo, desglose por destino, comparación contra el
 * tramo anterior, y por centro o consolidado de toda la empresa. Es de solo
 * lectura: desde aquí no se toca ni una operación.
 *
 * ## Tres cosas que la pantalla dice en voz alta, porque callarlas engaña
 *
 * **Lo sin clasificar se enseña.** Clasificar no es obligatorio —fue la
 * decisión, para no parar el mostrador el día que falte una entrada del
 * catálogo—, así que hay pagos sin concepto y siempre los habrá. Esconderlos
 * dejaría «4.200 € en dietas» conviviendo con un total del cierre que no cuadra
 * y nadie sabiendo por qué. Sale como una línea más y, si pesa, con un aviso
 * encima: un hueco que se ve se rellena, uno escondido crece.
 *
 * **El periodo se corta por la fecha de la JORNADA**, no por la hora del pago.
 * Un pago hecho a las 00:40 con la caja de ayer todavía abierta pertenece a la
 * jornada de ayer: es la que lo cerró y la que lo cuadró. Se dice al pie porque
 * en fin de mes alguien compara esto con el arqueo.
 *
 * **La comparación es contra un tramo de la MISMA longitud** y se enseñan sus
 * fechas. Comparar septiembre con agosto tiene truco —30 días contra 31— y
 * «hemos gastado más» acabaría siendo solo que el mes es más largo.
 *
 * ## Sin librería de gráficos
 *
 * La serie son barras de CSS. Un `<div>` con un ancho porcentual dice lo mismo
 * que 300 kB de librería para lo único que se pregunta aquí: qué mes se
 * disparó.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import { Aviso, Cabecera, EmptyRow, ErrorBox, TableWrap, thCls, tdCls, inputCls, btnPrimary } from "../components/ui";
import { euros, eurosConSigno } from "../utils/money";
/* El mes en curso es lo que se quiere ver al entrar nueve de cada diez veces. */
import { mesEnCurso } from "../utils/periodo";
import type { ConceptoGasto, GranularidadGasto, InformeGasto } from "../types";
import * as api from "../services/api";

const ETIQUETA_GRANULARIDAD: Record<GranularidadGasto, string> = {
  dia: "Por día",
  mes: "Por mes",
  anio: "Por año",
};

export default function GastoPorConcepto() {
  const { cajas } = useCash();
  const inicial = useMemo(mesEnCurso, []);

  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [granularidad, setGranularidad] = useState<GranularidadGasto>("mes");
  const [centro, setCentro] = useState("");
  /** `null` = todos los conceptos. Con uno, se entra en el detalle. */
  const [conceptoId, setConceptoId] = useState<number | null>(null);

  const [informe, setInforme] = useState<InformeGasto | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoGasto[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  /*
   * Los centros salen de las cajas y no de una llamada aparte: una caja vive en
   * un taller, así que la lista de talleres con caja ya está en el arranque. Las
   * cajas sin taller asignado no pueden filtrarse por centro y se quedan fuera
   * del desplegable — entran igualmente en el consolidado.
   */
  const centros = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const c of cajas) if (c.centroId) vistos.set(c.centroId, c.centro || c.nombre);
    return [...vistos].map(([id, nombre]) => ({ id, nombre }));
  }, [cajas]);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.estadisticasDeGasto({
        desde,
        hasta,
        granularidad,
        centro: centro || null,
        conceptoId,
        comparar: true,
      });
      setInforme(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error consultando el gasto");
      setInforme(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, granularidad, centro, conceptoId]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  useEffect(() => {
    void api
      .conceptosDeGasto()
      .then((r) => setConceptos(r.conceptos))
      .catch(() => {
        /* El catálogo solo pone nombre al filtro; sin él el informe se ve igual. */
      });
  }, []);

  const enDetalle = conceptoId != null;
  const nombreConcepto = conceptos.find((c) => c.id === conceptoId)?.nombre ?? "";

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Gasto por concepto"
        descripcion="En qué se va el dinero de la caja, y a quién se le imputa."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Agrupar</span>
          <select
            value={granularidad}
            onChange={(e) => setGranularidad(e.target.value as GranularidadGasto)}
            className={inputCls}
          >
            {(Object.keys(ETIQUETA_GRANULARIDAD) as GranularidadGasto[]).map((g) => (
              <option key={g} value={g}>
                {ETIQUETA_GRANULARIDAD[g]}
              </option>
            ))}
          </select>
        </label>
        {centros.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Centro</span>
            <select value={centro} onChange={(e) => setCentro(e.target.value)} className={inputCls}>
              {/* Lo primero es el consolidado: es la vista de quien manda. */}
              <option value="">Toda la empresa</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className={btnPrimary} disabled={cargando} onClick={() => void buscar()}>
          <Search className="mr-1 inline h-4 w-4" /> {cargando ? "Consultando…" : "Consultar"}
        </button>
      </div>

      {enDetalle && (
        <button
          className="inline-flex items-center gap-1 text-[12px] text-sky-400 hover:text-sky-300"
          onClick={() => setConceptoId(null)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a todos los conceptos
        </button>
      )}

      {informe && (
        <>
          <Totales informe={informe} etiqueta={enDetalle ? nombreConcepto : "Gasto del periodo"} />

          {/*
           * El aviso salta cuando lo sin clasificar pesa de verdad. Por debajo
           * de eso la línea de la tabla ya lo dice; un aviso permanente por dos
           * pagos sueltos se convierte en parte del decorado y deja de leerse.
           */}
          {!enDetalle && informe.sinClasificarCentimos > 0 && informe.totalCentimos > 0 &&
            informe.sinClasificarCentimos / informe.totalCentimos >= 0.15 && (
              <Aviso tono="aviso">
                {euros(informe.sinClasificarCentimos)} del periodo —
                {" "}
                {Math.round((informe.sinClasificarCentimos / informe.totalCentimos) * 100)} %— están sin
                clasificar. Mientras sea así, el reparto por concepto de abajo no cuenta todo el gasto.
              </Aviso>
            )}

          {/*
           * Sin ningún pago, las tres secciones dirían lo mismo tres veces —la
           * serie, los conceptos y los destinos— y la pantalla parecería rota.
           * Se dice una vez y se sugiere lo único que arregla el caso normal:
           * que el periodo esté mal elegido.
           */}
          {informe.operaciones === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-center text-[13px] text-slate-400">
              No hay ningún pago entre el {informe.desde} y el {informe.hasta}
              {informe.centroId ? " en este centro" : ""}. Prueba con otras fechas.
            </div>
          ) : (
            <>
              <Serie informe={informe} />

              {!enDetalle && (
                <Conceptos informe={informe} onElegir={(id) => id != null && setConceptoId(id)} />
              )}

              <Destinos informe={informe} enDetalle={enDetalle} concepto={nombreConcepto} />
            </>
          )}
        </>
      )}

      <p className="pt-1 text-[11px] text-slate-500">
        El periodo se corta por la <strong className="text-slate-400">fecha de la jornada</strong>, no por la
        hora del pago: un pago hecho de madrugada con la caja del día anterior abierta cuenta en esa jornada,
        que es la que lo cuadró. Así el arqueo y estas cifras dicen lo mismo.
      </p>
    </div>
  );
}

// ── Los números de arriba ──────────────────────────────────────────────────

function Totales({ informe, etiqueta }: { informe: InformeGasto; etiqueta: string }) {
  const c = informe.comparacion;
  /*
   * Que suba el gasto no es una buena noticia, así que el verde es para el
   * ahorro. Gastar exactamente lo mismo no es ninguna de las dos cosas: pintar
   * un 0,00 € de verde sería felicitarse por nada.
   */
  const color =
    !c || c.diferenciaCentimos === 0
      ? "text-slate-300"
      : c.diferenciaCentimos > 0
        ? "text-rose-300"
        : "text-emerald-300";

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</div>
        <div className="text-2xl font-black tabular-nums text-slate-100">{euros(informe.totalCentimos)}</div>
        <div className="text-[11px] text-slate-500">{informe.operaciones} pago(s)</div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Frente al tramo anterior
        </div>
        {c ? (
          <>
            <div className={`text-2xl font-black tabular-nums ${color}`}>
              {eurosConSigno(c.diferenciaCentimos)}
            </div>
            <div className="text-[11px] text-slate-500">
              {/*
               * Se enseñan las fechas contra las que se compara. Sin ellas, un
               * «+1.200 €» no se puede comprobar ni discutir.
               */}
              {c.variacion == null
                ? "antes no hubo gasto"
                : `${c.variacion > 0 ? "+" : ""}${(c.variacion * 100).toFixed(1)} %`}{" "}
              · {c.desde} a {c.hasta} ({euros(c.totalCentimos)})
            </div>
          </>
        ) : (
          <div className="pt-1 text-[12px] text-slate-500">Sin comparación.</div>
        )}
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sin clasificar</div>
        <div className="text-2xl font-black tabular-nums text-slate-300">
          {euros(informe.sinClasificarCentimos)}
        </div>
        <div className="text-[11px] text-slate-500">
          {informe.totalCentimos > 0
            ? `${Math.round((informe.sinClasificarCentimos / informe.totalCentimos) * 100)} % del total`
            : "—"}
        </div>
      </div>
    </div>
  );
}

// ── La serie, en barras ────────────────────────────────────────────────────

function Serie({ informe }: { informe: InformeGasto }) {
  /* El máximo es la referencia de la barra llena; sin gasto no hay nada que escalar. */
  const maximo = Math.max(...informe.serie.map((p) => p.importeCentimos), 1);

  return (
    <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {ETIQUETA_GRANULARIDAD[informe.granularidad]}
      </div>
      {informe.serie.map((p) => (
        <div key={p.periodo} className="flex items-center gap-2">
          <span className="w-20 shrink-0 font-mono text-[11px] text-slate-400">{p.periodo}</span>
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

// ── El reparto por concepto ────────────────────────────────────────────────

function Conceptos({
  informe,
  onElegir,
}: {
  informe: InformeGasto;
  onElegir: (id: number | null) => void;
}) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Concepto</th>
          <th className={`${thCls} text-right`}>Importe</th>
          <th className={`${thCls} text-right`}>% del total</th>
          <th className={`${thCls} text-right`}>Pagos</th>
        </tr>
      </thead>
      <tbody>
        {informe.conceptos.length === 0 && (
          <EmptyRow cols={4} text="Ningún pago en este periodo." />
        )}
        {informe.conceptos.map((c) => {
          const sinClasificar = c.conceptoId == null;
          return (
            <tr
              key={c.conceptoId ?? "sin"}
              /* Sin clasificar no se puede abrir: no hay destino que desglosar. */
              className={sinClasificar ? "text-slate-500" : "cursor-pointer hover:bg-slate-800/60"}
              onClick={() => !sinClasificar && onElegir(c.conceptoId)}
              title={sinClasificar ? "Pagos que se registraron sin concepto" : "Ver el desglose por destino"}
            >
              <td className={tdCls}>
                <span className={sinClasificar ? "italic" : "font-medium text-slate-100"}>{c.nombre}</span>
                {c.codigo && <div className="font-mono text-[10px] text-slate-500">{c.codigo}</div>}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(c.importeCentimos)}</td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                {informe.totalCentimos > 0
                  ? `${((c.importeCentimos / informe.totalCentimos) * 100).toFixed(1)} %`
                  : "—"}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{c.operaciones}</td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

// ── El desglose por destino ────────────────────────────────────────────────

function Destinos({
  informe,
  enDetalle,
  concepto,
}: {
  informe: InformeGasto;
  enDetalle: boolean;
  concepto: string;
}) {
  const suma = informe.destinos.reduce((a, d) => a + d.importeCentimos, 0);

  return (
    <div className="space-y-1">
      <h2 className="pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {enDetalle ? `${concepto}: a quién se ha imputado` : "A quién se ha imputado"}
      </h2>
      {!enDetalle && (
        <p className="text-[12px] text-slate-500">
          {/*
           * Se avisa de que esta lista NO suma el total: sin concepto elegido el
           * servidor deja fuera lo que no tiene destino. Sin la nota, restar los
           * dos números de la pantalla lleva a pensar que falta dinero.
           */}
          Solo los pagos que llevan destino, mezclando conceptos. Para el desglose que se puede leer —«dietas
          por operario»— entra en un concepto de la tabla de arriba.
        </p>
      )}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Destino</th>
            <th className={`${thCls} text-right`}>Importe</th>
            <th className={`${thCls} text-right`}>%</th>
            <th className={`${thCls} text-right`}>Pagos</th>
          </tr>
        </thead>
        <tbody>
          {informe.destinos.length === 0 && (
            <EmptyRow
              cols={4}
              text={
                enDetalle
                  ? "Ninguno de estos pagos se imputó a nadie."
                  : "Ningún pago del periodo lleva destino."
              }
            />
          )}
          {informe.destinos.map((d) => (
            <tr key={d.destinoId ?? "sin"}>
              <td className={tdCls}>
                <span className={d.destinoId == null ? "italic text-slate-500" : "text-slate-100"}>
                  {d.nombre}
                </span>
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(d.importeCentimos)}</td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                {suma > 0 ? `${((d.importeCentimos / suma) * 100).toFixed(1)} %` : "—"}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{d.operaciones}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
