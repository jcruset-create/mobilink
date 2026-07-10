import { useEffect, useState } from "react";
import {
  obtenerUmbralesEmpresa, guardarUmbralesEmpresa,
  listarUmbralesMedida, guardarUmbralMedida, eliminarUmbralMedida, listarMedidas,
} from "../services/data";
import type { UmbralMedida, MedidaNeumatico } from "../types";
import { inputCls, Field, TableWrap, tdCls, thCls } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Umbrales de profundidad de una empresa. Cascada al clasificar cada neumático:
// override por medida → defecto de la empresa → valores legales (1,6/3,0 mm).
// Alimentan el estado de flota, las alertas y (futuro) la app del técnico.
export default function UmbralesEmpresa({ empresaId }: { empresaId: string }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  // Defecto de empresa
  const [minimo, setMinimo] = useState("1.6");
  const [aviso, setAviso] = useState("3.0");
  const [tolerancia, setTolerancia] = useState("0.5");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  // Overrides por medida
  const [overrides, setOverrides] = useState<UmbralMedida[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [nuevoMin, setNuevoMin] = useState("");
  const [nuevoAviso, setNuevoAviso] = useState("");

  async function cargar() {
    const [u, ov, meds] = await Promise.all([
      obtenerUmbralesEmpresa(empresaId).catch(() => null),
      listarUmbralesMedida(empresaId).catch(() => [] as UmbralMedida[]),
      listarMedidas().catch(() => [] as MedidaNeumatico[]),
    ]);
    if (u) {
      setMinimo(String(u.profundidad_minima_mm));
      setAviso(String(u.profundidad_aviso_mm));
      setTolerancia(String(u.presion_tolerancia_bar));
    }
    setOverrides(ov);
    setMedidas(meds);
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [empresaId]);

  const num = (s: string) => Number(s.replace(",", "."));

  async function guardarDefecto() {
    setGuardando(true); setMsg("");
    try {
      await guardarUmbralesEmpresa(empresaId, {
        profundidad_minima_mm: num(minimo), profundidad_aviso_mm: num(aviso), presion_tolerancia_bar: num(tolerancia),
      });
      setMsg("✔ Umbrales por defecto guardados");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  async function anadirOverride() {
    if (!nuevaMedida || !nuevoMin || !nuevoAviso) return;
    setMsg("");
    try {
      await guardarUmbralMedida(empresaId, nuevaMedida, { profundidad_minima_mm: num(nuevoMin), profundidad_aviso_mm: num(nuevoAviso) });
      setNuevaMedida(""); setNuevoMin(""); setNuevoAviso("");
      setOverrides(await listarUmbralesMedida(empresaId));
    } catch (e: any) { setMsg(e?.message || "Error al guardar la medida"); }
  }

  async function borrarOverride(medida: string) {
    if (!window.confirm(`¿Eliminar el umbral específico de la medida ${medida}?`)) return;
    await eliminarUmbralMedida(empresaId, medida);
    setOverrides(await listarUmbralesMedida(empresaId));
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Umbrales de profundidad</div>
      <div className="mb-3 text-[11px] text-slate-500">
        Definen el semáforo del estado de flota y las alertas. Cada neumático usa: umbral de su medida → defecto de la empresa → valores legales (1,6/3,0 mm).
      </div>

      {/* Defecto de empresa */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Mínimo legal por defecto (mm)"><input type="number" step="0.1" className={inputCls} value={minimo} disabled={!puedeEditar} onChange={(e) => setMinimo(e.target.value)} /></Field>
        <Field label="Aviso por defecto (mm)"><input type="number" step="0.1" className={inputCls} value={aviso} disabled={!puedeEditar} onChange={(e) => setAviso(e.target.value)} /></Field>
        <Field label="Tolerancia de presión (bar)"><input type="number" step="0.1" className={inputCls} value={tolerancia} disabled={!puedeEditar} onChange={(e) => setTolerancia(e.target.value)} /></Field>
      </div>
      {puedeEditar && (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={guardarDefecto} disabled={guardando} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar por defecto"}
          </button>
          {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
        </div>
      )}

      {/* Overrides por medida */}
      <div className="mt-4 mb-2 text-[11px] font-bold uppercase text-slate-400">Umbrales específicos por medida</div>
      <div className="mb-2 text-[11px] text-slate-500">Ej.: 295/80R22.5 (camión) admite más desgaste que 195/75R16 (furgoneta). Lo que no tenga medida propia usa el defecto de arriba.</div>

      {puedeEditar && (
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px]">
            <div className="mb-1 text-[11px] text-slate-400">Medida</div>
            <select className={inputCls} value={nuevaMedida} onChange={(e) => setNuevaMedida(e.target.value)}>
              <option value="">Selecciona…</option>
              {medidas.map((m) => <option key={m.id} value={m.valor}>{m.valor}</option>)}
            </select>
          </div>
          <div className="w-28"><div className="mb-1 text-[11px] text-slate-400">Mínimo (mm)</div><input type="number" step="0.1" className={inputCls} value={nuevoMin} onChange={(e) => setNuevoMin(e.target.value)} /></div>
          <div className="w-28"><div className="mb-1 text-[11px] text-slate-400">Aviso (mm)</div><input type="number" step="0.1" className={inputCls} value={nuevoAviso} onChange={(e) => setNuevoAviso(e.target.value)} /></div>
          <button onClick={anadirOverride} className="rounded bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white">Añadir / actualizar</button>
        </div>
      )}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Medida</th><th className={thCls}>Mínimo (mm)</th><th className={thCls}>Aviso (mm)</th><th className={thCls}></th>
        </tr></thead>
        <tbody>
          {overrides.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Sin umbrales específicos. Todas las medidas usan el defecto de la empresa.</td></tr>
          : overrides.map((o) => (
            <tr key={o.medida} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold text-slate-200"}>{o.medida}</td>
              <td className={tdCls + " text-slate-300"}>{o.profundidad_minima_mm}</td>
              <td className={tdCls + " text-slate-300"}>{o.profundidad_aviso_mm}</td>
              <td className={tdCls}>{puedeEditar && <button onClick={() => borrarOverride(o.medida)} className="text-rose-400 hover:underline">Eliminar</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
