import { useEffect, useState } from "react";
import {
  listarUsuarios, crearUsuario, actualizarUsuario, listarEmpresas,
  listarEmpresasDeUsuario, guardarEmpresasUsuario, eliminarUsuario, cambiarPasswordUsuario,
  generarEnlaceAcceso, ultimosAccesos, obtenerPantallasUsuario, guardarPantallasUsuario,
} from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { Modal, inputCls } from "../components/ui";
import { ROL_LABELS, type Empresa, type Perfil, type Rol } from "../types";
import { NAV } from "../config/navigation";

/** Hace legible un "hace cuánto" sin traer una librería de fechas. */
function haceCuanto(iso: string | null | undefined): { txt: string; frio: boolean } {
  if (!iso) return { txt: "nunca", frio: true };
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return { txt: "hoy", frio: false };
  if (dias === 1) return { txt: "ayer", frio: false };
  if (dias < 30) return { txt: `hace ${dias} días`, frio: dias > 14 };
  const meses = Math.floor(dias / 30);
  return { txt: meses === 1 ? "hace 1 mes" : `hace ${meses} meses`, frio: true };
}

const EMPTY = { nombre: "", email: "", password: "", rol: "cliente" as Rol, acceso_apk: false, acceso_panel: true, empresa_id: "" };

