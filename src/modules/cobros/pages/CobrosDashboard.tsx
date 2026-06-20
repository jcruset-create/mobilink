import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

type Payment = {
  id: number;
  reference: string;
  customer_name: string;
  customer_phone: string;
  amount_cents: number;
  status: string;
  payment_url: string;
  paid_at_ms: number | null;
  created_at_ms: number;
  description: string;
};

type PaymentStatus = {
  id: number;
  plate?: string;
  depositStatus?: string;
  depositAmount?: number;
  depositPaidAtMs?: number | null;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
};

export default function CobrosDashboard() {
  const navigate = useNavigate();

  // Form
  const [jobId, setJobId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountEuros, setAmountEuros] = useState("50");
  const [description, setDescription] = useState("");

  // State
  const [paymentUrl, setPaymentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);

  // History
  const [history, setHistory] = useState<Payment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/payments/recent");
      const data = await res.json();
      if (data.success) setHistory(data.payments);
    } catch {}
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function createPaymentLink() {
    setLoading(true);
    setMessage("");
    setPaymentUrl("");
    try {
      const response = await fetch("/api/payments/create-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: Number(jobId),
          customerName,
          customerPhone,
          amountEuros: Number(amountEuros),
          description,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || "No se pudo crear el enlace");
      setPaymentUrl(data.url);
      setMessage("Enlace de pago creado correctamente.");
      loadHistory();
    } catch (error: any) {
      setMessage(error.message || "Error creando pago");
    } finally {
      setLoading(false);
    }
  }

  async function checkPaymentStatus() {
    setStatusLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/payments/status/${encodeURIComponent(jobId)}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.message || "No se pudo consultar el estado");
      setPaymentStatus({
        id: data.payment.id,
        plate: data.payment.reference,
        depositStatus: data.payment.status,
        depositAmount: data.payment.amount_cents,
        depositPaidAtMs: data.payment.paid_at_ms,
        stripeSessionId: data.payment.stripe_session_id,
        stripePaymentIntentId: data.payment.stripe_payment_intent_id,
      });
      setMessage("Estado actualizado.");
    } catch (error: any) {
      setMessage(error.message || "Error consultando estado");
    } finally {
      setStatusLoading(false);
    }
  }

  async function cancelPayment(id: number) {
    if (!confirm("¿Cancelar este cobro? Se eliminará y el enlace dejará de funcionar.")) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setMessage("Cobro cancelado correctamente.");
      loadHistory();
    } catch (error: any) {
      setMessage(error.message || "Error cancelando cobro");
    } finally {
      setCancellingId(null);
    }
  }

  async function copyPaymentLink() {
    if (!paymentUrl) return;
    await navigator.clipboard.writeText(paymentUrl);
    setMessage("Enlace copiado al portapapeles.");
  }

  function buildWhatsAppText(url: string) {
    const desc = description.trim();
    return `Hola${customerName ? ` ${customerName}` : ""}, para confirmar la asistencia puede realizar la paga y señal aquí:

${url}

Importe: ${Number(amountEuros).toFixed(2)} €${desc ? `\nConcepto: ${desc}` : ""}`;
  }

  async function copyWhatsAppMessage() {
    if (!paymentUrl) return;
    await navigator.clipboard.writeText(buildWhatsAppText(paymentUrl));
    setMessage("Mensaje WhatsApp copiado al portapapeles.");
  }

  const isPaid = paymentStatus?.depositStatus === "paid";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black">Cobros</h1>
            <p className="text-slate-400 mt-1">Crear enlaces de paga y señal con Stripe.</p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-700"
          >
            ← Volver a Operativo
          </button>
        </div>

        {/* Formulario */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-bold text-slate-200">Nuevo enlace de pago</h2>

          <div>
            <label className="block text-sm font-bold mb-2">Referencia cobro</label>
            <input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="Ejemplo: 33"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Cliente</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nombre cliente"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Teléfono cliente</label>
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Ejemplo: 34600111222"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Descripción / Concepto</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Paga y señal reparación motor"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-2">Importe €</label>
            <input
              type="number"
              min="1"
              value={amountEuros}
              onChange={(e) => setAmountEuros(e.target.value)}
              placeholder="50"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
            />
          </div>

          <button
            onClick={createPaymentLink}
            disabled={loading}
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-600 text-black font-black py-3"
          >
            {loading ? "Creando..." : "Crear enlace de pago"}
          </button>

          <button
            onClick={checkPaymentStatus}
            disabled={statusLoading || !jobId}
            className="w-full rounded-xl bg-blue-500 hover:bg-blue-400 disabled:bg-slate-600 text-white font-black py-3"
          >
            {statusLoading ? "Consultando..." : "Consultar estado del pago"}
          </button>

          {paymentUrl && (
            <div className="bg-slate-800 border border-emerald-500 rounded-xl p-4 space-y-3">
              <div className="text-sm text-slate-300">Enlace generado:</div>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-emerald-300 underline"
              >
                {paymentUrl}
              </a>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={copyPaymentLink}
                  className="rounded-xl bg-white text-black font-bold px-4 py-2"
                >
                  Copiar enlace
                </button>
                <button
                  onClick={copyWhatsAppMessage}
                  className="rounded-xl bg-green-500 text-black font-bold px-4 py-2"
                >
                  Copiar mensaje WhatsApp
                </button>
                <a
                  href={`https://wa.me/${customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsAppText(paymentUrl))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-emerald-700 text-white font-bold px-4 py-2 text-center"
                >
                  Abrir WhatsApp
                </a>
              </div>
            </div>
          )}

          <div className="bg-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-400">Estado del pago</div>
            <div className="text-xl font-black mt-1">
              {!paymentStatus && "Sin consultar"}
              {paymentStatus && isPaid && "✅ Pagado"}
              {paymentStatus && !isPaid && "⏳ Pendiente"}
            </div>
            {paymentStatus && (
              <div className="mt-3 text-sm text-slate-300 space-y-1">
                <div>Asistencia: {paymentStatus.id}</div>
                <div>Matrícula: {paymentStatus.plate || "Sin matrícula"}</div>
                <div>Importe pagado: {((paymentStatus.depositAmount || 0) / 100).toFixed(2)} €</div>
                <div>
                  Fecha pago:{" "}
                  {paymentStatus.depositPaidAtMs
                    ? new Date(paymentStatus.depositPaidAtMs).toLocaleString()
                    : "Pendiente"}
                </div>
              </div>
            )}
          </div>

          {message && <div className="text-sm text-amber-300">{message}</div>}
        </div>

        {/* Historial */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-200">Historial de cobros</h2>
            <button
              onClick={loadHistory}
              disabled={historyLoading}
              className="text-sm text-slate-400 hover:text-white"
            >
              {historyLoading ? "Cargando..." : "↺ Actualizar"}
            </button>
          </div>

          {history.length === 0 && !historyLoading && (
            <p className="text-slate-500 text-sm">No hay cobros registrados.</p>
          )}

          <div className="space-y-3">
            {history.map((p) => {
              const paid = p.status === "paid";
              const euros = (p.amount_cents / 100).toFixed(2);
              const createdAt = new Date(Number(p.created_at_ms)).toLocaleString("es-ES", {
                day: "2-digit", month: "2-digit", year: "2-digit",
                hour: "2-digit", minute: "2-digit",
              });
              const paidAt = p.paid_at_ms
                ? new Date(Number(p.paid_at_ms)).toLocaleString("es-ES", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })
                : null;

              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                    paid
                      ? "border-emerald-700 bg-emerald-950/30"
                      : "border-slate-700 bg-slate-800"
                  }`}
                >
                  {/* Status pill */}
                  <div className="flex-shrink-0">
                    <span
                      className={`inline-block text-xs font-bold px-2 py-1 rounded-full ${
                        paid
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-orange-500/20 text-orange-300"
                      }`}
                    >
                      {paid ? "✅ Pagado" : "⏳ Pendiente"}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white">
                      {p.customer_name || "Sin nombre"}{" "}
                      <span className="text-slate-400 font-normal text-sm">· ref. {p.reference}</span>
                    </div>
                    {p.description && (
                      <div className="text-sm text-slate-300 mt-0.5">{p.description}</div>
                    )}
                    <div className="text-xs text-slate-500 mt-1">
                      {p.customer_phone && <span>{p.customer_phone} · </span>}
                      Creado: {createdAt}
                      {paidAt && <span> · Pagado: {paidAt}</span>}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className={`text-lg font-black flex-shrink-0 ${paid ? "text-emerald-400" : "text-white"}`}>
                    {euros} €
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0">
                    {p.payment_url && (
                      <a
                        href={p.payment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 font-bold"
                      >
                        Ver enlace
                      </a>
                    )}
                    {!paid && (
                      <button
                        onClick={() => cancelPayment(p.id)}
                        disabled={cancellingId === p.id}
                        className="text-xs rounded-lg bg-red-900/60 hover:bg-red-800 text-red-300 px-3 py-1.5 font-bold disabled:opacity-50"
                      >
                        {cancellingId === p.id ? "..." : "Cancelar"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
