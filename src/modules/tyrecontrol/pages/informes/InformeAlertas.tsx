import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { listarAlertas, listarAlertasPorVehiculo } from "../../services/informes";
import type { Alerta, RuedaAlerta } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import PlanoMiniVehiculo from "../../components/informes/PlanoMiniVehiculo";
import { descargarCSV } from "../../utils/exportar";
import {
  agruparPorVehiculo, edadEnTexto, fechaCorta, filtrarVehiculos, mm, ordenarVehiculos,
  resumenDeTarjeta, DIAS_MEDICION_VIEJA,
  type FiltroVehiculos, type OrdenVehiculos, type VehiculoConAlertas,
} from "../../services/alertasPorVehiculo";

const ORDENES: { valor: OrdenVehiculos; texto: string }[] = [
  { valor: "peor", texto: "La goma más gastada primero" },
  { valor: "ruedas", texto: "Más ruedas afectadas primero" },
  { valor: "antiguedad", texto: "Medición más antigua primero" },
  { valor: "matricula", texto: "Matrícula" },
];

/** Una muestra del relleno, para la leyenda. */
function Muestra({ clase, children }: { clase: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
      <span className={`min-w-[28px] rounded px-1 py-[2px] text-center text-[11px] font-extrabold tabular-nums ${clase}`}>{children}</span>
    </span>
  );
}

