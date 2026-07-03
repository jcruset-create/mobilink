import type { EmpresaInput, DelegacionInput } from "../types";
import { TextField, inputCls, Field } from "./ui";

export function EmpresaFormFields({ draft, set }: { draft: EmpresaInput; set: (p: Partial<EmpresaInput>) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <TextField label="Nombre *" value={draft.nombre ?? ""} onChange={(v) => set({ nombre: v })} />
      <TextField label="Número de cliente" value={draft.codigo_cliente ?? ""} onChange={(v) => set({ codigo_cliente: v })} />
      <TextField label="CIF" value={draft.cif ?? ""} onChange={(v) => set({ cif: v })} />
      <TextField label="Teléfono" value={draft.telefono ?? ""} onChange={(v) => set({ telefono: v })} />
      <TextField label="Email" value={draft.email ?? ""} onChange={(v) => set({ email: v })} />
      <TextField label="Dirección" value={draft.direccion ?? ""} onChange={(v) => set({ direccion: v })} />
      <TextField label="Ciudad" value={draft.ciudad ?? ""} onChange={(v) => set({ ciudad: v })} />
      <TextField label="Provincia" value={draft.provincia ?? ""} onChange={(v) => set({ provincia: v })} />
      <TextField label="Código postal" value={draft.codigo_postal ?? ""} onChange={(v) => set({ codigo_postal: v })} />
      <TextField label="País" value={draft.pais ?? ""} onChange={(v) => set({ pais: v })} />
      <Field label="Estado">
        <select className={inputCls} value={draft.activo ? "1" : "0"} onChange={(e) => set({ activo: e.target.value === "1" })}>
          <option value="1">Activa</option>
          <option value="0">Inactiva</option>
        </select>
      </Field>
    </div>
  );
}

export function DelegacionFormFields({ draft, set }: { draft: DelegacionInput; set: (p: Partial<DelegacionInput>) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <TextField label="Nombre *" value={draft.nombre ?? ""} onChange={(v) => set({ nombre: v })} />
      <TextField label="Responsable" value={draft.responsable ?? ""} onChange={(v) => set({ responsable: v })} />
      <TextField label="Teléfono" value={draft.telefono ?? ""} onChange={(v) => set({ telefono: v })} />
      <TextField label="Email" value={draft.email ?? ""} onChange={(v) => set({ email: v })} />
      <TextField label="Dirección" value={draft.direccion ?? ""} onChange={(v) => set({ direccion: v })} />
      <TextField label="Ciudad" value={draft.ciudad ?? ""} onChange={(v) => set({ ciudad: v })} />
      <TextField label="Provincia" value={draft.provincia ?? ""} onChange={(v) => set({ provincia: v })} />
      <TextField label="Código postal" value={draft.codigo_postal ?? ""} onChange={(v) => set({ codigo_postal: v })} />
      <TextField label="País" value={draft.pais ?? ""} onChange={(v) => set({ pais: v })} />
      <Field label="Estado">
        <select className={inputCls} value={draft.activo ? "1" : "0"} onChange={(e) => set({ activo: e.target.value === "1" })}>
          <option value="1">Activa</option>
          <option value="0">Inactiva</option>
        </select>
      </Field>
    </div>
  );
}

export const EMPRESA_VACIA: EmpresaInput = {
  nombre: "", cif: "", codigo_cliente: "", telefono: "", email: "", direccion: "",
  ciudad: "", provincia: "", codigo_postal: "", pais: "", activo: true,
};

export function delegacionVacia(empresa_id: string): DelegacionInput {
  return {
    empresa_id, nombre: "", direccion: "", ciudad: "", provincia: "",
    codigo_postal: "", pais: "", responsable: "", telefono: "", email: "", activo: true,
  };
}
