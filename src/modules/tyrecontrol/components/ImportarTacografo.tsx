import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Info, Paperclip, Undo2, Upload,
} from "lucide-react";

import {
  bloqueadasDeLoteTacografo, importarInformesPdf, importarTacografo, listarEmpresas,
  listarLotesTacografo, deshacerLoteTacografo, simularTacografo,
  type AccionInformePdf, type LoteTacografo, type RespuestaSimulacionTacografo,
  type ResultadoImportTacografo, type ResultadoImportarInformesPdf,
} from "../services/data";
import type { Empresa } from "../types";
import { TableWrap, tdCls, thCls } from "./ui";

/**
 * Simular la importación del informe de intervenciones de tacógrafo.
 *
 * Dos botones y en este orden: primero SIMULAR, que enseña qué pasaría sin
 * escribir una fila, y solo después IMPORTAR. Los números hay que poder
 * discutirlos antes de que existan.
 *
 * El fichero se manda entero al servidor, que es quien lo lee: el parser vive
 * allí y tener otro aquí sería tener dos criterios para el mismo Excel. Y al
 * importar se vuelve a leer y a cruzar, en vez de fiarse de lo que se simuló
 * hace un rato: entre una cosa y otra alguien puede haber dado de alta un
 * vehículo o haber importado el mismo fichero desde otro sitio.
 *
 * Abajo, los lotes ya importados, cada uno con su «deshacer». Deshacer se
 * NIEGA si alguien vinculó una intervención a mano, aceptó una propuesta de
 * medida o editó una fila: eso es trabajo de una persona y no se tira sin
 * mirarlo.
 *
 * ── Y los informes en PDF, que van por otro camino ──────────────────────────
 *
 * El Excel es la exportación del mes: miles de filas, y por eso se simula
 * antes de escribir. Los informes en PDF son los papeles que el centro manda
 * de uno en uno —o el mes entero en un fichero—, y ahí simular no aporta
 * nada: se suben, cada intervención se da de alta si no estaba, el PDF se
 * adjunta, y lo que ha pasado con cada una se cuenta después con su nombre.
 *
 * El mismo PDF dos veces no duplica nada: se reconoce por su huella y se
 * dice que ya estaba.
 */

const ETIQUETA_CASO: Record<string, string> = {
  sin_medida: "Sin medida informada",
  solo_marcado: "Misma medida, distinto marcado",
  discrepa: "Discrepa",
  sin_vehiculo: "Sin vehículo en TyreControl",
};

/** Lo que se ha hecho con cada informe, dicho para una persona. */
const ETIQUETA_PDF: Record<AccionInformePdf, string> = {
  creada_y_adjuntada: "Dada de alta y adjuntada",
  adjuntada: "Ya estaba: solo adjuntado",
  creada_sin_adjuntar: "Dada de alta, sin adjuntar",
  ya_estaba: "Este mismo PDF ya estaba",
  no_se_puede: "No se ha podido",
};

