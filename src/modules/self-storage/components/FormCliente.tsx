/**
 * Alta y edición de un cliente de Self Storage. El NIF/NIE/CIF y el teléfono
 * los valida y normaliza el servidor; aquí sólo se recogen.
 */

import { useState } from "react";
import * as api from "../services/api";
import type { Cliente, CustomerType } from "../types";
import { ErrorBox, Modal, SelectField, TextAreaField, TextField, btnPrimary, btnSecondary } from "./ui";

type Form = {
  customerType: CustomerType;
  firstName: string;
  lastName: string;
  companyName: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  notes: string;
};

export default function FormCliente({ cliente, onCerrar, onHecho }: { cliente: Cliente | null; onCerrar: () => void; onHecho: (c: Cliente) => void }) {
  const [f, setF] = useState<Form>({
    customerType: cliente?.customerType ?? "individual",
    firstName: cliente?.firstName ?? "",
    lastName: cliente?.lastName ?? "",
    companyName: cliente?.companyName ?? "",
    taxId: cliente?.taxId ?? "",
    phone: cliente?.phone ?? "",
    email: cliente?.email ?? "",
    address: cliente?.address ?? "",
    postalCode: cliente?.postalCode ?? "",
    city: cliente?.city ?? "",
    province: cliente?.province ?? "",
    country: cliente?.country ?? "ES",
    notes: cliente?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const empresa = f.customerType === "company";

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const datos = { ...f };
      const r = cliente ? await api.editarCliente(cliente.id, datos) : await api.crearCliente(datos);
      onHecho(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      wide
      title={cliente ? `Cliente ${cliente.displayName}` : "Nuevo cliente de Self Storage"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>Cancelar</button>
          <button className={btnPrimary} disabled={enviando} onClick={guardar}>Guardar</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="Tipo de cliente" value={f.customerType} onChange={(v) => set("customerType", v)}>
          <option value="individual">Particular</option>
          <option value="company">Empresa</option>
        </SelectField>
        <TextField label={empresa ? "CIF / NIF" : "DNI / NIE"} value={f.taxId} onChange={(v) => set("taxId", v)} />
        {empresa && <TextField label="Razón social" value={f.companyName} onChange={(v) => set("companyName", v)} />}
        <TextField label={empresa ? "Nombre de contacto (opcional)" : "Nombre"} value={f.firstName} onChange={(v) => set("firstName", v)} />
        <TextField label={empresa ? "Apellidos de contacto (opcional)" : "Apellidos"} value={f.lastName} onChange={(v) => set("lastName", v)} />
        <TextField label="Teléfono" value={f.phone} onChange={(v) => set("phone", v)} placeholder="600 000 000" />
        <TextField label="Email" value={f.email} onChange={(v) => set("email", v)} type="email" />
        <TextField label="Dirección" value={f.address} onChange={(v) => set("address", v)} />
        <TextField label="Código postal" value={f.postalCode} onChange={(v) => set("postalCode", v)} />
        <TextField label="Población" value={f.city} onChange={(v) => set("city", v)} />
        <TextField label="Provincia" value={f.province} onChange={(v) => set("province", v)} />
        <TextField label="País (ISO, p. ej. ES)" value={f.country} onChange={(v) => set("country", v.toUpperCase().slice(0, 2))} />
      </div>
      <div className="mt-3">
        <TextAreaField label="Notas internas" value={f.notes} onChange={(v) => set("notes", v)} />
      </div>
    </Modal>
  );
}
