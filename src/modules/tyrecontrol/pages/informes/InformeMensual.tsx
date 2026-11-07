import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";

import {
  CabeceraCorrida, CabeceraInforme, PieCorrido,
} from "../../components/informes/CabeceraInforme";
import { useInformesFiltros } from "./InformesLayout";
import { arcosDeQuesito } from "../../services/quesito";
import { useTyreAuth } from "../../contexts/TyreAuthContext";
import {
  evolucionMensual, informeMensual,
  type EvolucionInforme, type FilaFichaInforme, type InformeMensual as Datos,
  type MatrizInforme, type Porcion,
} from "../../services/informes";

/**
 * El informe mensual de flota, en papel.
 *
 * Es la réplica del informe del centro técnico (`docs/PLAN_informe_mensual_
 * plana.md`), con la marca de Mobilink y sin las 49 páginas de detalle
 * vehículo a vehículo, que es la versión corta que se pidió.
 *
 * ── Aquí no se suma NADA ────────────────────────────────────────────────────
 *
 * Todas las tablas vienen hechas del servidor, con sus totales y sus
 * porcentajes. Si esta pantalla recalculara un total, el día que cambie un
 * criterio —qué cuenta como revisada, dónde cae un 4,0 mm— la pantalla diría
 * una cosa y el papel otra. Lo único que hace este fichero es colocar.
 *
 * ── Dos peticiones, no una ──────────────────────────────────────────────────
 *
 * El informe llega enseguida; la evolución son doce meses de mediciones y
 * tarda. Van por separado para que las tablas se puedan leer mientras las
 * gráficas siguen cargando, en vez de una pantalla en blanco esperando a lo
 * más lento.
 *
 * ── Los avisos van ARRIBA y se imprimen ─────────────────────────────────────
 *
 * Dicen lo que el informe no puede saber: cuántos vehículos no tienen tipo,
 * de cuántas gomas no consta la condición, por qué las rayadas salen a cero.
 * Esconderlos en una nota al pie convertiría cada cero en una afirmación que
 * nadie puede comprobar, y este informe se le entrega a un cliente.
 */

const nf = (n: number) => n.toLocaleString("es-ES");
const pctTxt = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fecha = (iso?: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : String(iso);
};
const mm = (v: number | null) =>
  v == null ? "" : v.toLocaleString("es-ES", { maximumFractionDigits: 1 });

/** Los seis colores de las bandas, de rojo a verde, como el original. */
const COLOR_BANDA = ["#dc2626", "#f59e0b", "#fbbf24", "#a3b018", "#65a30d", "#166534"];

function Bloque({ titulo, children, nota }: {
  titulo: string; children: React.ReactNode; nota?: string;
}) {
  return (
    <section className="bloque-informe rounded-lg bg-slate-800 p-4 print:bg-white">
      <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-300 print:text-black">
        {titulo}
      </h2>
      {nota && <p className="mb-2 text-[11px] text-slate-400 print:text-slate-600">{nota}</p>}
      {children}
    </section>
  );
}

