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

      {/* Geo-zona de la base (Webfleet · "vehículos en base") */}
      <div className="sm:col-span-2 mt-1 rounded-lg border border-slate-700 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Base (Webfleet)</div>
        <div className="mb-2 text-[11px] text-slate-500">
          Posición de esta base. Los vehículos asignados a esta delegación se marcan «en base» cuando su GPS está dentro del radio. Copia latitud/longitud de Google Maps.
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Latitud"><input className={inputCls} type="number" value={draft.webfleet_lat ?? ""} onChange={(e) => set({ webfleet_lat: e.target.value === "" ? null : Number(e.target.value) })} placeholder="41.1549" /></Field>
          <Field label="Longitud"><input className={inputCls} type="number" value={draft.webfleet_lng ?? ""} onChange={(e) => set({ webfleet_lng: e.target.value === "" ? null : Number(e.target.value) })} placeholder="1.1067" /></Field>
          <Field label="Radio (m)"><input className={inputCls} type="number" value={draft.webfleet_radio_m ?? 300} onChange={(e) => set({ webfleet_radio_m: Number(e.target.value) || 0 })} /></Field>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
          <input type="checkbox" checked={draft.webfleet_genera_avisos ?? true} onChange={(e) => set({ webfleet_genera_avisos: e.target.checked })} />
          Genera avisos al entrar un vehículo con revisión pendiente
        </label>
      </div>
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
