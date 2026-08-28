/**
 * Connect Pro — cartera de empresas de la central.
 *
 * La diferencia con la pantalla «Empresas de asistencia», que sigue donde
 * estaba: aquella lista proveedores. Esta lista **empresas**, sean lo que
 * sean para esta central —proveedor, cliente, partner, dueña de talleres— y
 * deja ver de un vistazo los papeles que desempeña cada una.
 *
 * Lo que hay que tener claro al usarla, porque es lo que el modelo separa:
 *
 *   · Los datos de la izquierda (razón social, CIF, domicilio) son de la
 *     EMPRESA y los comparten todas las plataformas que trabajan con ella.
 *     Corregir el domicilio aquí lo corrige para todas, que es lo que se
 *     quiere: una empresa, una ficha.
 *   · Los de la derecha (roles, código interno, pago, límites, SLA) son de la
 *     RELACIÓN con ESTA central. La plataforma de al lado tiene los suyos y no
 *     se ven desde aquí.
 *
 * Retirar una empresa de la cartera no la borra: deja de estar en esta
 * central y sigue existiendo para las demás.
 */

import { useCallback, useEffect, useState } from "react";

import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";

const ROLES = ["CUSTOMER", "PROVIDER", "PARTNER", "WORKSHOP_OWNER"] as const;
type Rol = (typeof ROLES)[number];

const ETIQUETA_ROL: Record<Rol, string> = {
  CUSTOMER: "Cliente",
  PROVIDER: "Proveedor",
  PARTNER: "Partner",
  WORKSHOP_OWNER: "Dueña de talleres",
};

