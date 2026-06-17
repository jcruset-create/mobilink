import { useEffect, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import type { RoadsideAssistance } from "../modules/roadsideAssistanceTypes";

/* ── Types ─────────────────────────────────────────────── */

export type BackofficeData = {
  // Contactos
  solicitanteNombre?: string;
  solicitanteTelefono?: string;
  solicitanteWhatsapp?: string;
  solicitanteEmail?: string;
  conductorTelefono?: string;
  responsableNombre?: string;
  responsableTelefono?: string;
  responsableCargo?: string;
  autorizadorNombre?: string;
  autorizadorTelefono?: string;
  autorizadorCargo?: string;
  // Empresas
  empresaSolicitanteNombre?: string;
  empresaSolicitanteTelefono?: string;
  empresaSolicitanteEmail?: string;
  empresaServicioNombre?: string;
  empresaServicioCif?: string;
  empresaServicioTelefono?: string;
  empresaFacturacionNombre?: string;
  empresaFacturacionCif?: string;
  empresaFacturacionEmail?: string;
  expedienteExterno?: string;
  referenciaCliente?: string;
  referenciaAutorizacion?: string;
  // Operativa
  tiposAsistencia?: string[];
  tipoVehiculo?: string;
  estadoVehiculo?: string;
  ubicacionIncidencia?: string;
  // Vehículo
  marca?: string;
  modelo?: string;
  color?: string;
  vin?: string;
  kilometraje?: number | string;
  medidaNeumatico?: string;
  ejeAfectado?: string;
  posicionRueda?: string;
  vehiculoCargado?: boolean | null;
  mercancia?: string;
  adr?: boolean | null;
  // Facturación
  facturable?: boolean;
  pendienteAutorizacion?: boolean;
  garantia?: boolean;
  interna?: boolean;
  importeAcordado?: number | string;
  observacionesFacturacion?: string;
};

type Tab = "contactos" | "empresas" | "operativa" | "vehiculo" | "facturacion";

const TABS: { id: Tab; label: string }[] = [
  { id: "contactos", label: "Contactos" },
  { id: "empresas", label: "Empresas" },
  { id: "operativa", label: "Operativa" },
  { id: "vehiculo", label: "Vehículo" },
  { id: "facturacion", label: "Facturación" },
];

const TIPOS_ASISTENCIA = [
  "Neumáticos", "Mecánica", "Batería", "Arranque", "Combustible",
  "Apertura vehículo", "Remolcado", "Accidente", "Rescate", "Otros",
];

const TIPOS_VEHICULO = [
  "Turismo", "Furgoneta", "Camión rígido", "Tractora", "Remolque",
  "Semirremolque", "Autobús", "Motocicleta", "Maquinaria", "Vehículo agrícola",
];

const ESTADOS_VEHICULO = [
  "Puede circular", "No puede circular", "Bloqueado", "Accidentado", "Volcado",
];

const UBICACIONES = [
  "Autopista", "Autovía", "Carretera nacional", "Ciudad", "Polígono",
  "Taller", "Parking", "Puerto", "Centro logístico",
];

const EJES = ["Dirección", "Tracción", "Remolque"];
const POSICIONES = ["Interior", "Exterior"];

/* ── Helpers ────────────────────────────────────────────── */

function Field({
  label, children, half,
}: { label: string; children: React.ReactNode; half?: boolean }) {
  return (
    <div className={half ? "col-span-1" : "col-span-2 sm:col-span-1"}>
      <label className="mb-1 block text-xs font-bold text-slate-500">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300";

const selectCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 mt-2 border-b border-slate-100 pb-1 text-xs font-black uppercase tracking-wider text-slate-400">
      {children}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function RoadsideBackofficeModal({
  assistance,
  onClose,
}: {
  assistance: RoadsideAssistance;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("contactos");
  const [data, setData] = useState<BackofficeData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `${API_BASE}/api/roadside-assistances/${assistance.id}/backoffice`,
          { headers: getAdminHeaders() as HeadersInit }
        );
        if (res.ok) {
          const raw = await res.json();
          if (raw) {
            setData({
              ...raw,
              tiposAsistencia: raw.tiposAsistencia
                ? JSON.parse(raw.tiposAsistencia)
                : [],
              kilometraje: raw.kilometraje ?? "",
              importeAcordado: raw.importeAcordado ?? "",
            });
          }
        }
      } catch (e) {
        console.error("Error loading backoffice:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [assistance.id]);

  function set<K extends keyof BackofficeData>(key: K, value: BackofficeData[K]) {
    setSaved(false);
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function toggleTipoAsistencia(tipo: string) {
    setSaved(false);
    setData((prev) => {
      const current = prev.tiposAsistencia ?? [];
      return {
        ...prev,
        tiposAsistencia: current.includes(tipo)
          ? current.filter((t) => t !== tipo)
          : [...current, tipo],
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(
        `${API_BASE}/api/roadside-assistances/${assistance.id}/backoffice`,
        {
          method: "PUT",
          headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
          body: JSON.stringify(data),
        }
      );
      setSaved(true);
    } catch (e) {
      console.error("Error saving backoffice:", e);
      alert("Error guardando los datos.");
    } finally {
      setSaving(false);
    }
  }

  const t = (key: keyof BackofficeData) => (data[key] as string) ?? "";
  const b = (key: keyof BackofficeData) => Boolean(data[key]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-10">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-bold text-slate-400">
              BACK OFFICE · #{assistance.id}
            </div>
            <h2 className="text-lg font-black text-slate-900">
              {assistance.plate || "Sin matrícula"} · {assistance.customerName || "Sin cliente"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saved ? "Guardado ✓" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 hover:bg-slate-100"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-t-lg px-4 py-2 text-xs font-bold transition-colors ${
                tab === t.id
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "text-slate-400 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* ── CONTACTOS ── */}
              {tab === "contactos" && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <SectionTitle>Solicitante</SectionTitle>
                  <Field label="Nombre solicitante">
                    <input className={inputCls} value={t("solicitanteNombre")} onChange={(e) => set("solicitanteNombre", e.target.value)} placeholder="Nombre" />
                  </Field>
                  <Field label="Teléfono solicitante">
                    <input className={inputCls} type="tel" value={t("solicitanteTelefono")} onChange={(e) => set("solicitanteTelefono", e.target.value)} placeholder="6XX XXX XXX" />
                  </Field>
                  <Field label="WhatsApp solicitante">
                    <input className={inputCls} type="tel" value={t("solicitanteWhatsapp")} onChange={(e) => set("solicitanteWhatsapp", e.target.value)} placeholder="+34 6XX XXX XXX" />
                  </Field>
                  <Field label="Email solicitante">
                    <input className={inputCls} type="email" value={t("solicitanteEmail")} onChange={(e) => set("solicitanteEmail", e.target.value)} placeholder="email@ejemplo.com" />
                  </Field>

                  <SectionTitle>Conductor</SectionTitle>
                  <Field label="Nombre conductor">
                    <input className={inputCls} value={assistance.conductorNombre ?? ""} disabled placeholder="(del formulario principal)" />
                  </Field>
                  <Field label="Teléfono conductor">
                    <input className={inputCls} type="tel" value={t("conductorTelefono")} onChange={(e) => set("conductorTelefono", e.target.value)} placeholder="6XX XXX XXX" />
                  </Field>

                  <SectionTitle>Responsable</SectionTitle>
                  <Field label="Nombre responsable">
                    <input className={inputCls} value={t("responsableNombre")} onChange={(e) => set("responsableNombre", e.target.value)} placeholder="Nombre" />
                  </Field>
                  <Field label="Teléfono responsable">
                    <input className={inputCls} type="tel" value={t("responsableTelefono")} onChange={(e) => set("responsableTelefono", e.target.value)} placeholder="6XX XXX XXX" />
                  </Field>
                  <Field label="Cargo" half>
                    <input className={inputCls} value={t("responsableCargo")} onChange={(e) => set("responsableCargo", e.target.value)} placeholder="Cargo" />
                  </Field>

                  <SectionTitle>Autorizador</SectionTitle>
                  <Field label="Nombre autorizador">
                    <input className={inputCls} value={t("autorizadorNombre")} onChange={(e) => set("autorizadorNombre", e.target.value)} placeholder="Nombre" />
                  </Field>
                  <Field label="Teléfono autorizador">
                    <input className={inputCls} type="tel" value={t("autorizadorTelefono")} onChange={(e) => set("autorizadorTelefono", e.target.value)} placeholder="6XX XXX XXX" />
                  </Field>
                  <Field label="Cargo autorizador" half>
                    <input className={inputCls} value={t("autorizadorCargo")} onChange={(e) => set("autorizadorCargo", e.target.value)} placeholder="Cargo" />
                  </Field>
                </div>
              )}

              {/* ── EMPRESAS ── */}
              {tab === "empresas" && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <SectionTitle>Empresa solicitante</SectionTitle>
                  <Field label="Nombre empresa solicitante">
                    <input className={inputCls} value={t("empresaSolicitanteNombre")} onChange={(e) => set("empresaSolicitanteNombre", e.target.value)} placeholder="Ej: Europ Assistance, RACE..." />
                  </Field>
                  <Field label="Teléfono">
                    <input className={inputCls} type="tel" value={t("empresaSolicitanteTelefono")} onChange={(e) => set("empresaSolicitanteTelefono", e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <input className={inputCls} type="email" value={t("empresaSolicitanteEmail")} onChange={(e) => set("empresaSolicitanteEmail", e.target.value)} />
                  </Field>

                  <SectionTitle>Empresa destinataria del servicio</SectionTitle>
                  <Field label="Nombre empresa servicio">
                    <input className={inputCls} value={t("empresaServicioNombre")} onChange={(e) => set("empresaServicioNombre", e.target.value)} placeholder="Propietaria o receptora" />
                  </Field>
                  <Field label="CIF/NIF">
                    <input className={inputCls} value={t("empresaServicioCif")} onChange={(e) => set("empresaServicioCif", e.target.value)} placeholder="B12345678" />
                  </Field>
                  <Field label="Teléfono">
                    <input className={inputCls} type="tel" value={t("empresaServicioTelefono")} onChange={(e) => set("empresaServicioTelefono", e.target.value)} />
                  </Field>

                  <SectionTitle>Empresa facturación</SectionTitle>
                  <Field label="Nombre empresa facturación">
                    <input className={inputCls} value={t("empresaFacturacionNombre")} onChange={(e) => set("empresaFacturacionNombre", e.target.value)} placeholder="A quien se emite la factura" />
                  </Field>
                  <Field label="CIF/NIF">
                    <input className={inputCls} value={t("empresaFacturacionCif")} onChange={(e) => set("empresaFacturacionCif", e.target.value)} placeholder="B12345678" />
                  </Field>
                  <Field label="Email facturación">
                    <input className={inputCls} type="email" value={t("empresaFacturacionEmail")} onChange={(e) => set("empresaFacturacionEmail", e.target.value)} />
                  </Field>

                  <SectionTitle>Referencias externas</SectionTitle>
                  <Field label="Número expediente externo">
                    <input className={inputCls} value={t("expedienteExterno")} onChange={(e) => set("expedienteExterno", e.target.value)} placeholder="EA-458921, RACE-784512..." />
                  </Field>
                  <Field label="Referencia cliente">
                    <input className={inputCls} value={t("referenciaCliente")} onChange={(e) => set("referenciaCliente", e.target.value)} />
                  </Field>
                  <Field label="Referencia autorización">
                    <input className={inputCls} value={t("referenciaAutorizacion")} onChange={(e) => set("referenciaAutorizacion", e.target.value)} />
                  </Field>
                </div>
              )}

              {/* ── OPERATIVA ── */}
              {tab === "operativa" && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <SectionTitle>Tipo de asistencia</SectionTitle>
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {TIPOS_ASISTENCIA.map((tipo) => {
                      const selected = (data.tiposAsistencia ?? []).includes(tipo);
                      return (
                        <button
                          key={tipo}
                          type="button"
                          onClick={() => toggleTipoAsistencia(tipo)}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                            selected
                              ? "bg-slate-900 text-white"
                              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {tipo}
                        </button>
                      );
                    })}
                  </div>

                  <SectionTitle>Tipo de vehículo</SectionTitle>
                  <Field label="Tipo de vehículo">
                    <select className={selectCls} value={t("tipoVehiculo")} onChange={(e) => set("tipoVehiculo", e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {TIPOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>

                  <SectionTitle>Estado del vehículo</SectionTitle>
                  <Field label="Estado del vehículo">
                    <select className={selectCls} value={t("estadoVehiculo")} onChange={(e) => set("estadoVehiculo", e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {ESTADOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>

                  <SectionTitle>Ubicación de la incidencia</SectionTitle>
                  <Field label="Tipo de vía / ubicación">
                    <select className={selectCls} value={t("ubicacionIncidencia")} onChange={(e) => set("ubicacionIncidencia", e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {UBICACIONES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                </div>
              )}

              {/* ── VEHÍCULO ── */}
              {tab === "vehiculo" && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <SectionTitle>Datos del vehículo</SectionTitle>
                  <Field label="Marca">
                    <input className={inputCls} value={t("marca")} onChange={(e) => set("marca", e.target.value)} placeholder="Renault, Volvo..." />
                  </Field>
                  <Field label="Modelo">
                    <input className={inputCls} value={t("modelo")} onChange={(e) => set("modelo", e.target.value)} placeholder="Master, FH..." />
                  </Field>
                  <Field label="Color">
                    <input className={inputCls} value={t("color")} onChange={(e) => set("color", e.target.value)} placeholder="Blanco, gris..." />
                  </Field>
                  <Field label="Nº bastidor (VIN)">
                    <input className={inputCls} value={t("vin")} onChange={(e) => set("vin", e.target.value)} placeholder="VF1..." />
                  </Field>
                  <Field label="Kilometraje">
                    <input className={inputCls} type="number" min={0} value={data.kilometraje ?? ""} onChange={(e) => set("kilometraje", e.target.value)} placeholder="km" />
                  </Field>

                  <SectionTitle>Información neumáticos</SectionTitle>
                  <Field label="Medida neumático">
                    <input className={inputCls} value={t("medidaNeumatico")} onChange={(e) => set("medidaNeumatico", e.target.value)} placeholder="315/70R22.5..." />
                  </Field>
                  <Field label="Eje afectado">
                    <select className={selectCls} value={t("ejeAfectado")} onChange={(e) => set("ejeAfectado", e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {EJES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Posición rueda">
                    <select className={selectCls} value={t("posicionRueda")} onChange={(e) => set("posicionRueda", e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {POSICIONES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>

                  <SectionTitle>Información carga</SectionTitle>
                  <div className="col-span-2 flex gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="carga"
                        checked={data.vehiculoCargado === false}
                        onChange={() => set("vehiculoCargado", false)}
                      />
                      <span className="text-sm font-bold">Vacío</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="carga"
                        checked={data.vehiculoCargado === true}
                        onChange={() => set("vehiculoCargado", true)}
                      />
                      <span className="text-sm font-bold">Cargado</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="carga"
                        checked={data.vehiculoCargado == null}
                        onChange={() => set("vehiculoCargado", null)}
                      />
                      <span className="text-sm text-slate-400">No especificado</span>
                    </label>
                  </div>
                  <Field label="Mercancía">
                    <input className={inputCls} value={t("mercancia")} onChange={(e) => set("mercancia", e.target.value)} placeholder="Descripción de la carga" />
                  </Field>
                  <div className="col-span-2">
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={b("adr")}
                        onChange={(e) => set("adr", e.target.checked)}
                      />
                      <span className="text-sm font-bold text-amber-800">Mercancía peligrosa (ADR)</span>
                    </label>
                  </div>
                </div>
              )}

              {/* ── FACTURACIÓN ── */}
              {tab === "facturacion" && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <SectionTitle>Estado de facturación</SectionTitle>
                  <div className="col-span-2 flex flex-wrap gap-3">
                    {(
                      [
                        { key: "facturable", label: "Facturable", color: "emerald" },
                        { key: "pendienteAutorizacion", label: "Pendiente autorización", color: "amber" },
                        { key: "garantia", label: "Garantía", color: "blue" },
                        { key: "interna", label: "Interna", color: "slate" },
                      ] as const
                    ).map(({ key, label, color }) => {
                      const colorMap: Record<string, string> = {
                        emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
                        amber: "border-amber-200 bg-amber-50 text-amber-800",
                        blue: "border-blue-200 bg-blue-50 text-blue-800",
                        slate: "border-slate-200 bg-slate-50 text-slate-800",
                      };
                      return (
                        <label
                          key={key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${colorMap[color]}`}
                        >
                          <input
                            type="checkbox"
                            checked={b(key)}
                            onChange={(e) => set(key, e.target.checked)}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>

                  <SectionTitle>Datos económicos</SectionTitle>
                  <Field label="Importe acordado (€)">
                    <input
                      className={inputCls}
                      type="number"
                      min={0}
                      step="0.01"
                      value={data.importeAcordado ?? ""}
                      onChange={(e) => set("importeAcordado", e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-bold text-slate-500">
                      Observaciones facturación
                    </label>
                    <textarea
                      className={`${inputCls} resize-none`}
                      rows={4}
                      value={t("observacionesFacturacion")}
                      onChange={(e) => set("observacionesFacturacion", e.target.value)}
                      placeholder="Notas para facturación..."
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? "Guardado ✓" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
