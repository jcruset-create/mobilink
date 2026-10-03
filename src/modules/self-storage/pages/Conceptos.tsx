/**
 * Catálogo de conceptos facturables. Cada concepto HEREDA el IVA general de la
 * empresa o tiene uno PROPIO (fianza, seguro, penalización…). El tipo efectivo
 * lo calcula el servidor; el panel no conoce ningún tipo impositivo.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import { INVOICE_ITEM_TYPES, type Concepto, type InvoiceItemType } from "../types";
import { Cabecera, CheckField, EmptyRow, ErrorBox, Modal, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, euros, msgError, pct, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

type Form = {
  code: string;
  name: string;
  itemType: InvoiceItemType;
  defaultPrice: string;
  vatPolicy: "inherit_default" | "custom";
  customTaxRate: string;
  taxExemptionReason: string;
  isRecurring: boolean;
  isRentalComponent: boolean;
  active: boolean;
  sortOrder: string;
};

const vacio: Form = {
  code: "",
  name: "",
  itemType: "other",
  defaultPrice: "0",
  vatPolicy: "inherit_default",
  customTaxRate: "",
  taxExemptionReason: "",
  isRecurring: false,
  isRentalComponent: false,
  active: true,
  sortOrder: "100",
};

export default function Conceptos() {
  const { puede, etqConcepto } = useSelfStorage();
  const [lista, setLista] = useState<Concepto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Concepto | "nuevo" | null>(null);
  const admin = puede("ss.billing.admin");

  const cargar = useCallback(async () => {
    try {
      setLista(await api.conceptos());
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Conceptos facturables" descripcion="Alquiler, fianza, seguro, candado, penalización, descuento, alta y otros, cada uno con su IVA.">
        {admin && (
          <button className={btnPrimary} onClick={() => setEditando("nuevo")}>
            Nuevo concepto
          </button>
        )}
      </Cabecera>
      <p className="text-[12px] text-slate-400">
        Los tipos de IVA de partida (fianza no sujeta, seguro exento…) son orientativos: revísalos con la asesoría. Cambiar un concepto no
        cambia contratos ni facturas ya hechos.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Código</th>
            <th className={thCls}>Nombre</th>
            <th className={thCls}>Tipo</th>
            <th className={thCls}>Precio base</th>
            <th className={thCls}>IVA</th>
            <th className={thCls}>Recurrente</th>
            <th className={thCls}>Parte de la cuota</th>
            <th className={thCls}>Activo</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={9} text="Cargando…" />}
          {lista?.map((c) => (
            <tr key={c.id} className={`border-t border-slate-700 ${c.active ? "" : "opacity-50"}`}>
              <td className={`${tdCls} font-mono`}>{c.code}</td>
              <td className={tdCls}>{c.name}</td>
              <td className={tdCls}>{etqConcepto(c.itemType)}</td>
              <td className={tdCls}>{euros(c.defaultPrice)}</td>
              <td className={tdCls}>
                {pct(c.taxRate)}
                <span className="block text-[10px] text-slate-500">{c.vatPolicy === "inherit_default" ? "IVA general" : "propio"}</span>
                {c.taxExemptionReason && <span className="block text-[10px] text-slate-500">{c.taxExemptionReason}</span>}
              </td>
              <td className={tdCls}>{c.isRecurring ? "Sí" : "No"}</td>
              <td className={tdCls}>{c.isRentalComponent ? "Sí" : "No"}</td>
              <td className={tdCls}>{c.active ? "Sí" : "No"}</td>
              <td className={`${tdCls} text-right`}>
                {admin && (
                  <button className={btnMini} onClick={() => setEditando(c)}>
                    Editar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {editando && (
        <FormConcepto
          concepto={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
          onHecho={() => {
            setEditando(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function FormConcepto({ concepto, onCerrar, onHecho }: { concepto: Concepto | null; onCerrar: () => void; onHecho: () => void }) {
  const { etqConcepto } = useSelfStorage();
  const [f, setF] = useState<Form>(() =>
    concepto
      ? {
          code: concepto.code,
          name: concepto.name,
          itemType: concepto.itemType,
          defaultPrice: String(concepto.defaultPrice),
          vatPolicy: concepto.vatPolicy,
          customTaxRate: concepto.customTaxRate == null ? "" : String(concepto.customTaxRate),
          taxExemptionReason: concepto.taxExemptionReason ?? "",
          isRecurring: concepto.isRecurring,
          isRentalComponent: concepto.isRentalComponent,
          active: concepto.active,
          sortOrder: String(concepto.sortOrder),
        }
      : vacio
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const n = (s: string) => Number(s.replace(",", "."));

  const guardar = async () => {
    try {
      const comun = {
        name: f.name,
        defaultPrice: n(f.defaultPrice),
        vatPolicy: f.vatPolicy,
        customTaxRate: f.vatPolicy === "custom" ? n(f.customTaxRate) : null,
        taxExemptionReason: f.taxExemptionReason.trim() || null,
        isRecurring: f.isRecurring,
        isRentalComponent: f.isRentalComponent,
        active: f.active,
        sortOrder: Math.round(n(f.sortOrder)),
      };
      if (concepto) await api.editarConcepto(concepto.id, comun);
      else await api.crearConcepto({ ...comun, code: f.code, itemType: f.itemType });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };

  return (
    <Modal
      title={concepto ? `Concepto ${concepto.code}` : "Nuevo concepto"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!f.name.trim() || (f.vatPolicy === "custom" && f.customTaxRate.trim() === "") || (!concepto && !f.code.trim())} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {!concepto && <TextField label="Código" value={f.code} onChange={(v) => set("code", v.toUpperCase())} />}
        {!concepto && (
          <SelectField label="Tipo" value={f.itemType} onChange={(v) => set("itemType", v as InvoiceItemType)}>
            {INVOICE_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {etqConcepto(t)}
              </option>
            ))}
          </SelectField>
        )}
        <div className="col-span-2">
          <TextField label="Nombre" value={f.name} onChange={(v) => set("name", v)} />
        </div>
        <TextField label="Precio base por defecto (€)" value={f.defaultPrice} onChange={(v) => set("defaultPrice", v)} />
        <SelectField label="IVA" value={f.vatPolicy} onChange={(v) => set("vatPolicy", v as Form["vatPolicy"])}>
          <option value="inherit_default">Hereda el IVA general</option>
          <option value="custom">IVA propio del concepto</option>
        </SelectField>
        {f.vatPolicy === "custom" ? (
          <TextField label="IVA propio (%)" value={f.customTaxRate} onChange={(v) => set("customTaxRate", v)} />
        ) : (
          <div className="self-end pb-2 text-[12px] text-slate-400">Usa el de Configuración → IVA general.</div>
        )}
        <div className="col-span-2">
          <TextField label="Motivo si no lleva IVA (exento / no sujeto)" value={f.taxExemptionReason} onChange={(v) => set("taxExemptionReason", v)} />
        </div>
        <TextField label="Orden" value={f.sortOrder} onChange={(v) => set("sortOrder", v)} />
        <div />
        <CheckField label="Recurrente (cada mes)" checked={f.isRecurring} onChange={(v) => set("isRecurring", v)} />
        <CheckField label="Forma parte de la cuota" checked={f.isRentalComponent} onChange={(v) => set("isRentalComponent", v)} />
        <CheckField label="Activo" checked={f.active} onChange={(v) => set("active", v)} />
        {error && (
          <div className="col-span-2">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}
      </div>
    </Modal>
  );
}
