import { useEffect, useState } from "react";
import { obtenerUmbralesEmpresa, guardarUmbralesEmpresa } from "../services/data";
import { inputCls, Field } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Umbrales de profundidad de una empresa. Alimentan el estado de flota, las
// alertas y (en el futuro) la app del técnico. Si no hay fila guardada se
// muestran los valores legales por defecto (1,6 / 3,0 mm).
export default function UmbralesEmpresa({ empresaId }: { empresaId: string }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [minimo, setMinimo] = useState("1.6");
  const [aviso, setAviso] = useState("3.0");
  const [tolerancia, setTolerancia] = useState("0.5");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    obtenerUmbralesEmpresa(empresaId).then((u) => {
      if (!u) return;
      setMinimo(String(u.profundidad_minima_mm));
      setAviso(String(u.profundidad_aviso_mm));
      setTolerancia(String(u.presion_tolerancia_bar));
    }).catch(() => {});
  }, [empresaId]);

  async function guardar() {
    setGuardando(true); setMsg("");
    try {
      await guardarUmbralesEmpresa(empresaId, {
        profundidad_minima_mm: Number(minimo.replace(",", ".")),
        profundidad_aviso_mm: Number(aviso.replace(",", ".")),
        presion_tolerancia_bar: Number(tolerancia.replace(",", ".")),
      });
      setMsg("✔ Umbrales guardados");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Umbrales de profundidad</div>
      <div className="mb-3 text-[11px] text-slate-500">Definen el semáforo del estado de flota y las alertas. Si no se guardan, se usan los valores legales por defecto (1,6 / 3,0 mm).</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Mínimo legal (mm)"><input type="number" step="0.1" className={inputCls} value={minimo} disabled={!puedeEditar} onChange={(e) => setMinimo(e.target.value)} /></Field>
        <Field label="Aviso / próximo cambio (mm)"><input type="number" step="0.1" className={inputCls} value={aviso} disabled={!puedeEditar} onChange={(e) => setAviso(e.target.value)} /></Field>
        <Field label="Tolerancia de presión (bar)"><input type="number" step="0.1" className={inputCls} value={tolerancia} disabled={!puedeEditar} onChange={(e) => setTolerancia(e.target.value)} /></Field>
      </div>
      {puedeEditar && (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={guardar} disabled={guardando} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar umbrales"}
          </button>
          {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
