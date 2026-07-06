import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Download, Pencil, Ban } from "lucide-react";
import * as XLSX from "xlsx";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  listPayments, listCustomers, listPaymentMethods, listWorkOrders, listInvoices,
  saveCobro, anularCobro, type NuevoCobro,
} from "../services/data";
import {
  Card, Modal, TableWrap, thCls, tdCls, TextField, SelectField, TextAreaField,
  btnPrimary, btnSecondary, btnDanger, btnMini, inputCls, Field, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import {
  fmtEur, fmtFecha, hoyISO, CENTRO_LABELS, CENTROS,
  type Payment, type Customer, type PaymentMethod, type WorkOrder, type Invoice, type Centro,
} from "../types";

export default function CobrosDia() {
  const { perfil } = useAdminAuth();
  const puedeGestionar = perfil && ["admin", "administracion"].includes(perfil.rol);
  const puedeRegistrar = puedeGestionar || perfil?.rol === "recepcion";

  // Filtros
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroCentro, setFiltroCentro] = useState<Centro | "">("");
  const [filtroForma, setFiltroForma] = useState("");

  // Datos
  const [cobros, setCobros] = useState<Payment[]>([]);
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Modales
  const [editando, setEditando] = useState<Payment | null | "nuevo">(null);
  const [anulando, setAnulando] = useState<Payment | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [c, cl, fp] = await Promise.all([
        listPayments({ desde, hasta, customerId: filtroCliente || undefined, center: filtroCentro, paymentMethod: filtroForma || undefined }),
        listCustomers(),
        listPaymentMethods(),
      ]);
      setCobros(c);
      setClientes(cl);
      setFormas(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando cobros");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, filtroCliente, filtroCentro, filtroForma]);

  useEffect(() => { void cargar(); }, [cargar]);

  const activos = useMemo(() => cobros.filter((c) => !c.is_cancelled), [cobros]);
  const totalPor = useCallback(
    (forma: string) => activos.filter((c) => c.payment_method === forma).reduce((s, c) => s + Number(c.amount), 0),
    [activos]
  );
  const total = activos.reduce((s, c) => s + Number(c.amount), 0);
  const sinVincular = activos.filter((c) => !c.invoice_id && !c.work_order_id).length;

  function exportar() {
    const filas = cobros.map((c) => ({
      Fecha: fmtFecha(c.payment_date),
      Cliente: c.customer?.name ?? "",
      "Matrícula": c.work_order?.vehicle_plate ?? "",
      "Nº OT": c.work_order?.ot_number ?? "",
      "Nº Factura": c.invoice?.invoice_number ?? "",
      Importe: Number(c.amount),
      "Forma de pago": c.payment_method,
      Usuario: c.registered_by_user?.nombre ?? "",
      Centro: CENTRO_LABELS[c.center],
      Observaciones: c.notes ?? "",
      Estado: c.is_cancelled ? `ANULADO: ${c.cancellation_reason ?? ""}` : "OK",
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cobros");
    XLSX.writeFile(wb, `cobros_${desde}_a_${hasta}.xlsx`);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Cobros del día</h1>
          <p className="text-sm text-slate-400">Cobros registrados en el taller.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportar} className={btnSecondary} disabled={cobros.length === 0}>
            <span className="flex items-center gap-1"><Download className="h-4 w-4" /> Exportar</span>
          </button>
          {puedeRegistrar && (
            <button onClick={() => setEditando("nuevo")} className={btnPrimary}>
              <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Registrar cobro</span>
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Tarjetas resumen */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card title="Total cobrado" value={fmtEur(total)} accent="text-emerald-300" />
        <Card title="Efectivo" value={fmtEur(totalPor("Efectivo"))} />
        <Card title="Tarjeta" value={fmtEur(totalPor("Tarjeta"))} />
        <Card title="Transferencia" value={fmtEur(totalPor("Transferencia"))} />
        <Card title="Stripe" value={fmtEur(totalPor("Stripe"))} />
        <Card title="Pendiente de revisar" value={String(sinVincular)} hint="cobros sin OT ni factura" accent={sinVincular > 0 ? "text-amber-300" : undefined} />
      </div>

      {/* Filtros */}
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></Field>
        <Field label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></Field>
        <SelectField label="Cliente" value={filtroCliente} onChange={setFiltroCliente}>
          <option value="">Todos</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Centro" value={filtroCentro} onChange={(v) => setFiltroCentro(v as Centro | "")}>
          <option value="">Todos</option>
          {CENTROS.map((c) => <option key={c} value={c}>{CENTRO_LABELS[c]}</option>)}
        </SelectField>
        <SelectField label="Forma de pago" value={filtroForma} onChange={setFiltroForma}>
          <option value="">Todas</option>
          {formas.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
        </SelectField>
      </div>

      {/* Tabla */}
      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Cliente</th>
            <th className={thCls}>Matrícula</th>
            <th className={thCls}>OT</th>
            <th className={thCls}>Factura</th>
            <th className={`${thCls} text-right`}>Importe</th>
            <th className={thCls}>Forma de pago</th>
            <th className={thCls}>Usuario</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Observaciones</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {cargando && <EmptyRow cols={11} text="Cargando…" />}
          {!cargando && cobros.length === 0 && <EmptyRow cols={11} text="No hay cobros en el periodo seleccionado." />}
          {!cargando && cobros.map((c) => (
            <tr key={c.id} className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${c.is_cancelled ? "opacity-50" : ""}`}>
              <td className={tdCls}>{fmtFecha(c.payment_date)}</td>
              <td className={`${tdCls} font-semibold`}>{c.customer?.name ?? "—"}</td>
              <td className={tdCls}>{c.work_order?.vehicle_plate ?? "—"}</td>
              <td className={tdCls}>{c.work_order?.ot_number ?? "—"}</td>
              <td className={tdCls}>{c.invoice?.invoice_number ?? "—"}</td>
              <td className={`${tdCls} text-right font-bold ${c.is_cancelled ? "line-through" : "text-emerald-300"}`}>{fmtEur(c.amount)}</td>
              <td className={tdCls}>{c.payment_method}</td>
              <td className={tdCls}>{c.registered_by_user?.nombre ?? "—"}</td>
              <td className={tdCls}>{CENTRO_LABELS[c.center]}</td>
              <td className={`${tdCls} max-w-[180px] truncate text-slate-400`} title={c.notes ?? ""}>
                {c.is_cancelled ? <Pill className="bg-rose-500/20 text-rose-300">Anulado: {c.cancellation_reason}</Pill> : (c.notes ?? "—")}
              </td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                {puedeGestionar && !c.is_cancelled && (
                  <span className="flex justify-end gap-1">
                    <button onClick={() => setEditando(c)} className={btnMini} title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setAnulando(c)} className={`${btnMini} text-rose-300`} title="Anular"><Ban className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editando && (
        <ModalCobro
          cobro={editando === "nuevo" ? null : editando}
          clientes={clientes}
          formas={formas.filter((f) => f.active)}
          userId={perfil?.id ?? null}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); void cargar(); }}
        />
      )}

      {anulando && (
        <ModalAnular
          cobro={anulando}
          onClose={() => setAnulando(null)}
          onDone={() => { setAnulando(null); void cargar(); }}
        />
      )}
    </div>
  );
}

// ── Modal registrar/editar cobro ─────────────────────────────
function ModalCobro({ cobro, clientes, formas, userId, onClose, onSaved }: {
  cobro: Payment | null;
  clientes: Customer[];
  formas: PaymentMethod[];
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState(cobro?.customer_id ?? "");
  const [workOrderId, setWorkOrderId] = useState(cobro?.work_order_id ?? "");
  const [invoiceId, setInvoiceId] = useState(cobro?.invoice_id ?? "");
  const [fecha, setFecha] = useState(cobro?.payment_date ?? hoyISO());
  const [importe, setImporte] = useState(cobro ? String(cobro.amount) : "");
  const [forma, setForma] = useState(cobro?.payment_method ?? (formas[0]?.name ?? "Efectivo"));
  const [centro, setCentro] = useState<Centro>(cobro?.center ?? "tarragona");
  const [referencia, setReferencia] = useState(cobro?.reference ?? "");
  const [notas, setNotas] = useState(cobro?.notes ?? "");
  const [ots, setOts] = useState<WorkOrder[]>([]);
  const [facturas, setFacturas] = useState<Invoice[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerId) { setOts([]); setFacturas([]); return; }
    (async () => {
      try {
        const [o, f] = await Promise.all([listWorkOrders(customerId), listInvoices(customerId)]);
        setOts(o);
        setFacturas(f);
      } catch { /* listados auxiliares: no bloquean el cobro */ }
    })();
  }, [customerId]);

  async function guardar() {
    const amount = parseFloat(importe.replace(",", "."));
    if (!amount || amount <= 0) { setError("Introduce un importe válido."); return; }
    if (!forma) { setError("Selecciona la forma de pago."); return; }
    setGuardando(true);
    setError("");
    try {
      const payload: NuevoCobro = {
        id: cobro?.id,
        customer_id: customerId || null,
        work_order_id: workOrderId || null,
        invoice_id: invoiceId || null,
        payment_date: fecha,
        amount,
        payment_method: forma,
        reference: referencia || null,
        center: centro,
        notes: notas || null,
      };
      await saveCobro(payload, userId);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando el cobro");
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={cobro ? "Editar cobro" : "Registrar cobro"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Guardar cobro"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Cliente" value={customerId} onChange={(v) => { setCustomerId(v); setWorkOrderId(""); setInvoiceId(""); }}>
          <option value="">— Sin cliente (cobro directo) —</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <Field label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></Field>
        <SelectField label="Nº OT (opcional)" value={workOrderId} onChange={setWorkOrderId}>
          <option value="">—</option>
          {ots.map((o) => <option key={o.id} value={o.id}>{o.ot_number ?? o.id.slice(0, 8)} · {o.vehicle_plate ?? "sin matrícula"} · {fmtEur(o.total_amount)}</option>)}
        </SelectField>
        <SelectField label="Nº Factura (opcional)" value={invoiceId} onChange={setInvoiceId}>
          <option value="">—</option>
          {facturas.map((f) => <option key={f.id} value={f.id}>{f.invoice_number} · pendiente {fmtEur(f.pending_amount)}</option>)}
        </SelectField>
        <TextField label="Importe (€)" value={importe} onChange={setImporte} placeholder="0,00" />
        <SelectField label="Forma de pago" value={forma} onChange={setForma}>
          {formas.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
        </SelectField>
        <SelectField label="Centro" value={centro} onChange={(v) => setCentro(v as Centro)}>
          {CENTROS.map((c) => <option key={c} value={c}>{CENTRO_LABELS[c]}</option>)}
        </SelectField>
        <TextField label="Referencia (opcional)" value={referencia} onChange={setReferencia} placeholder="Nº operación, recibo…" />
      </div>
      <div className="mt-3">
        <TextAreaField label="Observaciones" value={notas} onChange={setNotas} rows={2} />
      </div>
    </Modal>
  );
}

// ── Modal anular con motivo obligatorio ──────────────────────
function ModalAnular({ cobro, onClose, onDone }: { cobro: Payment; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function anular() {
    if (!motivo.trim()) { setError("El motivo de anulación es obligatorio."); return; }
    setGuardando(true);
    setError("");
    try {
      await anularCobro(cobro.id, motivo.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error anulando el cobro");
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Anular cobro"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={anular} disabled={guardando} className={btnDanger}>{guardando ? "Anulando…" : "Anular cobro"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <p className="mb-3 text-sm text-slate-300">
        Vas a anular el cobro de <strong className="text-slate-100">{fmtEur(cobro.amount)}</strong>
        {cobro.customer?.name ? <> de <strong className="text-slate-100">{cobro.customer.name}</strong></> : null}.
        El cobro quedará marcado como anulado (no se borra).
      </p>
      <TextAreaField label="Motivo de anulación (obligatorio)" value={motivo} onChange={setMotivo} rows={3} placeholder="Ej.: importe duplicado, error de forma de pago…" />
    </Modal>
  );
}
