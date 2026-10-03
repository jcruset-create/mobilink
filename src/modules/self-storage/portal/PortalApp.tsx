/**
 * Portal del cliente de trasteros (`/trasteros/portal`) · parte financiera.
 *
 * El cliente entra con un enlace a su email (sin contraseña). Sólo pueden
 * entrar los clientes que el centro ha invitado: el login no crea usuarios
 * (`shouldCreateUser: false`) y el servidor, además, exige que la sesión
 * corresponda a un cliente de Self Storage.
 *
 * Ve y descarga su contrato, lo acepta, ve y descarga sus facturas, paga lo
 * pendiente y gestiona su método de pago. Pagar le lleva a Stripe; el pago se
 * da por bueno cuando Stripe lo confirma al servidor, no al volver aquí.
 * Abrir puertas llega en la fase 3.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { Container, LogOut } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../administracion/services/supabase";
import * as api from "./api";
import { ModalFirma } from "../components/Dialogos";
import {
  ETIQUETA_CONTRACT_STATUS,
  ETIQUETA_INVOICE_STATUS,
  ETIQUETA_PAYMENT_METHOD,
  ETIQUETA_PAYMENT_STATUS,
  type InvoiceStatus,
} from "../types/enums";

const BASE = "/trasteros/portal";
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const euros = (v: number | null | undefined) => (v == null ? "—" : eur.format(v));
const fecha = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }) : "—";
const msg = (e: unknown) => (e instanceof Error ? e.message : "Error");

const btn = "rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50";
const btnSec = "rounded-xl bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50";

function Caja({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">{children}</div>;
}
function Fallo({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{children}</div>;
}
function Info({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">{children}</div>;
}

const COLOR_FACTURA: Record<InvoiceStatus, string> = {
  draft: "text-slate-400",
  pending: "text-amber-300",
  paid: "text-emerald-300",
  overdue: "text-rose-300",
  cancelled: "text-slate-500",
  refunded: "text-violet-300",
};

/** Avisos de vuelta de Stripe: volver no confirma nada, lo confirma Stripe. */
function VueltaStripe() {
  const [params] = useSearchParams();
  const v = params.get("stripe");
  if (v === "ok") return <Info>Gracias. El pago se confirmará en cuanto nos lo comunique Stripe (con domiciliación SEPA puede tardar unos días).</Info>;
  if (v === "cancelado") return <Info>Has salido de la página de pago sin completarlo.</Info>;
  return null;
}

/** Redirige al pago de Stripe. */
async function irA(fn: () => Promise<{ url: string }>, onError: (m: string) => void) {
  try {
    const { url } = await fn();
    window.location.href = url;
  } catch (e) {
    onError(msg(e));
  }
}

// ── Login ───────────────────────────────────────────────────────────────────

