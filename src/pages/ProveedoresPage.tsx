/**
 * Mobilink Assist — proveedores a los que subcontratamos.
 *
 * Un proveedor (p. ej. «Grupo Talleres Norte SL») tiene uno o varios talleres
 * o centros, y sus propios contactos. Antes esto se escribía a mano en cada
 * asistencia: el mismo taller acababa escrito de cuatro maneras y nadie sabía
 * a qué teléfono llamar.
 *
 * Los datos son los MISMOS que ve Connect Pro: una sola tabla, dos puertas de
 * entrada. Aquí no se copia nada.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Building2, Plus, Search } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import ContactosBloque from "../components/ContactosBloque";

type Proveedor = {
  id: number; name: string; legalName: string | null; commercialName: string | null;
  taxId: string | null; address: string | null; postalCode: string | null;
  city: string | null; province: string | null; country: string | null;
  web: string | null; contactEmail: string | null; contactPhone: string | null;
  billingEmail: string | null; paymentTerms: string | null; paymentMethod: string | null;
  status: string; notes: string | null; talleres: number;
  erpSystem: string | null; erpCode: string | null; erpSyncStatus: string | null;
};

type Taller = {
  id: number; name: string; address: string | null; city: string | null;
  postalCode: string | null; country: string | null;
  province: string | null; phone: string | null; emergencyPhone: string | null;
  email: string | null; assistanceEmail: string | null; adminEmail: string | null;
  billingEmail: string | null; deliveryNoteEmail: string | null;
  openingHours: string | null; open24h: boolean; active: boolean;
  coverageProvinces: string | null; coveragePostalCodes: string | null;
  vehicleTypes: string | null; avgResponseMinutes: number | null;
  authorizationLimit: number | null; notes: string | null;
};

const ESTADOS_ERP: Record<string, { texto: string; clase: string }> = {
  not_synced: { texto: "No sincronizado", clase: "border-slate-600 text-slate-500" },
  pending: { texto: "Pendiente", clase: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  syncing: { texto: "Sincronizando", clase: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  synced: { texto: "Sincronizado", clase: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  error: { texto: "Error", clase: "border-red-500/40 bg-red-500/10 text-red-300" },
};

/** Campos de texto de la ficha del proveedor: etiqueta y anchura. */
const CAMPOS_PROVEEDOR: [keyof Proveedor, string][] = [
  ["name", "Nombre"],
  ["commercialName", "Nombre comercial"],
  ["legalName", "Razón social"],
  ["taxId", "CIF / NIF / VAT"],
  ["address", "Dirección fiscal"],
  ["postalCode", "Código postal"],
  ["city", "Población"],
  ["province", "Provincia"],
  ["country", "País"],
  ["contactPhone", "Teléfono"],
  ["contactEmail", "Email"],
  ["billingEmail", "Email de facturación"],
  ["web", "Web"],
  ["paymentTerms", "Condiciones de pago"],
  ["paymentMethod", "Forma de pago"],
  ["notes", "Observaciones"],
];

/** Campos de texto de la ficha del taller. */
const CAMPOS_TALLER: [keyof Taller, string][] = [
  ["name", "Nombre del taller"],
  ["address", "Dirección"],
  ["postalCode", "Código postal"],
  ["city", "Población"],
  ["province", "Provincia"],
  ["country", "País"],
  ["phone", "Teléfono"],
  ["emergencyPhone", "Teléfono de urgencias"],
  ["assistanceEmail", "Email de asistencias"],
  ["adminEmail", "Email de administración"],
  ["billingEmail", "Email de facturación"],
  ["deliveryNoteEmail", "Email de albaranes"],
  ["openingHours", "Horario"],
  ["coverageProvinces", "Provincias que cubre"],
  ["coveragePostalCodes", "Códigos postales"],
  ["vehicleTypes", "Tipos de vehículo"],
  ["avgResponseMinutes", "Tiempo medio (min)"],
  ["authorizationLimit", "Límite sin autorización (€)"],
  ["notes", "Observaciones"],
];

/** Las listas se guardan como JSON y se editan separadas por comas. */
const CAMPOS_LISTA = ["coverageProvinces", "coveragePostalCodes", "vehicleTypes"];

function valorEditable(campo: string, obj: Record<string, unknown>): string {
  const bruto = obj[campo];
  if (bruto == null) return "";
  if (CAMPOS_LISTA.includes(campo)) {
    try {
      const lista = JSON.parse(String(bruto));
      if (Array.isArray(lista)) return lista.join(", ");
    } catch { /* no era JSON: se enseña tal cual */ }
  }
  return String(bruto);
}

