import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, List, Plus, Mail, MessageCircle, Phone, StickyNote, Euro, ArrowRightCircle } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  listTracking, listTrackingActions, listCustomers, listWorkOrders, listPaymentMethods,
  addTrackingAction, cambiarEstadoTracking, updateTracking, pasarARecobro,
  registrarPagoVinculado, saveInvoice,
} from "../services/data";
import {
  Card, Modal, TableWrap, thCls, tdCls, TextField, SelectField, TextAreaField, Field,
  btnPrimary, btnSecondary, inputCls, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import {
  fmtEur, fmtFecha, fmtFechaHora, hoyISO, KANBAN_COLUMNS,
  TRACKING_STATUS_LABELS, TRACKING_STATUS_COLORS, ACTION_TYPE_LABELS,
  type PaymentTracking, type TrackingStatus, type TrackingAction, type Customer,
  type PaymentMethod, type Centro, type WorkOrder,
} from "../types";

export default function Seguimiento() {
  const { perfil } = useAdminAuth();
  const puedeGestionar = perfil ? ["admin", "administracion"].includes(perfil.rol) : false;

  const [vista, setVista] = useState<"kanban" | "tabla">("kanban");
  const [items, setItems] = useState<PaymentTracking[]>([]);
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<PaymentTracking | null>(null);
  const [nuevaFactura, setNuevaFactura] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [t, fp] = await Promise.all([listTracking(), listPaymentMethods(true)]);
      setItems(t);
      setFormas(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando seguimientos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = hoyISO();
  const porEstado = useCallback(
    (s: TrackingStatus) => items.filter((t) => t.status === s),
    [items]
  );
  const previstosHoy = items.filter((t) => t.expected_payment_date === hoy).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Seguimiento de pagos</h1>
          <p className="text-sm text-slate-400">Clientes sin giro bancario — control preventivo.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-xl border border-slate-700">
            <button
              onClick={() => setVista("kanban")}
              className={`flex items-center gap-1 px-3 py-2 text-[12px] font-medium ${vista === "kanban" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            ><LayoutGrid className="h-4 w-4" /> Kanban</button>
            <button
              onClick={() => setVista("tabla")}
              className={`flex items-center gap-1 px-3 py-2 text-[12px] font-medium ${vista === "tabla" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            ><List className="h-4 w-4" /> Tabla</button>
          </div>
          {puedeGestionar && (
            <button onClick={() => setNuevaFactura(true)} className={btnPrimary}>
              <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nueva factura</span>
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Tarjetas resumen */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card title="Pendiente de pago" value={String(porEstado("pendiente").length)} accent="text-amber-300" />
        <Card title="Recordatorios enviados" value={String(porEstado("recordatorio_enviado").length)} accent="text-sky-300" />
        <Card title="Esperando transferencia" value={String(porEstado("esperando_transferencia").length)} accent="text-indigo-300" />
        <Card title="Pagos parciales" value={String(porEstado("pago_parcial").length)} accent="text-orange-300" />
        <Card title="Pagos previstos hoy" value={String(previstosHoy)} accent="text-emerald-300" />
      </div>

      {cargando ? (
        <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>
      ) : vista === "kanban" ? (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map((estado) => (
            <div key={estado} className="w-64 shrink-0 rounded-lg border border-slate-700 bg-slate-800/60">
              <div className="border-b border-slate-700 px-3 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
                  {TRACKING_STATUS_LABELS[estado]}
                </span>
                <span className="ml-2 rounded-full bg-slate-700 px-1.5 text-[10px] font-bold text-slate-300">
                  {porEstado(estado).length}
                </span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {porEstado(estado).length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-[11px] text-slate-600">Vacío</div>
                )}
                {porEstado(estado).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setDetalle(t)}
                    className="rounded-lg bg-slate-900 p-2.5 text-left hover:ring-1 hover:ring-sky-500"
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="truncate text-[12px] font-bold text-slate-100">{t.customer?.name ?? "Cliente"}</span>
                      <span className="text-[12px] font-black text-amber-300">{fmtEur(t.pending_amount)}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t.invoice?.invoice_number ? `Fra. ${t.invoice.invoice_number}` : t.work_order?.ot_number ? `OT ${t.work_order.ot_number}` : "Sin documento"}
                    </div>
                    <div className={`text-[11px] ${t.expected_payment_date && t.expected_payment_date < hoy ? "font-bold text-rose-300" : "text-slate-500"}`}>
                      Previsto: {fmtFecha(t.expected_payment_date)}
                    </div>
                    {t.next_action_date && (
                      <div className="text-[11px] text-sky-300">Próx. acción: {fmtFecha(t.next_action_date)}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-700">
              <th className={thCls}>Cliente</th>
              <th className={thCls}>CIF/NIF</th>
              <th className={thCls}>OT</th>
              <th className={thCls}>Factura</th>
              <th className={thCls}>Fecha factura</th>
              <th className={thCls}>Previsto</th>
              <th className={`${thCls} text-right`}>Total</th>
              <th className={`${thCls} text-right`}>Pendiente</th>
              <th className={thCls}>Estado</th>
              <th className={thCls}>Próx. acción</th>
              <th className={thCls}>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <EmptyRow cols={11} text="No hay seguimientos abiertos." />}
            {items.map((t) => (
              <tr key={t.id} onClick={() => setDetalle(t)} className="cursor-pointer border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className={`${tdCls} font-semibold`}>{t.customer?.name ?? "—"}</td>
                <td className={tdCls}>{t.customer?.tax_id ?? "—"}</td>
                <td className={tdCls}>{t.work_order?.ot_number ?? "—"}</td>
                <td className={tdCls}>{t.invoice?.invoice_number ?? "—"}</td>
                <td className={tdCls}>{fmtFecha(t.invoice?.invoice_date)}</td>
                <td className={`${tdCls} ${t.expected_payment_date && t.expected_payment_date < hoy ? "font-bold text-rose-300" : ""}`}>{fmtFecha(t.expected_payment_date)}</td>
                <td className={`${tdCls} text-right`}>{fmtEur(t.total_amount)}</td>
                <td className={`${tdCls} text-right font-bold text-amber-300`}>{fmtEur(t.pending_amount)}</td>
                <td className={tdCls}><Pill className={TRACKING_STATUS_COLORS[t.status]}>{TRACKING_STATUS_LABELS[t.status]}</Pill></td>
                <td className={tdCls}>{fmtFecha(t.next_action_date)}</td>
                <td className={tdCls}>{t.responsible?.nombre ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {detalle && (
        <ModalDetalle
          tracking={detalle}
          formas={formas}
          puedeGestionar={puedeGestionar}
          userId={perfil?.id ?? null}
          onClose={() => setDetalle(null)}
          onChanged={() => { setDetalle(null); void cargar(); }}
        />
      )}

      {nuevaFactura && (
        <ModalNuevaFactura
          onClose={() => setNuevaFactura(false)}
          onSaved={() => { setNuevaFactura(false); void cargar(); }}
        />
      )}
    </div>
  );
}

// ── Detalle de seguimiento + acciones rápidas ────────────────
function ModalDetalle({ tracking: t, formas, puedeGestionar, userId, onClose, onChanged }: {
  tracking: PaymentTracking;
  formas: PaymentMethod[];
  puedeGestionar: boolean;
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [historial, setHistorial] = useState<TrackingAction[]>([]);
  const [nota, setNota] = useState("");
  const [proximaAccion, setProximaAccion] = useState("");
  const [importePago, setImportePago] = useState("");
  const [formaPago, setFormaPago] = useState(formas[0]?.name ?? "Transferencia");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cliente = t.customer;
  const doc = t.invoice?.invoice_number ? `la factura ${t.invoice.invoice_number}` : t.work_order?.ot_number ? `la orden de trabajo ${t.work_order.ot_number}` : "el trabajo realizado";

  const cargarHistorial = useCallback(async () => {
    try { setHistorial(await listTrackingActions(t.id)); } catch { /* historial no bloquea */ }
  }, [t.id]);
  useEffect(() => { void cargarHistorial(); }, [cargarHistorial]);

  async function accion(fn: () => Promise<void>, msgOk?: string) {
    setTrabajando(true);
    setError("");
    try {
      await fn();
      if (msgOk) { setMensaje(msgOk); await cargarHistorial(); setTrabajando(false); }
      else onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setTrabajando(false);
    }
  }

  function enviarRecordatorioEmail() {
    const email = cliente?.admin_email || cliente?.email;
    if (!email) { setError("El cliente no tiene email de administración."); return; }
    const asunto = encodeURIComponent(`Recordatorio de pago — ${doc}`);
    const cuerpo = encodeURIComponent(
      `Hola${cliente?.payment_contact_name ? " " + cliente.payment_contact_name : ""},\n\n` +
      `Le recordamos que ${doc} con importe pendiente de ${fmtEur(t.pending_amount)} ` +
      `tiene fecha prevista de pago ${fmtFecha(t.expected_payment_date)}.\n\n` +
      `Si ya ha realizado el pago, ignore este mensaje.\n\nGracias,\nAdministración SEA`
    );
    window.open(`mailto:${email}?subject=${asunto}&body=${cuerpo}`);
    void accion(async () => {
      await addTrackingAction(t.id, "recordatorio_email", userId, `Recordatorio enviado a ${email}`);
      await updateTracking(t.id, { status: "recordatorio_enviado" });
    });
  }

  function prepararWhatsApp() {
    const tel = (cliente?.admin_phone || cliente?.phone || "").replace(/[^\d]/g, "");
    if (!tel) { setError("El cliente no tiene teléfono de administración."); return; }
    const texto = encodeURIComponent(
      `Hola${cliente?.payment_contact_name ? " " + cliente.payment_contact_name : ""}, le recordamos que ${doc} ` +
      `tiene un importe pendiente de ${fmtEur(t.pending_amount)} con fecha prevista de pago ${fmtFecha(t.expected_payment_date)}. Gracias. — Administración SEA`
    );
    window.open(`https://wa.me/${tel.startsWith("34") ? tel : "34" + tel}?text=${texto}`, "_blank");
    void accion(async () => {
      await addTrackingAction(t.id, "whatsapp", userId, "Mensaje de WhatsApp preparado");
    }, "WhatsApp preparado y registrado en el historial.");
  }

  async function registrarPago(total: boolean) {
    const amount = total ? Number(t.pending_amount) : parseFloat(importePago.replace(",", "."));
    if (!amount || amount <= 0) { setError("Introduce un importe válido."); return; }
    await accion(async () => {
      await registrarPagoVinculado({
        customerId: t.customer_id,
        workOrderId: t.work_order_id,
        invoiceId: t.invoice_id,
        amount,
        paymentMethod: formaPago,
        center: (t.work_order?.center as Centro) ?? "tarragona",
        userId,
        notes: `Pago ${total ? "total" : "parcial"} desde seguimiento`,
      });
      await addTrackingAction(t.id, total ? "pago_total" : "pago_parcial", userId, `${fmtEur(amount)} (${formaPago})`);
    });
  }

  return (
    <Modal title={`Seguimiento — ${cliente?.name ?? "Cliente"}`} onClose={onClose} wide
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {puedeGestionar && (
              <>
                <button disabled={trabajando} onClick={enviarRecordatorioEmail} className={btnSecondary}>
                  <span className="flex items-center gap-1"><Mail className="h-4 w-4" /> Recordatorio email</span>
                </button>
                <button disabled={trabajando} onClick={prepararWhatsApp} className={btnSecondary}>
                  <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
                </button>
                <button disabled={trabajando} onClick={() => void accion(async () => {
                  await addTrackingAction(t.id, "llamada", userId, nota || "Llamada realizada", proximaAccion || undefined);
                }, "Llamada registrada.")} className={btnSecondary}>
                  <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> Registrar llamada</span>
                </button>
                <button disabled={trabajando} onClick={() => void accion(async () => {
                  const casoId = await pasarARecobro(t.id);
                  if (!casoId) throw new Error("No se pudo crear el expediente");
                })} className={`${btnSecondary} text-rose-300`}>
                  <span className="flex items-center gap-1"><ArrowRightCircle className="h-4 w-4" /> Pasar a recobro</span>
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className={btnPrimary}>Cerrar</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      {mensaje && <div className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{mensaje}</div>}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Datos */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Datos</div>
          <Dato label="Cliente" valor={cliente?.name} />
          <Dato label="CIF/NIF" valor={cliente?.tax_id} />
          <Dato label="Contacto" valor={cliente?.payment_contact_name} />
          <Dato label="Teléfono" valor={cliente?.admin_phone || cliente?.phone} />
          <Dato label="Email" valor={cliente?.admin_email || cliente?.email} />
          <Dato label="Nº OT" valor={t.work_order?.ot_number} />
          <Dato label="Nº Factura" valor={t.invoice?.invoice_number} />
          <Dato label="Fecha factura" valor={fmtFecha(t.invoice?.invoice_date)} />
          <Dato label="Previsto" valor={fmtFecha(t.expected_payment_date)} />
          <Dato label="Forma prevista" valor={t.expected_payment_method} />
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2">
            <span className="text-[11px] uppercase text-slate-400">Pendiente</span>
            <span className="text-lg font-black text-amber-300">{fmtEur(t.pending_amount)}</span>
          </div>
          <div className="mt-2"><Pill className={TRACKING_STATUS_COLORS[t.status]}>{TRACKING_STATUS_LABELS[t.status]}</Pill></div>
        </div>

        {/* Acciones */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Gestionar</div>
          {puedeGestionar ? (
            <div className="flex flex-col gap-2">
              <SelectField label="Cambiar estado" value={t.status} onChange={(v) => void accion(async () => {
                await cambiarEstadoTracking(t.id, v as TrackingStatus, userId);
              })}>
                {(Object.keys(TRACKING_STATUS_LABELS) as TrackingStatus[]).map((s) => (
                  <option key={s} value={s}>{TRACKING_STATUS_LABELS[s]}</option>
                ))}
              </SelectField>
              <TextAreaField label="Nota" value={nota} onChange={setNota} rows={2} placeholder="Comentario de la gestión…" />
              <Field label="Próxima acción (fecha)">
                <input type="date" value={proximaAccion} onChange={(e) => setProximaAccion(e.target.value)} className={inputCls} />
              </Field>
              <button disabled={trabajando} onClick={() => void accion(async () => {
                if (!nota.trim() && !proximaAccion) throw new Error("Escribe una nota o una fecha de próxima acción.");
                await addTrackingAction(t.id, "nota", userId, nota.trim() || "Próxima acción planificada", proximaAccion || undefined);
                setNota(""); setProximaAccion("");
              }, "Nota guardada.")} className={btnSecondary}>
                <span className="flex items-center justify-center gap-1"><StickyNote className="h-4 w-4" /> Añadir nota</span>
              </button>

              <div className="mt-2 border-t border-slate-700 pt-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Registrar pago</div>
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Importe (€)" value={importePago} onChange={setImportePago} placeholder="0,00" />
                  <SelectField label="Forma" value={formaPago} onChange={setFormaPago}>
                    {formas.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                  </SelectField>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button disabled={trabajando} onClick={() => void registrarPago(false)} className={btnSecondary}>
                    <span className="flex items-center justify-center gap-1"><Euro className="h-4 w-4" /> Pago parcial</span>
                  </button>
                  <button disabled={trabajando} onClick={() => void registrarPago(true)} className={btnPrimary}>
                    <span className="flex items-center justify-center gap-1"><Euro className="h-4 w-4" /> Pago total</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Solo lectura.</div>
          )}
        </div>

        {/* Historial */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Historial de gestiones</div>
          {historial.length === 0 ? (
            <div className="text-[12px] text-slate-500">Sin gestiones registradas.</div>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {historial.map((h) => (
                <li key={h.id} className="rounded-lg bg-slate-800 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-300">{ACTION_TYPE_LABELS[h.action_type] ?? h.action_type}</span>
                    <span className="text-[10px] text-slate-500">{fmtFechaHora(h.action_date)}</span>
                  </div>
                  {h.notes && <div className="text-[11px] text-slate-300">{h.notes}</div>}
                  <div className="text-[10px] text-slate-500">
                    {h.user?.nombre ?? ""}{h.next_action_date ? ` · próx.: ${fmtFecha(h.next_action_date)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Dato({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 py-1">
      <span className="text-[11px] uppercase text-slate-500">{label}</span>
      <span className="text-right text-[12px] font-medium text-slate-200">{valor || "—"}</span>
    </div>
  );
}

// ── Nueva factura (dispara el seguimiento automático) ────────
function ModalNuevaFactura({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [ots, setOts] = useState<WorkOrder[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [vencimiento, setVencimiento] = useState("");
  const [importe, setImporte] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listCustomers().then(setClientes).catch(() => setError("No se pudieron cargar los clientes"));
  }, []);

  useEffect(() => {
    if (!customerId) { setOts([]); return; }
    listWorkOrders(customerId).then(setOts).catch(() => { /* opcional */ });
  }, [customerId]);

  const clienteSel = clientes.find((c) => c.id === customerId);

  async function guardar() {
    const total = parseFloat(importe.replace(",", "."));
    if (!customerId) { setError("Selecciona un cliente."); return; }
    if (!numero.trim()) { setError("Introduce el número de factura."); return; }
    if (!total || total <= 0) { setError("Introduce un importe válido."); return; }
    setGuardando(true);
    setError("");
    try {
      await saveInvoice({
        customer_id: customerId,
        work_order_id: workOrderId || null,
        invoice_number: numero.trim(),
        invoice_date: fecha,
        due_date: vencimiento || null,
        total_amount: total,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando la factura");
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nueva factura" onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Crear factura"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Cliente" value={customerId} onChange={(v) => { setCustomerId(v); setWorkOrderId(""); }}>
          <option value="">— Selecciona —</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="OT relacionada (opcional)" value={workOrderId} onChange={setWorkOrderId}>
          <option value="">—</option>
          {ots.map((o) => <option key={o.id} value={o.id}>{o.ot_number ?? o.id.slice(0, 8)} · {o.vehicle_plate ?? ""} · {fmtEur(o.total_amount)}</option>)}
        </SelectField>
        <TextField label="Nº factura" value={numero} onChange={setNumero} placeholder="F-2026-0001" />
        <TextField label="Importe total (€)" value={importe} onChange={setImporte} placeholder="0,00" />
        <Field label="Fecha factura"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></Field>
        <Field label="Vencimiento (opcional)"><input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} className={inputCls} /></Field>
      </div>
      {clienteSel && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${clienteSel.has_direct_debit || !clienteSel.requires_payment_tracking
          ? "border-slate-600 bg-slate-900 text-slate-400"
          : "border-sky-500/40 bg-sky-500/10 text-sky-300"}`}>
          {clienteSel.has_direct_debit
            ? "Este cliente tiene giro bancario: NO se creará seguimiento automático."
            : clienteSel.requires_payment_tracking
              ? "Este cliente no tiene giro bancario: al crear la factura se generará un seguimiento de pago automáticamente."
              : "Este cliente tiene el seguimiento de pagos desactivado en su ficha."}
        </div>
      )}
    </Modal>
  );
}