function Login() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  // Un enlace caducado vuelve con «#error=…» en la URL.
  const [error, setError] = useState<string | null>(() =>
    window.location.hash.includes("error") ? "El enlace ha caducado o no es válido. Pide uno nuevo." : null
  );
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (window.location.hash.includes("error")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const enviar = async () => {
    setCargando(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // Sólo clientes invitados por el centro: aquí no se crean cuentas.
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${BASE}` },
    });
    setCargando(false);
    // Mismo mensaje exista o no la cuenta: no se revela quién es cliente.
    if (err && !/signups not allowed|user not found/i.test(err.message)) setError(err.message);
    else setEnviado(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-800 p-8">
        <div className="flex items-center gap-2">
          <Container className="h-6 w-6 text-orange-400" />
          <div>
            <h1 className="text-lg font-black leading-tight">Mis trasteros</h1>
            <p className="text-xs text-slate-400">Contratos, facturas y pagos</p>
          </div>
        </div>
        {enviado ? (
          <p className="text-sm text-slate-300">
            Si <b>{email}</b> es el email de un cliente, le hemos enviado un enlace para entrar. Revisa tu bandeja de entrada.
          </p>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && void enviar()}
              placeholder="tu@email.com"
              autoComplete="email"
              className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500"
            />
            {error && <Fallo>{error}</Fallo>}
            <button className={`${btn} w-full`} disabled={cargando || !email.trim()} onClick={() => void enviar()}>
              {cargando ? "Enviando…" : "Enviarme el enlace de acceso"}
            </button>
            <p className="text-[11px] text-slate-500">Usa el email que diste al contratar. Si no te llega, pídele al centro que te invite.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pantallas ──────────────────────────────────────────────────────────────

function Inicio({ yo }: { yo: api.Yo }) {
  const [lista, setLista] = useState<api.ContratoPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.contratos().then(setLista, (e) => setError(msg(e)));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Hola, {yo.name}</h1>
      <VueltaStripe />
      <Caja>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400">Pendiente de pago</div>
            <div className={`text-2xl font-black ${yo.debt.pendiente > 0 ? "text-amber-300" : "text-emerald-300"}`}>{euros(yo.debt.pendiente)}</div>
            {yo.debt.vencida > 0 && <div className="text-[12px] text-rose-300">{euros(yo.debt.vencida)} vencido</div>}
          </div>
          <div className="flex items-end justify-end">
            {yo.debt.facturas > 0 && (
              <Link to={`${BASE}/facturas`} className={btn}>
                Pagar
              </Link>
            )}
          </div>
        </div>
      </Caja>
      {error && <Fallo>{error}</Fallo>}
      <h2 className="pt-2 text-sm font-bold">Mis contratos</h2>
      {lista?.length === 0 && <p className="text-sm text-slate-400">No tienes contratos.</p>}
      {lista?.map((k) => (
        <Link key={k.id} to={`${BASE}/contratos/${k.id}`} className="block">
          <Caja>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-bold">Trastero {k.unitCode}</div>
                <div className="text-[12px] text-slate-400">
                  {k.centerName} · {k.contractNumber} · desde {fecha(k.startDate)}
                </div>
              </div>
              <div className="text-right text-sm">
                <div>{euros(k.monthlyPriceGross)}/mes</div>
                <div className="text-[12px] text-slate-400">{ETIQUETA_CONTRACT_STATUS[k.status]}</div>
              </div>
            </div>
          </Caja>
        </Link>
      ))}
    </div>
  );
}

function Contrato({ yo }: { yo: api.Yo }) {
  const { id = "" } = useParams();
  const [k, setK] = useState<api.ContratoPortalDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firmando, setFirmando] = useState<api.DocumentoPortal | null>(null);

  const cargar = useCallback(() => api.contrato(id).then(setK, (e) => setError(msg(e))), [id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !k) return <Fallo>{error}</Fallo>;
  if (!k) return <p className="text-sm text-slate-400">Cargando…</p>;
  const pendientes = k.documents.filter((d) => d.status === "draft");
  const pdf = (docId: string) => void api.pdfDocumento(k.id, docId).catch((e) => setError(msg(e)));

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Trastero {k.unitCode}</h1>
      <p className="text-sm text-slate-400">
        {k.centerName} · {k.zoneName} · contrato {k.contractNumber} · {ETIQUETA_CONTRACT_STATUS[k.status]}
      </p>
      <VueltaStripe />
      {error && <Fallo>{error}</Fallo>}

      {pendientes.map((d) => (
        <Info key={d.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Tienes {d.documentType === "annex" ? "un anexo" : "el contrato"} pendiente de aceptar.
            </span>
            <span className="flex gap-2">
              <button className={btnSec} onClick={() => pdf(d.id)}>
                Leer
              </button>
              <button className={btn} onClick={() => setFirmando(d)}>
                Aceptar
              </button>
            </span>
          </div>
        </Info>
      ))}

      {k.canPayFirstOnline && k.firstPaymentStatus !== "processing" && (
        <Info>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Último paso: el primer pago. Al confirmarse, el trastero queda activo.</span>
            <button className={btn} onClick={() => void irA(() => api.pagarPrimero(k.id), setError)}>
              Pagar ahora
            </button>
          </div>
        </Info>
      )}
      {k.status === "pending_payment" && k.firstPaymentStatus === "processing" && (
        <Info>Tu primer pago está en proceso. Te avisaremos cuando se confirme.</Info>
      )}
      {k.status === "pending_payment" && !k.canPayFirstOnline && k.invoices.some((f) => f.status === "pending") && (
        <Info>
          Pendiente del primer pago ({k.paymentMethod ? ETIQUETA_PAYMENT_METHOD[k.paymentMethod].toLowerCase() : "en el centro"}). Puedes pagarlo con
          tarjeta desde <Link className="underline" to={`${BASE}/facturas`}>tus facturas</Link>.
        </Info>
      )}

      <Caja>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Campo t="Cuota mensual">
            {euros(k.monthlyPriceGross)} <span className="text-[11px] text-slate-400">({euros(k.monthlyPrice)} + {k.taxRate} % IVA)</span>
          </Campo>
          <Campo t="Fianza">{euros(k.depositAmount)}</Campo>
          <Campo t="Inicio">{fecha(k.startDate)}</Campo>
          <Campo t="Fin">{k.endDate ? fecha(k.endDate) : "Indefinido"}</Campo>
          <Campo t="Se factura el día">{k.billingDay}</Campo>
          <Campo t="Forma de pago">{k.paymentMethod ? ETIQUETA_PAYMENT_METHOD[k.paymentMethod] : "—"}</Campo>
        </div>
        {k.items.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-[12px] text-slate-300">
            {k.items.map((i, n) => (
              <li key={n}>
                {i.description} · {i.quantity} × {euros(i.unitPrice)} + {i.taxRate} % IVA {i.isRecurring ? "· mensual" : ""}
              </li>
            ))}
          </ul>
        )}
      </Caja>

      <h2 className="pt-2 text-sm font-bold">Documentos</h2>
      {k.documents.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2 text-sm">
          <span>
            {d.documentType === "annex" ? "Anexo" : "Contrato"} v{d.version}
            <span className="ml-2 text-[11px] text-slate-400">{d.acceptedAt ? `aceptado ${fechaHora(d.acceptedAt)}` : "pendiente de aceptar"}</span>
          </span>
          <button className={btnSec} onClick={() => pdf(d.id)}>
            PDF
          </button>
        </div>
      ))}

      {firmando && (
        <ModalFirma
          titulo={firmando.documentType === "annex" ? "Aceptar el anexo" : "Aceptar el contrato"}
          documento={firmando}
          nombreInicial={yo.name}
          presencial={false}
          onVerPdf={() => pdf(firmando.id)}
          onCerrar={() => setFirmando(null)}
          onFirmar={async (nombre) => {
            setK(await api.aceptar(k.id, { signerName: nombre, documentId: firmando.id, accepted: true }));
            setFirmando(null);
          }}
        />
      )}
    </div>
  );
}

function Campo({ t, children }: { t: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase text-slate-400">{t}</div>
      <div>{children}</div>
    </div>
  );
}

function Facturas() {
  const [lista, setLista] = useState<api.FacturaPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.facturas().then(setLista, (e) => setError(msg(e)));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Facturas</h1>
      <VueltaStripe />
      {error && <Fallo>{error}</Fallo>}
      {lista?.length === 0 && <p className="text-sm text-slate-400">Aún no tienes facturas.</p>}
      {lista?.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm">
          <div>
            <div className="font-bold">{f.invoiceNumber}</div>
            <div className="text-[12px] text-slate-400">
              {fecha(f.issueDate)}
              {f.periodStart ? ` · ${fecha(f.periodStart)} – ${fecha(f.periodEnd)}` : ""}
              {f.dueDate ? ` · vence ${fecha(f.dueDate)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold">{euros(f.total)}</span>
            <span className={`text-[12px] ${COLOR_FACTURA[f.status]}`}>{ETIQUETA_INVOICE_STATUS[f.status]}</span>
            <button className={btnSec} onClick={() => void api.pdfFactura(f.id).catch((e) => setError(msg(e)))}>
              PDF
            </button>
            {(f.status === "pending" || f.status === "overdue") && (
              <button className={btn} onClick={() => void irA(() => api.pagarFactura(f.id), setError)}>
                Pagar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Pagos() {
  const [lista, setLista] = useState<api.PagoPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.pagos().then(setLista, (e) => setError(msg(e)));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Pagos</h1>
      {error && <Fallo>{error}</Fallo>}
      {lista?.length === 0 && <p className="text-sm text-slate-400">Aún no hay pagos.</p>}
      {lista?.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm">
          <div>
            <div>{fechaHora(p.paidAt ?? p.createdAt)}</div>
            <div className="text-[12px] text-slate-400">
              {ETIQUETA_PAYMENT_METHOD[p.paymentMethod]}
              {p.invoiceNumber ? ` · factura ${p.invoiceNumber}` : ""}
            </div>
            {p.failureReason && <div className="text-[12px] text-rose-300">{p.failureReason}</div>}
          </div>
          <div className="text-right">
            <div className="font-bold">{euros(p.amount)}</div>
            <div className="text-[12px] text-slate-400">{ETIQUETA_PAYMENT_STATUS[p.status]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MetodoPago() {
  const [lista, setLista] = useState<api.MetodoPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.metodos().then(setLista, (e) => setError(msg(e)));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Método de pago</h1>
      <VueltaStripe />
      {error && <Fallo>{error}</Fallo>}
      <p className="text-sm text-slate-400">
        Tu tarjeta o cuenta bancaria la guarda Stripe, nunca nosotros. Al añadir una nueva pasa a ser la que se usa para tus cuotas.
      </p>
      {lista?.length === 0 && <p className="text-sm text-slate-400">No tienes ningún método guardado.</p>}
      {lista?.map((m) => (
        <div key={m.id} className="rounded-xl bg-slate-800 px-3 py-2 text-sm">
          {m.type === "sepa_debit" ? "Cuenta SEPA" : (m.brand ?? "Tarjeta").toUpperCase()} ···· {m.last4 ?? "—"}
          {m.expMonth ? ` · caduca ${String(m.expMonth).padStart(2, "0")}/${m.expYear}` : ""}
          {m.isDefault && <span className="ml-2 text-[11px] text-emerald-300">predeterminado</span>}
        </div>
      ))}
      <button className={btn} onClick={() => void irA(api.nuevoMetodo, setError)}>
        {lista?.length ? "Cambiar o añadir método" : "Añadir método de pago"}
      </button>
    </div>
  );
}

// ── Marco ───────────────────────────────────────────────────────────────────

const PESTANAS = [
  { to: "", label: "Inicio", end: true },
  { to: "facturas", label: "Facturas" },
  { to: "pagos", label: "Pagos" },
  { to: "pago", label: "Método de pago" },
];

function Portal() {
  const [yo, setYo] = useState<api.Yo | null>(null);
  const [error, setError] = useState<api.ErrorPortal | null>(null);

  useEffect(() => {
    api.yo().then(setYo, (e) => setError(e instanceof api.ErrorPortal ? e : new api.ErrorPortal(msg(e), "ERROR", 0)));
  }, []);

  const salir = () => void supabase.auth.signOut();

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
        <div className="max-w-sm space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-100">
          <p className="font-bold">No podemos abrir tu área de cliente</p>
          <p>{error.code === "SIN_ACCESO" ? "Este email no corresponde a ningún cliente de trasteros. Si acabas de contratar, pide al centro que te invite." : error.message}</p>
          <button className={btnSec} onClick={salir}>
            Salir
          </button>
        </div>
      </div>
    );
  }
  if (!yo) return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">Cargando…</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <Link to={BASE} className="flex items-center gap-2 font-black">
            <Container className="h-5 w-5 text-orange-400" /> Mis trasteros
          </Link>
          <button className="flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200" onClick={salir}>
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-3 pb-2 text-[13px]">
          {PESTANAS.map((p) => (
            <NavLink
              key={p.to}
              end={p.end}
              to={p.to ? `${BASE}/${p.to}` : BASE}
              className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 ${isActive ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Routes>
          <Route index element={<Inicio yo={yo} />} />
          <Route path="contratos/:id" element={<Contrato yo={yo} />} />
          <Route path="facturas" element={<Facturas />} />
          <Route path="pagos" element={<Pagos />} />
          <Route path="pago" element={<MetodoPago />} />
          <Route path="*" element={<Navigate to={BASE} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function PortalApp() {
  const [sesion, setSesion] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (sesion === undefined) return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">Cargando…</div>;
  return sesion ? <Portal key={sesion.user.id} /> : <Login />;
}
