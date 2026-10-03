/**
 * Alta y edición (en borrador) de un contrato.
 *
 * El precio de partida es el del trastero; se puede pactar otro (base sin IVA
 * o PVP con IVA) y el servidor lo copia al contrato. Los conceptos extra salen
 * del catálogo con su IVA: aquí no se escribe ningún tipo impositivo.
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "../services/api";
import { PAYMENT_METHODS, type Cliente, type Concepto, type ContratoDetalle, type PaymentMethod, type Trastero } from "../types";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { ErrorBox, Modal, SelectField, TextAreaField, TextField, btnMini, btnPrimary, btnSecondary, euros, msgError, pct } from "./ui";

type Extra = { billingItemId: string; quantity: string; unitPrice: string; description: string };

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export default function FormContrato({
  contrato,
  inicial,
  onCerrar,
  onHecho,
}: {
  contrato?: ContratoDetalle;
  inicial?: { customerId?: string; unitId?: string };
  onCerrar: () => void;
  onHecho: (c: ContratoDetalle) => void;
}) {
  const { centroId, etqMetodo, etqConcepto } = useSelfStorage();
  const editando = Boolean(contrato);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busca, setBusca] = useState("");
  const [trasteros, setTrasteros] = useState<Trastero[]>([]);
  const [catalogo, setCatalogo] = useState<Concepto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [f, setF] = useState(() => ({
    customerId: contrato?.customerId ?? inicial?.customerId ?? "",
    unitId: contrato?.unitId ?? inicial?.unitId ?? "",
    startDate: contrato?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: contrato?.endDate ?? "",
    modoPrecio: "tarifa" as "tarifa" | "base" | "pvp",
    precio: "",
    depositAmount: contrato ? String(contrato.depositAmount) : "",
    billingDay: contrato ? String(contrato.billingDay) : "",
    paymentMethod: (contrato?.paymentMethod ?? "") as PaymentMethod | "",
    notes: contrato?.notes ?? "",
  }));
  const [extras, setExtras] = useState<Extra[]>(
    () =>
      contrato?.items.map((i) => ({
        billingItemId: i.billingItemId ?? "",
        quantity: String(i.quantity),
        unitPrice: String(i.unitPrice),
        description: i.description,
      })) ?? []
  );
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api.conceptos().then(setCatalogo).catch((e) => setError(msgError(e)));
  }, []);

  useEffect(() => {
    if (editando) return;
    const t = setTimeout(() => {
      api
        .clientes({ q: busca || undefined, status: "active", limit: 50 })
        .then((r) => setClientes(r.items))
        .catch((e) => setError(msgError(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, editando]);

  useEffect(() => {
    if (editando || !centroId) return;
    api
      .trasteros({ centerId: centroId, status: "available" })
      .then(async (lista) => {
        // El trastero que llega preseleccionado puede no estar en la lista del centro elegido.
        if (inicial?.unitId && !lista.some((t) => t.id === inicial.unitId)) {
          const t = await api.trastero(inicial.unitId).catch(() => null);
          if (t) lista = [t, ...lista];
        }
        setTrasteros(lista);
      })
      .catch((e) => setError(msgError(e)));
  }, [centroId, editando, inicial?.unitId]);

  const unidad = trasteros.find((t) => t.id === f.unitId);
  const extrasCatalogo = useMemo(() => catalogo.filter((c) => c.active && c.itemType !== "rental" && c.itemType !== "deposit"), [catalogo]);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const precio = num(f.precio);
      const d: Record<string, unknown> = {
        startDate: f.startDate,
        endDate: f.endDate || null,
        paymentMethod: f.paymentMethod || null,
        notes: f.notes.trim() || null,
        extras: extras
          .filter((e) => e.billingItemId)
          .map((e) => ({
            billingItemId: e.billingItemId,
            quantity: num(e.quantity) ?? 1,
            unitPrice: num(e.unitPrice),
            description: e.description.trim() || null,
          })),
      };
      if (f.modoPrecio === "base" && precio != null) d.monthlyPrice = precio;
      if (f.modoPrecio === "pvp" && precio != null) d.monthlyPriceGross = precio;
      if (num(f.depositAmount) != null) d.depositAmount = num(f.depositAmount);
      if (num(f.billingDay) != null) d.billingDay = num(f.billingDay);
      const r = contrato ? await api.editarContrato(contrato.id, d) : await api.crearContrato({ ...d, customerId: f.customerId, unitId: f.unitId });
      onHecho(r);
    } catch (e) {
      setError(msgError(e, "No se ha podido guardar"));
    } finally {
      setGuardando(false);
    }
  };

  const valido = f.startDate && (editando || (f.customerId && f.unitId));

  return (
    <Modal
      wide
      title={editando ? `Editar ${contrato!.contractNumber}` : "Nuevo contrato"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!valido || guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : editando ? "Guardar" : "Crear borrador"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        {editando ? (
          <p className="text-[12px] text-slate-400">
            {contrato!.customerName} · trastero {contrato!.unitCode} ({contrato!.centerName}). Cliente y trastero no se cambian: si no son,
            cancela este borrador y crea otro.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <TextField label="Buscar cliente" value={busca} onChange={setBusca} placeholder="Nombre, NIF, email…" />
              <SelectField label="Cliente" value={f.customerId} onChange={(v) => set("customerId", v)}>
                <option value="">— Elige —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} · {c.taxId}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-1">
              <SelectField label="Trastero libre (centro elegido arriba)" value={f.unitId} onChange={(v) => set("unitId", v)}>
                <option value="">— Elige —</option>
                {trasteros.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.zone.name} · {euros(t.monthlyPriceGross)}/mes
                  </option>
                ))}
              </SelectField>
              {unidad && (
                <p className="text-[12px] text-slate-400">
                  Tarifa: {euros(unidad.monthlyPrice)} + {pct(unidad.taxRate)} IVA = {euros(unidad.monthlyPriceGross)} · fianza {euros(unidad.depositAmount)}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField label="Inicio" type="date" value={f.startDate} onChange={(v) => set("startDate", v)} />
          <TextField label="Fin (opcional)" type="date" value={f.endDate} onChange={(v) => set("endDate", v)} />
          <TextField label="Día de facturación (1-28)" value={f.billingDay} onChange={(v) => set("billingDay", v)} placeholder="el del inicio" />
          <SelectField label="Forma de pago" value={f.paymentMethod} onChange={(v) => set("paymentMethod", v as PaymentMethod | "")}>
            <option value="">— Sin decidir —</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {etqMetodo(m)}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SelectField label="Precio mensual" value={f.modoPrecio} onChange={(v) => set("modoPrecio", v as typeof f.modoPrecio)}>
            <option value="tarifa">{editando ? "El que tiene" : "El de tarifa del trastero"}</option>
            <option value="base">Pactado · base sin IVA</option>
            <option value="pvp">Pactado · PVP con IVA</option>
          </SelectField>
          {f.modoPrecio !== "tarifa" && <TextField label="Importe pactado (€)" value={f.precio} onChange={(v) => set("precio", v)} />}
          <TextField
            label="Fianza (€)"
            value={f.depositAmount}
            onChange={(v) => set("depositAmount", v)}
            placeholder={unidad ? String(unidad.depositAmount) : "la del trastero"}
          />
        </div>
        {editando && (
          <p className="text-[12px] text-slate-400">
            Ahora: {euros(contrato!.monthlyPrice)} + {pct(contrato!.taxRate)} = {euros(contrato!.monthlyPriceGross)} al mes
            {contrato!.listMonthlyPrice != null && contrato!.listMonthlyPrice !== contrato!.monthlyPrice && ` (tarifa ${euros(contrato!.listMonthlyPrice)})`}.
          </p>
        )}

        <div className="space-y-2 rounded-xl border border-slate-700 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase text-slate-400">Conceptos adicionales (del catálogo)</span>
            <button
              className={btnMini}
              disabled={extrasCatalogo.length === 0}
              onClick={() => setExtras((x) => [...x, { billingItemId: extrasCatalogo[0]?.id ?? "", quantity: "1", unitPrice: "", description: "" }])}
            >
              Añadir concepto
            </button>
          </div>
          {extras.length === 0 && <p className="text-[12px] text-slate-500">Ninguno: sólo alquiler y fianza.</p>}
          {extras.map((e, i) => {
            const item = catalogo.find((c) => c.id === e.billingItemId);
            const cambiar = (k: keyof Extra, v: string) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
            return (
              <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
                <SelectField label="Concepto" value={e.billingItemId} onChange={(v) => cambiar("billingItemId", v)}>
                  {extrasCatalogo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {etqConcepto(c.itemType)} · IVA {pct(c.taxRate)}
                      {c.isRecurring ? " · mensual" : ""}
                    </option>
                  ))}
                </SelectField>
                <TextField label="Cantidad" value={e.quantity} onChange={(v) => cambiar("quantity", v)} />
                <TextField label="Precio base (€)" value={e.unitPrice} onChange={(v) => cambiar("unitPrice", v)} placeholder={item ? String(item.defaultPrice) : ""} />
                <TextField label="Descripción" value={e.description} onChange={(v) => cambiar("description", v)} placeholder={item?.name ?? ""} />
                <button className={btnMini} onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>
                  Quitar
                </button>
              </div>
            );
          })}
        </div>

        <TextAreaField label="Notas internas (no salen en el contrato ni en el portal)" value={f.notes} onChange={(v) => set("notes", v)} rows={2} />
      </div>
    </Modal>
  );
}
