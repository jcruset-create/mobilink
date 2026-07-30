/**
 * Mobilink Assist — gestión de talleres (multi-taller).
 * Una empresa (= licencia) puede tener varios talleres. Aquí se crean/editan
 * los talleres y se asigna cada técnico a un taller.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Store, Plus, User, Building2, ShieldCheck } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Taller = {
  id: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  codigoInterno: string | null;
  activo: boolean;
  licenseId: number | null;
  empresaNombre: string | null;
  nTecnicos: number;
  nUnidades: number;
};
type Empresa = { id: number; nombre: string; maxUnidadesMoviles: number };
type Tech = { name: string; tallerId: number | null };
type PanelUser = {
  userId: string;
  username: string | null;
  nombre: string;
  esSuperadmin: boolean;
  esAdmin: boolean;
  tallerId: number | null;
};

export default function TalleresPage() {
  const navigate = useNavigate();
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [panelUsers, setPanelUsers] = useState<PanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Formulario de nuevo taller
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoLicenseId, setNuevoLicenseId] = useState<string>("");
  const [nuevaDireccion, setNuevaDireccion] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/assist-talleres`, { headers: getAdminHeaders() as HeadersInit });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error cargando");
      setTalleres(data.talleres ?? []);
      setEmpresas(data.empresas ?? []);
      setTechs(data.techs ?? []);
      // Usuarios del panel web (hub) — best-effort, no bloquea la pantalla
      try {
        const ru = await fetch(`${API_BASE}/api/assist-panel-users`, { headers: getAdminHeaders() as HeadersInit });
        const du = await ru.json();
        if (ru.ok) setPanelUsers(du.usuarios ?? []);
      } catch { /* opcional */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function crearTaller() {
    if (!nuevoNombre.trim()) { setError("El nombre del taller es obligatorio"); return; }
    setBusy("crear");
    try {
      const res = await fetch(`${API_BASE}/api/assist-talleres`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({
          nombre: nuevoNombre.trim(),
          licenseId: nuevoLicenseId ? Number(nuevoLicenseId) : null,
          direccion: nuevaDireccion.trim() || null,
          telefono: nuevoTelefono.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error creando");
      setNuevoNombre(""); setNuevoLicenseId(""); setNuevaDireccion(""); setNuevoTelefono("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando");
    } finally { setBusy(null); }
  }

  async function toggleActivo(t: Taller) {
    setBusy(`t${t.id}`);
    try {
      await fetch(`${API_BASE}/api/assist-talleres/${t.id}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ activo: !t.activo }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function cambiarEmpresa(t: Taller, licenseId: string) {
    setBusy(`e${t.id}`);
    try {
      await fetch(`${API_BASE}/api/assist-talleres/${t.id}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ licenseId: licenseId ? Number(licenseId) : null }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function asignarTecnico(name: string, tallerId: string) {
    setBusy(`tech${name}`);
    setTechs((prev) => prev.map((x) => (x.name === name ? { ...x, tallerId: tallerId ? Number(tallerId) : null } : x)));
    try {
      await fetch(`${API_BASE}/api/assist-talleres/tech/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ tallerId: tallerId ? Number(tallerId) : null }),
      });
      await load();
    } catch { void load(); } finally { setBusy(null); }
  }

  async function actualizarPanelUser(u: PanelUser, cambios: { tallerId?: number | null; esAdmin?: boolean }) {
    setBusy(`pu${u.userId}`);
    const nuevo = { ...u, ...cambios };
    setPanelUsers((prev) => prev.map((x) => (x.userId === u.userId ? nuevo : x)));
    try {
      await fetch(`${API_BASE}/api/assist-panel-users/${encodeURIComponent(u.userId)}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ tallerId: nuevo.tallerId, esAdmin: nuevo.esAdmin }),
      });
    } catch { void load(); } finally { setBusy(null); }
  }

  const tallerName = (id: number | null) =>
    id == null ? "" : talleres.find((t) => t.id === id)?.nombre ?? "";

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/asistencias")} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-sky-400" />
            <div>
              <h1 className="text-base font-bold">Talleres</h1>
              <div className="text-xs text-slate-400">{talleres.filter((t) => t.activo).length} activos · {talleres.length} en total</div>
            </div>
          </div>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">{error}</div>}

        {/* Nuevo taller */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">
            <Plus className="h-4 w-4" /> Nuevo taller
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre del taller *"
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500"
            />
            <select
              value={nuevoLicenseId}
              onChange={(e) => setNuevoLicenseId(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            >
              <option value="">— Empresa (licencia) —</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.nombre} ({emp.maxUnidadesMoviles} uds.)</option>
              ))}
            </select>
            <input
              value={nuevaDireccion}
              onChange={(e) => setNuevaDireccion(e.target.value)}
              placeholder="Dirección (opcional)"
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500"
            />
            <input
              value={nuevoTelefono}
              onChange={(e) => setNuevoTelefono(e.target.value)}
              placeholder="Teléfono (opcional)"
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500"
            />
          </div>
          <button
            onClick={() => void crearTaller()}
            disabled={busy === "crear"}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Crear taller
          </button>
        </section>

        {/* Lista de talleres */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60">
          <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-300">
            <Building2 className="h-4 w-4" /> Talleres
          </div>
          <div className="divide-y divide-slate-700/60">
            {loading ? (
              <div className="px-4 py-8 text-center text-slate-500">Cargando…</div>
            ) : talleres.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">Aún no hay talleres. Crea el primero arriba.</div>
            ) : talleres.map((t) => (
              <div key={t.id} className={`px-4 py-3 ${t.activo ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{t.nombre}</div>
                    <div className="text-xs text-slate-500">
                      {t.nTecnicos} técnicos · {t.nUnidades} unidades
                      {t.direccion ? ` · ${t.direccion}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => void toggleActivo(t)}
                    disabled={busy === `t${t.id}`}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${t.activo ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border border-slate-600 bg-slate-700/40 text-slate-300"}`}
                  >
                    {t.activo ? "Activo" : "Inactivo"}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Empresa:</span>
                  <select
                    value={t.licenseId ?? ""}
                    onChange={(e) => void cambiarEmpresa(t, e.target.value)}
                    disabled={busy === `e${t.id}`}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                  >
                    <option value="">— Sin empresa —</option>
                    {empresas.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Asignación de técnicos */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60">
          <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-300">
            <User className="h-4 w-4" /> Técnicos → taller
          </div>
          <div className="divide-y divide-slate-700/60">
            {loading ? (
              <div className="px-4 py-8 text-center text-slate-500">Cargando…</div>
            ) : techs.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">Sin técnicos.</div>
            ) : techs.map((tech) => (
              <div key={tech.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-bold">{tech.name}</div>
                  <div className="text-xs text-slate-500">{tech.tallerId ? tallerName(tech.tallerId) : "Sin taller"}</div>
                </div>
                <select
                  value={tech.tallerId ?? ""}
                  onChange={(e) => void asignarTecnico(tech.name, e.target.value)}
                  disabled={busy === `tech${tech.name}`}
                  className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                >
                  <option value="">— Sin taller —</option>
                  {talleres.filter((t) => t.activo).map((t) => (
                    <option key={t.id} value={t.id}>{t.nombre}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>

        {/* Usuarios del panel web → taller */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60">
          <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-300">
            <ShieldCheck className="h-4 w-4" /> Usuarios del panel → taller
          </div>
          <div className="border-b border-slate-700/60 px-4 py-2 text-xs text-slate-500">
            Cada usuario del panel ve solo las asistencias de su taller. Los administradores (y superadmins) ven todos los talleres con el selector.
          </div>
          <div className="divide-y divide-slate-700/60">
            {loading ? (
              <div className="px-4 py-8 text-center text-slate-500">Cargando…</div>
            ) : panelUsers.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">Sin usuarios del panel.</div>
            ) : panelUsers.map((u) => (
              <div key={u.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-bold">
                    {u.nombre}
                    {u.username && <span className="ml-1 text-xs font-normal text-slate-500">@{u.username}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.esSuperadmin ? "Superadmin (ve todo siempre)" : u.esAdmin ? "Admin de asistencias" : u.tallerId ? tallerName(u.tallerId) : "Sin taller (no ve asistencias)"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!u.esSuperadmin && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={u.esAdmin}
                        disabled={busy === `pu${u.userId}`}
                        onChange={(e) => void actualizarPanelUser(u, { esAdmin: e.target.checked })}
                        className="h-4 w-4 accent-emerald-500"
                      />
                      Admin
                    </label>
                  )}
                  {!u.esSuperadmin && !u.esAdmin && (
                    <select
                      value={u.tallerId ?? ""}
                      onChange={(e) => void actualizarPanelUser(u, { tallerId: e.target.value ? Number(e.target.value) : null })}
                      disabled={busy === `pu${u.userId}`}
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                    >
                      <option value="">— Sin taller —</option>
                      {talleres.filter((t) => t.activo).map((t) => (
                        <option key={t.id} value={t.id}>{t.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
