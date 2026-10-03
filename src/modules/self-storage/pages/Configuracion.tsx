/**
 * Configuración de facturación y contratos de la empresa: emisor, series,
 * vencimiento, plazos de impago, política del primer SEPA, condiciones
 * generales e IVA general de la empresa. Cada cambio queda auditado.
 *
 * Los valores y sus límites los valida el servidor; aquí sólo se editan.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as api from "../services/api";
import { TRABAJOS, type Ajustes, type ClaveAjuste, type Emisor, type FirstSepaPolicy, type Trabajo } from "../types";
import { Aviso, Cabecera, Cargando, ErrorBox, SelectField, TextAreaField, TextField, btnMini, btnPrimary, msgError } from "../components/ui";

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
      <h2 className="text-sm font-bold">{titulo}</h2>
      {ayuda && <p className="text-[12px] text-slate-400">{ayuda}</p>}
      {children}
    </section>
  );
}

const NOMBRE_TRABAJO: Record<Trabajo, string> = {
  facturacion: "Facturar periodos (cobro manual)",
  vencimientos: "Marcar facturas vencidas",
  impagos: "Avanzar impagos (avisos y suspensión)",
  notificaciones: "Enviar notificaciones pendientes",
  stripe_reintentos: "Reintentar eventos de Stripe fallidos",
};

export default function Configuracion() {
  const [a, setA] = useState<Ajustes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [emisor, setEmisor] = useState<Emisor>({ name: "", taxId: "", address: "", email: "", phone: "" });
  const [series, setSeries] = useState({ factura: "", rectificativa: "", contrato: "" });
  const [dias, setDias] = useState("");
  const [impago, setImpago] = useState({ firstNoticeDays: "", secondNoticeDays: "", suspendDays: "" });
  const [sepa, setSepa] = useState<FirstSepaPolicy>("wait_for_success");
  const [iva, setIva] = useState("");
  const [terminos, setTerminos] = useState({ version: "", texto: "" });

  const cargar = useCallback(async () => {
    try {
      const r = await api.ajustes();
      setA(r);
      const e = r["billing.issuer"].value;
      setEmisor({ name: e?.name ?? "", taxId: e?.taxId ?? "", address: e?.address ?? "", email: e?.email ?? "", phone: e?.phone ?? "" });
      setSeries({ factura: r["billing.invoice_series"].value, rectificativa: r["billing.rectifying_series"].value, contrato: r["contracts.series"].value });
      setDias(String(r["billing.due_days"].value));
      const p = r["dunning.policy"].value;
      setImpago({ firstNoticeDays: String(p.firstNoticeDays), secondNoticeDays: String(p.secondNoticeDays), suspendDays: String(p.suspendDays) });
      setSepa(r["billing.first_sepa_payment_access_policy"].value);
      setIva(r.default_vat_rate.value.toFixed(2).replace(".", ","));
      setTerminos({ version: r["contracts.terms_version"].value, texto: r["contracts.terms_text"].value });
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Guarda varias claves en orden; si una falla, se para y lo dice. */
  const guardar = async (cambios: { [K in ClaveAjuste]?: Ajustes[K]["value"] }, que: string) => {
    setOk(null);
    setError(null);
    try {
      for (const [k, v] of Object.entries(cambios)) await api.guardarAjuste(k as ClaveAjuste, v as never);
      setOk(`${que}: guardado.`);
      await cargar();
    } catch (e) {
      setError(`${que}: ${msgError(e)}`);
    }
  };

  const ejecutar = async (t: Trabajo) => {
    setOk(null);
    try {
      const r = await api.ejecutarTrabajo(t);
      setOk(`${NOMBRE_TRABAJO[t]}: ${JSON.stringify(r)}`);
    } catch (e) {
      setError(msgError(e));
    }
  };

  if (!a && !error) return <Cargando />;
  const n = (s: string) => Number(s.replace(",", "."));
  const cambiaIva = Boolean(a) && n(iva) !== a!.default_vat_rate.value;

  return (
    <div className="space-y-4">
      <Cabecera titulo="Configuración" descripcion="Facturación, contratos e impagos de la empresa. Cada cambio queda en la auditoría." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      {a && (
        <>
          <Bloque titulo="Emisor de facturas y contratos" ayuda="Sin estos datos no se emite ninguna factura ni contrato. Se copian en cada documento al emitirlo.">
            {!a["billing.issuer"].value && <Aviso tono="aviso">Falta el emisor: no se pueden emitir contratos ni facturas.</Aviso>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextField label="Razón social" value={emisor.name} onChange={(v) => setEmisor((e) => ({ ...e, name: v }))} />
              <TextField label="NIF" value={emisor.taxId} onChange={(v) => setEmisor((e) => ({ ...e, taxId: v }))} />
              <TextField label="Dirección fiscal" value={emisor.address} onChange={(v) => setEmisor((e) => ({ ...e, address: v }))} />
              <TextField label="Email" value={emisor.email ?? ""} onChange={(v) => setEmisor((e) => ({ ...e, email: v }))} />
              <TextField label="Teléfono" value={emisor.phone ?? ""} onChange={(v) => setEmisor((e) => ({ ...e, phone: v }))} />
            </div>
            <button
              className={btnPrimary}
              onClick={() =>
                void guardar(
                  {
                    "billing.issuer": {
                      name: emisor.name,
                      taxId: emisor.taxId,
                      address: emisor.address,
                      ...(emisor.email?.trim() ? { email: emisor.email.trim() } : {}),
                      ...(emisor.phone?.trim() ? { phone: emisor.phone.trim() } : {}),
                    },
                  },
                  "Emisor"
                )
              }
            >
              Guardar emisor
            </button>
          </Bloque>

          <Bloque titulo="IVA general" ayuda="Se aplicará por defecto a nuevos contratos y conceptos configurados para heredar el IVA general.">
            <div className="flex max-w-xs items-end gap-2">
              <TextField label="IVA general (%)" value={iva} onChange={setIva} />
              <span className="pb-2 text-sm text-slate-400">%</span>
            </div>
            {cambiaIva && <Aviso tono="aviso">El cambio no modifica contratos ni facturas existentes.</Aviso>}
            <button className={btnPrimary} disabled={!cambiaIva || !Number.isFinite(n(iva))} onClick={() => void guardar({ default_vat_rate: n(iva) }, "IVA general")}>
              Guardar
            </button>
          </Bloque>

          <Bloque titulo="Numeración y vencimiento" ayuda="Series en mayúsculas (1-5 letras). El número sigue el formato SERIE-AÑO-000001, correlativo por serie y año.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <TextField label="Serie facturas" value={series.factura} onChange={(v) => setSeries((s) => ({ ...s, factura: v.toUpperCase() }))} />
              <TextField label="Serie rectificativas" value={series.rectificativa} onChange={(v) => setSeries((s) => ({ ...s, rectificativa: v.toUpperCase() }))} />
              <TextField label="Serie contratos" value={series.contrato} onChange={(v) => setSeries((s) => ({ ...s, contrato: v.toUpperCase() }))} />
              <TextField label="Días para vencer (cobro manual)" value={dias} onChange={setDias} />
            </div>
            <button
              className={btnPrimary}
              onClick={() =>
                void guardar(
                  {
                    "billing.invoice_series": series.factura,
                    "billing.rectifying_series": series.rectificativa,
                    "contracts.series": series.contrato,
                    "billing.due_days": n(dias),
                  },
                  "Numeración"
                )
              }
            >
              Guardar
            </button>
          </Bloque>

          <Bloque titulo="Impagos" ayuda="Días desde el cobro fallido (día 0). Tras la suspensión se bloquea el acceso; al cobrar se levanta sólo ese bloqueo.">
            <div className="grid grid-cols-3 gap-2">
              <TextField label="Primer aviso (días)" value={impago.firstNoticeDays} onChange={(v) => setImpago((p) => ({ ...p, firstNoticeDays: v }))} />
              <TextField label="Segundo aviso (días)" value={impago.secondNoticeDays} onChange={(v) => setImpago((p) => ({ ...p, secondNoticeDays: v }))} />
              <TextField label="Suspensión (días)" value={impago.suspendDays} onChange={(v) => setImpago((p) => ({ ...p, suspendDays: v }))} />
            </div>
            <button
              className={btnPrimary}
              onClick={() =>
                void guardar(
                  { "dunning.policy": { firstNoticeDays: n(impago.firstNoticeDays), secondNoticeDays: n(impago.secondNoticeDays), suspendDays: n(impago.suspendDays) } },
                  "Impagos"
                )
              }
            >
              Guardar
            </button>
          </Bloque>

          <Bloque
            titulo="Primer cobro SEPA de un cliente nuevo"
            ayuda="Un adeudo SEPA tarda varios días en confirmarse. Por defecto el contrato espera al cobro. Un cliente que ya está activo y tiene un recibo en proceso no se bloquea nunca por eso."
          >
            <SelectField label="Política" value={sepa} onChange={(v) => setSepa(v as FirstSepaPolicy)}>
              <option value="wait_for_success">Esperar a que se confirme (recomendado)</option>
              <option value="allow_while_processing">Dar acceso mientras se procesa</option>
            </SelectField>
            <button className={btnPrimary} onClick={() => void guardar({ "billing.first_sepa_payment_access_policy": sepa }, "Política SEPA")}>
              Guardar
            </button>
          </Bloque>

          <Bloque titulo="Condiciones generales del contrato" ayuda="Se imprimen en cada contrato con su versión. Cambia la versión al cambiar el texto: los contratos firmados conservan la suya.">
            <TextField label="Versión" value={terminos.version} onChange={(v) => setTerminos((t) => ({ ...t, version: v }))} />
            <TextAreaField label="Texto" value={terminos.texto} onChange={(v) => setTerminos((t) => ({ ...t, texto: v }))} rows={12} />
            <button
              className={btnPrimary}
              onClick={() => void guardar({ "contracts.terms_version": terminos.version, "contracts.terms_text": terminos.texto }, "Condiciones")}
            >
              Guardar
            </button>
          </Bloque>

          <Bloque titulo="Trabajos programados" ayuda="Se ejecutan solos cada pocos minutos. Aquí se pueden lanzar a mano.">
            <div className="flex flex-wrap gap-2 text-[11px]">
              {TRABAJOS.map((t) => (
                <button key={t} className={btnMini} onClick={() => void ejecutar(t)}>
                  {NOMBRE_TRABAJO[t]}
                </button>
              ))}
            </div>
          </Bloque>
        </>
      )}
    </div>
  );
}
