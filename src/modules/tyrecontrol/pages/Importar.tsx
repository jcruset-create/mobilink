import { useState } from "react";
import * as XLSX from "xlsx";
import { importVehiculos, type ReporteImport } from "../services/importVehiculos";
import { TableWrap, tdCls, thCls } from "../components/ui";

export default function Importar() {
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [reporte, setReporte] = useState<ReporteImport | null>(null);
  const [ejecutado, setEjecutado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function onArchivo(file: File | undefined) {
    if (!file) return;
    setError(""); setReporte(null); setEjecutado(false); setRows([]); setNombreArchivo(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets["Vehiculos"] ?? wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
      const validas = data.filter((r) => String(r.matricula ?? "").trim());
      if (validas.length === 0) throw new Error("No se han encontrado filas con 'matricula'. ¿Es la plantilla de Vehículos?");
      setRows(validas);
    } catch (e: any) { setError(e?.message || "No se pudo leer el archivo"); }
  }

  async function analizar() {
    setCargando(true); setError(""); setEjecutado(false);
    try { setReporte(await importVehiculos(rows, false)); }
    catch (e: any) { setError(e?.message || "Error al analizar"); }
    finally { setCargando(false); }
  }

  async function importar() {
    if (!window.confirm(`Vas a importar ${rows.length} vehículos. ¿Continuar?`)) return;
    setCargando(true); setError("");
    try { setReporte(await importVehiculos(rows, true)); setEjecutado(true); }
    catch (e: any) { setError(e?.message || "Error al importar"); }
    finally { setCargando(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Importar</h1>
      <p className="mb-3 text-sm text-slate-400">Importación de vehículos desde la plantilla Excel (hoja «Vehiculos»).</p>

      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300">
          📁 Elegir archivo Excel
          <input type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(e) => onArchivo(e.target.files?.[0])} />
        </label>
        {nombreArchivo && <span className="ml-3 text-[13px] text-slate-300">{nombreArchivo} · {rows.length} filas</span>}

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

      {reporte && (
        <>
          {ejecutado && <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">✔ Importación completada.</div>}

          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <Kpi t="Total" v={reporte.resumen.total} />
            <Kpi t="A crear" v={reporte.resumen.crear} tono="text-sky-300" />
            <Kpi t="A actualizar" v={reporte.resumen.actualizar} tono="text-amber-300" />
            <Kpi t="Errores" v={reporte.resumen.errores} tono={reporte.resumen.errores ? "text-rose-300" : "text-emerald-300"} />
          </div>

          <div className="mb-3 rounded-lg bg-slate-800 p-3 text-[12px] text-slate-300">
            <div className="mb-1 font-bold uppercase text-[11px] text-slate-400">Se {ejecutado ? "han creado" : "crearán"} estos catálogos</div>
            <div>Empresa: <b>{reporte.empresa}</b>{reporte.empresaNueva ? " (nueva)" : " (existente)"}</div>
            {reporte.delegacionesNuevas.length > 0 && <div>Delegaciones nuevas: {reporte.delegacionesNuevas.join(", ")}</div>}
            {reporte.configsNuevas.length > 0 && <div>Configuraciones de ejes nuevas: {reporte.configsNuevas.join(", ")}</div>}
            {reporte.medidasNuevas.length > 0 && <div>Medidas nuevas: {reporte.medidasNuevas.join(", ")}</div>}
            {reporte.delegacionesNuevas.length === 0 && reporte.configsNuevas.length === 0 && reporte.medidasNuevas.length === 0 && <div className="text-slate-500">Ninguno (todo existente).</div>}
          </div>

          <div className="rounded-lg bg-slate-800 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Detalle por fila</div>
            <TableWrap>
              <thead className="bg-slate-900"><tr>
                <th className={thCls}>Fila</th><th className={thCls}>Matrícula</th><th className={thCls}>Acción</th><th className={thCls}>Avisos</th>
              </tr></thead>
              <tbody>
                {reporte.filas.map((f, i) => (
                  <tr key={i} className="border-t border-slate-700/60">
                    <td className={tdCls + " text-slate-500"}>{f.fila}</td>
                    <td className={tdCls + " font-semibold text-slate-200"}>{f.matricula || "—"}</td>
                    <td className={tdCls}>
                      <span className={f.accion === "error" ? "text-rose-300" : f.accion === "crear" ? "text-sky-300" : "text-amber-300"}>
                        {f.accion === "error" ? "Error" : f.accion === "crear" ? "Crear" : "Actualizar"}
                      </span>
                    </td>
                    <td className={tdCls + " text-slate-400"}>{f.error ? <span className="text-rose-300">{f.error}</span> : f.avisos.join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}

      <div className="mt-3 text-[11px] text-slate-500">
        Se agrupa por matrícula: si el vehículo ya existe se actualiza, si no se crea. Las delegaciones, configuraciones de ejes y medidas que falten se crean automáticamente.
        Los tipos de vehículo y de llanta se enlazan si coinciden por nombre; si no, el vehículo se importa sin ellos (revisa los avisos).
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
