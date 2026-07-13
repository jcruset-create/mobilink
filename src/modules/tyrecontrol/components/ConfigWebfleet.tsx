import { useEffect, useState } from "react";
import { obtenerWebfleetSyncConfig, guardarWebfleetSyncConfig, sincronizarWebfleet } from "../services/data";
import { inputCls, Field } from "./ui";

// Configuración del módulo "vehículos en base" (Webfleet).
export default function ConfigWebfleet() {
  const [intervalo, setIntervalo] = useState("5");
  const [minBase, setMinBase] = useState("10");
  const [antiguedad, setAntiguedad] = useState("30");
  const [alertas, setAlertas] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    obtenerWebfleetSyncConfig().then((c) => {
      if (!c) return;
      setIntervalo(String(c.intervalo_min));
      setMinBase(String(c.min_tiempo_base_min));
      setAntiguedad(String(c.antiguedad_max_pos_min));
      setAlertas(c.alertas_activas);
    }).catch(() => {});
  }, []);

  async function guardar() {
    setSaving(true); setMsg("");
    try {
      await guardarWebfleetSyncConfig({
        intervalo_min: Math.max(1, Number(intervalo) || 5),
        min_tiempo_base_min: Math.max(0, Number(minBase) || 0),
        antiguedad_max_pos_min: Math.max(1, Number(antiguedad) || 30),
        alertas_activas: alertas,
      });
      setMsg("✔ Configuración guardada");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setSaving(false); }
  }

  async function sincronizar() {
    setSincronizando(true); setMsg("");
    try {
      const r = await sincronizarWebfleet();
      setMsg(r.error ? `Webfleet: ${r.error}` : `✔ Sincronizado (${r.actualizados ?? 0} vehículos)`);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSincronizando(false); }
  }

  return (
    <div className="mb-4 rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Vehículos en base (Webfleet)</div>
      <div className="mb-3 text-[11px] text-slate-500">
        Cada cuánto se consulta la posición y con qué criterios se considera que un vehículo está en base. Las bases (geo-zonas) se definen en cada delegación.
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Sincronizar cada (min)"><input type="number" className={inputCls} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} /></Field>
        <Field label="Tiempo mín. en base (min)"><input type="number" className={inputCls} value={minBase} onChange={(e) => setMinBase(e.target.value)} /></Field>
        <Field label="Antigüedad máx. posición (min)"><input type="number" className={inputCls} value={antiguedad} onChange={(e) => setAntiguedad(e.target.value)} /></Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
        <input type="checkbox" checked={alertas} onChange={(e) => setAlertas(e.target.checked)} />
        Generar avisos al entrar un vehículo en base con revisión pendiente
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={guardar} disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
        <button onClick={sincronizar} disabled={sincronizando} className="rounded border border-sky-600 px-3 py-1.5 text-[12px] font-bold text-sky-300 disabled:opacity-50">{sincronizando ? "Sincronizando…" : "↻ Sincronizar ahora"}</button>
        {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
      </div>
    </div>
  );
}