const TONO_PDF: Record<AccionInformePdf, string> = {
  creada_y_adjuntada: "font-bold text-emerald-300",
  adjuntada: "text-sky-300",
  creada_sin_adjuntar: "text-amber-300",
  ya_estaba: "text-slate-400",
  no_se_puede: "font-bold text-rose-300",
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
  const [imp, setImp] = useState<ResultadoImportTacografo | null>(null);
  const [lotes, setLotes] = useState<LoteTacografo[]>([]);
  const [bloqueadas, setBloqueadas] = useState<{ lote: string; filas: any[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [subiendoPdfs, setSubiendoPdfs] = useState(false);
  const [resPdf, setResPdf] = useState<ResultadoImportarInformesPdf | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (e.length) setEmpresaId((a) => a || e[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  const cargarLotes = useCallback(async () => {
    if (!empresaId) return;
    try { setLotes(await listarLotesTacografo(empresaId)); }
    catch (e: any) { setError(e.message); }
  }, [empresaId]);

  useEffect(() => { void cargarLotes(); }, [cargarLotes]);

  async function simular() {
    if (!archivo || !empresaId) return;
    setCargando(true); setError(""); setMsg(""); setRes(null); setImp(null);
    try {
      setRes(await simularTacografo(empresaId, archivo));
    } catch (e: any) {
      setError(e?.message || "No se ha podido simular");
    } finally { setCargando(false); }
  }

  /**
   * Importar. Se pide confirmación con el número delante, porque «importar»
   * y «importar 1.694 intervenciones» no son la misma decisión.
   */
  async function importar() {
    if (!archivo || !empresaId || !res) return;
    const n = res.simulacion.nuevas;
    if (n === 0) { setError("No hay nada nuevo que importar en este fichero."); return; }
    if (!window.confirm(
      `Vas a importar ${n.toLocaleString("es-ES")} intervención(es) de tacógrafo.\n\n`
      + `Las ${res.simulacion.duplicadas.toLocaleString("es-ES")} que ya estaban se saltan, y `
      + `${res.simulacion.sinVehiculo} entran sin vincular porque su matrícula no está en `
      + `TyreControl.\n\n¿Continuar?`)) return;

    setImportando(true); setError(""); setMsg("");
    try {
      const r = await importarTacografo(empresaId, archivo);
      setImp(r);
      setRes({ ...res, simulacion: r.simulacion });
      setMsg(`Importadas ${r.resultado.insertadas.toLocaleString("es-ES")} intervenciones.`);
      await cargarLotes();
    } catch (e: any) {
      setError(e?.message || "No se ha podido importar");
    } finally { setImportando(false); }
  }

  /**
   * Subir los informes en PDF. Sin simular y sin preguntar: cada informe se
   * coloca solo, y lo que ha pasado con cada uno sale en la tabla de abajo.
   */
  async function subirPdfs() {
    if (!pdfs.length || !empresaId) return;
    setSubiendoPdfs(true); setError(""); setMsg(""); setResPdf(null);
    try {
      const r = await importarInformesPdf(empresaId, pdfs);
      setResPdf(r);
      const n = r.resumen;
      setMsg(`${r.informes} intervención(es) en ${r.archivos} fichero(s): `
        + `${n.creadasYAdjuntadas} dadas de alta y adjuntadas, ${n.adjuntadas} solo adjuntadas, `
        + `${n.yaEstaban} que ya estaban.`);
    } catch (e: any) {
      setError(e?.message || "No se han podido importar los informes");
    } finally { setSubiendoPdfs(false); }
  }

  async function deshacer(lote: LoteTacografo) {
    setError(""); setMsg("");
    try {
      const previo = await deshacerLoteTacografo(empresaId, lote.id, true);
      const v = previo.veredicto;
      if (v && !v.puede) {
        setError(v.explicacion ?? "Ese lote no se puede deshacer.");
        return;
      }
      if (!window.confirm(
        `Vas a borrar ${v?.aBorrar ?? lote.importadas} intervención(es) importadas el `
        + `${new Date(lote.created_at).toLocaleString("es-ES")} desde «${lote.archivo_nombre}».\n\n`
        + `Solo se borran las que metió ESE lote. ¿Continuar?`)) return;
      const r = await deshacerLoteTacografo(empresaId, lote.id);
      setMsg(`Deshecho: ${r.borradas ?? 0} intervención(es) borradas.`);
      await cargarLotes();
    } catch (e: any) {
      setError(e?.message || "No se ha podido deshacer");
    }
  }

  async function verBloqueadas(lote: LoteTacografo) {
    setError("");
    try {
      setBloqueadas({ lote: lote.archivo_nombre, filas: await bloqueadasDeLoteTacografo(empresaId, lote.id) });
    } catch (e: any) { setError(e.message); }
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
            disabled={!archivo || !empresaId || cargando || importando}
            className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300
                       hover:bg-sky-500/10 disabled:opacity-50"
          >
            {cargando ? "Simulando…" : "Simular"}
          </button>
          {/* El de importar solo aparece después de simular: el orden es la
              mitad del diseño. No se importa lo que no se ha mirado. */}
          {res && res.simulacion.nuevas > 0 && (
            <button
              onClick={importar}
              disabled={importando || cargando}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm
                         font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Upload size={14} />
              {importando
                ? "Importando…"
                : `Importar ${res.simulacion.nuevas.toLocaleString("es-ES")}`}
            </button>
          )}
        </div>
      </div>

      {/* ── Los informes técnicos en PDF ──────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
        <h2 className="flex items-center gap-2 text-sm font-black">
          <FileText size={16} /> Informes técnicos en PDF
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Los papeles que manda el centro técnico. Se colocan solos: si la intervención no está
          dada de alta <b className="text-slate-200">se crea con los datos del informe</b>, y en
          cualquier caso el PDF queda adjunto a su revisión, con un clip en la ficha del vehículo.
          Un fichero puede traer <b className="text-slate-200">varias intervenciones</b>, y el
          mismo PDF dos veces no duplica nada.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            <span className="mb-1 block">Informes (PDF, hasta 20)</span>
            <input
              type="file" accept="application/pdf" multiple
              onChange={(e) => { setPdfs([...(e.target.files ?? [])]); setResPdf(null); }}
              className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0
                         file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-100"
            />
          </label>
          <button
            onClick={() => void subirPdfs()}
            disabled={!pdfs.length || !empresaId || subiendoPdfs}
            className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-300
                       hover:bg-emerald-500/10 disabled:opacity-40"
          >
            <Paperclip className="mr-1 inline h-4 w-4" />
            {subiendoPdfs
              ? "Leyendo los informes…"
              : `Importar ${pdfs.length || ""} informe(s)`}
          </button>
        </div>

        {resPdf && (
          <div className="mt-4">
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Cifra n={resPdf.resumen.creadasYAdjuntadas} de="dadas de alta y adjuntadas" tono="text-emerald-300" />
              <Cifra n={resPdf.resumen.adjuntadas} de="ya estaban: solo adjuntado" />
              <Cifra n={resPdf.resumen.yaEstaban} de="el mismo PDF otra vez" tono="text-slate-400" />
              <Cifra n={resPdf.resumen.creadasSinAdjuntar} de="sin vehículo en TyreControl"
                     tono={resPdf.resumen.creadasSinAdjuntar ? "text-amber-300" : ""} />
              <Cifra n={resPdf.resumen.conProblema} de="no se han podido"
                     tono={resPdf.resumen.conProblema ? "text-rose-300" : ""} />
            </div>

            {/*
              Una fila por INTERVENCIÓN y no por fichero: un PDF con el mes
              entero son diez líneas, y cada una tuvo su suerte.
            */}
            <TableWrap>
              <thead><tr>
                <th className={thCls}>Nº de orden</th>
                <th className={thCls}>Fecha</th>
                <th className={thCls}>Matrícula</th>
                <th className={thCls}>Qué se ha hecho</th>
                <th className={thCls}>Fichero</th>
              </tr></thead>
              <tbody>
                {resPdf.resultados.map((r, i) => (
                  <tr key={`${r.archivo}-${r.idOrigen ?? i}`}>
                    <td className={`${tdCls} font-semibold`}>{r.idOrigen ?? "—"}</td>
                    <td className={tdCls}>{r.fecha ?? "—"}</td>
                    <td className={tdCls}>{r.matricula ?? "—"}</td>
                    <td className={tdCls}>
                      <span className={TONO_PDF[r.accion]}>{ETIQUETA_PDF[r.accion]}</span>
                      {(r.motivo || r.avisos.length > 0) && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {[r.motivo, ...r.avisos].filter(Boolean).join(" ")}
                        </div>
                      )}
                    </td>
                    <td className={`${tdCls} text-[11px] text-slate-500`}>{r.archivo}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {msg && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">✔ {msg}</div>}

      {imp && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[13px] text-emerald-200">
          <b>Lote {imp.loteId.slice(0, 8)}</b> · leídas {imp.resultado.leidas.toLocaleString("es-ES")}
          {" · "}grabadas <b>{imp.resultado.insertadas.toLocaleString("es-ES")}</b>
          {" · "}ya estaban {imp.resultado.yaEstaban.toLocaleString("es-ES")}
          {imp.resultado.duplicadasEnBase > 0 && <> · rechazadas por la base {imp.resultado.duplicadasEnBase}</>}
          {" · "}sin vincular {imp.resultado.sinVehiculo}
          {imp.resultado.bloqueadas > 0 && <> · <b>bloqueadas {imp.resultado.bloqueadas}</b></>}
        </div>
      )}

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

      {lotes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-black">Importaciones hechas</h3>
          <p className="mb-2 text-xs text-slate-400">
            Deshacer borra <b className="text-slate-200">solo</b> lo que metió ese lote. Se niega si
            alguien vinculó una intervención a mano, aceptó una propuesta de medida o editó una
            fila: eso es trabajo de una persona y no se tira sin mirarlo.
          </p>
          <TableWrap>
            <thead><tr>
              <th className={thCls}>Fichero</th><th className={thCls}>Cuándo</th>
              <th className={thCls}>Grabadas</th><th className={thCls}>Ya estaban</th>
              <th className={thCls}>Sin vincular</th><th className={thCls}>Bloqueadas</th>
              <th className={thCls}>Estado</th><th className={thCls}></th>
            </tr></thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id}>
                  <td className={`${tdCls} font-bold`}>{l.archivo_nombre}</td>
                  <td className={tdCls}>{new Date(l.created_at).toLocaleString("es-ES")}</td>
                  <td className={`${tdCls} tabular-nums`}>{l.importadas.toLocaleString("es-ES")}</td>
                  <td className={`${tdCls} tabular-nums text-slate-400`}>{l.duplicadas.toLocaleString("es-ES")}</td>
                  <td className={`${tdCls} tabular-nums`}>{l.sin_vehiculo}</td>
                  <td className={tdCls}>
                    {l.bloqueadas > 0
                      ? <button onClick={() => verBloqueadas(l)} className="text-amber-300 underline">{l.bloqueadas}</button>
                      : <span className="text-slate-500">0</span>}
                  </td>
                  <td className={tdCls}>
                    {l.estado === "deshecho"
                      ? <span className="text-slate-400">deshecho {l.deshecho_en ? new Date(l.deshecho_en).toLocaleDateString("es-ES") : ""}</span>
                      : <span className="text-emerald-300">aplicado</span>}
                  </td>
                  <td className={tdCls}>
                    {l.estado === "aplicado" && (
                      <button
                        onClick={() => deshacer(l)}
                        className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1
                                   text-[11px] font-bold text-slate-200 hover:bg-slate-700"
                      >
                        <Undo2 size={12} /> Deshacer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}

      {bloqueadas && (
        <section>
          <h3 className="mb-2 flex items-center justify-between text-sm font-black">
            <span>Filas que no entraron · {bloqueadas.lote}</span>
            <button onClick={() => setBloqueadas(null)} className="text-xs font-normal text-slate-400 underline">
              cerrar
            </button>
          </h3>
          <TableWrap>
            <thead><tr>
              <th className={thCls}>Fila</th><th className={thCls}>Intervención</th>
              <th className={thCls}>Matrícula</th><th className={thCls}>Motivo</th>
            </tr></thead>
            <tbody>
              {bloqueadas.filas.map((b, i) => (
                <tr key={i}>
                  <td className={`${tdCls} tabular-nums`}>{b.fila_origen ?? "—"}</td>
                  <td className={`${tdCls} text-[11px] text-slate-400`}>{b.id_origen ?? "—"}</td>
                  <td className={tdCls}>{b.matricula ?? "—"}</td>
                  <td className={tdCls}>{b.motivo}{b.valor ? ` (${b.valor})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}
    </div>
  );
}