const TONO_ROL: Record<Rol, string> = {
  CUSTOMER: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  PROVIDER: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  PARTNER: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  WORKSHOP_OWNER: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

type Relacion = {
  id: number;
  internalCode: string | null;
  roles: Rol[];
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  creditLimit: number | null;
  authorizationLimit: number | null;
  slaAcceptMin: number | null;
  slaArrivalMin: number | null;
  notes: string | null;
};

type Empresa = {
  id: number;
  uuid: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  relacion: Relacion | null;
  talleres: number;
};

const RELACION_VACIA = {
  internalCode: "", roles: [] as Rol[], status: "active",
  paymentTerms: "", paymentMethod: "", creditLimit: "", authorizationLimit: "",
  slaAcceptMin: "", slaArrivalMin: "", notes: "",
};

export default function Cartera() {
  const { user } = useConnectAuth();
  const puedeEditar = hasRole(user, "cc_admin");

  const [rows, setRows] = useState<Empresa[]>([]);
  const [q, setQ] = useState("");
  const [filtroRol, setFiltroRol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [alta, setAlta] = useState({ name: "", taxId: "", roles: ["PROVIDER"] as Rol[] });
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [rel, setRel] = useState({ ...RELACION_VACIA });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setCargando(true);
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (filtroRol) qs.set("rol", filtroRol);
    boFetch<{ data: Empresa[] }>(`/empresas${qs.toString() ? `?${qs}` : ""}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [q, filtroRol]);

  // La búsqueda la resuelve el servidor; se espera a dejar de teclear.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const crear = async () => {
    if (!alta.name.trim() || alta.roles.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await boFetch("/empresas", { method: "POST", body: alta });
      setAlta({ name: "", taxId: "", roles: ["PROVIDER"] });
      load();
    } catch (e: any) {
      // 409: el CIF ya está dado de alta. No se duplica la ficha; se dice cuál es.
      setError(
        e.code === "company_exists"
          ? `${e.message}. Búscala por su CIF y añádela a tu cartera en lugar de crearla otra vez.`
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const abrirRelacion = (e: Empresa) => {
    setEditando(e);
    const r = e.relacion;
    setRel({
      internalCode: r?.internalCode ?? "",
      roles: r?.roles ?? [],
      status: r?.status ?? "active",
      paymentTerms: r?.paymentTerms ?? "",
      paymentMethod: r?.paymentMethod ?? "",
      creditLimit: r?.creditLimit != null ? String(r.creditLimit) : "",
      authorizationLimit: r?.authorizationLimit != null ? String(r.authorizationLimit) : "",
      slaAcceptMin: r?.slaAcceptMin != null ? String(r.slaAcceptMin) : "",
      slaArrivalMin: r?.slaArrivalMin != null ? String(r.slaArrivalMin) : "",
      notes: r?.notes ?? "",
    });
  };

  const guardarRelacion = async () => {
    if (!editando || rel.roles.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await boFetch(`/empresas/${editando.id}/relacion`, { method: "PUT", body: rel });
      setEditando(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const retirar = async (e: Empresa) => {
    if (!confirm(`Retirar «${e.name}» de tu cartera?\n\nNo se borra la empresa: deja de estar en esta central y sigue existiendo para las demás.`)) return;
    setBusy(true);
    try {
      await boFetch(`/empresas/${e.id}/relacion`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const alternaRol = (lista: Rol[], rol: Rol): Rol[] =>
    lista.includes(rol) ? lista.filter((r) => r !== rol) : [...lista, rol];

  return (
    <div>
      <PageTitle
        title="Cartera de empresas"
        subtitle="Una empresa, una ficha. Los datos fiscales se comparten entre plataformas; los roles y las condiciones comerciales son solo de esta central."
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nombre, CIF, población o código interno"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-[280px] flex-1"
          />
          <Select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="w-56">
            <option value="">Todos los roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>
            ))}
          </Select>
        </div>
      </Card>

      {puedeEditar && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Alta de empresa</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Nombre o razón social"
              value={alta.name}
              onChange={(e) => setAlta({ ...alta, name: e.target.value })}
              className="min-w-[240px] flex-1"
            />
            <Input
              placeholder="CIF / NIF"
              value={alta.taxId}
              onChange={(e) => setAlta({ ...alta, taxId: e.target.value })}
              className="w-40"
            />
            <div className="flex flex-wrap gap-3 text-[12px] text-slate-300">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={alta.roles.includes(r)}
                    onChange={() => setAlta({ ...alta, roles: alternaRol(alta.roles, r) })}
                  />
                  {ETIQUETA_ROL[r]}
                </label>
              ))}
            </div>
            <Button onClick={crear} disabled={busy || !alta.name.trim() || alta.roles.length === 0}>
              Dar de alta
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Si el CIF ya existe no se crea otra ficha: se avisa de cuál es la que hay.
          </p>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Empresa</Th>
              <Th>CIF</Th>
              <Th>Población</Th>
              <Th>Roles en esta central</Th>
              <Th>Código interno</Th>
              <Th>Talleres</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {cargando && rows.length === 0 && (
              <tr><Td colSpan={7}>Cargando…</Td></tr>
            )}
            {!cargando && rows.length === 0 && (
              <tr>
                <Td colSpan={7}>
                  <EmptyState message="No hay empresas en la cartera con ese criterio." />
                </Td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-slate-800/60">
                <Td>
                  <div className="font-semibold text-slate-100">{e.name}</div>
                  {e.legalName && e.legalName !== e.name && (
                    <div className="text-[11px] text-slate-500">{e.legalName}</div>
                  )}
                </Td>
                <Td>{e.taxId ?? "—"}</Td>
                <Td>{[e.city, e.province].filter(Boolean).join(", ") || "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(e.relacion?.roles ?? []).map((r) => (
                      <Badge key={r} className={TONO_ROL[r]}>{ETIQUETA_ROL[r]}</Badge>
                    ))}
                    {e.relacion?.status === "suspended" && (
                      <Badge className="border-red-500/40 bg-red-500/10 text-red-300">Suspendida</Badge>
                    )}
                    {(e.relacion?.roles ?? []).length === 0 && <span className="text-slate-500">—</span>}
                  </div>
                </Td>
                <Td>{e.relacion?.internalCode ?? "—"}</Td>
                <Td>{e.talleres || "—"}</Td>
                <Td>
                  {puedeEditar && (
                    <div className="flex gap-3 text-[11px]">
                      <button onClick={() => abrirRelacion(e)} className="text-slate-400 hover:text-orange-400">
                        condiciones
                      </button>
                      <button onClick={() => void retirar(e)} className="text-slate-500 hover:text-red-400">
                        retirar
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <Card className="mt-10 w-full max-w-2xl p-5">
            <h2 className="text-base font-bold text-slate-100">Condiciones con {editando.name}</h2>
            <p className="mb-4 mt-1 text-[12px] text-slate-500">
              Solo afectan a esta central. La misma empresa puede tener otras condiciones en otra plataforma.
            </p>

            <div className="mb-4 flex flex-wrap gap-3 text-[12px] text-slate-300">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rel.roles.includes(r)}
                    onChange={() => setRel({ ...rel, roles: alternaRol(rel.roles, r) })}
                  />
                  {ETIQUETA_ROL[r]}
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Código interno">
                <Input value={rel.internalCode} onChange={(e) => setRel({ ...rel, internalCode: e.target.value })} />
              </Campo>
              <Campo etiqueta="Estado de la relación">
                <Select value={rel.status} onChange={(e) => setRel({ ...rel, status: e.target.value })}>
                  <option value="active">Activa</option>
                  <option value="suspended">Suspendida</option>
                  <option value="ended">Finalizada</option>
                </Select>
              </Campo>
              <Campo etiqueta="Condiciones de pago">
                <Input value={rel.paymentTerms} onChange={(e) => setRel({ ...rel, paymentTerms: e.target.value })} placeholder="30 días fecha factura" />
              </Campo>
              <Campo etiqueta="Forma de pago">
                <Input value={rel.paymentMethod} onChange={(e) => setRel({ ...rel, paymentMethod: e.target.value })} placeholder="Transferencia" />
              </Campo>
              <Campo etiqueta="Límite de crédito (€)">
                <Input type="number" min="0" value={rel.creditLimit} onChange={(e) => setRel({ ...rel, creditLimit: e.target.value })} />
              </Campo>
              <Campo etiqueta="Límite de autorización (€)">
                <Input type="number" min="0" value={rel.authorizationLimit} onChange={(e) => setRel({ ...rel, authorizationLimit: e.target.value })} />
              </Campo>
              <Campo etiqueta="SLA de aceptación (min)">
                <Input type="number" min="1" value={rel.slaAcceptMin} onChange={(e) => setRel({ ...rel, slaAcceptMin: e.target.value })} />
              </Campo>
              <Campo etiqueta="SLA de llegada (min)">
                <Input type="number" min="1" value={rel.slaArrivalMin} onChange={(e) => setRel({ ...rel, slaArrivalMin: e.target.value })} />
              </Campo>
            </div>

            <Campo etiqueta="Observaciones">
              <Input value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} />
            </Campo>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button onClick={guardarRelacion} disabled={busy || rel.roles.length === 0}>
                {busy ? "Guardando…" : "Guardar condiciones"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-xs font-semibold text-slate-400">{etiqueta}</span>
      {children}
    </label>
  );
}
