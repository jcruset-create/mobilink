import { useEffect, useState } from "react";
import { obtenerWebfleetConfig, guardarWebfleetConfig } from "../services/data";
import { inputCls, Field } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Credenciales de Webfleet de UN cliente (empresa). Cada cliente tiene su
// propia cuenta/API. Cuando estén rellenas, el backend podrá sincronizar km
// y posición de los vehículos de esta empresa (enlazados por su Webfleet ID).
export default function WebfleetEmpresa({ empresaId }: { empresaId: string }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [account, setAccount] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apikey, setApikey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://csv.webfleet.com/extern");
  const [activo, setActivo] = useState(true);
  const [configurado, setConfigurado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    obtenerWebfleetConfig(empresaId).then((c) => {
      if (!c) return;
      setConfigurado(!!c.account);
      setAccount(c.account ?? "");
      setUsername(c.username ?? "");
      setBaseUrl(c.base_url ?? "https://csv.webfleet.com/extern");
      setActivo(c.activo);
      // La contraseña y la API key NO se traen: se escriben, no se leen.
      // Se quedan en blanco y, si se dejan así, conservan su valor guardado.
    }).catch(() => {});
  }, [empresaId]);

  async function guardar() {
    setGuardando(true); setMsg("");
    try {
      // Un secreto en blanco significa «déjalo como está», no «bórralo»: si se
      // enviara null, abrir la pantalla y pulsar Guardar borraría la contraseña
      // del cliente sin que nadie lo pidiera. Para vaciarlo de verdad está el
      // interruptor de integración activa.
      await guardarWebfleetConfig(empresaId, {
        account: account.trim() || null, username: username.trim() || null,
        base_url: baseUrl.trim() || "https://csv.webfleet.com/extern", activo,
        ...(password.trim() ? { password: password.trim() } : {}),
        ...(apikey.trim() ? { apikey: apikey.trim() } : {}),
      });
      setConfigurado(!!account.trim());
      setPassword(""); setApikey("");
      setMsg("✔ Credenciales de Webfleet guardadas");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 flex items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Integración Webfleet</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${configurado ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>
          {configurado ? "Configurado" : "Sin configurar"}
        </span>
      </div>
      <div className="mb-3 text-[11px] text-slate-500">
        Credenciales de la cuenta Webfleet de este cliente (WEBFLEET.connect). Cuando estén rellenas, se podrán sincronizar los km y la posición de sus vehículos
        (cada vehículo debe tener su «Webfleet Vehicle ID» en su ficha). La contraseña y la API key no se muestran: escríbelas solo si quieres cambiarlas.
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Account"><input className={inputCls} value={account} disabled={!puedeEditar} onChange={(e) => setAccount(e.target.value)} placeholder="cuenta Webfleet del cliente" /></Field>
        <Field label="Usuario (API)"><input className={inputCls} value={username} disabled={!puedeEditar} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Contraseña (API)"><input type="password" autoComplete="new-password" className={inputCls} value={password} disabled={!puedeEditar} onChange={(e) => setPassword(e.target.value)} placeholder="sin cambios" /></Field>
        <Field label="API key"><input type="password" autoComplete="off" className={inputCls} value={apikey} disabled={!puedeEditar} onChange={(e) => setApikey(e.target.value)} placeholder="sin cambios" /></Field>
        <Field label="Base URL"><input className={inputCls} value={baseUrl} disabled={!puedeEditar} onChange={(e) => setBaseUrl(e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[12px] text-slate-300">
          <input type="checkbox" checked={activo} disabled={!puedeEditar} onChange={(e) => setActivo(e.target.checked)} />
          Integración activa
        </label>
      </div>

      {puedeEditar && (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={guardar} disabled={guardando} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar credenciales"}
          </button>
          {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
