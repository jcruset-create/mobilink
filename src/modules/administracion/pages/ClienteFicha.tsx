import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Lock } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  getCustomer, saveCustomer, listPaymentMethods, listWorkOrders, listInvoices,
  saveWorkOrder, cerrarWorkOrder, supabaseTrackingDelCliente, supabaseRecobrosDelCliente,
} from "../services/data";
import {
  Modal, TableWrap, thCls, tdCls, TextField, SelectField, TextAreaField, CheckField,
  btnPrimary, btnSecondary, btnMini, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import {
  fmtEur, fmtFecha, CENTRO_LABELS, CENTROS,
  TRACKING_STATUS_LABELS, TRACKING_STATUS_COLORS, RECOVERY_STATUS_LABELS, RECOVERY_STATUS_COLORS,
  type Customer, type PaymentMethod, type WorkOrder, type Invoice, type Centro,
  type PaymentTracking, type RecoveryCase,
} from "../types";

export default function ClienteFicha() {
  const { id } = useParams<{ id: string }>();
  const { perfil } = useAdminAuth();
  const puedeGestionar = perfil ? ["admin", "administracion"].includes(perfil.rol) : false;

  const [cliente, setCliente] = useState<Customer | null>(null);
  const [ots, setOts] = useState<WorkOrder[]>([]);
  const [facturas, setFacturas] = useState<Invoice[]>([]);
  const [seguimientos, setSeguimientos] = useState<PaymentTracking[]>([]);
  const [recobros, setRecobros] = useState<RecoveryCase[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(false);
  const [nuevaOt, setNuevaOt] = useState(false);

  const cargar = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    setError("");
    try {
      const [c, o, f, t, r] = await Promise.all([
        getCustomer(id),
        listWorkOrders(id),
        listInvoices(id),
        supabaseTrackingDelCliente(id),
        supabaseRecobrosDelCliente(id),
      ]);
      setCliente(c);
      setOts(o);
      setFacturas(f);
      setSeguimientos(t);
      setRecobros(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la ficha");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando) return <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>;
  if (!cliente) return <div className="p-6"><ErrorBox>{error || "Cliente no encontrado."}</ErrorBox></div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/administracion/clientes" className="rounded-lg p-1.5 hover:bg-slate-800"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-lg font-black">{cliente.name}</h1>
            <p className="text-sm text-slate-400">{cliente.tax_id ?? "Sin CIF/NIF"} · {cliente.phone ?? "sin teléfono"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {puedeGestionar && (
            <>
              <button onClick={() => setNuevaOt(true)} className={btnSecondary}>
                <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nueva OT</span>
              </button>
              <button onClick={() => setEditando(true)} className={btnPrimary}>
                <span className="flex items-center gap-1"><Pencil className="h-4 w-4" /> Editar ficha</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Ficha económica */}
      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <Lock className="h-3 w-3" /> Sección económica
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Dato label="Forma de pago habitual" valor={cliente.payment_method} />
            <Dato label="Giro bancario" valor={cliente.has_direct_debit ? "Sí" : "No"} />
            <Dato label="Requiere seguimiento" valor={cliente.has_direct_debit ? "No aplica" : cliente.requires_payment_tracking ? "Sí" : "No"} />
            <Dato label="Días previstos de pago" valor={String(cliente.expected_payment_days)} />
            <Dato label="Email administración" valor={cliente.admin_email} />
            <Dato label="Teléfono administración" valor={cliente.admin_phone} />
            <Dato label="Responsable de pagos" valor={cliente.payment_contact_name} />
            <Dato label="Límite interno de crédito" valor={cliente.internal_credit_limit != null ? fmtEur(cliente.internal_credit_limit) : null} />
          </div>
          {cliente.economic_notes && (
            <div className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-[12px] text-slate-300">{cliente.economic_notes}</div>
          )}
        </div>

        {/* Resumen seguimientos / recobros */}
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Seguimientos y recobros abiertos</div>
          {seguimientos.length === 0 && recobros.length === 0 && (
            <div className="text-[12px] text-slate-500">Este cliente no tiene seguimientos ni recobros abiertos.</div>
          )}
          <ul className="flex flex-col gap-1.5">
            {seguimientos.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-900 px-2.5 py-1.5">
                <div>
                  <div className="text-[12px] font-semibold">
                    {t.invoice?.invoice_number ? `Fra. ${t.invoice.invoice_number}` : t.work_order?.ot_number ? `OT ${t.work_order.ot_number}` : "Seguimiento"}
                    <span className="ml-2 text-amber-300">{fmtEur(t.pending_amount)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">Previsto: {fmtFecha(t.expected_payment_date)}</div>
                </div>
                <Pill className={TRACKING_STATUS_COLORS[t.status]}>{TRACKING_STATUS_LABELS[t.status]}</Pill>
              </li>
            ))}
            {recobros.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-900 px-2.5 py-1.5">
                <div>
                  <div className="text-[12px] font-semibold">
                    Recobro {r.invoice?.invoice_number ? `Fra. ${r.invoice.invoice_number}` : ""}
                    <span className="ml-2 text-rose-300">{fmtEur(r.pending_amount)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">Vencimiento: {fmtFecha(r.due_date)}</div>
                </div>
                <Pill className={RECOVERY_STATUS_COLORS[r.status]}>{RECOVERY_STATUS_LABELS[r.status]}</Pill>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-3">
            <Link to="/administracion/seguimiento" className="text-[12px] font-medium text-sky-400 hover:underline">Ir a seguimiento →</Link>
            <Link to="/administracion/recobros" className="text-[12px] font-medium text-sky-400 hover:underline">Ir a recobros →</Link>
          </div>
        </div>
      </div>

      {/* OTs */}
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Órdenes de trabajo</h2>
      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Nº OT</th>
            <th className={thCls}>Matrícula</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Estado</th>
            <th className={`${thCls} text-right`}>Importe</th>
            <th className={thCls}>Creada</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {ots.length === 0 && <EmptyRow cols={7} text="Sin órdenes de trabajo." />}
          {ots.map((o) => (
            <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className={`${tdCls} font-semibold`}>{o.ot_number ?? o.id.slice(0, 8)}</td>
              <td className={tdCls}>{o.vehicle_plate ?? "—"}</td>
              <td className={tdCls}>{CENTRO_LABELS[o.center]}</td>
              <td className={tdCls}>
                <Pill className={o.status === "abierta" ? "bg-sky-500/20 text-sky-300" : o.status === "cerrada" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                  {o.status}
                </Pill>
              </td>
              <td className={`${tdCls} text-right`}>{fmtEur(o.total_amount)}</td>
              <td className={tdCls}>{fmtFecha(o.created_at)}</td>
              <td className={`${tdCls} text-right`}>
                {puedeGestionar && o.status === "abierta" && (
                  <button
                    onClick={async () => {
                      try { await cerrarWorkOrder(o.id); await cargar(); }
                      catch (e) { setError(e instanceof Error ? e.message : "Error"); }
                    }}
                    className={btnMini}
                  >Cerrar OT</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {/* Facturas */}
      <h2 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wide text-slate-400">Facturas</h2>
      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Nº factura</th>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Vencimiento</th>
            <th className={`${thCls} text-right`}>Total</th>
            <th className={`${thCls} text-right`}>Pendiente</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {facturas.length === 0 && <EmptyRow cols={6} text="Sin facturas." />}
          {facturas.map((f) => (
            <tr key={f.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className={`${tdCls} font-semibold`}>{f.invoice_number}</td>
              <td className={tdCls}>{fmtFecha(f.invoice_date)}</td>
              <td className={tdCls}>{fmtFecha(f.due_date)}</td>
              <td className={`${tdCls} text-right`}>{fmtEur(f.total_amount)}</td>
              <td className={`${tdCls} text-right font-bold ${Number(f.pending_amount) > 0 ? "text-amber-300" : "text-emerald-300"}`}>{fmtEur(f.pending_amount)}</td>
              <td className={tdCls}>
                <Pill className={f.status === "pagada" ? "bg-emerald-500/20 text-emerald-300" : f.status === "parcial" ? "bg-orange-500/20 text-orange-300" : f.status === "anulada" ? "bg-slate-700 text-slate-400" : "bg-amber-500/20 text-amber-300"}>
                  {f.status}
                </Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editando && (
        <ModalCliente
          cliente={cliente}
          onClose={() => setEditando(false)}
          onSaved={() => { setEditando(false); void cargar(); }}
        />
      )}

      {nuevaOt && id && (
        <ModalNuevaOt
          customerId={id}
          onClose={() => setNuevaOt(false)}
          onSaved={() => { setNuevaOt(false); void cargar(); }}
        />
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-700/50 py-1">
      <span className="text-[11px] uppercase text-slate-500">{label}</span>
      <span className="text-right text-[12px] font-medium text-slate-200">{valor || "—"}</span>
    </div>
  );
}

// ── Modal crear/editar cliente (ficha económica) ─────────────
export function ModalCliente({ cliente, onClose, onSaved }: {
  cliente: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [nombre, setNombre] = useState(cliente?.name ?? "");
  const [cif, setCif] = useState(cliente?.tax_id ?? "");
  const [telefono, setTelefono] = useState(cliente?.phone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [formaPago, setFormaPago] = useState(cliente?.payment_method ?? "");
  const [giro, setGiro] = useState(cliente?.has_direct_debit ?? false);
  const [seguimiento, setSeguimiento] = useState(cliente?.requires_payment_tracking ?? true);
  const [dias, setDias] = useState(String(cliente?.expected_payment_days ?? 30));
  const [emailAdmin, setEmailAdmin] = useState(cliente?.admin_email ?? "");
  const [telAdmin, setTelAdmin] = useState(cliente?.admin_phone ?? "");
  const [contacto, setContacto] = useState(cliente?.payment_contact_name ?? "");
  const [limite, setLimite] = useState(cliente?.internal_credit_limit != null ? String(cliente.internal_credit_limit) : "");
  const [notas, setNotas] = useState(cliente?.economic_notes ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listPaymentMethods().then(setFormas).catch(() => { /* opcional */ });
  }, []);

  async function guardar() {
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    setError("");
    try {
      await saveCustomer({
        id: cliente?.id,
        name: nombre.trim(),
        tax_id: cif.trim() || null,
        phone: telefono.trim() || null,
        email: email.trim() || null,
        payment_method: formaPago || null,
        has_direct_debit: giro,
        requires_payment_tracking: seguimiento,
        expected_payment_days: parseInt(dias) || 30,
        admin_email: emailAdmin.trim() || null,
        admin_phone: telAdmin.trim() || null,
        payment_contact_name: contacto.trim() || null,
        internal_credit_limit: limite ? parseFloat(limite.replace(",", ".")) : null,
        economic_notes: notas.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando el cliente");
      setGuardando(false);
    }
  }

  return (
    <Modal title={cliente ? `Editar cliente — ${cliente.name}` : "Nuevo cliente"} onClose={onClose} wide
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Guardar cliente"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nombre / Razón social" value={nombre} onChange={setNombre} />
        <TextField label="CIF/NIF" value={cif} onChange={setCif} />
        <TextField label="Teléfono" value={telefono} onChange={setTelefono} />
        <TextField label="Email" value={email} onChange={setEmail} type="email" />
      </div>

      <div className="my-3 border-t border-slate-700 pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Condiciones económicas</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Forma de pago habitual" value={formaPago} onChange={setFormaPago}>
          <option value="">—</option>
          {formas.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
        </SelectField>
        <TextField label="Días previstos de pago" value={dias} onChange={setDias} type="number" />
        <CheckField label="Tiene giro bancario domiciliado" checked={giro} onChange={setGiro} />
        <CheckField label="Requiere seguimiento de pago" checked={seguimiento} onChange={setSeguimiento} />
      </div>
      {giro && (
        <div className="mt-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-[12px] text-slate-400">
          Con giro bancario el cliente NO entra en seguimiento automático.
        </div>
      )}

      <div className="my-3 border-t border-slate-700 pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Contacto de administración</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Persona responsable de pagos" value={contacto} onChange={setContacto} />
        <TextField label="Email de administración" value={emailAdmin} onChange={setEmailAdmin} type="email" />
        <TextField label="Teléfono de administración" value={telAdmin} onChange={setTelAdmin} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField label="Límite interno de crédito (€, opcional)" value={limite} onChange={setLimite} />
      </div>
      <div className="mt-3">
        <TextAreaField label="Observaciones económicas" value={notas} onChange={setNotas} rows={2} />
      </div>
    </Modal>
  );
}

// ── Modal nueva OT ───────────────────────────────────────────
function ModalNuevaOt({ customerId, onClose, onSaved }: {
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [matricula, setMatricula] = useState("");
  const [importe, setImporte] = useState("");
  const [centro, setCentro] = useState<Centro>("tarragona");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const total = parseFloat(importe.replace(",", "."));
    setGuardando(true);
    setError("");
    try {
      await saveWorkOrder({
        customer_id: customerId,
        ot_number: numero.trim() || null,
        vehicle_plate: matricula.trim().toUpperCase() || null,
        total_amount: isNaN(total) ? 0 : total,
        center: centro,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando la OT");
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nueva orden de trabajo" onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Crear OT"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nº OT" value={numero} onChange={setNumero} placeholder="OT-2026-0001" />
        <TextField label="Matrícula" value={matricula} onChange={setMatricula} placeholder="0000XXX" />
        <TextField label="Importe (€)" value={importe} onChange={setImporte} placeholder="0,00" />
        <SelectField label="Centro" value={centro} onChange={(v) => setCentro(v as Centro)}>
          {CENTROS.map((c) => <option key={c} value={c}>{CENTRO_LABELS[c]}</option>)}
        </SelectField>
      </div>
      <p className="mt-3 text-[12px] text-slate-500">
        Al cerrar la OT, si el cliente no tiene giro bancario y requiere seguimiento, se creará automáticamente un seguimiento de pago (si no hay factura emitida).
      </p>
    </Modal>
  );
}