export default function ProveedoresPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Proveedor[]>([]);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [edicion, setEdicion] = useState<Record<string, string> | null>(null);
  const [tallerEdit, setTallerEdit] = useState<{ id: number | null; datos: Record<string, string> } | null>(null);
  const [nuevo, setNuevo] = useState({ name: "", taxId: "", city: "", contactPhone: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pedir = useCallback(async (ruta: string, init?: RequestInit) => {
    const res = await fetch(`${API_BASE}${ruta}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...getAdminHeaders() },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await pedir(`/api/proveedores?q=${encodeURIComponent(q)}`);
      setRows(d.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [pedir, q]);

  // La búsqueda la resuelve el servidor; se espera a dejar de teclear.
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  const abrir = async (id: number) => {
    if (abierto === id) { setAbierto(null); setEdicion(null); setTallerEdit(null); return; }
    setAbierto(id); setEdicion(null); setTallerEdit(null);
    try {
      const d = await pedir(`/api/proveedores/${id}`);
      setTalleres(d.talleres);
    } catch (e: any) { setError(e.message); }
  };

  const crear = async () => {
    if (!nuevo.name.trim()) { setError("El nombre del proveedor es obligatorio."); return; }
    setBusy(true); setError("");
    try {
      await pedir("/api/proveedores", { method: "POST", body: JSON.stringify(nuevo) });
      setNuevo({ name: "", taxId: "", city: "", contactPhone: "" });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardarProveedor = async (id: number) => {
    if (!edicion) return;
    setBusy(true); setError("");
    try {
      await pedir(`/api/proveedores/${id}`, { method: "PATCH", body: JSON.stringify(edicion) });
      setEdicion(null);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardarTaller = async () => {
    if (!tallerEdit || abierto == null) return;
    setBusy(true); setError("");
    try {
      const cuerpo = {
        ...tallerEdit.datos,
        open24h: tallerEdit.datos.open24h === "true",
        active: tallerEdit.datos.active !== "false",
      };
      if (tallerEdit.id == null) {
        await pedir(`/api/proveedores/${abierto}/talleres`, { method: "POST", body: JSON.stringify(cuerpo) });
      } else {
        await pedir(`/api/proveedor-talleres/${tallerEdit.id}`, { method: "PATCH", body: JSON.stringify(cuerpo) });
      }
      setTallerEdit(null);
      const d = await pedir(`/api/proveedores/${abierto}`);
      setTalleres(d.talleres);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const campo = (valor: string, alCambiar: (v: string) => void, etiqueta: string) => (
    <label key={etiqueta} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</span>
      <input
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/asistencias")} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sky-400" />
            <div>
              <h1 className="text-base font-bold">Proveedores</h1>
              <div className="text-xs text-slate-400">
                {rows.length} {rows.length === 1 ? "proveedor" : "proveedores"} · a quién subcontratamos
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-4">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">{error}</div>}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, CIF, población, provincia o teléfono…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-orange-500"
          />
        </div>

        <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">
            <Plus className="h-4 w-4" /> Nuevo proveedor
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            {campo(nuevo.name, (v) => setNuevo({ ...nuevo, name: v }), "Nombre *")}
            {campo(nuevo.taxId, (v) => setNuevo({ ...nuevo, taxId: v }), "CIF")}
            {campo(nuevo.city, (v) => setNuevo({ ...nuevo, city: v }), "Población")}
            {campo(nuevo.contactPhone, (v) => setNuevo({ ...nuevo, contactPhone: v }), "Teléfono")}
          </div>
          <button
            onClick={() => void crear()}
            disabled={busy || !nuevo.name.trim()}
            className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-500 disabled:opacity-50"
          >
            Crear proveedor
          </button>
        </section>

        {loading ? (
          <div className="text-sm text-slate-400">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-8 text-center text-sm text-slate-400">
            {q ? "Ningún proveedor coincide con la búsqueda." : "Todavía no hay proveedores."}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((p) => {
              const erp = ESTADOS_ERP[p.erpSyncStatus ?? "not_synced"] ?? ESTADOS_ERP.not_synced;
              const activo = abierto === p.id;
              return (
                <section key={p.id} className="rounded-xl border border-slate-700 bg-slate-800/60">
                  <button onClick={() => void abrir(p.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-800">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-100">
                        {p.name}
                        {p.status !== "active" && (
                          <span className="ml-2 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-300">Suspendido</span>
                        )}
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {[p.taxId, [p.postalCode, p.city].filter(Boolean).join(" "), p.province, p.contactPhone]
                          .filter(Boolean).join(" · ") || "Sin datos"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-slate-400">{p.talleres} {p.talleres === 1 ? "taller" : "talleres"}</div>
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${erp.clase}`}>{erp.texto}</span>
                    </div>
                  </button>

                  {activo && (
                    <div className="space-y-4 border-t border-slate-700 p-4">
                      {/* Ficha */}
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="text-sm font-black uppercase tracking-wide text-slate-300">Datos del proveedor</h3>
                          {edicion === null ? (
                            <button onClick={() => setEdicion(Object.fromEntries(
                              CAMPOS_PROVEEDOR.map(([c]) => [c, String((p as any)[c] ?? "")])))}
                              className="text-xs text-slate-400 hover:text-orange-400">✎ editar</button>
                          ) : (
                            <>
                              <button onClick={() => void guardarProveedor(p.id)} disabled={busy}
                                className="rounded bg-orange-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50">Guardar</button>
                              <button onClick={() => setEdicion(null)} className="text-xs text-slate-400 hover:text-slate-200">Cancelar</button>
                            </>
                          )}
                        </div>
                        {edicion === null ? (
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                            {CAMPOS_PROVEEDOR.map(([c, etiqueta]) => (
                              <div key={c} className="flex gap-2 border-b border-slate-700/40 py-1">
                                <dt className="w-40 shrink-0 text-slate-500">{etiqueta}</dt>
                                <dd className="text-slate-200">{String((p as any)[c] ?? "") || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {CAMPOS_PROVEEDOR.map(([c, etiqueta]) =>
                              campo(edicion[c] ?? "", (v) => setEdicion({ ...edicion, [c]: v }), etiqueta))}
                          </div>
                        )}
                      </div>

                      {/* Talleres */}
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="text-sm font-black uppercase tracking-wide text-slate-300">Talleres / centros</h3>
                          <button
                            onClick={() => setTallerEdit({ id: null, datos: { name: "", open24h: "false", active: "true" } })}
                            className="text-xs text-slate-400 hover:text-orange-400">+ añadir</button>
                        </div>
                        {talleres.length === 0 && !tallerEdit && (
                          <p className="text-[13px] text-slate-500">Este proveedor no tiene talleres todavía.</p>
                        )}
                        <ul className="space-y-1">
                          {talleres.map((t) => (
                            <li key={t.id} className={`flex flex-wrap items-center gap-2 border-b border-slate-700/40 py-1.5 text-[13px] ${t.active ? "" : "opacity-50"}`}>
                              <span className="font-semibold text-slate-100">{t.name}</span>
                              {t.open24h && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] font-bold text-emerald-300">24 h</span>}
                              {!t.active && <span className="text-[11px] text-slate-500">(inactivo)</span>}
                              <span className="text-slate-400">
                                {[t.city, t.phone, t.assistanceEmail ?? t.email].filter(Boolean).join(" · ")}
                              </span>
                              <button
                                onClick={() => setTallerEdit({
                                  id: t.id,
                                  datos: {
                                    ...Object.fromEntries(CAMPOS_TALLER.map(([c]) => [c, valorEditable(c as string, t as any)])),
                                    open24h: String(t.open24h === true),
                                    active: String(t.active !== false),
                                  },
                                })}
                                className="ml-auto text-[11px] text-slate-500 hover:text-orange-400">editar</button>
                            </li>
                          ))}
                        </ul>

                        {tallerEdit && (
                          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                            <div className="mb-2 text-xs font-bold uppercase text-slate-400">
                              {tallerEdit.id == null ? "Nuevo taller" : "Editar taller"}
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              {CAMPOS_TALLER.map(([c, etiqueta]) =>
                                campo(tallerEdit.datos[c as string] ?? "",
                                  (v) => setTallerEdit({ ...tallerEdit, datos: { ...tallerEdit.datos, [c]: v } }),
                                  etiqueta))}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px] text-slate-300">
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={tallerEdit.datos.open24h === "true"}
                                  onChange={(e) => setTallerEdit({ ...tallerEdit, datos: { ...tallerEdit.datos, open24h: String(e.target.checked) } })} />
                                Servicio 24 h
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={tallerEdit.datos.active !== "false"}
                                  onChange={(e) => setTallerEdit({ ...tallerEdit, datos: { ...tallerEdit.datos, active: String(e.target.checked) } })} />
                                Taller activo
                              </label>
                              <button onClick={() => void guardarTaller()} disabled={busy}
                                className="rounded bg-orange-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Guardar taller</button>
                              <button onClick={() => setTallerEdit(null)} className="text-xs text-slate-400 hover:text-slate-200">Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>

                      <ContactosBloque ownerType="provider" ownerId={p.id} titulo="Contactos del proveedor" />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
