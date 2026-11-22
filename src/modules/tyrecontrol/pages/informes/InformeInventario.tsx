import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerKpis, inventarioPor, inventarioMarcaMedida, distribucionProfundidad, inventarioCubo, planosIncompletos } from "../../services/informes";
import type { CeldaInventario, KpisInformes, DimensionTotal, MarcaMedidaTotal, PlanosIncompletos, ProfundidadDistribucion } from "../../types/informes";
import {
  cuadrosDelInventario, tablasDelInventario, ESTADOS_INVENTARIO, NOMBRE_ESTADO_INVENTARIO, type EstadoInventario,
} from "../../services/cuadrosInformes";
import { ESTADO_NEUMATICO_LABELS } from "../../types";
import type { EstadoNeumatico } from "../../types";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { FiltroActivo, KpiCard } from "../../components/informes/KpiCard";
import { descargarCSV } from "../../utils/exportar";

function BotonCSV({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">Exportar CSV</button>;
}

function TablaDim({ titulo, columna, datos, etiquetar }: {
  titulo: string; columna: string; datos: DimensionTotal[]; etiquetar?: (s: string) => string;
}) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase text-slate-400">{titulo}</div>
        <BotonCSV onClick={() => descargarCSV(titulo, [columna, "Total"], datos.map((d) => [etiquetar ? etiquetar(d.etiqueta) : d.etiqueta, d.total]))} />
      </div>
      <TableWrap>
        <thead className="bg-slate-900"><tr><th className={thCls}>{columna}</th><th className={thCls}>Total</th></tr></thead>
        <tbody>
          {datos.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={2}>Sin datos.</td></tr>
          : datos.map((d, i) => (
            <tr key={i} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-200"}>{etiquetar ? etiquetar(d.etiqueta) : d.etiqueta}</td>
              <td className={tdCls + " font-semibold text-slate-100"}>{d.total}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// Estados de la ficha que no están en ESTADO_NEUMATICO_LABELS.
const ETIQUETA_ESTADO_EXTRA: Record<string, string> = {
  pendiente_clasificacion: "Pendiente de clasificar", no_localizado: "No localizado", "—": "Sin estado",
};

const TONO_CUADRO: Partial<Record<EstadoInventario, "info" | "warn">> = { montado: "info", pendiente_clasificacion: "warn" };

export default function InformeInventario() {
  const { filtros } = useInformesFiltros();
  const [kpis, setKpis] = useState<KpisInformes | null>(null);
  const [porMarca, setPorMarca] = useState<DimensionTotal[]>([]);
  const [porMedida, setPorMedida] = useState<DimensionTotal[]>([]);
  const [porModelo, setPorModelo] = useState<DimensionTotal[]>([]);
  const [porEstado, setPorEstado] = useState<DimensionTotal[]>([]);
  const [marcaMedida, setMarcaMedida] = useState<MarcaMedidaTotal[]>([]);
  const [prof, setProf] = useState<ProfundidadDistribucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  /*
   * El inventario en celdas, de donde salen todas las tablas —enteras o de un
   * solo estado—. Si la base todavía no lo tiene (`null`), la pantalla va por
   * el camino de siempre y los cuadros no filtran: no hay de dónde.
   */
  const [celdas, setCeldas] = useState<CeldaInventario[] | null>(null);
  const [soloEstado, setSoloEstado] = useState<EstadoInventario | null>(null);
  const [planos, setPlanos] = useState<PlanosIncompletos | null>(null);

  // El aviso va aparte y no frena el informe: si tarda o la base aún no
  // tiene la función, el inventario sale igual y el aviso, cuando llegue.
  useEffect(() => {
    let vivo = true;
    setPlanos(null);
    planosIncompletos(filtros).then((p) => { if (vivo) setPlanos(p); });
    return () => { vivo = false; };
  }, [filtros]);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    inventarioCubo(filtros).then((cubo) => {
      if (!vivo) return undefined;
      setCeldas(cubo);
      if (cubo) { setCargando(false); return undefined; }
      return Promise.all([
      obtenerKpis(filtros),
      inventarioPor(filtros, "marca"),
      inventarioPor(filtros, "medida"),
      inventarioPor(filtros, "modelo"),
      inventarioPor(filtros, "estado"),
      inventarioMarcaMedida(filtros),
      distribucionProfundidad(filtros),
    ])
        .then(([k, ma, me, mo, es, mm, pr]) => {
          if (!vivo) return;
          setKpis(k); setPorMarca(ma); setPorMedida(me); setPorModelo(mo); setPorEstado(es); setMarcaMedida(mm); setProf(pr);
        })
        .catch((e) => { if (vivo) setError(e?.message || "Error al cargar el inventario"); })
        .finally(() => { if (vivo) setCargando(false); });
    });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !kpis && !celdas) return <div className="text-slate-400">Cargando inventario…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!kpis && !celdas) return null;

  // Con las celdas, todo sale de ellas —cuadros incluidos— y un cuadro pulsado
  // deja las tablas en su estado. Sin ellas, lo que ha traído cada función.
  const filtra = celdas !== null;
  const cuadros = celdas
    ? cuadrosDelInventario(celdas)
    : {
        total: kpis?.neumaticos_total ?? 0, montado: kpis?.neumaticos_montados ?? 0, almacen: kpis?.neumaticos_almacen ?? 0,
        reparacion: kpis?.neumaticos_reparacion ?? 0, descartado: kpis?.neumaticos_descartados ?? 0,
        pendiente_clasificacion: 0, papelera: 0, otros: 0,
      };
  // Sin las celdas no se sabe cuántos hay de los estados nuevos: esos cuadros
  // no se enseñan antes que enseñar un cero que no es verdad.
  const visibles = filtra ? ESTADOS_INVENTARIO : (["montado", "almacen", "reparacion", "descartado"] as EstadoInventario[]);
  const tablas = celdas
    ? tablasDelInventario(celdas, soloEstado)
    : { porMarca, porMedida, porModelo, porEstado, marcaMedida, profundidad: prof, enElFiltro: 0, delHistorico: 0 };
  const alternar = (e: EstadoInventario) => setSoloEstado((actual) => (actual === e ? null : e));

  const etiquetaEstado = (s: string) =>
    ESTADO_NEUMATICO_LABELS[s as EstadoNeumatico] ?? ETIQUETA_ESTADO_EXTRA[s] ?? s;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard title="Total controlados" value={cuadros.total} hint={filtra ? "La suma de los cuadros" : undefined}
                 onClick={filtra ? () => setSoloEstado(null) : undefined} />
        {visibles.map((e) => (
          <KpiCard key={e} title={NOMBRE_ESTADO_INVENTARIO[e]} value={cuadros[e]} tono={TONO_CUADRO[e] ?? "neutral"}
                   hint={e === "otros" ? "Reservados, no localizados, sin estado" : undefined}
                   activo={soloEstado === e} onClick={filtra ? () => alternar(e) : undefined} />
        ))}
      </div>

      {soloEstado === "pendiente_clasificacion" && (
        <div className="mb-3 text-[12px] text-slate-400">
          Son gomas desmontadas que nadie ha clasificado todavía (almacén, reparación o descarte).
          Se clasifican en <Link to="/tyrecontrol/almacen-usados" className="font-bold text-sky-300 hover:underline">Almacén de usados</Link>.
        </div>
      )}

      {planos && <AvisoPlanos planos={planos} />}

      {soloEstado && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <span>Las tablas de abajo cuentan solo:</span>
          <FiltroActivo texto={NOMBRE_ESTADO_INVENTARIO[soloEstado]} onQuitar={() => setSoloEstado(null)} />
          {/*
            El cuadro cuenta todos los neumáticos y las tablas por marca,
            medida, modelo y estado no cuentan las fichas que creó la
            importación del histórico. Sin decirlo, el número de arriba y la
            suma de abajo no cuadran y parece un error.
          */}
          {tablas.delHistorico > 0 && (
            <span>
              · {tablas.delHistorico.toLocaleString("es-ES")} de los {tablas.enElFiltro.toLocaleString("es-ES")} son fichas
              del histórico importado: cuentan en el cuadro y en la profundidad, no en las otras tablas.
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <TablaDim titulo="Por marca" columna="Marca" datos={tablas.porMarca} />
        <TablaDim titulo="Por medida" columna="Medida" datos={tablas.porMedida} />
        <TablaDim titulo="Por modelo" columna="Modelo" datos={tablas.porModelo} />
        <TablaDim titulo="Por estado" columna="Estado" datos={tablas.porEstado} etiquetar={etiquetaEstado} />
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Marca + medida</div>
          <BotonCSV onClick={() => descargarCSV("marca_medida", ["Marca", "Medida", "Total"], tablas.marcaMedida.map((d) => [d.marca, d.medida, d.total]))} />
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Marca</th><th className={thCls}>Medida</th><th className={thCls}>Total</th></tr></thead>
          <tbody>
            {tablas.marcaMedida.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={3}>Sin datos.</td></tr>
            : tablas.marcaMedida.map((d, i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{d.marca}</td>
                <td className={tdCls + " text-slate-300"}>{d.medida}</td>
                <td className={tdCls + " font-semibold text-slate-100"}>{d.total}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Distribución por profundidad (última medición)</div>
          <BotonCSV onClick={() => descargarCSV("profundidades", ["Marca", "0-2", "2-4", "4-6", "6-8", "8-10", "+10", "Total"], tablas.profundidad.map((p) => [p.marca, p.r0_2, p.r2_4, p.r4_6, p.r6_8, p.r8_10, p.r10, p.total]))} />
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca</th>
            <th className={thCls + " text-rose-300"}>🔴 0-2</th>
            <th className={thCls + " text-amber-300"}>🟡 2-4</th>
            <th className={thCls}>4-6</th>
            <th className={thCls}>6-8</th>
            <th className={thCls}>8-10</th>
            <th className={thCls + " text-emerald-300"}>🟢 +10</th>
            <th className={thCls}>Total</th>
          </tr></thead>
          <tbody>
            {tablas.profundidad.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin mediciones registradas todavía.</td></tr>
            : tablas.profundidad.map((p, i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{p.marca}</td>
                <td className={tdCls + " text-rose-300"}>{p.r0_2 || ""}</td>
                <td className={tdCls + " text-amber-300"}>{p.r2_4 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r4_6 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r6_8 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r8_10 || ""}</td>
                <td className={tdCls + " text-emerald-300"}>{p.r10 || ""}</td>
                <td className={tdCls + " font-semibold text-slate-100"}>{p.total}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-2 text-[11px] text-slate-500">Rangos en mm. Serán configurables en una próxima fase. Los neumáticos sin ninguna revisión no aparecen aquí.</div>
      </div>
    </div>
  );
}

/**
 * Un camión monta las ruedas por ejes: un eje con 1 o 3 ruedas, o una ficha
 * «montada» que no está en ninguna posición, es un dato mal cargado. Salía a
 * la luz solo porque el número de montados era impar.
 */
function AvisoPlanos({ planos }: { planos: PlanosIncompletos }) {
  const [abierto, setAbierto] = useState(false);
  const nVeh = planos.vehiculos.length;
  const nFichas = planos.fichas_sin_posicion_total;
  if (nVeh === 0 && nFichas === 0) return null;
  const partes = [
    nVeh > 0 ? `${nVeh} ${nVeh === 1 ? "vehículo con el plano incompleto" : "vehículos con el plano incompleto"}` : null,
    nFichas > 0 ? `${nFichas} ${nFichas === 1 ? "ficha montada sin posición" : "fichas montadas sin posición"}` : null,
  ].filter(Boolean);
  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-100">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="flex w-full items-center justify-between gap-2 text-left">
        <span><span className="font-bold">⚠ {partes.join(" · ")}</span>
          <span className="text-amber-200/80"> — el recuento de montados no es fiable hasta corregirlo.</span></span>
        <span className="shrink-0 font-bold text-amber-300">{abierto ? "Ocultar" : "Ver"}</span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-3">
          {nVeh > 0 && (
            <div>
              <div className="mb-1 text-amber-200/80">
                Tienen alguna rueda informada y alguna posición sin rueda. Se corrige en la ficha del vehículo,
                con «Informar los neumáticos que ya lleva».
              </div>
              <ul className="divide-y divide-amber-500/20">
                {planos.vehiculos.map((v) => (
                  <li key={v.vehiculo_id} className="flex flex-wrap items-baseline gap-x-3 py-1">
                    <Link to={`/tyrecontrol/vehiculos/${v.vehiculo_id}`} className="font-bold text-sky-300 hover:underline">{v.matricula}</Link>
                    <span>{v.montadas} de {v.posiciones}</span>
                    <span className="text-amber-200/80">falta{v.faltan.length === 1 ? "" : "n"}: {v.faltan.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {nFichas > 0 && (
            <div>
              <div className="mb-1 text-amber-200/80">
                Están en «montado» pero en ningún vehículo: suelen ser fichas genéricas de una importación que se
                quedaron colgando. Cuentan como montadas sin estarlo.
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {planos.fichas_sin_posicion.map((f) => (
                  <li key={f.id}>
                    <span className="font-semibold">{f.codigo_interno ?? "sin código"}</span>
                    {(f.marca || f.medida) && <span className="text-amber-200/70"> {[f.marca, f.medida].filter(Boolean).join(" ")}</span>}
                  </li>
                ))}
              </ul>
              {nFichas > planos.fichas_sin_posicion.length && (
                <div className="mt-1 text-amber-200/70">… y {nFichas - planos.fichas_sin_posicion.length} más.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
