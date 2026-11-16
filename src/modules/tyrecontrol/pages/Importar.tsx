import { useState } from "react";
import * as XLSX from "xlsx";
import { importVehiculos, type ReporteImport } from "../services/importVehiculos";
import { importRevisiones, type ReporteRev } from "../services/importRevisiones";
import { importCheckpoint, type ReporteCheckpoint } from "../services/importCheckpoint";
import { HOJA_DETALLE } from "../services/checkpoint";
import {
  altasPosibles, darDeAlta, importFleetcheck, leerFleetcheckPdf,
  type AltaPropuesta, type ReporteFleetcheck, type ResultadoAltas,
} from "../services/importFleetcheck";
import type { LecturaFleetcheck } from "../services/fleetcheck";
import { pareceHoja1, pareceHoja2 } from "../services/importHistorico";
import ImportarHistorico from "../components/ImportarHistorico";
import ImportarTacografo from "../components/ImportarTacografo";
import { TableWrap, tdCls, thCls } from "../components/ui";

type Modo = "vehiculos" | "revisiones" | "checkpoint" | "historico" | "fleetcheck";

export default function Importar() {
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [modo, setModo] = useState<Modo | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [repVeh, setRepVeh] = useState<ReporteImport | null>(null);
  const [repRev, setRepRev] = useState<ReporteRev | null>(null);
  const [repChk, setRepChk] = useState<ReporteCheckpoint | null>(null);
  // El Fleetcheck Report de TIRETASK llega en PDF: lo abre el servidor.
  const [fleetcheck, setFleetcheck] = useState<LecturaFleetcheck | null>(null);
  const [fechaFleetcheck, setFechaFleetcheck] = useState("");
  const [repFlt, setRepFlt] = useState<ReporteFleetcheck | null>(null);
  // Vehículos del informe sin plano: se pueden dar de alta con sus datos,
  // pero solo si quien importa lo marca, porque eso SÍ crea neumáticos.
  const [altas, setAltas] = useState<AltaPropuesta[]>([]);
  const [hacerAltas, setHacerAltas] = useState(false);
  const [resAltas, setResAltas] = useState<ResultadoAltas | null>(null);
  const [avanceAltas, setAvanceAltas] = useState("");
  const [ejecutado, setEjecutado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  // El histórico de albaranes (Hoja1 + Hoja2 del Excel de Genes) tiene su
  // propio componente: no se parece a las plantillas de arriba.
  const [historico, setHistorico] = useState<{ h1: any[]; h2: any[]; bytes: ArrayBuffer } | null>(null);
  // Las cargas ya hechas se gestionan sin volver a subir el Excel.
  const [soloCargas, setSoloCargas] = useState(false);
  /**
   * El informe de tacógrafo tiene su propio panel y lo lee el SERVIDOR, así
   * que no pasa por la detección de arriba: no tendría sentido leerlo aquí
   * para volver a mandarlo entero.
   */
  const [tacografo, setTacografo] = useState(false);

  function reset() { setAltas([]); setHacerAltas(false); setResAltas(null); setAvanceAltas(""); setFleetcheck(null); setFechaFleetcheck(""); setRepFlt(null); setRepVeh(null); setRepRev(null); setRepChk(null); setEjecutado(false); setRows([]); setModo(null); setError(""); setHistorico(null); }

  async function onArchivo(file: File | undefined) {
    if (!file) return;
    reset(); setNombreArchivo(file.name);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setCargando(true);
        try {
          const lectura = await leerFleetcheckPdf(file);
          setFleetcheck(lectura);
          setFechaFleetcheck(lectura.fecha ?? "");
          setModo("fleetcheck");
          // `rows` solo cuenta ruedas, para el rótulo y para enseñar los botones.
          setRows(lectura.vehiculos.flatMap((v) => v.ruedas));
        } finally { setCargando(false); }
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      // El informe del CheckPoint se reconoce por su hoja, y sus cabeceras
      // están en la SEGUNDA fila: la primera es el título con la fecha del
      // informe.
      if (wb.SheetNames.includes(HOJA_DETALLE)) {
        const data = XLSX.utils.sheet_to_json(wb.Sheets[HOJA_DETALLE], { range: 1, defval: "" }) as any[];
        const validas = data.filter((r) => String(r["Matrícula"] ?? "").trim());
        if (validas.length === 0) throw new Error("El informe del CheckPoint no trae ninguna matrícula.");
        setModo("checkpoint"); setRows(validas);
        return;
      }
      // El histórico de albaranes: una hoja con Documento/Matrícula/Código y
      // otra con Cod. Articulo/Doc. Salida (los nombres «Hoja1»/«Hoja2» no se
      // exigen: se reconocen por las cabeceras).
      {
        const hojas = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }) as any[]);
        const i1 = hojas.findIndex((h) => pareceHoja1(h[0]));
        const i2 = hojas.findIndex((h) => pareceHoja2(h[0]));
        if (i1 >= 0) {
          setModo("historico"); setRows(hojas[i1]);
          setHistorico({ h1: hojas[i1], h2: i2 >= 0 ? hojas[i2] : [], bytes: buf });
          return;
        }
      }
      // Si lo que han elegido es el informe de tacógrafo, se dice dónde va en
      // vez de soltar un «no se han encontrado filas con matricula», que no
      // ayuda a nadie. Su cabecera está en la tercera fila.
      {
        const primera = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
          { header: 1, defval: null, raw: true }) as unknown[][];
        const esTacografo = primera.slice(0, 8).some((f) =>
          (f ?? []).some((c) => String(c ?? "").trim().toLowerCase().includes("id intervención")));
        if (esTacografo) {
          setTacografo(true);
          throw new Error("Esto es el informe de intervenciones de tacógrafo: tiene su propio "
            + "apartado, que se acaba de abrir aquí debajo.");
        }
      }

      const tieneRev = wb.SheetNames.includes("Revisiones");
      const hoja = tieneRev ? "Revisiones" : (wb.Sheets["Vehiculos"] ? "Vehiculos" : wb.SheetNames[0]);
      const data = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: "" }) as any[];
      const esRev = tieneRev || (data[0] && ("posicion" in data[0]) && ("profundidad_mm" in data[0]));
      const m: Modo = esRev ? "revisiones" : "vehiculos";
      const validas = data.filter((r) => String(r.matricula ?? "").trim());
      if (validas.length === 0) throw new Error("No se han encontrado filas con 'matricula'.");
      setModo(m); setRows(validas);
    } catch (e: any) { setError(e?.message || "No se pudo leer el archivo"); }
  }

  async function analizar() {
    setCargando(true); setError(""); setEjecutado(false);
    try {
      if (modo === "vehiculos") setRepVeh(await importVehiculos(rows, false));
      else if (modo === "checkpoint") setRepChk(await importCheckpoint(rows, false));
      else if (modo === "fleetcheck") {
        if (!fleetcheck) return;
        if (!fechaFleetcheck) throw new Error("Pon la fecha en que se hicieron las mediciones.");
        setResAltas(null);
        setAltas(await altasPosibles(fleetcheck));
        setRepFlt(await importFleetcheck(fleetcheck, fechaFleetcheck, false));
      }
      else setRepRev(await importRevisiones(rows, false));
    } catch (e: any) { setError(e?.message || "Error al analizar"); } finally { setCargando(false); }
  }

  async function importar() {
    const n = modo === "revisiones" ? (repRev?.resumen.revisiones ?? 0) : rows.length;
    const altasValidas = altas.filter((a) => !a.motivo);
    const que = modo === "fleetcheck"
      ? `${repFlt?.rev.resumen.detalles ?? 0} mediciones en ${repFlt?.rev.resumen.revisiones ?? 0} revisiones nuevas, con fecha ${fechaFleetcheck}`
        + (hacerAltas && altasValidas.length
          ? `, y a dar de alta ${altasValidas.length} vehículos sin plano CREANDO sus ${altasValidas.reduce((s, a) => s + a.ruedas, 0)} neumáticos`
          : "")
      : modo === "checkpoint"
      ? `${repChk?.mediciones ?? 0} mediciones nuevas del CheckPoint` +
        (repChk?.altas.length ? ` y el alta de ${repChk.altas.length} vehículos` : "")
      : modo === "revisiones" ? `${rows.length} filas de revisión` : `${n} vehículos`;
    if (!window.confirm(`Vas a importar ${que}. ¿Continuar?`)) return;
    setCargando(true); setError("");
    try {
      if (modo === "vehiculos") setRepVeh(await importVehiculos(rows, true));
      else if (modo === "checkpoint") setRepChk(await importCheckpoint(rows, true));
      else if (modo === "fleetcheck") {
        if (!fleetcheck || !fechaFleetcheck) return;
        // Primero las altas: así sus revisiones ya existen cuando pasa la
        // importación, que las respeta y no las duplica.
        if (hacerAltas && altas.some((a) => !a.motivo)) {
          setResAltas(await darDeAlta(fleetcheck, fechaFleetcheck, altas,
            (n, total) => setAvanceAltas(`Dando de alta vehículos: ${n} de ${total}…`)));
          setAvanceAltas("");
          setAltas(await altasPosibles(fleetcheck).catch(() => []));
        }
        setRepFlt(await importFleetcheck(fleetcheck, fechaFleetcheck, true));
      }
      else setRepRev(await importRevisiones(rows, true));
      setEjecutado(true);
    } catch (e: any) { setError(e?.message || "Error al importar"); } finally { setCargando(false); }
  }

  const reporte = modo === "vehiculos" ? repVeh : modo === "checkpoint" ? repChk : modo === "fleetcheck" ? repFlt : repRev;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Importar</h1>
      <p className="mb-3 text-sm text-slate-400">Importación desde plantilla Excel. Detecta automáticamente si es de Vehículos, de Revisiones, el informe del CheckPoint o el histórico de albaranes del taller. También admite el PDF «Fleetcheck Report» de TIRETASK. El informe de intervenciones de tacógrafo va en su propio apartado.</p>

      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300">
          📁 Elegir archivo (Excel o PDF)
          <input type="file" accept=".xlsx,.xlsm,.xls,.pdf,application/pdf" className="hidden" onChange={(e) => onArchivo(e.target.files?.[0])} />
        </label>
        <button onClick={() => setSoloCargas((v) => !v)}
          className="ml-3 rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700">
          {soloCargas ? "Ocultar cargas del histórico" : "Cargas del histórico de albaranes"}
        </button>
        <button onClick={() => setTacografo((v) => !v)}
          className="ml-2 rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700">
          {tacografo ? "Ocultar tacógrafo" : "Informe de tacógrafo"}
        </button>
        {nombreArchivo && (
          <span className="ml-3 text-[13px] text-slate-300">
            {nombreArchivo} · {modo === "fleetcheck" ? `${fleetcheck?.vehiculos.length ?? 0} vehículos, ${rows.length} ruedas` : `${rows.length} filas`}
            {modo && <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">{modo === "revisiones" ? "Revisiones" : modo === "checkpoint" ? "CheckPoint" : modo === "fleetcheck" ? "Fleetcheck (TIRETASK)" : modo === "historico" ? "Histórico de albaranes" : "Vehículos"}</span>}
          </span>
        )}
        {modo === "fleetcheck" && (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
            Fecha de las mediciones
            <input id="fleetcheck-fecha" type="date" value={fechaFleetcheck}
              onChange={(e) => { setFechaFleetcheck(e.target.value); setRepFlt(null); setEjecutado(false); }}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[13px] text-slate-100" />
            <span className="text-slate-500">El informe solo trae una fecha, sin hora: es la que llevarán todas las revisiones.</span>
          </label>
        )}
        {rows.length > 0 && modo !== "historico" && (
          <div className="mt-3 flex gap-2">
            <button onClick={analizar} disabled={cargando} className="rounded bg-slate-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
              {cargando && !ejecutado ? "Analizando…" : "Analizar (vista previa)"}
            </button>
            <button onClick={importar} disabled={cargando || !reporte || ejecutado} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
              {cargando && ejecutado ? "Importando…" : "Importar"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      {modo === "historico" && historico && (
        <ImportarHistorico h1={historico.h1} h2={historico.h2} nombreArchivo={nombreArchivo} bytes={historico.bytes} />
      )}
      {soloCargas && modo !== "historico" && (
        <ImportarHistorico h1={[]} h2={[]} nombreArchivo="" bytes={null} />
      )}
      {tacografo && <ImportarTacografo />}
      {ejecutado && reporte && <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">✔ Importación completada.</div>}

      {/* VEHÍCULOS */}
      {modo === "vehiculos" && repVeh && (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <Kpi t="Total" v={repVeh.resumen.total} />
            <Kpi t="A crear" v={repVeh.resumen.crear} tono="text-sky-300" />
            <Kpi t="A actualizar" v={repVeh.resumen.actualizar} tono="text-amber-300" />
            <Kpi t="Errores" v={repVeh.resumen.errores} tono={repVeh.resumen.errores ? "text-rose-300" : "text-emerald-300"} />
          </div>
          <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-slate-300">
            <div>Empresa: <b>{repVeh.empresa}</b>{repVeh.empresaNueva ? " (nueva)" : " (existente)"}</div>
            {repVeh.delegacionesNuevas.length > 0 && <div>Delegaciones nuevas: {repVeh.delegacionesNuevas.join(", ")}</div>}
            {repVeh.configsNuevas.length > 0 && <div>Configuraciones de ejes nuevas: {repVeh.configsNuevas.join(", ")}</div>}
            {repVeh.medidasNuevas.length > 0 && <div>Medidas nuevas: {repVeh.medidasNuevas.join(", ")}</div>}
          </div>
          <TablaFilas filas={repVeh.filas.map((f) => ({ fila: f.fila, ref: f.matricula, accion: f.accion, detalle: f.error || f.avisos.join(" · ") }))} />
        </>
      )}

      {/* REVISIONES */}
      {modo === "revisiones" && repRev && (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi t="Filas" v={repRev.resumen.filas} />
            <Kpi t="Revisiones" v={repRev.resumen.revisiones} tono="text-sky-300" />
            <Kpi t="Mediciones" v={repRev.resumen.detalles} />
            <Kpi t="Neumáticos nuevos" v={repRev.resumen.neumaticosNuevos} tono="text-amber-300" />
            <Kpi t="Errores" v={repRev.resumen.errores} tono={repRev.resumen.errores ? "text-rose-300" : "text-emerald-300"} />
          </div>
          {repRev.empresa && <div className="mb-3 text-[12px] text-slate-400">Empresa: <b>{repRev.empresa}</b></div>}
          {repRev.noEncontrados.length > 0 && (
            <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-200">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos NO encontrados ({repRev.noEncontrados.length}) — impórtalos antes con la plantilla de Vehículos</div>
              <div className="font-mono text-[11px] text-rose-100">{repRev.noEncontrados.join(", ")}</div>
            </div>
          )}
          {repRev.sinPosiciones.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos SIN tipo/posiciones ({repRev.sinPosiciones.length}) — asígnales un tipo con posiciones</div>
              <div className="font-mono text-[11px] text-amber-100">{repRev.sinPosiciones.join(", ")}</div>
            </div>
          )}
          {repRev.avisos.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px] text-slate-400">Avisos ({repRev.avisos.length})</div>
              {repRev.avisos.slice(0, 20).map((a, i) => <div key={i}>· {a}</div>)}
              {repRev.avisos.length > 20 && <div className="text-slate-500">…y {repRev.avisos.length - 20} más</div>}
            </div>
          )}
          {repRev.errores.length > 0 && (
            <TablaFilas filas={repRev.errores.map((e) => ({ fila: e.fila, ref: e.matricula, accion: "error" as const, detalle: e.error }))} />
          )}
        </>
      )}

      {modo === "fleetcheck" && repFlt && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi t="Vehículos del informe" v={repFlt.vehiculos} />
            <Kpi t={ejecutado ? "Revisiones creadas" : "Revisiones a crear"} v={repFlt.rev.resumen.revisiones} tono="text-sky-300" />
            <Kpi t="Mediciones" v={repFlt.rev.resumen.detalles} />
            <Kpi t="Ruedas sin neumático" v={(repFlt.rev.sinNeumatico ?? []).reduce((s, x) => s + x.posiciones.length, 0)} tono="text-amber-300" />
            <Kpi t="Ya revisados ese día" v={(repFlt.rev.yaRevisados ?? []).length} tono="text-slate-400" />
          </div>
          {repFlt.rev.empresa && <div className="mb-3 text-[12px] text-slate-400">Empresa: <b>{repFlt.rev.empresa}</b></div>}
          <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-slate-300">
            Se guarda la <b>menor</b> de las lecturas de profundidad de cada rueda y la presión del informe. No se crea ni se cambia ningún neumático ni montaje.
            Los kilómetros no se cogen del informe: la revisión nace sin ellos y se piden a la telemática en el relleno diario.
          </div>
          {avanceAltas && <div className="mb-3 text-[12px] text-sky-300">{avanceAltas}</div>}
          {resAltas && (
            <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-[12px] text-emerald-100">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos dados de alta ({resAltas.hechas.length})</div>
              <div className="font-mono text-[11px]">{resAltas.hechas.join(", ") || "Ninguno"}</div>
              {resAltas.fallos.length > 0 && (
                <div className="mt-2 text-rose-200">
                  <div className="font-bold uppercase text-[11px]">No se han podido dar de alta ({resAltas.fallos.length})</div>
                  {resAltas.fallos.map((f) => <div key={f.matricula}>· {f.matricula}: {f.error}</div>)}
                </div>
              )}
              {resAltas.avisos.map((a, i) => <div key={i} className="mt-1 text-amber-200">· {a}</div>)}
            </div>
          )}
          {altas.length > 0 && !ejecutado && (
            <div className="mb-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-[12px] text-sky-100">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos sin plano ({altas.length})</div>
              <table className="mb-2 w-full text-left text-[11px]">
                <thead className="text-slate-400"><tr><th className="py-1 pr-3">Matrícula</th><th className="pr-3">Ejes en el informe</th><th className="pr-3">Tipo que se le pondría</th><th>Ruedas</th></tr></thead>
                <tbody>
                  {altas.map((a) => (
                    <tr key={a.matricula} className="border-t border-slate-700/60">
                      <td className="py-1 pr-3 font-mono">{a.matricula}</td>
                      <td className="pr-3">{a.firma}</td>
                      <td className="pr-3">{a.motivo ? <span className="text-amber-300">{a.motivo}</span> : a.tipoNombre}</td>
                      <td>{a.ruedas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {altas.some((a) => !a.motivo) && (
                <label className="flex items-start gap-2">
                  <input id="fleetcheck-altas" type="checkbox" className="mt-0.5" checked={hacerAltas} onChange={(e) => setHacerAltas(e.target.checked)} />
                  <span>
                    <b>Dar de alta estos vehículos con los datos del informe.</b> Se les pone el tipo y se crea el neumático de cada posición como carga inicial (sin descontar stock), con su marca, modelo, medida, profundidad y presión. Quedan sin número de serie ni DOT, que el informe no trae. Si no lo marcas, estos vehículos no se importan.
                  </span>
                </label>
              )}
            </div>
          )}
          {repFlt.rev.noEncontrados.length > 0 && (
            <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-200">
              <div className="mb-1 font-bold uppercase text-[11px]">Matrículas que no están en TyreControl ({repFlt.rev.noEncontrados.length}) — no se importan</div>
              <div className="font-mono text-[11px] text-rose-100">{repFlt.rev.noEncontrados.join(", ")}</div>
            </div>
          )}
          {repFlt.rev.sinPosiciones.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos sin plano de posiciones ({repFlt.rev.sinPosiciones.length}) — no se importan</div>
              <div className="font-mono text-[11px] text-amber-100">{repFlt.rev.sinPosiciones.join(", ")}</div>
            </div>
          )}
          {(repFlt.rev.sinNeumatico ?? []).length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px]">Ruedas medidas que no tienen neumático montado en TyreControl — no se importan</div>
              {(repFlt.rev.sinNeumatico ?? []).map((x) => (
                <div key={x.matricula} className="font-mono text-[11px] text-amber-100">{x.matricula}: {x.posiciones.join(", ")}</div>
              ))}
            </div>
          )}
          {(repFlt.rev.yaRevisados ?? []).length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-slate-300">
              <div className="mb-1 font-bold uppercase text-[11px] text-slate-400">Ya tenían una revisión ese día — no se tocan</div>
              <div className="font-mono text-[11px]">{(repFlt.rev.yaRevisados ?? []).join(", ")}</div>
            </div>
          )}
          {repFlt.medidasDistintas.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px]">La medida del informe no es la del neumático montado ({repFlt.medidasDistintas.length}) — se importa igual, conviene mirarlo</div>
              {repFlt.medidasDistintas.slice(0, 30).map((a, i) => <div key={i}>· {a}</div>)}
              {repFlt.medidasDistintas.length > 30 && <div className="text-amber-300/70">…y {repFlt.medidasDistintas.length - 30} más</div>}
            </div>
          )}
          {repFlt.avisos.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-amber-200">
              <div className="mb-1 font-bold uppercase text-[11px] text-slate-400">Avisos ({repFlt.avisos.length})</div>
              {repFlt.avisos.slice(0, 20).map((a, i) => <div key={i}>· {a}</div>)}
              {repFlt.avisos.length > 20 && <div className="text-slate-500">…y {repFlt.avisos.length - 20} más</div>}
            </div>
          )}
        </>
      )}

      {modo === "checkpoint" && repChk && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi t="Mediciones nuevas" v={repChk.mediciones} tono="text-sky-300" />
            <Kpi t="Revisiones" v={repChk.rev.resumen.revisiones} />
            <Kpi t="Altas de vehículo" v={repChk.altas.length} tono="text-emerald-300" />
            <Kpi t="Ya cargados" v={repChk.yaCargados.length} tono="text-slate-400" />
            <Kpi t="Sin cruzar el arco" v={repChk.sinMedir.length} tono="text-amber-300" />
          </div>
          {repChk.rev.empresa && <div className="mb-3 text-[12px] text-slate-400">Empresa: <b>{repChk.rev.empresa}</b></div>}
          {repChk.altas.length > 0 && (
            <div className="mb-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3">
              <div className="mb-1 font-bold uppercase text-[11px]">Vehículos que se dan de alta ({repChk.altas.length})</div>
              <div className="font-mono text-[11px] text-emerald-100">{repChk.altas.join(", ")}</div>
            </div>
          )}
          {repChk.rev.sinPosiciones.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-800 bg-amber-950/40 p-3">
              <div className="mb-1 font-bold uppercase text-[11px]">Sin tipo con posiciones ({repChk.rev.sinPosiciones.length})</div>
              <div className="font-mono text-[11px] text-amber-100">{repChk.rev.sinPosiciones.join(", ")}</div>
            </div>
          )}
          {repChk.avisos.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-900 p-3 text-[12px] text-slate-300">
              <div className="mb-1 font-bold uppercase text-[11px] text-slate-400">Avisos ({repChk.avisos.length})</div>
              {repChk.avisos.slice(0, 20).map((a, i) => <div key={i}>· {a}</div>)}
              {repChk.avisos.length > 20 && <div className="text-slate-500">…y {repChk.avisos.length - 20} más</div>}
            </div>
          )}
        </>
      )}

      <div className="mt-3 text-[11px] text-slate-500">
        CheckPoint: el informe es una foto de la última medición de cada vehículo, así que solo se carga lo medido después de lo que ya hay. Se guarda la hora real y las mediciones quedan marcadas como del arco, no de un técnico.
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Revisiones: se agrupan por matrícula + fecha. El vehículo debe existir y tener un tipo con posiciones. Si un neumático no tiene serie/RFID, se crea uno genérico por posición. Re-importar actualiza (no duplica).
      </div>
    </div>
  );
}

function Kpi({ t, v, tono = "text-slate-100" }: { t: string; v: number; tono?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="text-[10px] font-bold uppercase text-slate-400">{t}</div>
      <div className={`mt-1 text-2xl font-black ${tono}`}>{v}</div>
    </div>
  );
}

function TablaFilas({ filas }: { filas: { fila: number; ref: string; accion: "crear" | "actualizar" | "error"; detalle: string }[] }) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Detalle</div>
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Fila</th><th className={thCls}>Referencia</th><th className={thCls}>Acción</th><th className={thCls}>Detalle</th>
        </tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-500"}>{f.fila}</td>
              <td className={tdCls + " font-semibold text-slate-200"}>{f.ref || "—"}</td>
              <td className={tdCls}>
                <span className={f.accion === "error" ? "text-rose-300" : f.accion === "crear" ? "text-sky-300" : "text-amber-300"}>
                  {f.accion === "error" ? "Error" : f.accion === "crear" ? "Crear" : "Actualizar"}
                </span>
              </td>
              <td className={tdCls + " text-slate-400"}>{f.detalle || "—"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
