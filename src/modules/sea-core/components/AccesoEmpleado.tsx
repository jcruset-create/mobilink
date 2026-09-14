// Acceso a la plataforma desde la ficha del empleado (paso 4 de la
// unificación de identidades).
//
// Antes había que dar de alta a la persona en Core → Empleados y volver a
// darla de alta en Administración → Usuarios, sin que nada relacionara las
// dos fichas. Aquí se crea la cuenta ya vinculada (app_usuarios.employee_id)
// y se le marcan los módulos en la misma pantalla.
import { useCallback, useEffect, useState } from "react";
import {
  getAppUsuarioDeEmpleado, crearUsuarioAuth, guardarAppUsuario,
  resetPasswordUsuario, listTcEmpresas, type AppUsuario,
} from "../../administracion/services/data";
import AccesosModulos from "../../administracion/components/AccesosModulos";
import {
  accesosAPayload, estadoInicialAccesos, type AccesoEdit,
} from "../../administracion/components/accesosModulos";
import { usuarioSugerido } from "./usuarioSugerido";

type Empleado = {
  id: string; nombre: string; apellidos: string | null;
  email: string | null; telefono: string | null; activo: boolean;
};

const card = "rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3";
const input = "rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";
const btn = "rounded-xl bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50";

export default function AccesoEmpleado({ empleado }: { empleado: Empleado }) {
  const [cuenta, setCuenta] = useState<AppUsuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [activo, setActivo] = useState(true);
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[]>([]);
  const [accesos, setAccesos] = useState<Record<string, AccesoEdit>>(() => estadoInicialAccesos());
  const [guardando, setGuardando] = useState(false);

  const [pinNuevo, setPinNuevo] = useState("");
  const [cambiando, setCambiando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const u = await getAppUsuarioDeEmpleado(empleado.id);
      setCuenta(u);
      setUsername(u?.username ?? usuarioSugerido(empleado.nombre, empleado.apellidos));
      setActivo(u?.activo ?? true);
      setAccesos(estadoInicialAccesos(u?.accesos));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el acceso.");
    } finally {
      setCargando(false);
    }
  }, [empleado.id, empleado.nombre, empleado.apellidos]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { void listTcEmpresas().then(setEmpresas); }, []);

  async function guardar() {
    if (username.trim().length < 2) { setError("El usuario debe tener al menos 2 caracteres."); return; }
    if (!cuenta && pin.length < 4) { setError("La contraseña debe tener al menos 4 caracteres."); return; }
    setGuardando(true);
    setError("");
    setAviso("");
    try {
      const nombreCompleto = `${empleado.nombre} ${empleado.apellidos ?? ""}`.trim();
      // La cuenta de Auth se crea primero; si el guardado posterior falla, la
      // cuenta queda sin accesos (no da entrada a nada) y se reintenta al
      // volver a guardar, porque ya existirá la fila vinculada.
      const id = cuenta?.id ?? await crearUsuarioAuth(username.trim(), nombreCompleto, pin);
      await guardarAppUsuario({
        id,
        username: username.trim(),
        nombre: nombreCompleto,
        email_recuperacion: empleado.email,
        telefono: empleado.telefono,
        activo,
        es_superadmin: cuenta?.es_superadmin ?? false,
        employee_id: empleado.id,
        accesos: accesosAPayload(accesos),
      });
      setPin("");
      setAviso(cuenta ? "Acceso actualizado." : `Acceso creado. Comunícale su usuario y contraseña en persona.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el acceso.");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarClave() {
    if (!cuenta) return;
    if (pinNuevo.length < 4) { setError("La contraseña debe tener al menos 4 caracteres."); return; }
    setCambiando(true);
    setError("");
    setAviso("");
    try {
      await resetPasswordUsuario(cuenta.id, pinNuevo);
      setPinNuevo("");
      setAviso("Contraseña cambiada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.");
    } finally {
      setCambiando(false);
    }
  }

  if (cargando) return <div className={card}><span className="text-sm text-slate-400">Cargando acceso…</span></div>;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}
      {aviso && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">Acceso a la plataforma</h2>
          {cuenta ? (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cuenta.activo ? "bg-green-100 text-green-800" : "bg-slate-700 text-slate-300"}`}>
              {cuenta.activo ? "Con acceso" : "Acceso desactivado"}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Sin cuenta</span>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Usuario y contraseña para entrar al panel web. Es distinto del PIN de las
          apps de operario, que está en la pestaña de datos personales.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Usuario (login)
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={input} placeholder="jordicruset" />
          </label>
          {!cuenta && (
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Contraseña (mínimo 4)
              <input type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} className={input} />
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 py-2 text-sm text-slate-300">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 accent-sky-500" />
            Activo
          </label>
        </div>
      </div>

      <div className={card}>
        <h2 className="font-semibold text-slate-200">Módulos permitidos</h2>
        <p className="text-xs text-slate-400">
          Sin ningún módulo marcado la persona tiene cuenta pero no entra a nada.
        </p>
        <AccesosModulos accesos={accesos} empresas={empresas} onChange={setAccesos} />
        <div className="flex justify-end">
          <button onClick={() => void guardar()} disabled={guardando} className={btn}>
            {guardando ? "Guardando…" : cuenta ? "Guardar acceso" : "Crear acceso"}
          </button>
        </div>
      </div>

      {cuenta && (
        <div className={card}>
          <h2 className="font-semibold text-slate-200">Contraseña</h2>
          <p className="text-xs text-slate-400">
            No se puede consultar, solo poner una nueva.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="new-password"
              value={pinNuevo}
              onChange={(e) => setPinNuevo(e.target.value)}
              placeholder="Nueva contraseña (mínimo 4)"
              className={input}
            />
            <button onClick={() => void cambiarClave()} disabled={cambiando} className={btn}>
              {cambiando ? "Guardando…" : "Cambiar contraseña"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
