import { useEffect, useState } from "react";
import {
  obtenerWebfleetConfig, guardarWebfleetConfig, obtenerEstadoWebfleet,
  type EstadoWebfleet, type OrigenCredencialesWebfleet,
} from "../services/data";
import { inputCls, Field } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Cómo se llama cada procedencia para una persona, y cómo se pinta.
//
// Importa distinguirlas porque durante la migración al gestor de secretos hay
// clientes en cada estado, y «funciona» no quiere decir «ya está migrado»:
// un cliente puede estar tirando de la cuenta global de la casa sin que nadie
// se haya dado cuenta.
const ORIGEN: Record<OrigenCredencialesWebfleet, { texto: string; clase: string; nota: string }> = {
  secretos: {
    texto: "Gestor de secretos",
    clase: "bg-emerald-500/20 text-emerald-300",
    nota: "Sus credenciales están fuera de la base de datos. Es el destino.",
  },
  tabla: {
    texto: "Base de datos",
    clase: "bg-amber-500/20 text-amber-300",
    nota: "Credenciales propias, pero guardadas en la base. Pendiente de migrar al gestor.",
  },
  globales: {
    texto: "Cuenta global",
    clase: "bg-sky-500/20 text-sky-300",
    nota: "Este cliente NO tiene cuenta propia: usa la de la casa, la misma que el resto.",
  },
  ninguno: {
    texto: "Sin configurar",
    clase: "bg-slate-700 text-slate-400",
    nota: "No hay credenciales por ninguna vía: los km de sus vehículos serán manuales.",
  },
};

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
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [estado, setEstado] = useState<EstadoWebfleet | null>(null);
  const [probando, setProbando] = useState(false);

  /** Vuelve a preguntar por dónde van las credenciales de este cliente. */
  async function refrescarEstado() {
    try { setEstado(await obtenerEstadoWebfleet(empresaId)); } catch { setEstado(null); }
  }

  useEffect(() => {
    obtenerWebfleetConfig(empresaId).then((c) => {
      if (!c) return;
      setAccount(c.account ?? "");
      setUsername(c.username ?? "");
      setBaseUrl(c.base_url ?? "https://csv.webfleet.com/extern");
      setActivo(c.activo);
      // La contraseña y la API key NO se traen: se escriben, no se leen.
      // Se quedan en blanco y, si se dejan así, conservan su valor guardado.
    }).catch(() => {});
    refrescarEstado();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  async function probar() {
    setProbando(true); setMsg("");
    try {
      setEstado(await obtenerEstadoWebfleet(empresaId, true));
    } catch (e: any) {
      setMsg(e?.message || "No se ha podido probar la conexión");
    } finally { setProbando(false); }
  }

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
      setPassword(""); setApikey("");
      setMsg("✔ Credenciales de Webfleet guardadas");
      // El origen puede haber cambiado al guardar (p. ej. de «cuenta global» a
      // «base de datos»), así que se vuelve a preguntar en vez de suponerlo.
      await refrescarEstado();
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 flex items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Integración Webfleet</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ORIGEN[estado?.origen ?? "ninguno"].clase}`}>
          {estado ? ORIGEN[estado.origen].texto : "Comprobando…"}
        </span>
      </div>
      {estado && <div className="mb-2 text-[11px] text-slate-500">{ORIGEN[estado.origen].nota}</div>}
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

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {puedeEditar && (
          <button onClick={guardar} disabled={guardando} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar credenciales"}
          </button>
        )}
        {/* Probar no cambia nada, así que no se restringe a quien puede editar:
            es la única forma de confirmar que unas credenciales funcionan de
            verdad, y es justo lo que hay que hacer antes y después de migrar
            un cliente al gestor de secretos. */}
        <button onClick={probar} disabled={probando} className="rounded border border-slate-600 px-3 py-1.5 text-[12px] font-bold text-slate-200 disabled:opacity-50">
          {probando ? "Probando…" : "Probar conexión"}
        </button>
        {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
      </div>

      {estado?.probado && (
        <div className={`mt-2 text-[12px] ${estado.ok ? "text-emerald-400" : "text-rose-300"}`}>
          {estado.ok
            ? `✔ Webfleet responde. ${estado.vehiculos ?? 0} vehículo(s) en la cuenta.`
            : `✖ ${estado.mensaje ?? "No responde"}`}
        </div>
      )}
    </div>
  );
}
