/**
 * Mobilink Assist — clientes de facturación.
 *
 * A quién le pasamos la factura del servicio, que no siempre es quien lo pide:
 * llama el conductor, pero paga la aseguradora o el gestor de flota. Aquí está
 * la ficha fiscal y cómo se le factura a cada uno.
 *
 * Misma tabla que Connect Pro: una sola verdad, dos puertas de entrada.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Contact, Plus, Search } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import ContactosBloque from "../components/ContactosBloque";
import MapeoTyreControl from "../components/MapeoTyreControl";

type Cliente = {
  id: number; name: string; legalName: string | null; commercialName: string | null;
  taxId: string | null; address: string | null; postalCode: string | null;
  city: string | null; province: string | null; country: string | null;
  currency: string | null; paymentMethod: string | null; paymentTerms: string | null;
  billingPeriodicity: string | null; billingGrouped: boolean;
  referenceRequired: boolean; purchaseOrderRequired: boolean;
  costCenter: string | null; project: string | null; billingSeries: string | null;
  taxConfig: string | null; billingNotes: string | null;
  contactEmail: string | null; contactPhone: string | null;
  active: boolean; notes: string | null;
  erpCode: string | null; erpSyncStatus: string | null;
};

const ESTADOS_ERP: Record<string, { texto: string; clase: string }> = {
  not_synced: { texto: "No sincronizado", clase: "border-slate-600 text-slate-500" },
  pending: { texto: "Pendiente", clase: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  syncing: { texto: "Sincronizando", clase: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  synced: { texto: "Sincronizado", clase: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  error: { texto: "Error", clase: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const CAMPOS_FISCALES: [keyof Cliente, string][] = [
  ["name", "Nombre"],
  ["commercialName", "Nombre comercial"],
  ["legalName", "Razón social"],
  ["taxId", "CIF / NIF / VAT"],
  ["address", "Dirección fiscal"],
  ["postalCode", "Código postal"],
  ["city", "Población"],
  ["province", "Provincia"],
  ["country", "País"],
  ["currency", "Moneda"],
  ["contactPhone", "Teléfono"],
  ["contactEmail", "Email"],
];

const CAMPOS_FACTURACION: [keyof Cliente, string][] = [
  ["paymentMethod", "Forma de pago"],
  ["paymentTerms", "Condiciones de pago"],
  ["billingPeriodicity", "Periodicidad"],
  ["costCenter", "Centro de coste"],
  ["project", "Proyecto"],
  ["billingSeries", "Serie de facturación"],
  ["taxConfig", "Config. fiscal / IVA"],
  ["billingNotes", "Observaciones de facturación"],
];

/** Interruptores de facturación: sí o no, sin nada que redactar. */
const INTERRUPTORES: [keyof Cliente, string][] = [
  ["billingGrouped", "Factura agrupada (una por periodo, no por servicio)"],
  ["referenceRequired", "Referencia obligatoria"],
  ["purchaseOrderRequired", "Nº de pedido obligatorio"],
];

