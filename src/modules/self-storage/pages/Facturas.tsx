/**
 * Facturas: lista con filtros, ficha (`?f=<id>`) con líneas, pagos y PDF, y
 * factura manual desde el catálogo de conceptos.
 *
 * Una factura emitida no se borra ni se cambia: se anula con una rectificativa.
 * Un pago con tarjeta/SEPA no se registra aquí: lo confirma Stripe. Aquí sólo
 * se registran transferencias y efectivo de facturas de cobro manual.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import { INVOICE_STATUSES, type Cliente, type Concepto, type Contrato, type Factura, type FacturaDetalle } from "../types";
import { ModalMotivo } from "../components/Dialogos";
import {
  Aviso,
  Cabecera,
  Cargando,
  ChipFactura,
  ChipPago,
  Dato,
  EmptyRow,
  ErrorBox,
  Modal,
  SelectField,
  TableWrap,
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

const POR_PAGINA = 50;

export default function Facturas() {
  const { puede, etqFactura } = useSelfStorage();
  const [params, setParams] = useSearchParams();
  const [datos, setDatos] = useState<{ total: number; items: Factura[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(0);
  const [nueva, setNueva] = useState(false);
  const abierta = params.get("f");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.facturas({ status: status || undefined, q: q || undefined, limit: POR_PAGINA, offset: pagina * POR_PAGINA }));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [status, q, pagina]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);
    return () => clearTimeout(t);
  }, [cargar]);

  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("f", id);
    else {
      p.delete("f");
      p.delete("stripe");
    }
    setParams(p);
  };

  return (
    <div className="space-y-3">
      <Cabecera titulo="Facturas" descripcion="Numeración correlativa por serie y año. Las emitidas no se borran: se rectifican.">
        {puede("ss.billing.manage") && (
          <button className={btnPrimary} onClick={() => setNueva(true)}>
            Factura manual
          </button>
        )}
      </Cabecera>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
        <TextField
          label="Buscar"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPagina(0);
          }}
          placeholder="Número o cliente"
        />
        <SelectField
          label="Estado"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPagina(0);
          }}
        >
          <option value="">Todos</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {etqFactura(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TablaFacturas items={datos?.items ?? null} onAbrir={abrir} />
      {datos && datos.total > POR_PAGINA && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-slate-400">
          <button className={btnMini} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          {pagina * POR_PAGINA + 1}–{Math.min(datos.total, (pagina + 1) * POR_PAGINA)} de {datos.total}
          <button className={btnMini} disabled={(pagina + 1) * POR_PAGINA >= datos.total} onClick={() => setPagina((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}

      {abierta && <FichaFactura id={abierta} vuelta={params.get("stripe")} onCerrar={() => abrir(null)} onCambio={() => void cargar()} />}
      {nueva && (
        <NuevaFactura
          onCerrar={() => setNueva(false)}
          onHecho={(f) => {
            setNueva(false);
            void cargar();
            abrir(f.id);
          }}
        />
      )}
    </div>
  );
}

export function TablaFacturas({ items, onAbrir, sinCliente }: { items: Factura[] | null; onAbrir: (id: string) => void; sinCliente?: boolean }) {
  const cols = sinCliente ? 6 : 7;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Número</th>
          <th className={thCls}>Fecha</th>
          {!sinCliente && <th className={thCls}>Cliente</th>}
          <th className={thCls}>Contrato</th>
          <th className={thCls}>Vence</th>
          <th className={thCls}>Total</th>
          <th className={thCls}>Estado</th>
        </tr>
      </thead>
      <tbody>
        {!items && <EmptyRow cols={cols} text="Cargando…" />}
        {items?.length === 0 && <EmptyRow cols={cols} text="Sin facturas." />}
        {items?.map((f) => (
          <tr key={f.id} className="cursor-pointer border-t border-slate-700 hover:bg-slate-800/60" onClick={() => onAbrir(f.id)}>
            <td className={`${tdCls} font-bold text-sky-300`}>{f.invoiceNumber ?? "Borrador"}</td>
            <td className={tdCls}>{fecha(f.issueDate)}</td>
            {!sinCliente && <td className={tdCls}>{f.displayCustomer}</td>}
            <td className={tdCls}>{f.contractNumber ?? "—"}</td>
            <td className={tdCls}>{fecha(f.dueDate)}</td>
            <td className={tdCls}>{euros(f.total)}</td>
            <td className={tdCls}>
              <ChipFactura estado={f.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function FichaFactura({ id, vuelta, onCerrar, onCambio }: { id: string; vuelta?: string | null; onCerrar: () => void; onCambio: () => void }) {
  const { puede, etqConcepto, etqMetodo } = useSelfStorage();
  const [f, setF] = useState<FacturaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<null | "rectificar" | "pago">(null);
  const [enlace, setEnlace] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setF(await api.factura(id));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await cargar();
      onCambio();
    } catch (e) {
      setError(msgError(e));
    }
  };

  const pendiente = f && (f.status === "pending" || f.status === "overdue");

  return (
    <Modal wide title={f ? `Factura ${f.invoiceNumber ?? "(borrador)"}` : "Factura"} onClose={onCerrar}>
      {!f && !error && <Cargando />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {f && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <ChipFactura estado={f.status} />
            {f.kind === "rectifying" && <span className="text-violet-300">Rectificativa · {f.rectificationReason}</span>}
            {f.stripeInvoiceId && <span className="text-slate-400">Cobro por Stripe</span>}
            <span className="flex-1" />
            {f.status !== "draft" && (
              <button className={btnMini} onClick={() => void api.pdfFactura(f.id).catch((e) => setError(msgError(e)))}>
                PDF
              </button>
            )}
            {f.status === "draft" && puede("ss.billing.manage") && (
              <>
                <button className={btnMini} onClick={() => void accion(() => api.emitirFactura(f.id))}>
                  Emitir (numera)
                </button>
                <button
                  className={btnMini}
                  onClick={() =>
                    void accion(async () => {
                      await api.borrarFactura(f.id);
                      onCerrar();
                    })
                  }
                >
                  Borrar borrador
                </button>
              </>
            )}
            {pendiente && puede("ss.billing.manage") && (
              <button className={btnMini} onClick={() => void api.enlacePago(f.id).then((r) => setEnlace(r.url), (e) => setError(msgError(e)))}>
                Enlace de pago
              </button>
            )}
            {pendiente && !f.stripeInvoiceId && puede("ss.billing.manage") && (
              <button className={btnMini} onClick={() => setDialogo("pago")}>
                Registrar transferencia/efectivo
              </button>
            )}
            {f.kind !== "rectifying" && ["pending", "overdue", "paid"].includes(f.status) && puede("ss.billing.admin") && (
              <button className={btnMini} onClick={() => setDialogo("rectificar")}>
                Rectificar…
              </button>
            )}
          </div>

          {vuelta === "ok" && <Aviso tono="info">Vuelta de Stripe: el pago se confirma cuando llega el aviso de Stripe. Si aún no se ve, recarga en unos segundos.</Aviso>}
          {enlace && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-2 text-[12px] text-sky-100">
              <span className="min-w-0 flex-1 truncate">{enlace}</span>
              <a className={btnMini} href={enlace} target="_blank" rel="noreferrer">
                Abrir
              </a>
              <button className={btnMini} onClick={() => void navigator.clipboard?.writeText(enlace)}>
                Copiar
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-900 p-3 sm:grid-cols-4">
            <Dato etiqueta="Emisor">
              {f.issuerName ?? "—"}
              <span className="block text-[11px] text-slate-400">{f.issuerTaxId}</span>
            </Dato>
            <Dato etiqueta="Cliente">
              <Link className="text-sky-300 hover:underline" to={`/self-storage/clientes/${f.customerId}`}>
                {f.customerName ?? f.displayCustomer}
              </Link>
              <span className="block text-[11px] text-slate-400">{f.customerTaxId}</span>
            </Dato>
            <Dato etiqueta="Fecha / vence">
              {fecha(f.issueDate)} · {fecha(f.dueDate)}
            </Dato>
            <Dato etiqueta="Contrato">
              {f.contractId ? (
                <Link className="text-sky-300 hover:underline" to={`/self-storage/contratos/${f.contractId}`}>
                  {f.contractNumber}
                </Link>
              ) : (
                "—"
              )}
            </Dato>
            {f.periodStart && (
              <Dato etiqueta="Periodo">
                {fecha(f.periodStart)} – {fecha(f.periodEnd)}
              </Dato>
            )}
            {f.customerAddress && <Dato etiqueta="Dirección del cliente">{f.customerAddress}</Dato>}
            {f.notes && <Dato etiqueta="Notas">{f.notes}</Dato>}
          </div>

          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Concepto</th>
                <th className={thCls}>Cant.</th>
                <th className={thCls}>Precio</th>
                <th className={thCls}>Base</th>
                <th className={thCls}>IVA</th>
                <th className={thCls}>Total</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-700">
                  <td className={tdCls}>
                    {l.description}
                    <span className="block text-[10px] text-slate-500">{etqConcepto(l.itemType)}</span>
                  </td>
                  <td className={tdCls}>{l.quantity}</td>
                  <td className={tdCls}>{euros(l.unitPrice)}</td>
                  <td className={tdCls}>{euros(l.subtotal)}</td>
                  <td className={tdCls}>
                    {euros(l.taxAmount)} <span className="text-[10px] text-slate-500">({pct(l.taxRate)})</span>
                  </td>
                  <td className={tdCls}>{euros(l.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-600 font-bold">
                <td className={tdCls} colSpan={3}>
                  Totales
                </td>
                <td className={tdCls}>{euros(f.subtotal)}</td>
                <td className={tdCls}>{euros(f.tax)}</td>
                <td className={tdCls}>{euros(f.total)}</td>
              </tr>
            </tbody>
          </TableWrap>

          <div>
            <h3 className="mb-1 text-[12px] font-bold">Pagos</h3>
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Forma</th>
                  <th className={thCls}>Importe</th>
                  <th className={thCls}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {f.payments.length === 0 && <EmptyRow cols={4} text="Sin pagos." />}
                {f.payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-700">
                    <td className={tdCls}>{fechaHora(p.paidAt ?? p.createdAt)}</td>
                    <td className={tdCls}>{etqMetodo(p.paymentMethod)}</td>
                    <td className={tdCls}>
                      {euros(p.amount)}
                      {p.refundedAmount > 0 && <span className="ml-1 text-[11px] text-violet-300">(−{euros(p.refundedAmount)})</span>}
                    </td>
                    <td className={tdCls}>
                      <ChipPago estado={p.status} />
                      {p.failureReason && <span className="block text-[11px] text-rose-300">{p.failureReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </div>
      )}

      {dialogo === "rectificar" && f && (
        <ModalMotivo
          titulo={`Rectificar ${f.invoiceNumber}`}
          boton="Emitir rectificativa"
          peligro
          onCerrar={() => setDialogo(null)}
          onAceptar={async (m) => {
            await api.rectificarFactura(f.id, m);
            setDialogo(null);
            await cargar();
            onCambio();
          }}
        >
          <p className="text-[12px] text-slate-400">
            Se emite una factura rectificativa por el importe en negativo y esta queda anulada (o reembolsada, si estaba pagada). No se borra nada.
          </p>
        </ModalMotivo>
      )}
      {dialogo === "pago" && f && (
        <RegistrarPago
          factura={f}
          onCerrar={() => setDialogo(null)}
          onHecho={async () => {
            setDialogo(null);
            await cargar();
            onCambio();
          }}
        />
      )}
    </Modal>
  );
}

function RegistrarPago({ factura, onCerrar, onHecho }: { factura: FacturaDetalle; onCerrar: () => void; onHecho: () => Promise<void> }) {
  const { etqMetodo } = useSelfStorage();
  const [metodo, setMetodo] = useState<"bank_transfer" | "cash">("bank_transfer");
  const [dia, setDia] = useState(new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const registrar = async () => {
    setEnviando(true);
    try {
      // Mediodía de Madrid: el día elegido no se mueve por la zona horaria.
      await api.registrarPago({ invoiceId: factura.id, paymentMethod: metodo, paidAt: `${dia}T12:00:00+01:00`, notes: notas.trim() || undefined });
      await onHecho();
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };
  return (
    <Modal
      title={`Registrar pago de ${factura.invoiceNumber}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Volver
          </button>
          <button className={btnPrimary} disabled={enviando || !dia} onClick={() => void registrar()}>
            Registrar {euros(factura.total)}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <SelectField label="Forma de pago" value={metodo} onChange={(v) => setMetodo(v as typeof metodo)}>
          <option value="bank_transfer">{etqMetodo("bank_transfer")}</option>
          <option value="cash">{etqMetodo("cash")}</option>
        </SelectField>
        <TextField label="Fecha del cobro" type="date" value={dia} onChange={setDia} />
        <TextField label="Notas (referencia de la transferencia…)" value={notas} onChange={setNotas} />
        <p className="text-[12px] text-slate-400">
          Se registra por el total de la factura. Si cierra un impago, levanta SÓLO el bloqueo por impago y reactiva el contrato si no quedan otros.
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

type LineaBorrador = { billingItemId: string; quantity: string; unitPrice: string; description: string };

function NuevaFactura({ onCerrar, onHecho }: { onCerrar: () => void; onHecho: (f: FacturaDetalle) => void }) {
  const { etqConcepto } = useSelfStorage();
  const [catalogo, setCatalogo] = useState<Concepto[]>([]);
  const [busca, setBusca] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [contratosCliente, setContratosCliente] = useState<Contrato[]>([]);
  const [contractId, setContractId] = useState("");
  const [vence, setVence] = useState("");
  const [lineas, setLineas] = useState<LineaBorrador[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .conceptos()
      .then((c) => {
        const activos = c.filter((x) => x.active);
        setCatalogo(activos);
        if (activos[0]) setLineas([{ billingItemId: activos[0].id, quantity: "1", unitPrice: "", description: "" }]);
      })
      .catch((e) => setError(msgError(e)));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .clientes({ q: busca || undefined, limit: 50 })
        .then((r) => setClientes(r.items))
        .catch((e) => setError(msgError(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => {
    setContractId("");
    if (!customerId) return setContratosCliente([]);
    api
      .contratos({ customerId })
      .then(setContratosCliente)
      .catch((e) => setError(msgError(e)));
  }, [customerId]);

  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const crear = async () => {
    setEnviando(true);
    setError(null);
    try {
      const f = await api.crearFactura({
        customerId,
        contractId: contractId || null,
        dueDate: vence || null,
        lines: lineas.map((l) => ({ billingItemId: l.billingItemId, quantity: n(l.quantity) ?? 1, unitPrice: n(l.unitPrice), description: l.description.trim() || null })),
      });
      onHecho(f);
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal
      wide
      title="Factura manual (borrador)"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!customerId || lineas.length === 0 || enviando} onClick={() => void crear()}>
            Crear borrador
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] text-slate-400">
          Se crea en borrador, sin número. El IVA de cada línea sale del concepto del catálogo. Al emitirla se numera y ya no se puede cambiar.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TextField label="Buscar cliente" value={busca} onChange={setBusca} />
          <SelectField label="Cliente" value={customerId} onChange={setCustomerId}>
            <option value="">— Elige —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} · {c.taxId}
              </option>
            ))}
          </SelectField>
          <SelectField label="Contrato (opcional)" value={contractId} onChange={setContractId}>
            <option value="">— Ninguno —</option>
            {contratosCliente.map((k) => (
              <option key={k.id} value={k.id}>
                {k.contractNumber} · {k.unitCode}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Vencimiento (opcional)" type="date" value={vence} onChange={setVence} />
        {lineas.map((l, i) => {
          const item = catalogo.find((c) => c.id === l.billingItemId);
          const cambiar = (k: keyof LineaBorrador, v: string) => setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
              <SelectField label="Concepto" value={l.billingItemId} onChange={(v) => cambiar("billingItemId", v)}>
                {catalogo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {etqConcepto(c.itemType)} · IVA {pct(c.taxRate)}
                  </option>
                ))}
              </SelectField>
              <TextField label="Cantidad" value={l.quantity} onChange={(v) => cambiar("quantity", v)} />
              <TextField label="Precio base (€)" value={l.unitPrice} onChange={(v) => cambiar("unitPrice", v)} placeholder={item ? String(item.defaultPrice) : ""} />
              <TextField label="Descripción" value={l.description} onChange={(v) => cambiar("description", v)} placeholder={item?.name} />
              <button className={btnDanger} onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          );
        })}
        <button
          className={btnMini}
          disabled={!catalogo.length}
          onClick={() => setLineas((xs) => [...xs, { billingItemId: catalogo[0]!.id, quantity: "1", unitPrice: "", description: "" }])}
        >
          Añadir línea
        </button>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
