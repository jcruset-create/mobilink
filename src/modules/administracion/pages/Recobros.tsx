import { useCallback, useEffect, useState } from "react";
import { Mail, MessageCircle, Phone, StickyNote, Euro, Handshake, CheckCircle2 } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  listRecoveryCases, listRecoveryActions, listPaymentMethods,
  addRecoveryAction, cambiarEstadoRecovery, cambiarPrioridadRecovery, updateRecovery,
  registrarPagoVinculado,
} from "../services/data";
import {
  Card, Modal, TableWrap, thCls, tdCls, TextField, SelectField, TextAreaField, Field,
  btnPrimary, btnSecondary, inputCls, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import {
  fmtEur, fmtFecha, fmtFechaHora, hoyISO, diasVencidos,
  RECOVERY_STATUS_LABELS, RECOVERY_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, ACTION_TYPE_LABELS,
  type RecoveryCase, type RecoveryStatus, type RecoveryPriority, type RecoveryAction,
  type PaymentMethod, type Centro,
} from "../types";

export default function Recobros() {
  const { perfil } = useAdminAuth();
  const puedeGestionar = perfil ? ["admin", "administracion"].includes(perfil.rol) : false;

  const [casos, setCasos] = useState<RecoveryCase[]>([]);
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<RecoveryCase | null>(null);
  const [filtroPrioridad, setFiltroPrioridad] = useState<RecoveryPriority | "">("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [c, fp] = await Promise.all([listRecoveryCases(), listPaymentMethods(true)]);
      setCasos(c);
      setFormas(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando recobros");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = hoyISO();
  const visibles = filtroPrioridad ? casos.filter((c) => c.priority === filtroPrioridad) : casos;
  const totalPendiente = casos.reduce((s, c) => s + Number(c.pending_amount || 0), 0);
  const compromisos = casos.filter((c) => c.status === "compromiso_pago").length;
  const prioridadAlta = casos.filter((c) => c.priority !== "normal").length;
  const accionesVencidas = casos.filter((c) => c.next_action_date && c.next_action_date < hoy).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Recobros</h1>
          <p className="text-sm text-slate-400">Facturas vencidas o retrasadas.</p>
        </div>
        <div className="w-44">
          <SelectField label="Prioridad" value={filtroPrioridad} onChange={(v) => setFiltroPrioridad(v as RecoveryPriority | "")}>
            <option value="">Todas</option>
            {(Object.keys(PRIORITY_LABELS) as RecoveryPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </SelectField>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Tarjetas resumen */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card title="Total pendiente" value={fmtEur(totalPendiente)} accent="text-rose-300" />
        <Card title="Casos abiertos" value={String(casos.length)} />
        <Card title="Compromisos de pago" value={String(compromisos)} accent="text-teal-300" />
        <Card title="Prioridad alta" value={String(prioridadAlta)} accent="text-amber-300" />
        <Card title="Acciones vencidas" value={String(accionesVencidas)} accent={accionesVencidas > 0 ? "text-rose-300" : undefined} />
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Cliente</th>
            <th className={thCls}>Factura</th>
            <th className={thCls}>OT</th>
            <th className={thCls}>Vencimiento</th>
            <th className={`${thCls} text-right`}>Días venc.</th>
            <th className={`${thCls} text-right`}>Inicial</th>
            <th className={`${thCls} text-right`}>Pendiente</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Prioridad</th>
            <th className={thCls}>Próx. acción</th>
            <th className={thCls}>Responsable</th>
          </tr>
        </thead>
        <tbody>
          {cargando && <EmptyRow cols={11} text="Cargando…" />}
          {!cargando && visibles.length === 0 && <EmptyRow cols={11} text="No hay expedientes de recobro abiertos." />}
          {!cargando && visibles.map((c) => {
            const dias = diasVencidos(c.due_date);
            return (
              <tr key={c.id} onClick={() => setDetalle(c)} className="cursor-pointer border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className={`${tdCls} font-semibold`}>{c.customer?.name ?? "—"}</td>
                <td className={tdCls}>{c.invoice?.invoice_number ?? "—"}</td>
                <td className={tdCls}>{c.work_order?.ot_number ?? "—"}</td>
                <td className={tdCls}>{fmtFecha(c.due_date)}</td>
                <td className={`${tdCls} text-right font-bold ${dias > 30 ? "text-rose-300" : dias > 0 ? "text-amber-300" : "text-slate-400"}`}>{dias}</td>
                <td className={`${tdCls} text-right`}>{fmtEur(c.initial_amount)}</td>
                <td className={`${tdCls} text-right font-bold text-rose-300`}>{fmtEur(c.pending_amount)}</td>
                <td className={tdCls}><Pill className={RECOVERY_STATUS_COLORS[c.status]}>{RECOVERY_STATUS_LABELS[c.status]}</Pill></td>
                <td className={tdCls}><Pill className={PRIORITY_COLORS[c.priority]}>{PRIORITY_LABELS[c.priority]}</Pill></td>
                <td className={`${tdCls} ${c.next_action_date && c.next_action_date < hoy ? "font-bold text-rose-300" : ""}`}>{fmtFecha(c.next_action_date)}</td>
                <td className={tdCls}>{c.responsible?.nombre ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {detalle && (
        <ModalDetalleRecobro
          caso={detalle}
          formas={formas}
          puedeGestionar={puedeGestionar}
          userId={perfil?.id ?? null}
          onClose={() => setDetalle(null)}
          onChanged={() => { setDetalle(null); void cargar(); }}
        />
      )}
    </div>
  );
}

// ── Detalle de expediente ────────────────────────────────────
function ModalDetalleRecobro({ caso: c, formas, puedeGestionar, userId, onClose, onChanged }: {
  caso: RecoveryCase;
  formas: PaymentMethod[];
  puedeGestionar: boolean;
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [historial, setHistorial] = useState<RecoveryAction[]>([]);
  const [nota, setNota] = useState("");
  const [proximaAccion, setProximaAccion] = useState("");
  const [importePago, setImportePago] = useState("");
  const [formaPago, setFormaPago] = useState(formas[0]?.name ?? "Transferencia");
  const [fechaCompromiso, setFechaCompromiso] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cliente = c.customer;
  const dias = diasVencidos(c.due_date);
  const doc = c.invoice?.invoice_number ? `la factura ${c.invoice.invoice_number}` : c.work_order?.ot_number ? `la orden de trabajo ${c.work_order.ot_number}` : "el importe pendiente";

  const cargarHistorial = useCallback(async () => {
    try { setHistorial(await listRecoveryActions(c.id)); } catch { /* historial no bloquea */ }
  }, [c.id]);
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

  function enviarAviso(tipo: "primer_aviso" | "segundo_aviso") {
    const email = cliente?.admin_email || cliente?.email;
    if (!email) { setError("El cliente no tiene email de administración."); return; }
    const asunto = encodeURIComponent(
      tipo === "primer_aviso"
        ? `Aviso de pago pendiente — ${doc}`
        : `Segundo aviso — pago pendiente de ${doc}`
    );
    const cuerpo = encodeURIComponent(
      `Hola${cliente?.payment_contact_name ? " " + cliente.payment_contact_name : ""},\n\n` +
      `${tipo === "primer_aviso" ? "Le informamos" : "Le recordamos de nuevo"} que ${doc}, ` +
      `con vencimiento ${fmtFecha(c.due_date)}, tiene un importe pendiente de ${fmtEur(c.pending_amount)}.\n\n` +
      `Le rogamos regularice el pago a la mayor brevedad. Si ya lo ha realizado, ignore este mensaje.\n\n` +
      `Gracias,\nAdministración SEA`
    );
    window.open(`mailto:${email}?subject=${asunto}&body=${cuerpo}`);
    void accion(async () => {
      await addRecoveryAction(c.id, tipo, userId, `Aviso enviado a ${email}`);
      await updateRecovery(c.id, { status: tipo });
    });
  }

  function prepararWhatsApp() {
    const tel = (cliente?.admin_phone || cliente?.phone || "").replace(/[^\d]/g, "");
    if (!tel) { setError("El cliente no tiene teléfono de administración."); return; }
    const texto = encodeURIComponent(
      `Hola${cliente?.payment_contact_name ? " " + cliente.payment_contact_name : ""}, le recordamos que ${doc} ` +
      `con vencimiento ${fmtFecha(c.due_date)} tiene un importe pendiente de ${fmtEur(c.pending_amount)}. ` +
      `Le agradecemos que regularice el pago. — Administración SEA`
    );
    window.open(`https://wa.me/${tel.startsWith("34") ? tel : "34" + tel}?text=${texto}`, "_blank");
    void accion(async () => {
      await addRecoveryAction(c.id, "whatsapp", userId, "Mensaje de WhatsApp preparado");
    }, "WhatsApp preparado y registrado en el historial.");
  }

  async function registrarPago(total: boolean) {
    const amount = total ? Number(c.pending_amount) : parseFloat(importePago.replace(",", "."));
    if (!amount || amount <= 0) { setError("Introduce un importe válido."); return; }
    await accion(async () => {
      await registrarPagoVinculado({
        customerId: c.customer_id,
        workOrderId: c.work_order_id,
        invoiceId: c.invoice_id,
        amount,
        paymentMethod: formaPago,
        center: (c.work_order?.center as Centro) ?? "tarragona",
        userId,
        notes: `Pago ${total ? "total" : "parcial"} desde recobro`,
      });
      await addRecoveryAction(c.id, total ? "pago_total" : "pago_parcial", userId, `${fmtEur(amount)} (${formaPago})`);
    });
  }

  return (
    <Modal title={`Recobro — ${cliente?.name ?? "Cliente"}`} onClose={onClose} wide
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {puedeGestionar && (
              <>
                <button disabled={trabajando} onClick={() => enviarAviso("primer_aviso")} className={btnSecondary}>
                  <span className="flex items-center gap-1"><Mail className="h-4 w-4" /> Primer aviso</span>
                </button>
                <button disabled={trabajando} onClick={() => enviarAviso("segundo_aviso")} className={btnSecondary}>
                  <span className="flex items-center gap-1"><Mail className="h-4 w-4" /> Segundo aviso</span>
                </button>
                <button disabled={trabajando} onClick={prepararWhatsApp} className={btnSecondary}>
                  <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
                </button>
                <button disabled={trabajando} onClick={() => void accion(async () => {
                  await addRecoveryAction(c.id, "llamada", userId, nota || "Llamada realizada", proximaAccion || undefined);
                  await updateRecovery(c.id, { status: "llamada_realizada" });
                })} className={btnSecondary}>
                  <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> Llamada</span>
                </button>
                <button disabled={trabajando} onClick={() => void accion(async () => {
                  await cambiarEstadoRecovery(c.id, "cerrado", userId, "Expediente cerrado");
                })} className={`${btnSecondary} text-emerald-300`}>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Cerrar expediente</span>
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
          <Dato label="Factura" valor={c.invoice?.invoice_number} />
          <Dato label="OT" valor={c.work_order?.ot_number} />
          <Dato label="Fecha factura" valor={fmtFecha(c.invoice?.invoice_date)} />
          <Dato label="Vencimiento" valor={fmtFecha(c.due_date)} />
          <Dato label="Días vencidos" valor={String(dias)} />
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2">
            <span className="text-[11px] uppercase text-slate-400">Pendiente</span>
            <span className="text-lg font-black text-rose-300">{fmtEur(c.pending_amount)}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Pill className={RECOVERY_STATUS_COLORS[c.status]}>{RECOVERY_STATUS_LABELS[c.status]}</Pill>
            <Pill className={PRIORITY_COLORS[c.priority]}>{PRIORITY_LABELS[c.priority]}</Pill>
          </div>
        </div>

        {/* Gestionar */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Gestionar</div>
          {puedeGestionar ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <SelectField label="Estado" value={c.status} onChange={(v) => void accion(async () => {
                  await cambiarEstadoRecovery(c.id, v as RecoveryStatus, userId);
                })}>
                  {(Object.keys(RECOVERY_STATUS_LABELS) as RecoveryStatus[]).map((s) => (
                    <option key={s} value={s}>{RECOVERY_STATUS_LABELS[s]}</option>
                  ))}
                </SelectField>
                <SelectField label="Prioridad" value={c.priority} onChange={(v) => void accion(async () => {
                  await cambiarPrioridadRecovery(c.id, v as RecoveryPriority);
                })}>
                  {(Object.keys(PRIORITY_LABELS) as RecoveryPriority[]).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </SelectField>
              </div>
              <TextAreaField label="Nota" value={nota} onChange={setNota} rows={2} placeholder="Comentario de la gestión…" />
              <Field label="Próxima acción (fecha)">
                <input type="date" value={proximaAccion} onChange={(e) => setProximaAccion(e.target.value)} className={inputCls} />
              </Field>
              <button disabled={trabajando} onClick={() => void accion(async () => {
                if (!nota.trim() && !proximaAccion) throw new Error("Escribe una nota o una fecha de próxima acción.");
                await addRecoveryAction(c.id, "nota", userId, nota.trim() || "Próxima acción planificada", proximaAccion || undefined);
                setNota(""); setProximaAccion("");
              }, "Nota guardada.")} className={btnSecondary}>
                <span className="flex items-center justify-center gap-1"><StickyNote className="h-4 w-4" /> Añadir nota</span>
              </button>

              <div className="mt-1 border-t border-slate-700 pt-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Compromiso de pago</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Fecha comprometida">
                    <input type="date" value={fechaCompromiso} onChange={(e) => setFechaCompromiso(e.target.value)} className={inputCls} />
                  </Field>
                  <button disabled={trabajando} onClick={() => void accion(async () => {
                    if (!fechaCompromiso) throw new Error("Indica la fecha comprometida.");
                    await addRecoveryAction(c.id, "compromiso_pago", userId, `Compromiso de pago para ${fmtFecha(fechaCompromiso)}`, fechaCompromiso);
                    await updateRecovery(c.id, { status: "compromiso_pago" });
                  })} className={`${btnSecondary} self-end`}>
                    <span className="flex items-center justify-center gap-1"><Handshake className="h-4 w-4" /> Registrar</span>
                  </button>
                </div>
              </div>

              <div className="mt-1 border-t border-slate-700 pt-2">
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
            <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
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

      {c.internal_notes && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Observaciones internas</div>
          <div className="text-sm text-slate-300">{c.internal_notes}</div>
        </div>
      )}
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