export default function ClientesFacturacionPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Cliente[]>([]);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [edicion, setEdicion] = useState<Record<string, string> | null>(null);
  const [nuevo, setNuevo] = useState({ name: "", taxId: "", city: "", contactEmail: "" });
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
      const d = await pedir(`/api/clientes-facturacion?q=${encodeURIComponent(q)}`);
      setRows(d.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [pedir, q]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  const crear = async () => {
    if (!nuevo.name.trim()) { setError("El nombre del cliente es obligatorio."); return; }
    setBusy(true); setError("");
    try {
      await pedir("/api/clientes-facturacion", { method: "POST", body: JSON.stringify(nuevo) });
      setNuevo({ name: "", taxId: "", city: "", contactEmail: "" });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardar = async (id: number, cambios: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await pedir(`/api/clientes-facturacion/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
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

  const ficha = (c: Cliente, campos: [keyof Cliente, string][]) =>
    edicion === null ? (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {campos.map(([k, etiqueta]) => (
          <div key={k} className="flex gap-2 border-b border-slate-700/40 py-1">
            <dt className="w-44 shrink-0 text-slate-500">{etiqueta}</dt>
            <dd className="text-slate-200">{String(c[k] ?? "") || "—"}</dd>
          </div>
        ))}
      </dl>
    ) : (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {campos.map(([k, etiqueta]) =>
          campo(edicion[k as string] ?? "", (v) => setEdicion({ ...edicion, [k]: v }), etiqueta))}
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/asistencias")} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Contact className="h-5 w-5 text-sky-400" />
            <div>
              <h1 className="text-base font-bold">Clientes de facturación</h1>
              <div className="text-xs text-slate-400">{rows.length} en total · a quién se le factura el servicio</div>
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
            placeholder="Buscar por nombre, razón social, CIF o población…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-orange-500"
          />
        </div>

        <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">
            <Plus className="h-4 w-4" /> Nuevo cliente
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            {campo(nuevo.name, (v) => setNuevo({ ...nuevo, name: v }), "Nombre *")}
            {campo(nuevo.taxId, (v) => setNuevo({ ...nuevo, taxId: v }), "CIF")}
            {campo(nuevo.city, (v) => setNuevo({ ...nuevo, city: v }), "Población")}
            {campo(nuevo.contactEmail, (v) => setNuevo({ ...nuevo, contactEmail: v }), "Email")}
          </div>
          <button onClick={() => void crear()} disabled={busy || !nuevo.name.trim()}
            className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-500 disabled:opacity-50">
            Crear cliente
          </button>
        </section>

        {loading ? (
          <div className="text-sm text-slate-400">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-8 text-center text-sm text-slate-400">
            {q ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes de facturación."}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((c) => {
              const erp = ESTADOS_ERP[c.erpSyncStatus ?? "not_synced"] ?? ESTADOS_ERP.not_synced;
              const activo = abierto === c.id;
              return (
                <section key={c.id} className="rounded-xl border border-slate-700 bg-slate-800/60">
                  <button
                    onClick={() => { setAbierto(activo ? null : c.id); setEdicion(null); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-100">
                        {c.commercialName || c.name}
                        {!c.active && <span className="ml-2 text-[11px] text-slate-500">(inactivo)</span>}
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {[c.taxId, c.city, c.contactEmail].filter(Boolean).join(" · ") || "Sin datos fiscales"}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${erp.clase}`}>{erp.texto}</span>
                  </button>

                  {activo && (
                    <div className="space-y-4 border-t border-slate-700 p-4">
                      <div className="flex items-center gap-2">
                        {edicion === null ? (
                          <button onClick={() => setEdicion(Object.fromEntries(
                            [...CAMPOS_FISCALES, ...CAMPOS_FACTURACION].map(([k]) => [k, String(c[k] ?? "")])))}
                            className="text-xs text-slate-400 hover:text-orange-400">✎ editar ficha</button>
                        ) : (
                          <>
                            <button onClick={async () => { await guardar(c.id, edicion); setEdicion(null); }} disabled={busy}
                              className="rounded bg-orange-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50">Guardar</button>
                            <button onClick={() => setEdicion(null)} className="text-xs text-slate-400 hover:text-slate-200">Cancelar</button>
                          </>
                        )}
                        <button onClick={() => void guardar(c.id, { active: !c.active })} disabled={busy}
                          className="ml-auto text-xs text-slate-400 hover:text-orange-400">
                          {c.active ? "desactivar cliente" : "reactivar cliente"}
                        </button>
                      </div>

                      <div>
                        <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-300">Datos fiscales</h3>
                        {ficha(c, CAMPOS_FISCALES)}
                      </div>

                      <div>
                        <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-300">Facturación</h3>
                        {ficha(c, CAMPOS_FACTURACION)}
                        <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-700/40 pt-2 text-[13px]">
                          {INTERRUPTORES.map(([k, etiqueta]) => (
                            <label key={k} className="flex items-center gap-2 text-slate-200">
                              <input type="checkbox" disabled={busy} checked={c[k] === true}
                                onChange={(e) => void guardar(c.id, { [k]: e.target.checked })} />
                              {etiqueta}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* La correspondencia con TyreControl va en la ficha del
                          cliente porque es de él: dice a qué empresa de TC
                          pertenecen sus vehículos. */}
                      <MapeoTyreControl clienteId={c.id} />

                      <ContactosBloque ownerType="client" ownerId={c.id} titulo="Contactos del cliente" />
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
