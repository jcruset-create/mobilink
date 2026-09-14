import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Trash2, KeyRound, ShieldCheck } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  listAppUsuarios, crearUsuarioAuth, guardarAppUsuario, resetPasswordUsuario,
  eliminarAppUsuario, listSeaEmployees, listTcEmpresas,
  type AppUsuario,
} from "../services/data";
import { MODULOS_APP } from "../config/modulosApp";
import AccesosModulos from "../components/AccesosModulos";
import {
  accesosAPayload, estadoInicialAccesos, type AccesoEdit,
} from "../components/accesosModulos";
import {
  Modal, TableWrap, thCls, tdCls, TextField, SelectField, CheckField,
  btnPrimary, btnSecondary, btnDanger, btnMini, inputCls, Pill, EmptyRow, ErrorBox,
} from "../components/ui";

const MODULO_LABELS: Record<string, string> = Object.fromEntries(MODULOS_APP.map((m) => [m.key, m.label]));

function rolLabel(modulo: string, rol: string): string {
  const m = MODULOS_APP.find((x) => x.key === modulo);
  return m?.roles.find((r) => r.value === rol)?.label ?? rol;
}

export default function UsuariosApp() {
  const { perfil } = useAdminAuth();
  const [usuarios, setUsuarios] = useState<AppUsuario[]>([]);
  const [filtro, setFiltro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [editando, setEditando] = useState<AppUsuario | null | "nuevo">(null);
  const [claveDe, setClaveDe] = useState<AppUsuario | null>(null);
  const [eliminando, setEliminando] = useState<AppUsuario | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setUsuarios(await listAppUsuarios());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando usuarios. ¿Está aplicada la migración fase 11?");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = filtro.trim()
    ? usuarios.filter((u) =>
        [u.username, u.nombre].some((v) => v.toLowerCase().includes(filtro.trim().toLowerCase())))
    : usuarios;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Usuarios</h1>
          <p className="text-sm text-slate-400">Acceso por usuario y contraseña. Un solo login para todos los módulos permitidos.</p>
        </div>
        <button onClick={() => setEditando("nuevo")} className={btnPrimary}>
          <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nuevo usuario</span>
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <div className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</div>}

      <div className="relative mb-3 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por usuario o nombre…"
          className={`${inputCls} pl-9`}
        />
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Usuario</th>
            <th className={thCls}>Nombre completo</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Accesos</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {cargando && <EmptyRow cols={5} text="Cargando…" />}
          {!cargando && visibles.length === 0 && <EmptyRow cols={5} text="No hay usuarios." />}
          {!cargando && visibles.map((u) => (
            <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className={`${tdCls} font-semibold`}>
                {u.username}
                {u.es_superadmin && (
                  <Pill className="ml-2 bg-purple-500/20 text-purple-300">Superadmin</Pill>
                )}
              </td>
              <td className={tdCls}>{u.nombre}</td>
              <td className={tdCls}>
                <Pill className={u.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                  {u.activo ? "Activo" : "Inactivo"}
                </Pill>
              </td>
              <td className={tdCls}>
                <span className="flex flex-wrap gap-1">
                  {u.accesos.length === 0 && <span className="text-[12px] text-slate-500">Sin accesos</span>}
                  {u.accesos.map((a) => (
                    <Pill key={a.modulo} className="bg-sky-500/15 text-sky-300">
                      {MODULO_LABELS[a.modulo] ?? a.modulo} · {rolLabel(a.modulo, a.rol)}
                    </Pill>
                  ))}
                </span>
              </td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                <span className="flex justify-end gap-1">
                  <button onClick={() => setClaveDe(u)} className={`${btnMini} text-amber-300`} title="Restablecer contraseña">
                    <KeyRound className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditando(u)} className={btnMini} title="Editar usuario">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {u.id !== perfil?.id && (
                    <button onClick={() => setEliminando(u)} className={`${btnMini} text-rose-300`} title="Eliminar usuario">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editando && (
        <ModalUsuarioApp
          usuario={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={(msg) => { setEditando(null); setAviso(msg); void cargar(); }}
        />
      )}

      {claveDe && (
        <ModalClave
          usuario={claveDe}
          onClose={() => setClaveDe(null)}
          onDone={() => { setClaveDe(null); setAviso("Contraseña restablecida."); }}
        />
      )}

      {eliminando && (
        <ModalEliminarUsuario
          usuario={eliminando}
          onClose={() => setEliminando(null)}
          onDone={(msg) => { setEliminando(null); setAviso(msg); void cargar(); }}
        />
      )}
    </div>
  );
}

// ── Crear / editar usuario ───────────────────────────────────
function ModalUsuarioApp({ usuario, onClose, onSaved }: {
  usuario: AppUsuario | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [username, setUsername] = useState(usuario?.username ?? "");
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [pin, setPin] = useState("");
  const [emailRec, setEmailRec] = useState(usuario?.email_recuperacion ?? "");
  const [telefono, setTelefono] = useState(usuario?.telefono ?? "");
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [superadmin, setSuperadmin] = useState(usuario?.es_superadmin ?? false);
  const [employeeId, setEmployeeId] = useState(usuario?.employee_id ?? "");
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string }[]>([]);
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[]>([]);
  const [accesos, setAccesos] = useState<Record<string, AccesoEdit>>(
    () => estadoInicialAccesos(usuario?.accesos),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void listSeaEmployees().then(setEmpleados);
    void listTcEmpresas().then(setEmpresas);
  }, []);

  async function guardar() {
    if (username.trim().length < 2) { setError("El usuario debe tener al menos 2 caracteres."); return; }
    if (!nombre.trim()) { setError("El nombre completo es obligatorio."); return; }
    if (!usuario && pin.length < 4) { setError("La contraseña debe tener al menos 4 caracteres."); return; }

    const payload = accesosAPayload(accesos);

    setGuardando(true);
    setError("");
    try {
      let id = usuario?.id;
      if (!id) {
        id = await crearUsuarioAuth(username.trim(), nombre.trim(), pin);
      }
      await guardarAppUsuario({
        id,
        username: username.trim(),
        nombre: nombre.trim(),
        email_recuperacion: emailRec.trim() || null,
        telefono: telefono.trim() || null,
        activo,
        es_superadmin: superadmin,
        employee_id: employeeId || null,
        accesos: payload,
      });
      onSaved(usuario ? "Usuario actualizado." : `Usuario ${username.trim()} creado. Comunícale su usuario y contraseña.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando el usuario");
      setGuardando(false);
    }
  }

  return (
    <Modal title={usuario ? `Editar usuario — ${usuario.username}` : "Nuevo usuario"} onClose={onClose} wide
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>
            {guardando ? "Guardando…" : "Guardar usuario"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Datos de acceso</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Usuario (login)" value={username} onChange={setUsername} placeholder="Jordi" />
        <TextField label="Nombre completo" value={nombre} onChange={setNombre} placeholder="Jordi Cruset" />
        {!usuario && (
          <TextField label="Contraseña (mínimo 4)" value={pin} onChange={setPin} type="password" placeholder="1234" />
        )}
        <TextField label="Email de recuperación (solo administradores)" value={emailRec} onChange={setEmailRec} type="email" />
        <TextField label="Teléfono" value={telefono} onChange={setTelefono} />
        <SelectField label="Empleado Mobilink Core (opcional)" value={employeeId} onChange={setEmployeeId}>
          <option value="">—</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </SelectField>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <CheckField label="Activo" checked={activo} onChange={setActivo} />
        <CheckField label="Superadmin (acceso total a todo)" checked={superadmin} onChange={setSuperadmin} />
      </div>

      <div className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wide text-slate-400">Accesos por módulo</div>
      <AccesosModulos accesos={accesos} empresas={empresas} onChange={setAccesos} />
      <p className="mt-2 text-[12px] text-slate-500">
        Las pantallas desmarcadas no aparecen en el menú del usuario. En esta fase el filtrado por pantalla se aplica en Administración; en Almacén y TyreControl se guarda para fases futuras.
      </p>
    </Modal>
  );
}

// ── Restablecer contraseña ───────────────────────────────────
function ModalClave({ usuario, onClose, onDone }: {
  usuario: AppUsuario;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (pin.length < 4) { setError("La contraseña debe tener al menos 4 caracteres."); return; }
    if (pin !== pin2) { setError("Las contraseñas no coinciden."); return; }
    setGuardando(true);
    setError("");
    try {
      await resetPasswordUsuario(usuario.id, pin);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cambiando la contraseña");
      setGuardando(false);
    }
  }

  return (
    <Modal title={`Restablecer contraseña — ${usuario.username}`} onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>
            {guardando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nueva contraseña (mínimo 4)" value={pin} onChange={setPin} type="password" placeholder="1234" />
        <TextField label="Repetir contraseña" value={pin2} onChange={setPin2} type="password" />
      </div>
      <p className="mt-3 text-[12px] text-slate-500">
        Comunícasela al usuario de palabra. Entrará con su usuario y esta contraseña en cualquier módulo permitido.
      </p>
    </Modal>
  );
}

// ── Eliminar usuario ─────────────────────────────────────────
function ModalEliminarUsuario({ usuario, onClose, onDone }: {
  usuario: AppUsuario;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState("");

  async function eliminar() {
    setBorrando(true);
    setError("");
    try {
      const resultado = await eliminarAppUsuario(usuario.id);
      onDone(resultado === "eliminado"
        ? `Usuario ${usuario.username} eliminado.`
        : `${usuario.username} tenía historial de gestiones: se ha desactivado en todos los módulos (no se borra para conservar el historial).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error eliminando el usuario");
      setBorrando(false);
    }
  }

  return (
    <Modal title="Eliminar usuario" onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={eliminar} disabled={borrando} className={btnDanger}>
            {borrando ? "Eliminando…" : "Eliminar usuario"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <p className="text-sm text-slate-300">
        Vas a eliminar a <strong className="text-slate-100">{usuario.username}</strong> ({usuario.nombre}) de toda la aplicación.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Si tiene historial (cobros, gestiones de recobro…), no se borra: se desactiva en todos los módulos para conservar el historial.
      </p>
    </Modal>
  );
}