export default function Usuarios() {
  const { perfil } = useTyreAuth();
  const esSuper = Boolean(perfil?.es_superadmin);
  const [items, setItems] = useState<Perfil[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [ficha, setFicha] = useState<Perfil | null>(null);
  const [filtroRol, setFiltroRol] = useState<"todos" | Rol>("todos");
  const [busca, setBusca] = useState("");
  const [accesos, setAccesos] = useState<Record<string, string | null>>({});

  async function cargar() {
    setLoading(true);
    try {
      setItems(await listarUsuarios());
      if (esSuper) setEmpresas(await listarEmpresas());
      // El último acceso es informativo: si falla, la pantalla sigue siendo
      // útil, así que no se propaga el error.
      ultimosAccesos().then(setAccesos).catch(() => setAccesos({}));
    } catch (e: any) { setMsg(e?.message || "Error cargando usuarios"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, []);

  async function crear() {
    if (!form.nombre.trim() || !form.email.trim()) { setMsg("Nombre y email obligatorios"); return; }
    // El PIN solo es necesario para la APK: al panel se entra con enlace por
    // email, así que a un cliente no se le inventa ninguna contraseña.
    if (form.acceso_apk && form.password.trim().length < 4) { setMsg("Un usuario de APK necesita un PIN de al menos 4 caracteres"); return; }
    if (esSuper && !form.empresa_id) { setMsg("Selecciona una empresa"); return; }
    try {
      await crearUsuario({
        nombre: form.nombre, email: form.email,
        password: form.acceso_apk ? form.password : undefined,
        rol: form.rol, acceso_apk: form.acceso_apk, acceso_panel: form.acceso_panel,
        empresa_id: esSuper ? form.empresa_id : undefined,
      });
      setForm({ ...EMPTY });
      setMsg("✔ Usuario creado. Ábrelo y pulsa «Enlace de acceso» para invitarle.");
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error creando usuario"); }
  }

  async function eliminar(u: Perfil) {
    const ok = window.confirm(`¿Eliminar a "${u.nombre}" definitivamente?\n\nSe borra su acceso y sus asignaciones. Si tiene historial (revisiones), se bloqueará y deberás desactivarlo en su lugar.`);
    if (!ok) return;
    setMsg("");
    try {
      await eliminarUsuario(u.id);
      setMsg(`✔ Usuario "${u.nombre}" eliminado`);
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error eliminando usuario"); }
  }

  const inp = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";
  const cols = esSuper ? 8 : 7;

  const visibles = items.filter((u) => {
    if (filtroRol !== "todos" && u.rol !== filtroRol) return false;
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return u.nombre.toLowerCase().includes(q)
      || (u.email ?? "").toLowerCase().includes(q)
      || (u.empresa?.nombre ?? "").toLowerCase().includes(q);
  });

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Usuarios</h1>
      <p className="mb-3 text-sm text-slate-400">Gestión de usuarios y accesos {esSuper ? "(todas las empresas)" : "de tu empresa"}.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Alta */}
      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[10px] font-bold uppercase text-slate-400">Nuevo usuario</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={inp} placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <input className={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {form.acceso_apk
            ? <input className={inp} type="password" placeholder="PIN de la APK" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            : <div className="flex items-center rounded-lg border border-dashed border-slate-600 px-3 py-2 text-[11px] text-slate-500">Sin contraseña: entra con enlace por email</div>}
          <select className={inp} value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
            {(Object.keys(ROL_LABELS) as Rol[]).map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
          </select>
          {esSuper && (
            <select className={inp} value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })}>
              <option value="">Empresa…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          )}
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.acceso_panel} onChange={(e) => setForm({ ...form, acceso_panel: e.target.checked })} /> Panel</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.acceso_apk} onChange={(e) => setForm({ ...form, acceso_apk: e.target.checked })} /> APK</label>
          </div>
        </div>
        <button onClick={crear} className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">Crear usuario</button>
      </div>

      {/* Filtros: con varios clientes dentro, la lista plana deja de servir */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([["todos", "Todos"], ["cliente", "Clientes"], ["operador", "Técnicos"], ["administrador", "Administradores"]] as const).map(([v, txt]) => (
            <button
              key={v}
              onClick={() => setFiltroRol(v as "todos" | Rol)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                filtroRol === v ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {txt}
              <span className="ml-1.5 opacity-60">
                {v === "todos" ? items.length : items.filter((u) => u.rol === v).length}
              </span>
            </button>
          ))}
        </div>
        <input
          className={`${inp} ml-auto max-w-[240px]`}
          placeholder="Buscar nombre, email o empresa…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Rol</th>{esSuper && <th className="px-4 py-2">Empresa</th>}
              <th className="px-4 py-2">Accesos</th><th className="px-4 py-2">Último acceso</th><th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={cols}>Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={cols}>Sin usuarios que coincidan.</td></tr>
            ) : visibles.map((u) => (
              <tr key={u.id} className="border-t border-slate-700/60">
                <td className="px-4 py-2 font-semibold">{u.nombre}{u.es_superadmin ? " ⭐" : ""}</td>
                <td className="px-4 py-2 text-slate-400">{u.email}</td>
                <td className="px-4 py-2">{ROL_LABELS[u.rol]}</td>
                {esSuper && <td className="px-4 py-2 text-slate-400">{u.empresa?.nombre ?? "—"}{u.empresas_manual ? <span className="ml-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300" title="Empresas visibles asignadas a mano">+manual</span> : null}</td>}
                <td className="px-4 py-2 text-[11px] text-slate-400">{u.acceso_panel ? "Panel " : ""}{u.acceso_apk ? "APK" : ""}</td>
                <td className="px-4 py-2 text-[11px]" title={accesos[u.id] ?? "Sin registro de acceso"}>
                  {(() => { const a = haceCuanto(accesos[u.id]); return <span className={a.frio ? "text-slate-500" : "text-slate-300"}>{a.txt}</span>; })()}
                </td>
                <td className="px-4 py-2">
                  <button
                    disabled={u.es_superadmin}
                    onClick={async () => { await actualizarUsuario(u.id, { activo: !u.activo }); await cargar(); }}
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${u.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"} disabled:opacity-40`}
                  >
                    {u.activo ? "Activo" : "Inactivo"}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2 text-[12px]">
                    <button onClick={() => setFicha(u)} className="font-bold text-sky-300 hover:underline">
                      {u.acceso_panel ? "Editar / invitar" : "Editar"}
                    </button>
                    <button
                      disabled={u.es_superadmin || u.id === perfil?.id}
                      onClick={() => void eliminar(u)}
                      className="text-rose-300 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ficha && (
        <FichaUsuario
          usuario={ficha}
          empresas={empresas}
          esSuper={esSuper}
          onClose={() => setFicha(null)}
          onDone={async (texto) => { setFicha(null); setMsg(texto); await cargar(); }}
        />
      )}
    </div>
  );
}

