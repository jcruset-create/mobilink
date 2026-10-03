/**
 * Ficha del contrato: datos copiados al crearlo, documentos (con su huella y
 * la aceptación), facturas, bloqueos de acceso, historial y las acciones que
 * el SERVIDOR dice que se pueden hacer en su estado (`actions`).
 *
 * El cobro nunca se marca desde aquí: con tarjeta/SEPA se manda al cliente a
 * Stripe y lo confirma el webhook; con transferencia/efectivo se registra el
 * pago de una factura concreta.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import type { ContratoDetalle as Detalle, EntradaHistorial } from "../types";
import FormContrato from "../components/FormContrato";
import { ModalFirma, ModalMotivo } from "../components/Dialogos";
import {
  Aviso,
  Cabecera,
  Cargando,
  ChipContrato,
  ChipFactura,
  Dato,
  EmptyRow,
  ErrorBox,
  Modal,
  SelectField,
  TableWrap,
  TextAreaField,
  TextField,
  btnDanger,
  btnMini,
  btnPrimary,
  btnSecondary,
  euros,
  fecha,
  fechaHora,
  msgError,
  pct,
  tdCls,
  thCls,
} from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

type Dialogo =
  | null
  | "editar"
  | "firmar"
  | "activar"
  | "suspender"
  | "finalizar"
  | "cancelar"
  | "anexo"
  | { levantar: string }
  | { firmarAnexo: string };

export default function ContratoDetalle() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { puede, etqMetodo, etqBloqueo, etqConcepto } = useSelfStorage();
  const [k, setK] = useState<Detalle | null>(null);
  const [historial, setHistorial] = useState<EntradaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [enlace, setEnlace] = useState<string | null>(null);
  const gestiona = puede("ss.contracts.manage");
  const admin = puede("ss.contracts.admin");

  const cargar = useCallback(async () => {
    try {
      setK(await api.contrato(id));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const verHistorial = async () => {
    try {
      setHistorial(await api.historialContrato(id));
    } catch (e) {
      setError(msgError(e));
    }
  };

  /** Ejecuta una acción, refresca y cierra el diálogo. Los errores suben al diálogo que la lanzó. */
  const hacer = async (fn: () => Promise<unknown>) => {
    const r = await fn();
    const w = (r as { warning?: string | null } | null)?.warning;
    setAviso(w ?? null);
    setDialogo(null);
    await cargar();
    if (historial) await verHistorial();
  };

  /** Igual, para botones sin diálogo: el error va a la cabecera. */
  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await hacer(fn);
    } catch (e) {
      setError(msgError(e));
    }
  };

  const pdf = (docId: string) => api.pdfDocumento(id, docId).catch((e) => setError(msgError(e)));

  const cobrar = async () => {
    try {
      const r = await api.checkoutContrato(id);
      setEnlace(r.url);
    } catch (e) {
      setError(msgError(e));
    }
  };

  if (error && !k) return <ErrorBox>{error}</ErrorBox>;
  if (!k) return <Cargando />;

  const puedeAccion = (a: Detalle["actions"][number]) => k.actions.includes(a);
  const docPendiente = [...k.documents].reverse().find((d) => d.status === "draft" && d.documentType === "contract");
  const anexoPendiente = [...k.documents].reverse().find((d) => d.status === "draft" && d.documentType === "annex");
  const bloqueosAbiertos = k.blocks.filter((b) => !b.liftedAt);
  const primera = k.invoices.find((f) => f.status === "pending" || f.status === "overdue");
  const stripeVuelta = params.get("stripe");

  return (
    <div className="space-y-4">
      <Cabecera titulo={`Contrato ${k.contractNumber}`} descripcion={`${k.customerName} · trastero ${k.unitCode} · ${k.centerName}`}>
        <ChipContrato estado={k.status} />
        {gestiona && puedeAccion("issue") && (
          <>
            <button className={btnSecondary} onClick={() => setDialogo("editar")}>
              Editar
            </button>
            <button className={btnPrimary} onClick={() => void accion(() => api.emitirContrato(id))}>
              Emitir para firma
            </button>
          </>
        )}
        {gestiona && puedeAccion("sign") && docPendiente && (
          <button className={btnPrimary} onClick={() => setDialogo("firmar")}>
            Firmar en presencia
          </button>
        )}
        {gestiona && k.status === "pending_payment" && k.collectionMethod === "stripe" && (
          <button className={btnPrimary} onClick={() => void cobrar()}>
            Cobrar primer pago (Stripe)
          </button>
        )}
        {admin && puedeAccion("activate") && (
          <button className={btnSecondary} onClick={() => setDialogo("activar")}>
            Activar sin cobro…
          </button>
        )}
        {gestiona && (k.status === "active" || k.status === "suspended") && (
          <button className={btnSecondary} onClick={() => setDialogo("suspender")}>
            Bloquear acceso…
          </button>
        )}
        {admin && ["pending_payment", "active", "suspended"].includes(k.status) && (
          <button className={btnSecondary} onClick={() => setDialogo("anexo")}>
            Anexo…
          </button>
        )}
        {admin && puedeAccion("terminate") && (
          <button className={btnDanger} onClick={() => setDialogo("finalizar")}>
            Finalizar…
          </button>
        )}
        {gestiona && puedeAccion("cancel") && (
          <button className={btnDanger} onClick={() => setDialogo("cancelar")}>
            Cancelar…
          </button>
        )}
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <Aviso tono="aviso">{aviso}</Aviso>}
      {stripeVuelta === "ok" && (
        <Aviso tono="info">
          Vuelta de Stripe. El pago se confirma cuando llega el aviso de Stripe (webhook), no al volver de la página: si aún no se ve, recarga
          en unos segundos.
        </Aviso>
      )}
      {stripeVuelta === "cancelado" && <Aviso tono="aviso">Se salió de Stripe sin completar el pago.</Aviso>}
      {k.status === "pending_payment" && k.collectionMethod === "manual" && (
        <Aviso tono="info">
          Cobro por {etqMetodo(k.paymentMethod).toLowerCase()}: el contrato se activa al registrar el pago de la primera factura
          {primera ? (
            <>
              {" "}
              (
              <Link className="underline" to={`/self-storage/facturas?f=${primera.id}`}>
                {primera.invoiceNumber}
              </Link>
              )
            </>
          ) : null}
          .
        </Aviso>
      )}
      {k.status === "pending_payment" && k.paymentMethod === "sepa" && k.firstPaymentStatus === "processing" && (
        <Aviso tono="info">
          Primer recibo SEPA en proceso.{" "}
          {k.firstSepaPaymentAccessPolicy === "wait_for_success"
            ? "Política: no se da acceso hasta que el banco lo confirme (puede tardar varios días)."
            : "Política: se da acceso mientras se procesa."}
        </Aviso>
      )}
      {k.activationOverrideReason && <Aviso tono="aviso">Activado por excepción: {k.activationOverrideReason}</Aviso>}
      {bloqueosAbiertos.length > 0 && (
        <Aviso tono="mal">Acceso bloqueado: {bloqueosAbiertos.map((b) => etqBloqueo(b.reason)).join(", ")}.</Aviso>
      )}
      {enlace && (
        <div className="space-y-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-100">
          <p>Enlace de pago de Stripe. Ábrelo aquí con el cliente delante o envíaselo; el contrato se activa cuando Stripe confirme el cobro.</p>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <a className={btnPrimary} href={enlace}>
              Abrir Stripe
            </a>
            <button className={btnSecondary} onClick={() => void navigator.clipboard?.writeText(enlace)}>
              Copiar enlace
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-800 p-4 lg:grid-cols-4">
        <Dato etiqueta="Cliente">
          <Link className="text-sky-300 hover:underline" to={`/self-storage/clientes/${k.customerId}`}>
            {k.customerName}
          </Link>
        </Dato>
        <Dato etiqueta="Trastero">
          {k.unitCode} · {k.zoneName}
        </Dato>
        <Dato etiqueta="Inicio / fin">
          {fecha(k.startDate)} → {k.endDate ? fecha(k.endDate) : "indefinido"}
        </Dato>
        <Dato etiqueta="Facturación">
          Día {k.billingDay} · mensual{k.nextInvoiceDate ? ` · próxima ${fecha(k.nextInvoiceDate)}` : ""}
        </Dato>
        <Dato etiqueta="Precio contratado">
          {euros(k.monthlyPrice)} + {pct(k.taxRate)} = <b>{euros(k.monthlyPriceGross)}</b>/mes
        </Dato>
        <Dato etiqueta="Tarifa al contratar">
          {euros(k.listMonthlyPrice)}
          {k.listMonthlyPrice != null && k.listMonthlyPrice !== k.monthlyPrice && <span className="ml-1 text-[11px] text-amber-300">precio pactado</span>}
        </Dato>
        <Dato etiqueta="Fianza">
          {euros(k.depositAmount)} {k.depositTaxRate ? `+ ${pct(k.depositTaxRate)}` : ""}
        </Dato>
        <Dato etiqueta="Forma de pago">
          {etqMetodo(k.paymentMethod)}
          {k.stripeSubscriptionId && <span className="block text-[11px] text-slate-400">Suscripción Stripe: {k.stripeSubscriptionStatus ?? "—"}</span>}
        </Dato>
        <Dato etiqueta="Firmado">{k.signedAt ? `${fechaHora(k.signedAt)} · ${k.signatureName ?? ""}` : "—"}</Dato>
        <Dato etiqueta="Activado">{fechaHora(k.activatedAt)}</Dato>
        {k.terminatedAt && <Dato etiqueta="Finalizado">{`${fechaHora(k.terminatedAt)} · ${k.terminationReason ?? ""}`}</Dato>}
        {k.cancelledAt && <Dato etiqueta="Cancelado">{`${fechaHora(k.cancelledAt)} · ${k.cancellationReason ?? ""}`}</Dato>}
        {k.notes && (
          <div className="col-span-2 lg:col-span-4">
            <Dato etiqueta="Notas internas">{k.notes}</Dato>
          </div>
        )}
      </div>

      {k.items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">Conceptos adicionales</h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Concepto</th>
                <th className={thCls}>Tipo</th>
                <th className={thCls}>Cantidad</th>
                <th className={thCls}>Base</th>
                <th className={thCls}>IVA</th>
                <th className={thCls}>Periodicidad</th>
              </tr>
            </thead>
            <tbody>
              {k.items.map((i) => (
                <tr key={i.id} className="border-t border-slate-700">
                  <td className={tdCls}>{i.description}</td>
                  <td className={tdCls}>{etqConcepto(i.itemType)}</td>
                  <td className={tdCls}>{i.quantity}</td>
                  <td className={tdCls}>{euros(i.unitPrice)}</td>
                  <td className={tdCls}>{pct(i.taxRate)}</td>
                  <td className={tdCls}>{i.isRecurring ? "Mensual" : "Una vez"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Documentos</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Documento</th>
              <th className={thCls}>Condiciones</th>
              <th className={thCls}>Estado</th>
              <th className={thCls}>Aceptación</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {k.documents.length === 0 && <EmptyRow cols={5} text="Se genera al emitir el contrato para firma." />}
            {k.documents.map((d) => (
              <tr key={d.id} className="border-t border-slate-700">
                <td className={tdCls}>
                  {d.documentType === "annex" ? "Anexo" : "Contrato"} v{d.version}
                  <div className="text-[10px] text-slate-500" title={d.sha256}>
                    {d.sha256.slice(0, 16)}…
                  </div>
                </td>
                <td className={tdCls}>{d.termsVersion ?? "—"}</td>
                <td className={tdCls}>{d.status === "final" ? "Firmado (inmutable)" : "Pendiente de firma"}</td>
                <td className={tdCls}>
                  {d.acceptedAt ? (
                    <>
                      {fechaHora(d.acceptedAt)} · {d.acceptedName}
                      <div className="text-[10px] text-slate-500">
                        {d.acceptedByType === "customer" ? "por el cliente" : "en presencia"} · IP {d.acceptedIp ?? "—"}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${tdCls} space-x-1 text-right`}>
                  <button className={btnMini} onClick={() => void pdf(d.id)}>
                    PDF
                  </button>
                  {gestiona && d.status === "draft" && d.documentType === "annex" && (
                    <button className={btnMini} onClick={() => setDialogo({ firmarAnexo: d.id })}>
                      Firmar anexo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Facturas</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={thCls}>Fecha</th>
              <th className={thCls}>Periodo</th>
              <th className={thCls}>Total</th>
              <th className={thCls}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {k.invoices.length === 0 && <EmptyRow cols={5} text="Sin facturas todavía." />}
            {k.invoices.map((f) => (
              <tr key={f.id} className="border-t border-slate-700">
                <td className={tdCls}>
                  <Link className="text-sky-300 hover:underline" to={`/self-storage/facturas?f=${f.id}`}>
                    {f.invoiceNumber ?? "Borrador"}
                  </Link>
                </td>
                <td className={tdCls}>{fecha(f.issueDate)}</td>
                <td className={tdCls}>{f.periodStart ? `${fecha(f.periodStart)} – ${fecha(f.periodEnd)}` : "—"}</td>
                <td className={tdCls}>{euros(f.total)}</td>
                <td className={tdCls}>
                  <ChipFactura estado={f.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Bloqueos de acceso</h2>
        <p className="text-[12px] text-slate-400">
          Pueden convivir varios. Cobrar sólo levanta el de impago; seguridad y manual nunca se levantan solos. Las puertas llegan en la fase 3.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Motivo</th>
              <th className={thCls}>Desde</th>
              <th className={thCls}>Notas</th>
              <th className={thCls}>Levantado</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {k.blocks.length === 0 && <EmptyRow cols={5} text="Sin bloqueos." />}
            {k.blocks.map((b) => (
              <tr key={b.id} className="border-t border-slate-700">
                <td className={tdCls}>{etqBloqueo(b.reason)}</td>
                <td className={tdCls}>{fechaHora(b.createdAt)}</td>
                <td className={tdCls}>{b.notes ?? "—"}</td>
                <td className={tdCls}>{b.liftedAt ? `${fechaHora(b.liftedAt)} · ${b.liftReason ?? ""}` : "—"}</td>
                <td className={`${tdCls} text-right`}>
                  {gestiona && !b.liftedAt && b.reason !== "payment" && b.reason !== "terminated" && (b.reason !== "security" || admin) && (
                    <button className={btnMini} onClick={() => setDialogo({ levantar: b.id })}>
                      Levantar
                    </button>
                  )}
                  {!b.liftedAt && b.reason === "payment" && <span className="text-[11px] text-slate-500">se levanta al cobrar</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Historial</h2>
          {!historial && (
            <button className={btnMini} onClick={() => void verHistorial()}>
              Ver
            </button>
          )}
        </div>
        {historial && (
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Cuándo</th>
                <th className={thCls}>Quién</th>
                <th className={thCls}>Qué</th>
                <th className={thCls}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 && <EmptyRow cols={4} text="Sin entradas." />}
              {historial.map((h) => (
                <tr key={h.id} className="border-t border-slate-700 align-top">
                  <td className={`${tdCls} whitespace-nowrap`}>{fechaHora(h.occurredAt)}</td>
                  <td className={tdCls}>{h.actorName ?? h.actorType}</td>
                  <td className={tdCls}>{h.action}</td>
                  <td className={`${tdCls} max-w-md break-all font-mono text-[10px] text-slate-400`}>
                    {h.before ? `${JSON.stringify(h.before)} → ` : ""}
                    {h.after ? JSON.stringify(h.after) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <Link to="/self-storage/contratos" className="text-[12px] text-slate-400 underline">
        Volver a contratos
      </Link>

      {dialogo === "editar" && (
        <FormContrato
          contrato={k}
          onCerrar={() => setDialogo(null)}
          onHecho={(c) => {
            setK(c);
            setDialogo(null);
          }}
        />
      )}
      {dialogo === "firmar" && docPendiente && (
        <ModalFirma
          titulo={`Firma del contrato ${k.contractNumber}`}
          documento={docPendiente}
          nombreInicial={k.customerName}
          presencial
          onVerPdf={() => void pdf(docPendiente.id)}
          onCerrar={() => setDialogo(null)}
          onFirmar={(nombre) => hacer(() => api.firmarContrato(id, { signerName: nombre, documentId: docPendiente.id, accepted: true }))}
        />
      )}
      {typeof dialogo === "object" && dialogo && "firmarAnexo" in dialogo && anexoPendiente && (
        <ModalFirma
          titulo="Firma del anexo"
          documento={k.documents.find((d) => d.id === dialogo.firmarAnexo) ?? anexoPendiente}
          nombreInicial={k.customerName}
          presencial
          onVerPdf={() => void pdf(dialogo.firmarAnexo)}
          onCerrar={() => setDialogo(null)}
          onFirmar={(nombre) => hacer(() => api.firmarContrato(id, { signerName: nombre, documentId: dialogo.firmarAnexo, accepted: true }))}
        />
      )}
      {dialogo === "activar" && (
        <ModalMotivo
          titulo="Activar sin el cobro confirmado"
          boton="Activar"
          onCerrar={() => setDialogo(null)}
          onAceptar={(m) => hacer(() => api.activarContrato(id, m))}
        >
          <Aviso tono="aviso">Excepción administrativa: el trastero pasa a ocupado y el cliente tendrá acceso aunque el cobro no esté confirmado.</Aviso>
        </ModalMotivo>
      )}
      {dialogo === "suspender" && <Suspender onCerrar={() => setDialogo(null)} onAceptar={(r, n) => hacer(() => api.suspenderContrato(id, r, n))} />}
      {dialogo === "finalizar" && (
        <Finalizar suscripcion={Boolean(k.stripeSubscriptionId)} onCerrar={() => setDialogo(null)} onAceptar={(d) => hacer(() => api.finalizarContrato(id, d))} />
      )}
      {dialogo === "cancelar" && (
        <ModalMotivo titulo={`Cancelar ${k.contractNumber}`} boton="Cancelar contrato" peligro onCerrar={() => setDialogo(null)} onAceptar={(m) => hacer(() => api.cancelarContrato(id, m))}>
          <p className="text-[12px] text-slate-400">
            El trastero vuelve a quedar libre. Si hay facturas emitidas sin cobrar, se anulan con una factura rectificativa.
          </p>
        </ModalMotivo>
      )}
      {dialogo === "anexo" && (
        <ModalMotivo
          titulo="Nuevo anexo"
          etiqueta="Texto del anexo (cambio pactado con el cliente)"
          boton="Generar anexo"
          onCerrar={() => setDialogo(null)}
          onAceptar={(t) => hacer(() => api.anexoContrato(id, t))}
        >
          <p className="text-[12px] text-slate-400">El contrato firmado no se toca: el anexo es otro documento, que también se firma.</p>
        </ModalMotivo>
      )}
      {typeof dialogo === "object" && dialogo && "levantar" in dialogo && (
        <ModalMotivo titulo="Levantar bloqueo" boton="Levantar" onCerrar={() => setDialogo(null)} onAceptar={(m) => hacer(() => api.levantarBloqueo(id, dialogo.levantar, m))} />
      )}
    </div>
  );
}

function Suspender({ onCerrar, onAceptar }: { onCerrar: () => void; onAceptar: (r: "security" | "incident" | "manual", notas: string) => Promise<void> }) {
  const { etqBloqueo } = useSelfStorage();
  const [motivo, setMotivo] = useState<"security" | "incident" | "manual">("manual");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Bloquear el acceso"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Volver
          </button>
          <button className={btnDanger} disabled={!notas.trim()} onClick={() => onAceptar(motivo, notas.trim()).catch((e) => setError(msgError(e)))}>
            Bloquear
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <SelectField label="Motivo" value={motivo} onChange={(v) => setMotivo(v as typeof motivo)}>
          {(["security", "incident", "manual"] as const).map((r) => (
            <option key={r} value={r}>
              {etqBloqueo(r)}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Notas (obligatorias, quedan en la auditoría)" value={notas} onChange={setNotas} rows={3} />
        <p className="text-[12px] text-slate-400">El contrato pasa a suspendido. El impago no se bloquea a mano: lo hace el motor de impagos.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

function Finalizar({ suscripcion, onCerrar, onAceptar }: { suscripcion: boolean; onCerrar: () => void; onAceptar: (d: { endDate: string | null; reason: string }) => Promise<void> }) {
  const [fin, setFin] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Finalizar contrato"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Volver
          </button>
          <button className={btnDanger} disabled={!motivo.trim()} onClick={() => onAceptar({ endDate: fin || null, reason: motivo.trim() }).catch((e) => setError(msgError(e)))}>
            Finalizar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Fecha de fin" type="date" value={fin} onChange={setFin} />
        <TextAreaField label="Motivo (obligatorio)" value={motivo} onChange={setMotivo} rows={3} />
        <p className="text-[12px] text-slate-400">
          El trastero queda libre y el acceso del cliente, bloqueado.{suscripcion ? " Se cancela también la suscripción de Stripe." : ""} Las facturas
          pendientes siguen pendientes.
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
