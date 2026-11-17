/**
 * Configuración · catálogo · Importar Excel.
 *
 * Se sube el Excel de un fabricante, se ve qué falta —marcas, medidas, índices
 * de carga, códigos de velocidad y modelos— y lo que ya está, y se importa con
 * un botón. Nada se repite y no se crean combinaciones: esas nacen al dar de
 * alta un neumático. La lógica está en `services/importarCatalogo.ts`.
 */
import { useState } from "react";
import * as XLSX from "xlsx";
import { aplicarImportacionCatalogo } from "../services/data";
import {
  elegirHoja, planificar, planVacio, type CatalogoActual, type FilaCatalogo, type PlanImportacion,
} from "../services/importarCatalogo";

type Tipo = "furgoneta" | "camion" | "turismo";

function Lista({ titulo, items, vacio }: { titulo: string; items: string[]; vacio: string }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-2">
      <div className="mb-1 text-[10px] font-bold uppercase text-slate-400">{titulo} · {items.length}</div>
      {items.length === 0 ? <div className="text-[11px] text-slate-500">{vacio}</div> : (
        <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {items.map((x) => <span key={x} className="rounded-full bg-emerald-950 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-800">{x}</span>)}
        </div>
      )}
    </div>
  );
}

export default function ImportarCatalogo({ catalogo, onImportado }: {
  catalogo: CatalogoActual;
  onImportado: () => void;
}) {
  const [archivo, setArchivo] = useState("");
  const [hoja, setHoja] = useState("");
  const [filas, setFilas] = useState<FilaCatalogo[]>([]);
  const [tipo, setTipo] = useState<Tipo>("furgoneta");
  const [msg, setMsg] = useState("");
  const [importando, setImportando] = useState(false);

  // El plan se calcula contra el catálogo de ahora: si se importa, al recargar
  // el catálogo sale vacío y el botón se apaga solo.
  const plan: PlanImportacion | null = filas.length ? planificar(filas, catalogo) : null;

  async function leer(f: File | undefined) {
    setMsg(""); setFilas([]); setHoja("");
    if (!f) return;
    setArchivo(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const hojas = Object.fromEntries(wb.SheetNames.map((n) =>
        [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }) as Record<string, unknown>[]]));
      const elegida = elegirHoja(hojas);
      if (!elegida) {
        setMsg("No encuentro ninguna hoja con medida, índice de carga y velocidad.");
        return;
      }
      setHoja(elegida.nombre);
      setFilas(elegida.filas);
      // Con eje (dirección, tracción) es de camión; si no, de furgoneta.
      setTipo(elegida.filas.some((x) => x.eje) ? "camion" : "furgoneta");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? `No se ha podido leer el Excel: ${e.message}` : "No se ha podido leer el Excel");
    }
  }

  async function importar() {
    if (!plan) return;
    setImportando(true); setMsg("");
    try {
      const r = await aplicarImportacionCatalogo(plan, tipo);
      setMsg(`✔ Importado: ${r.marcas} marcas, ${r.medidas} medidas, ${r.indices} índices de carga, ${r.velocidades} códigos de velocidad y ${r.modelos} modelos.`);
      onImportado();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setImportando(false);
    }
  }

  const incompletas = filas.filter((f) => !f.simple || !f.cv).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-slate-400">
        Sube el Excel de un fabricante (una fila por modelo, medida, índice de carga y velocidad). Se añaden las marcas,
        medidas, índices, velocidades y modelos que falten; lo que ya está no se repite. Las combinaciones no se crean:
        nacen al dar de alta un neumático.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="cat-importar-excel" className="text-[11px] text-slate-400">Excel del fabricante</label>
          <input id="cat-importar-excel" type="file" accept=".xlsx,.xls"
            onChange={(e) => void leer(e.target.files?.[0])}
            className="text-[12px] text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-sky-700 file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-white" />
        </div>
        {plan && (
          <div className="flex flex-col gap-1">
            <label htmlFor="cat-importar-tipo" className="text-[11px] text-slate-400">Las medidas y modelos nuevos son de</label>
            <select id="cat-importar-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px]">
              <option value="furgoneta">Furgoneta</option>
              <option value="camion">Camión</option>
              <option value="turismo">Turismo</option>
            </select>
          </div>
        )}
      </div>

      {plan && (
        <>
          <div className="text-[12px] text-slate-300">
            <b>{archivo}</b> · hoja «{hoja}» · {filas.length} filas
            {incompletas > 0 && <span className="text-amber-300"> · {incompletas} sin índice o velocidad válidos (se usan sus medidas y modelos)</span>}
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <Lista titulo="Marcas nuevas" items={plan.marcas} vacio="Ninguna: ya están todas" />
            <Lista titulo="Medidas nuevas" items={plan.medidas} vacio="Ninguna: ya están todas" />
            <Lista titulo="Índices de carga nuevos" items={plan.indices} vacio="Ninguno: ya están todos" />
            <Lista titulo="Códigos de velocidad nuevos" items={plan.velocidades} vacio="Ninguno: ya están todos" />
            <Lista titulo="Modelos nuevos" items={plan.modelos.map((m) => `${m.marca} ${m.nombre}`)} vacio="Ninguno: ya están todos" />
          </div>
          <div className="text-[11px] text-slate-500">
            Ya estaban y no se repiten: {plan.yaEstaban.medidas} medidas, {plan.yaEstaban.indices} índices,{" "}
            {plan.yaEstaban.velocidades} velocidades y {plan.yaEstaban.modelos} modelos.
          </div>
          <div>
            <button type="button" onClick={() => void importar()} disabled={importando || planVacio(plan)}
              className="rounded bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
              {importando ? "Importando…" : planVacio(plan) ? "Nada que importar" : "Importar al catálogo"}
            </button>
          </div>
        </>
      )}

      {msg && <div className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</div>}
    </div>
  );
}