function TarjetaVehiculo({ v }: { v: VehiculoConAlertas }) {
  const vieja = (v.diasDesdeMedicion ?? 0) > DIAS_MEDICION_VIEJA;
  const soloPresion = v.paraCambiar === 0 && v.conPresion > 0;
  return (
    <article className={`flex flex-col gap-3 rounded-xl border bg-slate-800 p-4 ${vieja ? "border-amber-700" : "border-slate-700"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/tyrecontrol/vehiculos/${v.vehiculoId}`} className="text-[17px] font-extrabold text-slate-100 hover:underline">
          {v.matricula || "sin matrícula"}
        </Link>
        {!v.activo && <span className="rounded bg-slate-700 px-1.5 py-[1px] text-[10px] font-bold text-slate-300">de baja</span>}
        <span className="flex-1" />
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
          soloPresion ? "bg-amber-500/20 text-amber-200" : "bg-red-500/20 text-red-200"}`}>
          {resumenDeTarjeta(v)}
        </span>
      </div>

      <div>
        <div className="text-[13px] font-bold text-slate-300">{v.medidas.length > 0 ? v.medidas.join(" · ") : "sin medida"}</div>
        <div className="text-[12px] text-slate-400">
          {[v.unidad && `unidad ${v.unidad}`, v.tipo, v.minimo != null && `mínimo ${mm(v.minimo)} mm`]
            .filter(Boolean).join(" · ")}
        </div>
      </div>

      <PlanoMiniVehiculo
        foto={v.foto}
        ruedas={v.ruedas}
        alt={`Plano de ${v.matricula} con la profundidad de cada rueda`}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-2.5">
        {v.medidoEl ? (
          <>
            <span className="text-[12px] text-slate-400">Medido el <b className="text-slate-300">{fechaCorta(v.medidoEl)}</b></span>
            <span className={vieja
              ? "rounded-full bg-amber-500/15 px-2 py-[2px] text-[11px] font-bold text-amber-200"
              : "text-[11px] text-slate-400"}>
              {edadEnTexto(v.diasDesdeMedicion)}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-slate-400">Sin fecha de medición</span>
        )}
        <span className="flex-1" />
        <Link to={`/tyrecontrol/vehiculos/${v.vehiculoId}`} className="text-[12px] font-bold text-sky-300 hover:underline">Ver</Link>
      </div>
    </article>
  );
}

export default function InformeAlertas() {
  const { filtros } = useInformesFiltros();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [ruedas, setRuedas] = useState<RuedaAlerta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<FiltroVehiculos>("todo");
  const [orden, setOrden] = useState<OrdenVehiculos>("peor");
  const [verSinRevisar, setVerSinRevisar] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    Promise.all([listarAlertas(filtros), listarAlertasPorVehiculo(filtros)])
      .then(([a, r]) => { if (vivo) { setAlertas(a); setRuedas(r); } })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar las alertas"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  const vehiculos = useMemo(() => agruparPorVehiculo(ruedas), [ruedas]);
  const visibles = useMemo(() => ordenarVehiculos(filtrarVehiculos(vehiculos, filtro), orden), [vehiculos, filtro, orden]);

  const nCambiar = vehiculos.reduce((t, v) => t + v.paraCambiar, 0);
  const nPresion = vehiculos.reduce((t, v) => t + v.conPresion, 0);
  const nVieja = filtrarVehiculos(vehiculos, "vieja").length;
  const sinRevisar = alertas.filter((a) => a.tipo === "vehiculo_sin_revisar");

  if (cargando && ruedas.length === 0) return <div className="text-slate-400">Cargando alertas…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const chips: { valor: FiltroVehiculos; texto: string }[] = [
    { valor: "todo", texto: `Todo (${vehiculos.length})` },
    { valor: "cambiar", texto: `Cambiar ya (${filtrarVehiculos(vehiculos, "cambiar").length})` },
    { valor: "presion", texto: `Presión (${filtrarVehiculos(vehiculos, "presion").length})` },
    { valor: "vieja", texto: `Medición vieja (${nVieja})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/*
        Cada cuadro filtra lo suyo: el de presión deja solo los de presión, y
        así con todos. El KPI es la pregunta y la rejilla de abajo es la
        respuesta, así que pulsarlo tiene que llevar a esa respuesta y no ser
        un número de adorno.
      */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard title="Vehículos con incidencia" value={vehiculos.length} tono={vehiculos.length > 0 ? "danger" : "ok"}
                 onClick={() => { setFiltro("todo"); setVerSinRevisar(false); }} />
        <KpiCard title="Cambiar ya" value={nCambiar} tono={nCambiar > 0 ? "danger" : "ok"}
                 hint="22.5 ≤ 4 mm · 19.5/17.5 ≤ 3 · 16 o menos ≤ 2"
                 onClick={() => { setFiltro("cambiar"); setVerSinRevisar(false); }} />
        <KpiCard title="Presión" value={nPresion} tono={nPresion > 0 ? "danger" : "ok"} hint="Sensor Goodyear"
                 onClick={() => { setFiltro("presion"); setVerSinRevisar(false); }} />
        <KpiCard title="Medición vieja" value={nVieja} tono={nVieja > 0 ? "warn" : "ok"} hint={`más de ${DIAS_MEDICION_VIEJA} días`}
                 onClick={() => { setFiltro("vieja"); setVerSinRevisar(false); }} />
        {/*
          Éste no filtra la rejilla porque sus vehículos NO están en ella: no
          tienen ni una medición, así que no hay plano que pintar. Pulsarlo
          abre su lista, que es donde está su respuesta.
        */}
        <KpiCard title="Sin revisar" value={sinRevisar.length}
                 hint={sinRevisar.length > 0 ? "ver la lista" : undefined}
                 onClick={sinRevisar.length > 0 ? () => setVerSinRevisar(true) : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.valor}
            type="button"
            onClick={() => setFiltro(c.valor)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${
              filtro === c.valor
                ? "border-slate-300 bg-slate-300 text-slate-900"
                : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >{c.texto}</button>
        ))}
        <span className="flex-1" />
        <label htmlFor="orden-alertas" className="text-[12px] text-slate-400">Ordenar por</label>
        <select
          id="orden-alertas"
          value={orden}
          onChange={(e) => setOrden(e.target.value as OrdenVehiculos)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-[12px] text-slate-100"
        >
          {ORDENES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
        <button
          type="button"
          onClick={() => descargarCSV(
            "alertas-por-vehiculo",
            ["Matrícula", "Unidad", "Tipo", "Posición", "Estado", "Profundidad mm", "Mínimo mm", "Medida", "Medido el"],
            visibles.flatMap((v) => v.ruedas
              .filter((r) => r.estado === "cambiar" || r.estado === "presion")
              .map((r) => [v.matricula, v.unidad, v.tipo, r.codigo,
                r.estado === "presion" ? "Presión baja" : "Cambiar ya",
                r.profundidad, r.minimo, v.medidas.join(" / "), fechaCorta(r.fecha)])),
          )}
          className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
        >Exportar CSV</button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Muestra clase="bg-green-800 text-white">7,2</Muestra>
        <span className="text-[11px] text-slate-400">por encima del mínimo</span>
        <Muestra clase="bg-red-600 text-white ring-[1.5px] ring-red-200">1,7</Muestra>
        <span className="text-[11px] text-slate-400">hay que cambiarla</span>
        <Muestra clase="bg-amber-700 text-white ring-[1.5px] ring-amber-200">12,0</Muestra>
        <span className="text-[11px] text-slate-400">aviso de presión</span>
        <Muestra clase="bg-slate-600 text-slate-100">—</Muestra>
        <span className="text-[11px] text-slate-400">sin medir</span>
        <span className="text-[11px] text-slate-500">· los milímetros son de la última revisión de cada rueda</span>
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-lg bg-slate-800 p-4 text-sm text-emerald-300">
          ✔ {vehiculos.length === 0 ? "Sin alertas. Toda la flota dentro de parámetros." : "Ningún vehículo con ese filtro."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((v) => <TarjetaVehiculo key={v.vehiculoId} v={v} />)}
        </div>
      )}

      {sinRevisar.length > 0 && (
        <details
          className="rounded-lg bg-slate-800 p-3"
          open={verSinRevisar}
          onToggle={(e) => setVerSinRevisar((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-[11px] font-bold uppercase text-slate-400">
            Vehículos sin revisar ({sinRevisar.length})
          </summary>
          {/*
            Éstos no tienen tarjeta porque no tienen NADA que pintar: ni una
            medición en ninguna rueda. Su problema no es una goma, es que el
            vehículo no ha pasado nunca por una revisión.
          */}
          <div className="mt-2 flex flex-wrap gap-2">
            {sinRevisar.map((a, i) => (
              <Link
                key={a.vehiculo_id ?? i}
                to={a.vehiculo_id ? `/tyrecontrol/vehiculos/${a.vehiculo_id}` : "#"}
                className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-700"
              >{a.matricula}</Link>
            ))}
          </div>
        </details>
      )}

      <div className="text-[11px] text-slate-500">
        Una tarjeta por vehículo con alguna incidencia: una goma en el mínimo de su llanta o por debajo
        (22.5 ≤ 4 mm · 19.5 y 17.5 ≤ 3 · 16 o menos ≤ 2), o un aviso de presión abierto. El plano es el mismo de la ficha
        del vehículo, con la foto de su configuración de ejes y un recuadro por rueda; pasando el ratón por encima sale la
        posición, los milímetros y el día en que se midió ESA rueda, que dentro de un mismo vehículo pueden ser días
        distintos. La fecha del pie es la más reciente de las ruedas que avisan.
        {" "}Las de <b>presión</b> no salen de una revisión: las manda el sensor de Goodyear por correo y se cierran solas
        cuando el vehículo vuelve a pasar por el arco y da bien.
        {" "}Los vehículos <b>dados de baja</b> salen marcados, porque sus gomas siguen contando en el almacén.
      </div>
    </div>
  );
}
