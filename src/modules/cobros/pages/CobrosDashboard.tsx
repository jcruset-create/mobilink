import { useEffect, useState } from "react";
import QRCode from "react-qr-code";

type PaymentStatus = {
  id: number;
  plate?: string;
  depositStatus?: string;
  depositAmount?: number;
  depositPaidAtMs?: number | null;
};

type RecentPayment = {
  id: number;
  reference: string;
  customer_name?: string;
  customer_phone?: string;
  amount_cents: number;
  status: string;
  payment_url?: string;
  paid_at_ms?: number | null;
  created_at_ms?: number | null;
};

export default function CobrosDashboard() {
  const [jobId, setJobId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountEuros, setAmountEuros] = useState("50");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [paymentFilter, setPaymentFilter] = useState<"all" | "pending" | "paid">("all");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  async function loadRecentPayments() {
    try {
      const response = await fetch("/api/payments/recent");
      const data = await response.json();

      if (data.success) {
        setRecentPayments(data.payments || []);
      }
    } catch (error) {
      console.error("Error cargando últimos cobros:", error);
    }
  }

  useEffect(() => {
    loadRecentPayments();

    const interval = setInterval(() => {
      loadRecentPayments();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  function buildWhatsAppText(url: string, amount: number) {
    return `Hola, para confirmar la asistencia puede realizar la pago aquí:

${url}

Importe: ${(amount / 100).toFixed(2)} €`;
  }

  async function createPaymentLink() {
    const safeReference = jobId.trim();
    const amountValue = Number(amountEuros || 0);

    if (!safeReference) {
      setMessage("La referencia del cobro es obligatoria.");
      return;
    }

    if (!Number.isFinite(amountValue) || amountValue < 1) {
      setMessage("El importe mínimo es 1 €.");
      return;
    }

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
          jobId: jobId.trim(),
          customerName,
          customerPhone,
          amountEuros: Number(amountEuros),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "No se pudo crear el enlace");
      }

      setPaymentUrl(data.url);
      setQrUrl(data.url);
      setMessage("Enlace de pago creado correctamente.");
      await loadRecentPayments();
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
      });

      setMessage("Estado actualizado.");
      await loadRecentPayments();
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

    const amountCents = Math.round(Number(amountEuros || 0) * 100);
    await navigator.clipboard.writeText(buildWhatsAppText(paymentUrl, amountCents));
    setMessage("Mensaje WhatsApp copiado al portapapeles.");
  }

  async function copyReference(reference: string) {
    await navigator.clipboard.writeText(reference);
    setMessage("Referencia copiada.");
  }

  async function copyRecentWhatsApp(payment: RecentPayment) {
    if (!payment.payment_url) return;

    await navigator.clipboard.writeText(
      buildWhatsAppText(payment.payment_url, payment.amount_cents)
    );

    setMessage("Mensaje WhatsApp copiado.");
  }

  function getMinutesAgo(ms?: number | null) {
    if (!ms) return "";

    const diffMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));

    if (diffMinutes < 1) return "hace menos de 1 minuto";
    if (diffMinutes === 1) return "hace 1 minuto";
    if (diffMinutes < 60) return `hace ${diffMinutes} minutos`;

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours === 1) return "hace 1 hora";
    if (diffHours < 24) return `hace ${diffHours} horas`;

    const diffDays = Math.floor(diffHours / 24);

    if (diffDays === 1) return "hace 1 día";

    return `hace ${diffDays} días`;
  }

  function isOldPending(payment: RecentPayment) {
    if (payment.status === "paid") return false;
    if (!payment.created_at_ms) return false;

    const diffMinutes = Math.floor((Date.now() - payment.created_at_ms) / 60000);

    return diffMinutes >= 30;
  }

  async function copyText(text: string, successMessage: string) {
    await navigator.clipboard.writeText(text);
    setMessage(successMessage);
  }

  async function deletePendingPayment(payment: RecentPayment) {
    if (payment.status === "paid") {
      setMessage("No se puede eliminar un cobro pagado.");
      return;
    }

    const ok = window.confirm(
      `¿Eliminar el cobro pendiente ${payment.reference}?`
    );

    if (!ok) return;

    try {
      const response = await fetch(`/api/payments/${payment.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "No se pudo eliminar el cobro");
      }

      setMessage("Cobro pendiente eliminado.");
      await loadRecentPayments();
    } catch (error: any) {
      setMessage(error.message || "Error eliminando cobro");
    }
  }

  function duplicatePayment(payment: RecentPayment) {
    setJobId(`${payment.reference}-COPIA`);
    setCustomerName(payment.customer_name || "");
    setCustomerPhone(payment.customer_phone || "");
    setAmountEuros((payment.amount_cents / 100).toFixed(2));
    setPaymentUrl("");
    setPaymentStatus(null);
    setQrUrl("");
    setMessage("Cobro duplicado. Revisa la referencia y crea un nuevo enlace.");
  }

  const isPaid = paymentStatus?.depositStatus === "paid";

  const filteredPayments = recentPayments.filter((payment) => {
    const matchesFilter =
      paymentFilter === "all" || payment.status === paymentFilter;

    const search = paymentSearch.trim().toLowerCase();

    const matchesSearch =
      !search ||
      payment.reference?.toLowerCase().includes(search) ||
      payment.customer_name?.toLowerCase().includes(search) ||
      payment.customer_phone?.toLowerCase().includes(search);

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black mb-2">Cobros</h1>
            <div
  className={`inline-flex items-center rounded-full px-4 py-2 text-xs font-black ${
    import.meta.env.VITE_STRIPE_MODE === "live"
      ? "bg-emerald-500 text-black"
      : "bg-amber-400 text-black"
  }`}
>
  {import.meta.env.VITE_STRIPE_MODE === "live"
    ? "💶 STRIPE REAL"
    : "🧪 STRIPE TEST"}
</div>
            <p className="text-slate-400">
              Crear enlaces de pago con Stripe.
            </p>
          </div>

          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
          >
            Volver
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-bold mb-2">
                Referencia cobro
              </label>
              <input
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                placeholder="Ejemplo: SEA-TEST-001"
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
              <label className="block text-sm font-bold mb-2">
                Teléfono cliente
              </label>
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

            <button
              onClick={() => {
                setJobId("");
                setCustomerName("");
                setCustomerPhone("");
                setAmountEuros("50");
                setPaymentUrl("");
                setPaymentStatus(null);
                setQrUrl("");
                setMessage("");
              }}
              className="w-full rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-black py-3"
            >
              Nuevo cobro
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
                    Copiar WhatsApp
                  </button>

                  <a
                    href={`https://wa.me/${customerPhone.replace(
                      /\D/g,
                      ""
                    )}?text=${encodeURIComponent(
                      buildWhatsAppText(
                        paymentUrl,
                        Math.round(Number(amountEuros || 0) * 100)
                      )
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-emerald-700 text-white font-bold px-4 py-2 text-center"
                  >
                    Abrir WhatsApp
                  </a>

                  <button
                    type="button"
                    onClick={() => setQrUrl(paymentUrl)}
                    className="rounded-xl bg-indigo-600 text-white font-bold px-4 py-2"
                  >
                    Ver QR
                  </button>
                </div>
              </div>
            )}

            <div
              className={`rounded-2xl p-5 text-center font-black text-2xl ${
                isPaid
                  ? "bg-emerald-500 text-black"
                  : "bg-amber-400 text-black"
              }`}
            >
              {!paymentStatus && "SIN CONSULTAR"}
              {paymentStatus && isPaid && "✅ PAGADO"}
              {paymentStatus && !isPaid && "⏳ PENDIENTE"}
            </div>

            <div className="bg-slate-800 rounded-xl p-4">
              <div className="text-sm text-slate-400">Estado del pago</div>

              <div className="text-xl font-black mt-1">
                {!paymentStatus && "Sin consultar"}
                {paymentStatus && isPaid && "✅ Pagado"}
                {paymentStatus && !isPaid && "⏳ Pendiente"}
              </div>

              {paymentStatus && (
                <div className="mt-3 text-sm text-slate-300 space-y-1">
                  <div>Referencia: {paymentStatus.plate}</div>
                  <div>
                    Importe:{" "}
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

          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">Últimos cobros</h2>

              <button
                onClick={loadRecentPayments}
                className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                Actualizar
              </button>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => setPaymentFilter("all")}
                className={`rounded-xl px-3 py-2 text-xs font-black ${
                  paymentFilter === "all"
                    ? "bg-white text-black"
                    : "border border-slate-600 text-slate-300"
                }`}
              >
                Todos
              </button>

              <button
                onClick={() => setPaymentFilter("pending")}
                className={`rounded-xl px-3 py-2 text-xs font-black ${
                  paymentFilter === "pending"
                    ? "bg-amber-400 text-black"
                    : "border border-slate-600 text-slate-300"
                }`}
              >
                Pendientes
              </button>

              <button
                onClick={() => setPaymentFilter("paid")}
                className={`rounded-xl px-3 py-2 text-xs font-black ${
                  paymentFilter === "paid"
                    ? "bg-emerald-500 text-black"
                    : "border border-slate-600 text-slate-300"
                }`}
              >
                Pagados
              </button>
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                placeholder="Buscar por referencia, cliente o teléfono"
                className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-white outline-none"
              />

              <button
                onClick={() => setPaymentSearch("")}
                className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800"
              >
                Limpiar
              </button>
            </div>

            <div className="mb-4 text-xs font-bold text-slate-400">
              Resultados: {filteredPayments.length}
            </div>

            <div className="space-y-3">
              {filteredPayments.length === 0 && (
                <div className="text-sm text-slate-400">
                  Todavía no hay cobros registrados.
                </div>
              )}

              {[...filteredPayments]
                .sort((a, b) => {
                  if (a.status === b.status) {
                    return (b.created_at_ms || 0) - (a.created_at_ms || 0);
                  }

                  if (a.status === "pending") return -1;
                  if (b.status === "pending") return 1;

                  return 0;
                })
                .map((payment) => {
                const paid = payment.status === "paid";

                return (
                  <div
                    key={payment.id}
                    className={`rounded-xl border p-4 ${
                      isOldPending(payment)
                        ? "border-red-400 bg-red-950/50"
                        : "border-slate-700 bg-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black">{payment.reference}</div>

                        <div className="mt-1 text-sm text-slate-300">
                          {payment.customer_name || "Sin cliente"}
                        </div>

                        <div className="mt-1 text-xs text-slate-400">
                          {payment.customer_phone || "Sin teléfono"}
                        </div>
                      </div>

                      <div
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          paid
                            ? "bg-emerald-500 text-black"
                            : "bg-amber-400 text-black"
                        }`}
                      >
                        {paid ? "✅ Pagado" : "⏳ Pendiente"}
                      </div>
                    </div>

                    {isOldPending(payment) && (
                      <div className="mt-3 rounded-xl border border-red-400 bg-red-900/60 px-3 py-2 text-xs font-black text-red-100">
                        Pendiente desde hace más de 30 minutos
                      </div>
                    )}

                    <div className="mt-3 text-sm text-slate-300">
                      Importe: {(payment.amount_cents / 100).toFixed(2)} €
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Creado:{" "}
                      {payment.created_at_ms
                        ? new Date(payment.created_at_ms).toLocaleString()
                        : "-"}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Pagado:{" "}
                      {payment.paid_at_ms
                        ? `${new Date(payment.paid_at_ms).toLocaleString()} (${getMinutesAgo(
                            payment.paid_at_ms
                          )})`
                        : "Pendiente"}
                    </div>

                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      {payment.status === "paid" && (
                        <div className="rounded-xl border border-emerald-500 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-200">
                          Cobro pagado: acciones de enlace bloqueadas
                        </div>
                      )}
                      {payment.payment_url && payment.status !== "paid" && (
                        <a
                          href={payment.payment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl bg-white px-3 py-2 text-center text-xs font-black text-black"
                        >
                          Abrir enlace
                        </a>
                      )}

                      {payment.payment_url && payment.status !== "paid" && (
                        <button
                          onClick={() => setQrUrl(payment.payment_url || "")}
                          className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white"
                        >
                          Ver QR
                        </button>
                      )}

                      {payment.payment_url && (
                        <button
                          type="button"
                          onClick={() => setQrUrl(payment.payment_url || "")}
                          className="rounded-xl bg-indigo-600 px-3 py-2 text-center text-xs font-black text-white"
                        >
                          Ver QR
                        </button>
                      )}

                      {payment.payment_url && payment.status !== "paid" && (
                        <button
                          onClick={() => copyRecentWhatsApp(payment)}
                          className="rounded-xl bg-green-500 px-3 py-2 text-xs font-black text-black"
                        >
                          Copiar WhatsApp
                        </button>
                      )}

                      <button
                        onClick={() => copyReference(payment.reference)}
                        className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-black text-white"
                      >
                        Copiar referencia
                      </button>

                      {payment.payment_url && payment.status !== "paid" && (
                        <button
                          onClick={() =>
                            copyText(
                              payment.payment_url || "",
                              "Enlace copiado."
                            )
                          }
                          className="rounded-xl bg-white px-3 py-2 text-xs font-black text-black"
                        >
                          Copiar enlace
                        </button>
                      )}

                      <button
                        onClick={() => duplicatePayment(payment)}
                        className="rounded-xl bg-purple-600 px-3 py-2 text-xs font-black text-white"
                      >
                        Duplicar
                      </button>

                      {payment.status !== "paid" && (
                        <button
                          onClick={() => deletePendingPayment(payment)}
                          className="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white"
                        >
                          Eliminar
                        </button>
                      )}

                      <button
                        onClick={async () => {
                          setJobId(payment.reference);

                          try {
                            const response = await fetch(
                              `/api/payments/status/${encodeURIComponent(
                                payment.reference
                              )}`
                            );

                            const data = await response.json();

                            if (data.success) {
                              await loadRecentPayments();
                              setMessage("Estado actualizado.");
                            }
                          } catch (error) {
                            console.error(error);
                          }
                        }}
                        className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white"
                      >
                        Actualizar estado
                      </button>

                      <button
                        onClick={() => {
                          setJobId(payment.reference);
                          setCustomerName(payment.customer_name || "");
                          setCustomerPhone(payment.customer_phone || "");
                          setAmountEuros(
                            (payment.amount_cents / 100).toFixed(2)
                          );
                          setPaymentUrl(payment.payment_url || "");
                        }}
                        className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200"
                      >
                        Cargar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
            <h2 className="mb-4 text-2xl font-black text-black">
              QR de pago
            </h2>

            <div className="inline-block rounded-2xl bg-white p-4">
              <QRCode value={qrUrl} size={260} />
            </div>

            <div className="mt-4 break-all text-xs text-slate-600">
              {qrUrl}
            </div>

            <button
              type="button"
              onClick={() => setQrUrl("")}
              className="mt-6 w-full rounded-xl bg-black py-3 font-black text-white"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}