import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info } from "lucide-react";

import { listarEmpresas, simularTacografo, type RespuestaSimulacionTacografo } from "../services/data";
import type { Empresa } from "../types";
import { TableWrap, tdCls, thCls } from "./ui";

/**
 * Simular la importación del informe de intervenciones de tacógrafo.
 *
 * De momento SOLO simula: sube el Excel y enseña qué pasaría. No escribe una
 * fila. Es a propósito —los números hay que poder discutirlos antes de que
 * existan— y el botón de importar llega en la siguiente fase.
 *
 * El fichero se manda entero al servidor, que es quien lo lee: el parser vive
 * allí y tener otro aquí sería tener dos criterios para el mismo Excel.
 */

const ETIQUETA_CASO: Record<string, string> = {
  sin_medida: "Sin medida informada",
  solo_marcado: "Misma medida, distinto marcado",
  discrepa: "Discrepa",
  sin_vehiculo: "Sin vehículo en TyreControl",
};

const Cifra = ({ n, de, tono = "" }: { n: number; de: string; tono?: string }) => (
  <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2">
    <div className={`text-xl font-black tabular-nums ${tono}`}>{n.toLocaleString("es-ES")}</div>
    <div className="text-[11px] leading-tight text-slate-400">{de}</div>
  </div>
);

