import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Plus, ShieldCheck } from "lucide-react";
import { apiFetch } from "../modules/apiFetch";

/**
 * SaaS fase 2 — panel SuperAdmin de empresas y licencias.
 * Alta de empresas, estado del tenant y gestión de licencias por módulo
 * sin tocar la base de datos a mano.
 */

type Empresa = {
  id: string;
  nombre: string;
  slug: string;
  cif: string | null;
  estado: "activa" | "suspendida" | "prueba";
  usuarios: number;
  licencias_activas: number;
};

type Licencia = {
  id: string;
  modulo: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: "activa" | "caducada" | "suspendida" | "cancelada";
  max_usuarios: number | null;
  max_dispositivos: number | null;
};

const MODULOS = [
  "taller",
  "workplanner",
  "administracion",
  "tyrecontrol",
  "almacen",
  "sea-core",
  "toolcontrol",
  "safety",
  "presencia",
];

const ESTADO_COLOR: Record<string, string> = {
  activa: "bg-emerald-500/15 text-emerald-300",
  prueba: "bg-amber-500/15 text-amber-300",
  suspendida: "bg-red-500/15 text-red-300",
  caducada: "bg-red-500/15 text-red-300",
  cancelada: "bg-slate-500/15 text-slate-300",
};

export default function AdminEmpresasPage() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [licencias, setLicencias] = useState<Licencia[]>([]);
  const [nuevaEmpresa, setNuevaEmpresa] = useState({ nombre: "", cif: "" });
  const [nuevaLic, setNuevaLic] = useState({ modulo: "taller", fecha_fin: "" });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await apiFetch("/api/admin/empresas");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setEmpresas(data);
    } catch (e: any) {
      setError(e.message || "Error cargando empresas");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function abrirEmpresa(id: string) {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id);
    setLicencias([]);
    const r = await apiFetch(`/api/admin/empresas/${id}/licencias`);
    if (r.ok) setLicencias(await r.json());
  }

  async function crearEmpresa() {
    if (nuevaEmpresa.nombre.trim().length < 2) return;
    setGuardando(true);
    setError("");
    try {
      const r = await apiFetch("/api/admin/empresas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevaEmpresa),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setNuevaEmpresa({ nombre: "", cif: "" });
      await cargar();
    } catch (e: any) {
      setError(e.message || "Error creando la empresa");
    } finally {
      setGuardando(false);
    }
  }

  async function crearLicencia() {
    if (!abierta) return;
    setGuardando(true);
    setError("");
    try {
      const r = await apiFetch(`/api/admin/empresas/${abierta}/licencias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modulo: nuevaLic.modulo,
          fecha_fin: nuevaLic.fecha_fin || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setLicencias((prev) => [data, ...prev]);
      await cargar();
    } catch (e: any) {
      setError(e.message || "Error creando la licencia");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstadoLicencia(lic: Licencia, estado: Licencia["estado"]) {
    const r = await apiFetch(`/api/admin/licencias/${lic.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (r.ok) {
      const data = await r.json();
      setLicencias((prev) => prev.map((l) => (l.id === lic.id ? data : l)));
      await cargar();
    }
  }

  async function cambiarEstadoEmpresa(e: Empresa, estado: Empresa["estado"]) {
    const r = await apiFetch(`/api/admin/empresas/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (r.ok) await cargar();
  }

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => navigate("/inicio")}
            className="rounded-lg border border-slate-700 p-2 hover:border-slate-500"
            aria-label="Volver al inicio"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ShieldCheck className="h-6 w-6 text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold">Empresas y licencias</h1>
            <p className="text-xs text-slate-400">
              Gestión de tenants de la plataforma (SuperAdmin Mobilink)
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Alta de empresa */}
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex-1 min-w-48">
            <label className="mb-1 block text-xs text-slate-400">Nombre de la empresa</label>
            <input
              value={nuevaEmpresa.nombre}
              onChange={(e) => setNuevaEmpresa((v) => ({ ...v, nombre: e.target.value }))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Talleres García SL"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs text-slate-400">CIF (opcional)</label>
            <input
              value={nuevaEmpresa.cif}
              onChange={(e) => setNuevaEmpresa((v) => ({ ...v, cif: e.target.value }))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
              placeholder="B12345678"
            />
          </div>
          <button
            onClick={() => void crearEmpresa()}
            disabled={guardando || nuevaEmpresa.nombre.trim().length < 2}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Crear empresa
          </button>
        </div>

        {/* Lista de empresas */}
        {cargando ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : (
          <div className="space-y-3">
            {empresas.map((e) => (
              <div key={e.id} className="rounded-2xl border border-slate-700 bg-slate-800">
                <button
                  onClick={() => void abrirEmpresa(e.id)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <Building2 className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="flex-1">
                    <span className="font-semibold">{e.nombre}</span>
                    <span className="ml-2 text-xs text-slate-500">{e.slug}</span>
                  </div>
                  <span className="text-xs text-slate-400">{e.usuarios} usuarios</span>
                  <span className="text-xs text-slate-400">{e.licencias_activas} módulos</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_COLOR[e.estado]}`}>
                    {e.estado}
                  </span>
                </button>

                {abierta === e.id && (
                  <div className="border-t border-slate-700 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs">
                      <span className="text-slate-400">Estado del tenant:</span>
                      {(["activa", "prueba", "suspendida"] as const).map((est) => (
                        <button
                          key={est}
                          onClick={() => void cambiarEstadoEmpresa(e, est)}
                          className={`rounded-full px-2 py-0.5 font-bold ${
                            e.estado === est ? ESTADO_COLOR[est] : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {est}
                        </button>
                      ))}
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500">
                          <th className="py-1">Módulo</th>
                          <th>Inicio</th>
                          <th>Fin</th>
                          <th>Estado</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {licencias.map((l) => (
                          <tr key={l.id} className="border-t border-slate-700/60">
                            <td className="py-2 font-medium">{l.modulo}</td>
                            <td>{l.fecha_inicio?.slice(0, 10)}</td>
                            <td>{l.fecha_fin ? l.fecha_fin.slice(0, 10) : "—"}</td>
                            <td>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_COLOR[l.estado]}`}>
                                {l.estado}
                              </span>
                            </td>
                            <td className="text-right">
                              {l.estado === "activa" ? (
                                <button
                                  onClick={() => void cambiarEstadoLicencia(l, "suspendida")}
                                  className="text-xs text-slate-400 hover:text-red-300"
                                >
                                  Suspender
                                </button>
                              ) : (
                                <button
                                  onClick={() => void cambiarEstadoLicencia(l, "activa")}
                                  className="text-xs text-slate-400 hover:text-emerald-300"
                                >
                                  Reactivar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!licencias.length && (
                          <tr><td colSpan={5} className="py-3 text-xs text-slate-500">Sin licencias</td></tr>
                        )}
                      </tbody>
                    </table>

                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-700/60 pt-3">
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Módulo</label>
                        <select
                          value={nuevaLic.modulo}
                          onChange={(ev) => setNuevaLic((v) => ({ ...v, modulo: ev.target.value }))}
                          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                        >
                          {MODULOS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Caduca (vacío = sin fin)</label>
                        <input
                          type="date"
                          value={nuevaLic.fecha_fin}
                          onChange={(ev) => setNuevaLic((v) => ({ ...v, fecha_fin: ev.target.value }))}
                          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => void crearLicencia()}
                        disabled={guardando}
                        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" /> Añadir licencia
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