/** Una de las rejillas del servidor, pintada tal cual viene. */
function Rejilla({ m, etiquetaFila, colorear }: {
  m: MatrizInforme; etiquetaFila: string; colorear?: boolean;
}) {
  if (m.filas.length === 0) {
    return <p className="text-[12px] text-slate-400">Sin datos este mes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead>
          <tr className="border-b border-slate-600 text-left text-[10px] uppercase text-slate-400 print:text-slate-600">
            <th className="py-1 pr-2 font-bold">{etiquetaFila}</th>
            {m.columnas.map((c) => (
              <th key={c} className="px-1 py-1 text-right font-bold">{c.replace("Posicion ", "Pos. ")}</th>
            ))}
            <th className="px-1 py-1 text-right font-bold">Total</th>
            <th className="px-1 py-1 text-right font-bold">%</th>
          </tr>
        </thead>
        <tbody>
          {m.filas.map((f, i) => (
            <tr key={f.etiqueta} className="border-b border-slate-700/60 print:border-slate-300">
              <td className="py-1 pr-2 font-semibold text-slate-200 print:text-black">
                {colorear && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle imprimir-fondo"
                    style={{ backgroundColor: COLOR_BANDA[i] ?? "#64748b" }}
                  />
                )}
                {f.etiqueta}
              </td>
              {f.celdas.map((v, j) => (
                <td key={j} className="px-1 py-1 text-right text-slate-300 print:text-black">
                  {v === 0 ? "" : nf(v)}
                </td>
              ))}
              <td className="px-1 py-1 text-right font-bold text-slate-100 print:text-black">{nf(f.total)}</td>
              <td className="px-1 py-1 text-right text-slate-400 print:text-slate-700">{pctTxt(f.pct)}</td>
            </tr>
          ))}
          <tr className="text-[10px] font-bold uppercase text-slate-400 print:text-slate-700">
            <td className="py-1 pr-2">Total</td>
            {m.totalPorColumna.map((v, j) => (
              <td key={j} className="px-1 py-1 text-right">{v === 0 ? "" : nf(v)}</td>
            ))}
            <td className="px-1 py-1 text-right">{nf(m.total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * El quesito, en SVG escrito a mano.
 *
 * Sin librería de gráficas: el proyecto ya dibuja así sus informes y una
 * dependencia nueva para seis porciones no se paga sola. Las etiquetas van
 * fuera, en una lista, porque dentro de una porción del 0,12 % no cabe nada.
 */
function Quesito({ porciones, colores }: { porciones: Porcion[]; colores: string[] }) {
  const total = porciones.reduce((a, p) => a + p.valor, 0);
  if (total === 0) return <p className="text-[12px] text-slate-400">Sin datos este mes.</p>;

  // La geometría vive en `services/quesito.ts` con sus pruebas: el arco del
  // 100 % y el `large-arc-flag` fallan en silencio —el gráfico sale, solo que
  // miente— y eso no se comprueba mirando un JSX.
  const arcos = arcosDeQuesito(porciones.map((p) => ({ etiqueta: p.etiqueta, valor: p.valor })));

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img"
           aria-label="Reparto por bandas de profundidad">
        {arcos.map((a) => (
          <path key={a.indice} d={a.d} fill={colores[a.indice] ?? "#64748b"}
                stroke="#0f172a" strokeWidth="0.6" className="imprimir-fondo" />
        ))}
      </svg>
      <ul className="min-w-[180px] flex-1 text-[11px]">
        {porciones.map((p, i) => (
          <li key={p.etiqueta} className="flex items-center gap-2 border-b border-slate-700/40 py-0.5 print:border-slate-300">
            <span className="inline-block h-2.5 w-2.5 rounded-sm imprimir-fondo"
                  style={{ backgroundColor: colores[i] ?? "#64748b" }} />
            <span className="flex-1 text-slate-300 print:text-black">{p.etiqueta}</span>
            <span className="tabular-nums font-semibold text-slate-100 print:text-black">{nf(p.valor)}</span>
            <span className="w-16 text-right tabular-nums text-slate-400 print:text-slate-700">{pctTxt(p.pct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Las barras apiladas de la evolución.
 *
 * En PORCENTAJE y no en unidades, a propósito: los meses de esta flota van de
 * 14 ruedas a 2.157, y en unidades los pequeños serían rayas invisibles al
 * lado de los grandes. En porcentaje se comparan, que es para lo que está la
 * gráfica. Debajo va el número de ruedas de cada mes, que es lo que avisa de
 * cuándo un porcentaje se apoya en poco.
 */
function BarrasEvolucion({ meses }: { meses: EvolucionInforme["meses"] }) {
  if (meses.length === 0) return <p className="text-[12px] text-slate-400">Sin meses que enseñar.</p>;
  const ancho = Math.max(320, meses.length * 52);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${ancho} 210`} style={{ width: ancho, maxWidth: "100%" }} role="img"
           aria-label="Evolución mensual del desgaste">
        {meses.map((m, i) => {
          const x = 10 + i * ((ancho - 20) / meses.length);
          const w = (ancho - 20) / meses.length - 8;
          let y = 20;
          return (
            <g key={m.mes}>
              {m.pctPorBanda.map((p, b) => {
                const alto = (p / 100) * 140;
                const rect = (
                  <rect key={b} x={x} y={y} width={w} height={alto}
                        fill={COLOR_BANDA[b]} className="imprimir-fondo" />
                );
                y += alto;
                return rect;
              })}
              {/* El mes, abreviado: doce etiquetas enteras no caben. */}
              <text x={x + w / 2} y={174} textAnchor="middle" fontSize="8" fill="currentColor">
                {m.etiqueta.slice(0, 3)}
              </text>
              <text x={x + w / 2} y={184} textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.6">
                {m.etiqueta.slice(-2)}
              </text>
              {/* Las ruedas en que se apoya ese mes: un 50 % de 14 no es un 50 %. */}
              <text x={x + w / 2} y={197} textAnchor="middle" fontSize="7.5" fill="currentColor" opacity="0.85">
                {nf(m.ruedas)}
              </text>
            </g>
          );
        })}
        <text x={10} y={12} fontSize="8" fill="currentColor" opacity="0.6">
          % de ruedas en cada banda · debajo, ruedas revisadas del mes
        </text>
      </svg>
    </div>
  );
}

/** Una de las listas del patio: profundidades por posición y datos del bus. */
function ListaDePatio({ filas, posiciones }: {
  filas: FilaFichaInforme[]; posiciones: number[];
}) {
  if (filas.length === 0) {
    return <p className="text-[12px] text-slate-400 print:text-slate-600">Ningún vehículo en esta banda.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead>
          <tr className="border-b border-slate-600 text-left text-[10px] uppercase text-slate-400 print:text-slate-600">
            <th className="py-1 pr-2 font-bold">Nº bus</th>
            {posiciones.map((p) => <th key={p} className="px-1 py-1 text-right font-bold">{p}</th>)}
            <th className="px-2 py-1 text-right font-bold">Peor</th>
            <th className="px-2 py-1 font-bold">Última rev.</th>
            <th className="px-2 py-1 font-bold">Medida</th>
            <th className="px-2 py-1 font-bold">Base</th>
            <th className="px-2 py-1 font-bold">Matrícula</th>
            {/* Las dos columnas que el taller rellena a mano sobre el papel. */}
            <th className="px-2 py-1 font-bold">Observaciones</th>
            <th className="px-2 py-1 font-bold">Pte. reparar</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.vehiculoId} className="border-b border-slate-700/60 print:border-slate-300">
              <td className="py-1 pr-2 font-bold text-slate-100 print:text-black">{f.numeroUnidad ?? "—"}</td>
              {f.profundidades.map((v, j) => (
                <td key={j} className="px-1 py-1 text-right text-slate-300 print:text-black">{mm(v)}</td>
              ))}
              <td className="px-2 py-1 text-right font-bold text-slate-100 print:text-black">{mm(f.peor)}</td>
              <td className="px-2 py-1 text-slate-400 print:text-slate-700">{fecha(f.ultimaRevision)}</td>
              <td className="px-2 py-1 text-slate-300 print:text-black">{f.medida ?? "—"}</td>
              <td className="px-2 py-1 text-slate-300 print:text-black">{f.base ?? "—"}</td>
              <td className="px-2 py-1 text-slate-300 print:text-black">{f.matricula ?? "—"}</td>
              <td className="px-2 py-1" />
              <td className="px-2 py-1" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InformeMensual() {
  const { filtros, empresas } = useInformesFiltros();
  const { perfil } = useTyreAuth();

  // El mes por defecto es el del `hasta` de los filtros, y si no hay, el de
  // ahora: quien viene de otro informe con un periodo puesto espera seguir
  // mirando ese periodo.
  const mesInicial = (filtros.hasta ?? new Date().toISOString()).slice(0, 7);
  const [mes, setMes] = useState(mesInicial);
  const [d, setD] = useState<Datos | null>(null);
  const [evo, setEvo] = useState<EvolucionInforme | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoEvo, setCargandoEvo] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empresaId = filtros.empresaId;

  useEffect(() => {
    if (!empresaId) { setCargando(false); setCargandoEvo(false); return; }
    let vivo = true;
    setCargando(true); setCargandoEvo(true); setError(null);

    informeMensual(empresaId, mes)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setError(e?.message ?? "Error al cargar el informe"); })
      .finally(() => { if (vivo) setCargando(false); });

    // La evolución va por su cuenta: tarda, y las tablas no tienen por qué
    // esperarla.
    evolucionMensual(empresaId, mes)
      .then((r) => { if (vivo) setEvo(r); })
      .catch(() => { if (vivo) setEvo(null); })
      .finally(() => { if (vivo) setCargandoEvo(false); });

    return () => { vivo = false; };
  }, [empresaId, mes]);

  const centro = perfil?.empresa?.nombre ?? null;
  const cliente = useMemo(
    () => (empresaId ? (empresas.find((e) => e.id === empresaId)?.nombre ?? null) : null),
    [empresaId, empresas],
  );

  if (!empresaId) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-sm text-slate-300">
        Elige una empresa arriba: el informe mensual es de una flota concreta.
      </div>
    );
  }
  if (cargando) return <div className="p-6 text-sm text-slate-400">Calculando el informe del mes…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        <p className="font-semibold">No se ha podido generar el informe mensual.</p>
        <p className="mt-1 text-[12px]">{error}</p>
      </div>
    );
  }
  if (!d) return null;

  const r = d.recuentos;
  const pos = d.neumaticos.posiciones;

  return (
    <div className="flex flex-col gap-4 print:gap-3">
      <CabeceraCorrida titulo="Informe mensual de flota" cliente={cliente} />
      <PieCorrido
        centro={centro} titulo="Informe mensual de flota" cliente={cliente}
        desde={d.periodo.desde} hasta={d.periodo.hasta}
      />

      <CabeceraInforme
        titulo="Informe mensual de flota"
        subtitulo={d.periodo.etiqueta}
        centro={centro}
        cliente={cliente}
        desde={d.periodo.desde}
        hasta={d.periodo.hasta}
        generado={new Date().toISOString()}
        acciones={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px] text-slate-200"
              aria-label="Mes del informe"
            />
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-semibold hover:bg-slate-600"
            >
              <Printer className="h-4 w-4" /> Imprimir / PDF
            </button>
          </div>
        }
      />

      {/* ── Los recuentos de la portada ── */}
      <Bloque titulo={`${cliente ?? "Flota"} · ${d.periodo.etiqueta}`}>
        <table className="w-full max-w-md border-collapse text-[12px] tabular-nums">
          <tbody>
            {[
              ["Flota controlada", nf(r.flotaControlada), ""],
              ["Flota revisada", nf(r.flotaRevisada), pctTxt(r.pctRevisada)],
              ["Pendientes de revisar", nf(r.pendientes), pctTxt(r.pctPendientes)],
            ].map(([k, v, p]) => (
              <tr key={k} className="border-b border-slate-700 print:border-slate-300">
                <td className="py-1 font-semibold text-slate-300 print:text-black">{k}</td>
                <td className="py-1 text-right font-bold text-slate-100 print:text-black">{v}</td>
                <td className="w-20 py-1 text-right text-slate-400 print:text-slate-700">{p}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 font-semibold text-slate-300 print:text-black">Neumáticos revisados</td>
              <td className="py-1 text-right font-bold text-slate-100 print:text-black">{nf(d.neumaticos.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Bloque>

      {/* ── Lo que el informe no puede saber, dicho y además impreso ── */}
      {d.avisos.length > 0 && (
        <Bloque titulo="Lo que hay que saber para leer estos números">
          <ul className="list-inside list-disc space-y-1 text-[11px] text-slate-300 print:text-black">
            {d.avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Bloque>
      )}

      <Bloque titulo="Estado de la flota · neumáticos revisados por posición">
        <Rejilla
          m={{
            columnas: pos.map((p) => `Pos. ${p}`),
            filas: [{
              etiqueta: "Total neumáticos revisados",
              celdas: d.neumaticos.porPosicion,
              total: d.neumaticos.total,
              pct: 100,
            }],
            totalPorColumna: d.neumaticos.porPosicion,
            total: d.neumaticos.total,
          }}
          etiquetaFila=""
        />
      </Bloque>

      <Bloque titulo="Marca por posición">
        <Rejilla m={d.rejillas.marcaPorPosicion} etiquetaFila="Marca" />
      </Bloque>

      <Bloque titulo="Medida por posición">
        <Rejilla m={d.rejillas.medidaPorPosicion} etiquetaFila="Medida" />
      </Bloque>

      <Bloque
        titulo="Rayadas, recauchutadas y reesculturadas"
        nota="Una misma rueda puede contar en más de una fila, así que el total es de marcas puestas y no de ruedas."
      >
        <Rejilla m={d.rejillas.condicionPorPosicion} etiquetaFila="" />
      </Bloque>

      <Bloque titulo="Profundidades por posición">
        <Rejilla m={d.rejillas.profundidadPorPosicion} etiquetaFila="Banda" colorear />
      </Bloque>

      <Bloque titulo="Profundidades por medida de neumático">
        <Rejilla m={d.rejillas.medidaPorMilimetro} etiquetaFila="Medida" />
      </Bloque>

      <Bloque titulo="Medida de neumáticos por marca">
        <Rejilla m={d.rejillas.medidaPorMarca} etiquetaFila="Medida" />
      </Bloque>

      {/* ── Los quesitos y la evolución, que llegan después ── */}
      {cargandoEvo ? (
        <Bloque titulo="Estado del banco de goma">
          <p className="text-[12px] text-slate-400">Calculando la evolución de los últimos meses…</p>
        </Bloque>
      ) : evo?.quesitos ? (
        <>
          <Bloque titulo="Estado del banco de goma">
            <Quesito porciones={evo.quesitos.bandas} colores={COLOR_BANDA} />
          </Bloque>
          <Bloque titulo="Recauchutadas y reesculturadas">
            <Quesito
              porciones={evo.quesitos.condicion}
              colores={["#f97316", "#38bdf8", "#334155"]}
            />
          </Bloque>
          <Bloque
            titulo="Evolución del desgaste"
            nota={evo.avisos.join(" ")}
          >
            <BarrasEvolucion meses={evo.meses} />
          </Bloque>
        </>
      ) : (
        <Bloque titulo="Evolución del desgaste">
          <p className="text-[12px] text-slate-400">
            No se ha podido calcular la evolución. Las tablas de arriba no dependen de ella.
          </p>
        </Bloque>
      )}

      {/* ── Las listas del patio ── */}
      {d.listados.map((l) => (
        <Bloque key={l.banda} titulo={`Profundidades · ${l.titulo} · ${l.filas.length} vehículo(s)`}>
          <ListaDePatio filas={l.filas} posiciones={pos} />
        </Bloque>
      ))}

      <Bloque
        titulo={`Lista de planificación · ${d.planificacion.etiqueta}`}
        nota={`${d.planificacion.filas.length} vehículo(s) revisados este mes`
          + (d.planificacion.sinRevisar > 0
            ? ` · ${d.planificacion.sinRevisar} de la flota sin revisar, que no salen aquí`
            : "")}
      >
        <ListaDePatio filas={d.planificacion.filas} posiciones={pos} />
      </Bloque>
    </div>
  );
}
