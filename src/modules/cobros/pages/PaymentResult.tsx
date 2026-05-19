type PaymentResultProps = {
  type: "success" | "cancelled";
};

export default function PaymentResult({ type }: PaymentResultProps) {
  const isSuccess = type === "success";

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl">
          {isSuccess ? "✅" : "⚠️"}
        </div>

        <h1 className="text-3xl font-black mb-3">
          {isSuccess ? "Pago realizado" : "Pago cancelado"}
        </h1>

        <p className="text-slate-300 mb-6">
          {isSuccess
            ? "Hemos recibido correctamente el pago. Gracias."
            : "El pago no se ha completado. Puede volver a intentarlo desde el enlace recibido."}
        </p>

        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300">
          SEA Tarragona
        </div>

        <a
          href="/"
          className="mt-6 block rounded-xl bg-emerald-500 px-4 py-3 font-black text-black hover:bg-emerald-400"
        >
          Volver
        </a>
      </div>
    </div>
  );
}