// ── Ficha de usuario: editar datos + empresas visibles ─────────
function FichaUsuario({ usuario, empresas, esSuper, onClose, onDone }: {
  usuario: Perfil; empresas: Empresa[]; esSuper: boolean;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [accesoPanel, setAccesoPanel] = useState(usuario.acceso_panel);
  const [accesoApk, setAccesoApk] = useState(usuario.acceso_apk);
  const [modo, setModo] = useState<"todas" | "manual">(usuario.empresas_manual ? "manual" : "todas");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [cargandoEmpresas, setCargandoEmpresas] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [nuevoPin, setNuevoPin] = useState("");
  const [cambiandoPin, setCambiandoPin] = useState(false);
  const [pinMsg, setPinMsg] = useState("");
  const [pantallas, setPantallas] = useState<Set<string> | null>(null); // null = todas
  const [pantallasMsg, setPantallasMsg] = useState("");
  const [enlace, setEnlace] = useState("");
  const [generando, setGenerando] = useState(false);
  const [enlaceMsg, setEnlaceMsg] = useState("");
  const [copiado, setCopiado] = useState(false);

  async function pedirEnlace() {
    setGenerando(true); setEnlaceMsg(""); setEnlace(""); setCopiado(false);
    try {
      const r = await generarEnlaceAcceso(usuario.id);
      setEnlace(r.enlace);
    } catch (e: any) { setEnlaceMsg(e?.message || "Error generando el enlace"); }
    finally { setGenerando(false); }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (http, navegador antiguo): el enlace ya
      // está visible y seleccionable, así que no se bloquea nada.
      setEnlaceMsg("No he podido copiarlo: selecciónalo y cópialo a mano.");
    }
  }

  async function cambiarPin() {
    if (nuevoPin.trim().length < 4) { setPinMsg("El PIN/contraseña debe tener al menos 4 caracteres"); return; }
    setCambiandoPin(true); setPinMsg("");
    try {
      await cambiarPasswordUsuario(usuario.id, nuevoPin.trim());
      setNuevoPin(""); setPinMsg("✔ Contraseña actualizada");
    } catch (e: any) { setPinMsg(e?.message || "Error"); }
    finally { setCambiandoPin(false); }
  }

  const activas = empresas.filter((e) => e.activo !== false);

  // Pantallas que este rol puede tener. Se derivan del propio menú para que al
  // añadir una pantalla nueva aparezca aquí sola, sin una lista paralela que
  // se quede desfasada.
  const pantallasDelRol = NAV.filter(
    (i) => !i.superadminOnly && (!i.roles || i.roles.includes(rol)) && i.path !== "perfil" && i.path !== "ayuda",
  );

  useEffect(() => {
    obtenerPantallasUsuario(usuario.id)
      .then((p) => setPantallas(p ? new Set(p) : null))
      .catch(() => setPantallas(null));
  }, [usuario.id]);

  async function guardarPantallas(nuevas: Set<string> | null) {
    setPantallas(nuevas);
    setPantallasMsg("");
    try {
      await guardarPantallasUsuario(usuario.id, nuevas ? [...nuevas] : null);
      setPantallasMsg("✔ Guardado");
    } catch (e: any) { setPantallasMsg(e?.message || "Error guardando"); }
  }

  useEffect(() => {
    listarEmpresasDeUsuario(usuario.id)
      .then((ids) => setSeleccion(new Set(ids)))
      .catch(() => setSeleccion(new Set()))
      .finally(() => setCargandoEmpresas(false));
  }, [usuario.id]);

  async function guardar() {
    if (!nombre.trim()) { setMsg("El nombre es obligatorio"); return; }
    if (modo === "manual" && seleccion.size === 0) { setMsg("Selecciona al menos una empresa (o marca «Todas»)"); return; }
    setSaving(true); setMsg("");
    try {
      await actualizarUsuario(usuario.id, {
        nombre: nombre.trim(), rol, acceso_panel: accesoPanel, acceso_apk: accesoApk,
      });
      if (esSuper) {
        await guardarEmpresasUsuario(usuario.id, modo === "todas" ? null : [...seleccion]);
      }
      onDone(`✔ Usuario "${nombre.trim()}" actualizado`);
    } catch (e: any) { setMsg(e?.message || "Error guardando"); setSaving(false); }
  }

  return (
    <Modal title={`Ficha de ${usuario.nombre}`} onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-[12px] text-rose-300">{msg}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      }>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12px] text-slate-400">Nombre
            <input className={`${inputCls} mt-1`} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-400">Rol
            <select className={`${inputCls} mt-1`} value={rol} onChange={(e) => setRol(e.target.value as Rol)} disabled={usuario.es_superadmin}>
              {(Object.keys(ROL_LABELS) as Rol[]).map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
            </select>
          </label>
        </div>
        <div className="text-[12px] text-slate-400">Email: <span className="text-slate-300">{usuario.email}</span></div>
        <div className="flex items-center gap-4 text-sm text-slate-300">
          <label className="flex items-center gap-1"><input type="checkbox" checked={accesoPanel} onChange={(e) => setAccesoPanel(e.target.checked)} /> Panel</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={accesoApk} onChange={(e) => setAccesoApk(e.target.checked)} /> APK</label>
        </div>

        {/* Invitación al panel: enlace de un solo uso */}
        {accesoPanel && (
          <div className="rounded-lg bg-slate-800 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Acceso al panel</div>
            <div className="mb-2 text-[11px] text-slate-500">
              Al panel se entra con un enlace por email, sin contraseña. Genera aquí un enlace y
              pásaselo a {usuario.nombre} por el canal que uses con él; o dile que entre en el panel
              y pulse «Enviar enlace de acceso» con su email ({usuario.email}).
            </div>
            <button
              onClick={() => void pedirEnlace()}
              disabled={generando}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {generando ? "Generando…" : "Generar enlace de acceso"}
            </button>
            {enlace && (
              <div className="mt-2">
                <textarea
                  readOnly
                  value={enlace}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-16 w-full resize-none rounded-lg border border-slate-600 bg-slate-900 p-2 text-[11px] text-slate-300"
                />
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => void copiar()} className="rounded-lg border border-slate-600 px-3 py-1 text-[12px] text-slate-200">
                    {copiado ? "✔ Copiado" : "Copiar enlace"}
                  </button>
                  <span className="text-[11px] text-amber-300">
                    Caduca y sirve una sola vez. Es una credencial: no lo publiques.
                  </span>
                </div>
              </div>
            )}
            {enlaceMsg && <div className="mt-1 text-[12px] text-rose-300">{enlaceMsg}</div>}
          </div>
        )}

        {/* PIN de la APK: solo tiene sentido para quien entra en la APK */}
        {accesoApk && (
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">PIN de la APK</div>
          <div className="mb-2 text-[11px] text-slate-500">
            Es el PIN con el que este usuario entra en la APK. Escribe el nuevo y pulsa cambiar.
          </div>
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="Nueva contraseña / PIN"
              value={nuevoPin}
              onChange={(e) => setNuevoPin(e.target.value)}
            />
            <button
              onClick={() => void cambiarPin()}
              disabled={cambiandoPin || nuevoPin.trim().length < 4}
              className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {cambiandoPin ? "Cambiando…" : "Cambiar"}
            </button>
          </div>
          {pinMsg && <div className={`mt-1 text-[12px] ${pinMsg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{pinMsg}</div>}
        </div>
        )}

        {/* Pantallas permitidas: por defecto todas las de su rol */}
        {!usuario.es_superadmin && (
          <div className="rounded-lg bg-slate-800 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Pantallas permitidas</div>
            <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-300">
              <label className="flex items-center gap-1">
                <input type="radio" checked={pantallas === null} onChange={() => void guardarPantallas(null)} />
                Todas las de su rol
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={pantallas !== null}
                  onChange={() => void guardarPantallas(new Set(pantallasDelRol.map((i) => i.path)))}
                />
                Solo estas:
              </label>
            </div>
            {pantallas !== null && (
              <div className="grid gap-1 sm:grid-cols-2">
                {pantallasDelRol.map((i) => (
                  <label key={i.key} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={pantallas.has(i.path)}
                      onChange={(ev) => {
                        const n = new Set(pantallas);
                        ev.target.checked ? n.add(i.path) : n.delete(i.path);
                        void guardarPantallas(n.size === 0 ? null : n);
                      }}
                    />
                    {i.label}
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-500">
              El Dashboard y la Ayuda están siempre disponibles. Desmarcar todas equivale a «Todas»:
              dejar a alguien sin ninguna pantalla le echaría del panel sin poder avisarle.
            </div>
            {pantallasMsg && <div className={`mt-1 text-[12px] ${pantallasMsg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{pantallasMsg}</div>}
          </div>
        )}

        {esSuper && (
          <div className="rounded-lg bg-slate-800 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Empresas visibles</div>
            <div className="mb-2 flex gap-4 text-sm text-slate-300">
              <label className="flex items-center gap-1">
                <input type="radio" checked={modo === "todas"} onChange={() => setModo("todas")} />
                Todas (automático, incluye las futuras)
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={modo === "manual"} onChange={() => setModo("manual")} />
                Solo estas:
              </label>
            </div>
            {modo === "manual" && (
              cargandoEmpresas ? <div className="text-[12px] text-slate-500">Cargando…</div> : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {activas.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={seleccion.has(e.id)}
                        onChange={(ev) => setSeleccion((s) => {
                          const n = new Set(s);
                          ev.target.checked ? n.add(e.id) : n.delete(e.id);
                          return n;
                        })}
                      />
                      {e.nombre}
                    </label>
                  ))}
                </div>
              )
            )}
            <div className="mt-2 text-[11px] text-slate-500">
              Con «Solo estas», el usuario ve únicamente los vehículos e incidencias de las empresas marcadas (en la APK y el panel). Su empresa principal ({usuario.empresa?.nombre ?? "—"}) conviene mantenerla marcada.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