export default function ImportarTacografo() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [res, setRes] = useState<RespuestaSimulacionTacografo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (e.length) setEmpresaId((a) => a || e[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  async function simular() {
    if (!archivo || !empresaId) return;
    setCargando(true); setError(""); setRes(null);
    try {
      setRes(await simularTacografo(empresaId, archivo));
    } catch (e: any) {
      setError(e?.message || "No se ha podido simular");
    } finally { setCargando(false); }
  }

  const s = res?.simulacion;
  const seguras = s?.propuestas.filter((p) => p.seguraParaBloque).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
        <h2 className="flex items-center gap-2 text-sm font-black">
          <FileSpreadsheet size={16} /> Informe de intervenciones de tacógrafo
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Sube el Excel de la extranet y se enseña qué pasaría. De momento
          <b className="text-slate-200"> solo simula: no escribe nada</b>.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          {empresas.length > 1 && (
            <label className="text-xs text-slate-400">
              <span className="mb-1 block">Cliente</span>
              <select
                value={empresaId}
                onChange={(e) => { setEmpresaId(e.target.value); setRes(null); }}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-400">
            <span className="mb-1 block">Fichero</span>
            <input
              type="file" accept=".xlsx,.xls"
              onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setRes(null); }}
              className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0
                         file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-100"
            />
          </label>
          <button
            onClick={simular}
            disabled={!archivo || !empresaId || cargando}
            className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300
                       hover:bg-sky-500/10 disabled:opacity-50"
          >
            {cargando ? "Simulando…" : "Simular"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {res && s && (
        <>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[13px] text-emerald-200">
            <CheckCircle2 size={14} className="mr-1 inline" />
            Leídas <b>{s.filasLeidas.toLocaleString("es-ES")}</b> intervenciones de «{s.archivo}»
            {" · "}cabecera en la fila {res.lectura.filaCabecera}
            {" · "}{res.lectura.columnasUsadas} de {res.lectura.columnas} columnas aprovechadas
            {" · "}vencimiento a {res.regla.meses} meses
            {". "}<b>No se ha escrito nada.</b>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Cifra n={s.nuevas} de="entrarían nuevas" tono="text-emerald-300" />
            <Cifra n={s.duplicadas} de="ya importadas, se saltan" tono="text-slate-300" />
            <Cifra n={s.sinVehiculo} de="sin vehículo, sin vincular" tono="text-amber-300" />
            <Cifra n={s.vehiculosEncontrados} de="vehículos alcanzados" />
            <Cifra n={s.propuestas.length} de="propuestas de medida" tono="text-sky-300" />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cifra n={s.vencimientos.vigente ?? 0} de="tacógrafo vigente" tono="text-emerald-300" />
            <Cifra n={s.vencimientos.proxima ?? 0} de="vence pronto" tono="text-amber-300" />
            <Cifra n={s.vencimientos.vencida ?? 0} de="vencido" tono="text-rose-300" />
            <Cifra n={s.vencimientos.sin_datos ?? 0} de="sin datos" />
          </div>

          {s.avisos.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              {s.avisos.map((a, i) => (
                <div key={i} className="text-[13px] text-amber-200">
                  <AlertTriangle size={13} className="mr-1 inline" />{a}
                </div>
              ))}
            </div>
          )}

          {s.problemas.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="mb-1 text-xs font-black text-rose-200">
                {s.problemas.length} fila(s) que no se han podido leer
              </div>
              {s.problemas.slice(0, 20).map((p, i) => (
                <div key={i} className="text-[12px] text-rose-200">
                  Fila {p.fila}: {p.motivo}{p.valor ? ` (${p.valor})` : ""}
                </div>
              ))}
            </div>
          )}

          <section>
            <h3 className="mb-2 text-sm font-black">
              Medidas de neumático · {s.propuestas.length} propuesta(s)
            </h3>
            <p className="mb-2 text-xs text-slate-400">
              <Info size={12} className="mr-1 inline" />
              La medida del tacógrafo dice con qué circunferencia se calibró el aparato, no qué
              rueda hay montada. Al aceptar una propuesta solo se escribiría la medida habitual
              del vehículo; nunca montajes, neumáticos, ejes ni posiciones.
              {seguras > 0 && <> De las {s.propuestas.length}, <b className="text-slate-200">{seguras}</b> son
              coincidencias seguras y podrían aceptarse en bloque.</>}
            </p>
            <div className="mb-2 flex flex-wrap gap-2">
              {Object.entries(s.propuestasPorCaso).map(([caso, n]) => (
                <span key={caso} className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">
                  {ETIQUETA_CASO[caso] ?? caso}: {n}
                </span>
              ))}
            </div>
            <TableWrap>
              <thead><tr>
                <th className={thCls}>Matrícula</th><th className={thCls}>Caso</th>
                <th className={thCls}>Tacógrafo</th><th className={thCls}>TyreControl</th>
                <th className={thCls}>Fecha</th><th className={thCls}>Intervención</th>
              </tr></thead>
              <tbody>
                {s.propuestas
                  .slice()
                  .sort((a, b) => a.caso.localeCompare(b.caso) || a.matriculaNorm.localeCompare(b.matriculaNorm))
                  .map((p) => (
                    <tr key={`${p.matriculaNorm}-${p.medidaNorm}`}>
                      <td className={`${tdCls} font-bold`}>{p.matricula ?? p.matriculaNorm}</td>
                      <td className={tdCls}>
                        <span className={
                          p.caso === "discrepa" ? "text-rose-300"
                          : p.caso === "solo_marcado" ? "text-amber-300"
                          : p.caso === "sin_vehiculo" ? "text-slate-400" : "text-emerald-300"}>
                          {ETIQUETA_CASO[p.caso]}
                        </span>
                      </td>
                      <td className={tdCls}>
                        {p.medidaNorm}
                        {p.medidaOrigen && p.medidaOrigen !== p.medidaNorm && (
                          <span className="ml-1 text-[11px] text-slate-500">({p.medidaOrigen})</span>
                        )}
                      </td>
                      <td className={tdCls}>{p.medidaActual ?? "—"}</td>
                      <td className={tdCls}>{p.fecha ?? "—"}</td>
                      <td className={`${tdCls} text-[11px] text-slate-400`}>{p.idOrigen}</td>
                    </tr>
                  ))}
              </tbody>
            </TableWrap>
          </section>

          {s.kmSospechosos.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-black">
                Kilometraje · {s.kmSospechosos.length} lectura(s) que bajan
              </h3>
              <p className="mb-2 text-xs text-slate-400">
                Se guardarían marcadas, no se descartan: lo más probable es que sea un cambio de
                cuentakilómetros. No tocan el kilómetro actual del vehículo, que viene de la telemática.
              </p>
              <TableWrap>
                <thead><tr>
                  <th className={thCls}>Matrícula</th><th className={thCls}>Antes</th>
                  <th className={thCls}>km</th><th className={thCls}>Después</th><th className={thCls}>km</th>
                </tr></thead>
                <tbody>
                  {s.kmSospechosos.map((k) => (
                    <tr key={k.idOrigen}>
                      <td className={`${tdCls} font-bold`}>{k.matricula ?? k.matriculaNorm}</td>
                      <td className={tdCls}>{k.fechaAnterior ?? "—"}</td>
                      <td className={`${tdCls} tabular-nums`}>{k.kmAnterior.toLocaleString("es-ES")}</td>
                      <td className={tdCls}>{k.fecha ?? "—"}</td>
                      <td className={`${tdCls} tabular-nums text-amber-300`}>{k.km.toLocaleString("es-ES")}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          )}

          {s.matriculasSinVehiculo.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-black">
                {s.matriculasSinVehiculo.length} matrícula(s) sin vehículo en TyreControl
              </h3>
              <p className="mb-2 text-xs text-slate-400">
                Sus intervenciones se guardarían sin vincular, para poder enlazarlas después.
                No se crea ningún vehículo.
              </p>
              <div className="flex flex-wrap gap-1">
                {s.matriculasSinVehiculo.map((m) => (
                  <span key={m} className="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">{m}</span>
                ))}
              </div>
            </section>
          )}

          {s.clientes.length > 1 && (
            <section>
              <h3 className="mb-2 text-sm font-black">Clientes que trae el fichero</h3>
              <p className="mb-2 text-xs text-slate-400">
                Todas las intervenciones se importarían bajo el cliente elegido arriba,
                conservando en cada una el nombre original del fichero.
              </p>
              <TableWrap>
                <thead><tr><th className={thCls}>Nombre en el fichero</th><th className={thCls}>Intervenciones</th></tr></thead>
                <tbody>
                  {s.clientes.map((c) => (
                    <tr key={c.nombre}>
                      <td className={tdCls}>{c.nombre}</td>
                      <td className={`${tdCls} tabular-nums`}>{c.filas.toLocaleString("es-ES")}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          )}
        </>
      )}
    </div>
  );
}
