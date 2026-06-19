import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
  const [jobId, setJobId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountEuros, setAmountEuros] = useState("50");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(
    null
  );

  async function createPaymentLink() {
    setLoading(true);
    setMessage("");
    setPaymentUrl("");

    try {
      const response = await fetch("/api/payments/create-deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: Number(jobId),
          customerName,
          amountEuros: Number(amountEuros),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "No se pudo crear el enlace");
      }

      setPaymentUrl(data.url);
      setMessage("Enlace de pago creado correctamente.");
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
      const response = await fetch(
  `/api/payments/status/${encodeURIComponent(jobId)}`
);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "No se pudo consultar el estado");
      }

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

  async function copyPaymentLink() {
    if (!paymentUrl) return;

    await navigator.clipboard.writeText(paymentUrl);
    setMessage("Enlace copiado al portapapeles.");
  }

  async function copyWhatsAppMessage() {
    if (!paymentUrl) return;

    const text = `Hola, para confirmar la asistencia puede realizar la paga y señal aquí:

${paymentUrl}

Importe: ${Number(amountEuros).toFixed(2)} €`;

    await navigator.clipboard.writeText(text);
    setMessage("Mensaje WhatsApp copiado al portapapeles.");
  }

  const isPaid = paymentStatus?.depositStatus === "paid";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-black">Cobros</h1>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-700"
          >
            ← Volver a Operativo
          </button>
        </div>

        <p className="text-slate-400 mb-6">
          Crear enlaces de paga y señal con Stripe.
        </p>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-bold mb-2">
              Referencia cobro
            </label>
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
    href={`https://wa.me/${customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
  `Hola, para confirmar la asistencia puede realizar la paga y señal aquí:\n\n${paymentUrl}\n\nImporte: ${Number(
    amountEuros
  ).toFixed(2)} €`
)}`}
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
                <div>
                  Importe pagado:{" "}
                  {((paymentStatus.depositAmount || 0) / 100).toFixed(2)} €
                </div>
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
      </div>
    </div>
  );
}