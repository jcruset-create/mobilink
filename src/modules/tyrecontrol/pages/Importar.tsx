import { useState } from "react";
import * as XLSX from "xlsx";
import { importVehiculos, type ReporteImport } from "../services/importVehiculos";
import { importRevisiones, type ReporteRev } from "../services/importRevisiones";
import { TableWrap, tdCls, thCls } from "../components/ui";

type Modo = "vehiculos" | "revisiones";

export default function Importar() {
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [modo, setModo] = useState<Modo | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [repVeh, setRepVeh] = useState<ReporteImport | null>(null);
  const [repRev, setRepRev] = useState<ReporteRev | null>(null);
  const [ejecutado, setEjecutado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  function reset() { setRepVeh(null); setRepRev(null); setEjecutado(false); setRows([]); setModo(null); setError(""); }

  async function onArchivo(file: File | undefined) {
    if (!file) return;
    reset(); setNombreArchivo(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
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
      else setRepRev(await importRevisiones(rows, false));
    } catch (e: any) { setError(e?.message || "Error al analizar"); } finally { setCargando(false); }
  }

  async function importar() {
    const n = modo === "revisiones" ? (repRev?.resumen.revisiones ?? 0) : rows.length;
    if (!window.confirm(`Vas a importar ${modo === "revisiones" ? rows.length + " filas de revisión" : n + " vehículos"}. ¿Continuar?`)) return;
    setCargando(true); setError("");
    try {
      if (modo === "vehiculos") setRepVeh(await importVehiculos(rows, true));
      else setRepRev(await importRevisiones(rows, true));
      setEjecutado(true);
    } catch (e: any) { setError(e?.message || "Error al importar"); } finally { setCargando(false); }
  }

  const reporte = modo === "vehiculos" ? repVeh : repRev;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Importar</h1>
      <p className="mb-3 text-sm text-slate-400">Importación desde plantilla Excel. Detecta automáticamente si es de Vehículos o de Revisiones.</p>

      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300">
          📁 Elegir archivo Excel
          <input type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(e) => onArchivo(e.target.files?.[0])} />
        </label>
        {nombreArchivo && (
          <span className="ml-3 text-[13px] text-slate-300">
            {nombreArchivo} · {rows.length} filas
            {modo && <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">{modo === "revisiones" ? "Revisiones" : "Vehículos"}</span>}
          </span>
        )}
        {rows.length > 0 && (
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

      <div className="mt-3 text-[11px] text-slate-500">
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
