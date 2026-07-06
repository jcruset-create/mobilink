import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, AlertTriangle, BellOff } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import { listTracking, listRecoveryCases } from "../services/data";
import { Card, ErrorBox } from "../components/ui";
import { fmtEur, fmtFecha, hoyISO, type PaymentTracking, type RecoveryCase } from "../types";

export default function Dashboard() {
  const { perfil } = useAdminAuth();
  const [tracking, setTracking] = useState<PaymentTracking[]>([]);
  const [recobros, setRecobros] = useState<RecoveryCase[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const puedeVerSeguimiento = perfil && ["admin", "administracion", "supervisor"].includes(perfil.rol);

  useEffect(() => {
    if (!puedeVerSeguimiento) { setCargando(false); return; }
    (async () => {
      try {
        const [t, r] = await Promise.all([listTracking(), listRecoveryCases()]);
        setTracking(t);
        setRecobros(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error cargando datos");
      } finally {
        setCargando(false);
      }
    })();
  }, [puedeVerSeguimiento]);

  const hoy = hoyISO();
  const pagosPrevistosHoy = tracking.filter((t) => t.expected_payment_date === hoy);
  const sinProximaAccion = tracking.filter((t) => !t.next_action_date && !["pago_confirmado", "cerrado", "pasado_a_recobro"].includes(t.status));
  const vencidos = tracking.filter((t) => t.expected_payment_date && t.expected_payment_date < hoy && !["pago_confirmado", "cerrado", "pasado_a_recobro"].includes(t.status));
  const totalPendienteSeguimiento = tracking.reduce((s, t) => s + Number(t.pending_amount || 0), 0);
  const totalPendienteRecobro = recobros.reduce((s, r) => s + Number(r.pending_amount || 0), 0);

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Administración</h1>
      <p className="mb-3 text-sm text-slate-400">
        Bienvenido{perfil?.nombre ? `, ${perfil.nombre}` : ""}. Cobros, seguimiento de pagos y recobros.
      </p>

      {error && <ErrorBox>{error}</ErrorBox>}

      {puedeVerSeguimiento && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="Seguimientos abiertos" value={cargando ? "…" : String(tracking.length)} />
            <Card title="Pendiente en seguimiento" value={cargando ? "…" : fmtEur(totalPendienteSeguimiento)} accent="text-amber-300" />
            <Card title="Recobros abiertos" value={cargando ? "…" : String(recobros.length)} />
            <Card title="Pendiente en recobro" value={cargando ? "…" : fmtEur(totalPendienteRecobro)} accent="text-rose-300" />
          </div>

          <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Avisos</h2>
          <div className="grid gap-2 lg:grid-cols-3">
            <AvisoPanel
              icon={<CalendarClock className="h-4 w-4 text-sky-400" />}
              titulo={`Pagos previstos hoy (${pagosPrevistosHoy.length})`}
              vacio="Ningún pago previsto para hoy."
              items={pagosPrevistosHoy.map((t) => ({
                id: t.id,
                texto: `${t.customer?.name ?? "Cliente"} · ${fmtEur(t.pending_amount)}`,
                sub: t.invoice?.invoice_number ? `Factura ${t.invoice.invoice_number}` : t.work_order?.ot_number ? `OT ${t.work_order.ot_number}` : "",
              }))}
              link="/administracion/seguimiento"
            />
            <AvisoPanel
              icon={<BellOff className="h-4 w-4 text-amber-400" />}
              titulo={`Seguimientos sin próxima acción (${sinProximaAccion.length})`}
              vacio="Todos los seguimientos tienen próxima acción."
              items={sinProximaAccion.slice(0, 8).map((t) => ({
                id: t.id,
                texto: `${t.customer?.name ?? "Cliente"} · ${fmtEur(t.pending_amount)}`,
                sub: t.expected_payment_date ? `Previsto: ${fmtFecha(t.expected_payment_date)}` : "",
              }))}
              link="/administracion/seguimiento"
            />
            <AvisoPanel
              icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
              titulo={`Superan fecha prevista (${vencidos.length})`}
              vacio="Ninguna factura supera la fecha prevista."
              items={vencidos.slice(0, 8).map((t) => ({
                id: t.id,
                texto: `${t.customer?.name ?? "Cliente"} · ${fmtEur(t.pending_amount)}`,
                sub: `Previsto: ${fmtFecha(t.expected_payment_date)} — valorar pasar a recobro`,
              }))}
              link="/administracion/seguimiento"
            />
          </div>
        </>
      )}

      {!puedeVerSeguimiento && perfil?.rol === "recepcion" && (
        <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-300">
          Accede a <Link to="/administracion/cobros-dia" className="text-sky-400 underline">Cobros del día</Link> para registrar y consultar cobros.
        </div>
      )}
      {!puedeVerSeguimiento && perfil?.rol === "tecnico" && (
        <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-300">
          Accede a <Link to="/administracion/estado-ots" className="text-sky-400 underline">Estado de OTs</Link> para consultar si una orden está abierta o cerrada.
        </div>
      )}
    </div>
  );
}

function AvisoPanel({ icon, titulo, vacio, items, link }: {
  icon: React.ReactNode;
  titulo: string;
  vacio: string;
  items: { id: string; texto: string; sub: string }[];
  link: string;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-bold">{icon}{titulo}</div>
      {items.length === 0 ? (
        <div className="text-[12px] text-slate-500">{vacio}</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="rounded-lg bg-slate-900 px-2.5 py-1.5">
              <div className="text-[12px] font-semibold text-slate-200">{i.texto}</div>
              {i.sub && <div className="text-[11px] text-slate-500">{i.sub}</div>}
            </li>
          ))}
        </ul>
      )}
      <Link to={link} className="mt-2 inline-block text-[12px] font-medium text-sky-400 hover:underline">Ver todo →</Link>
    </div>
  );
}
