/**
 * Connect Pro — Nueva asistencia: formulario por bloques (expediente,
 * solicitante, ubicación, vehículo, incidencia) con borradores y validación.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, Input, Select, Button, ErrorBanner } from "../components/ui";
import type { ServiceType, VehicleType } from "../types";
import type { Client } from "./Clientes";

type Form = {
  expedientNumber: string; externalReference: string; clientName: string;
  priority: string; slaMinutes: string; serviceType: string;
  requesterName: string; requesterPhone: string; requesterEmail: string; requesterLanguage: string; requesterNotes: string;
  customerName: string; customerPhone: string;
  address: string; lat: string; lng: string; road: string; km: string; direction: string; placeRef: string;
  vehicleType: string; make: string; model: string; plate: string; vin: string; fuel: string;
  electric: boolean; trailer: boolean; weight: string; cargo: string; dangerous: boolean;
  description: string; diagnosis: string; notes: string;
};

const EMPTY: Form = {
  expedientNumber: "", externalReference: "", clientName: "", priority: "normal", slaMinutes: "", serviceType: "other",
  requesterName: "", requesterPhone: "", requesterEmail: "", requesterLanguage: "es", requesterNotes: "",
  customerName: "", customerPhone: "",
  address: "", lat: "", lng: "", road: "", km: "", direction: "", placeRef: "",
  vehicleType: "car", make: "", model: "", plate: "", vin: "", fuel: "",
  electric: false, trailer: false, weight: "", cargo: "", dangerous: false,
  description: "", diagnosis: "", notes: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-cyan-300">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </Card>
  );
}

function Field({ label, children, w = "" }: { label: string; children: React.ReactNode; w?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${w}`}>
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export default function NuevaAsistencia() {
  const navigate = useNavigate();
  const [f, setF] = useState<Form>(EMPTY);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    boFetch<{ service_types: ServiceType[]; vehicle_types?: VehicleType[] }>("/catalogs")
      .then((r) => {
        setTypes(r.service_types.filter((t) => t.active));
        setVehicleTypes((r.vehicle_types ?? []).filter((t) => t.active));
      })
      .catch(() => {});
    boFetch<{ data: Client[] }>("/clients").then((r) => setClients(r.data.filter((c) => c.active))).catch(() => {});
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value } as Form);

  const buildBody = (draft: boolean) => ({
    draft,
    expedientNumber: f.expedientNumber || null,
    externalReference: f.externalReference || null,
    clientId: clientId ? Number(clientId) : null,
    clientName: f.clientName || null,
    priority: f.priority,
    slaMinutes: f.slaMinutes ? Number(f.slaMinutes) : null,
    serviceType: f.serviceType,
    customer: { name: f.customerName, phone: f.customerPhone },
    requester: {
      name: f.requesterName || null, phone: f.requesterPhone || null, email: f.requesterEmail || null,
      language: f.requesterLanguage, notes: f.requesterNotes || null,
    },
    address: f.address,
    location: f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : undefined,
    locationDetails: { road: f.road || null, km: f.km || null, direction: f.direction || null, placeRef: f.placeRef || null },
    vehicle: {
      type: f.vehicleType, make: f.make || null, model: f.model || null, plate: f.plate || null, vin: f.vin || null,
      fuel: f.electric ? "electric" : f.fuel || null, electric: f.electric, trailer: f.trailer,
      weight: f.weight || null, cargo: f.cargo || null, dangerousGoods: f.dangerous,
    },
    description: [f.description, f.diagnosis ? `Diagnóstico inicial: ${f.diagnosis}` : "", f.notes ? `Obs.: ${f.notes}` : ""]
      .filter(Boolean).join("\n"),
  });

  const crear = async (draft: boolean) => {
    if (!draft) {
      if (!f.customerName && !f.customerPhone) { setError("Indica nombre o teléfono del cliente."); return; }
      if (!f.address && !(f.lat && f.lng)) { setError("Indica dirección o coordenadas."); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const row = await boFetch<{ id: number }>("/assistances", { method: "POST", body: buildBody(draft) });
      navigate(`/connect/asistencias/${row.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl">
      <PageTitle title="Nueva asistencia" subtitle="Crea una asistencia manualmente. Puedes guardarla como borrador si faltan datos." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-col gap-4">
        <Section title="Expediente">
          <Field label="Nº expediente"><Input value={f.expedientNumber} onChange={set("expedientNumber")} className="w-40" /></Field>
          <Field label="Referencia externa"><Input value={f.externalReference} onChange={set("externalReference")} className="w-40" /></Field>
          <Field label="Cliente de cartera">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Sin cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.defaultSlaMinutes ? ` (SLA ${c.defaultSlaMinutes} min)` : ""}</option>)}
            </Select>
          </Field>
          {!clientId && (
            <Field label="Cliente (texto libre)"><Input value={f.clientName} onChange={set("clientName")} className="w-48" placeholder="Aseguradora / flota" /></Field>
          )}
          <Field label="Tipo de asistencia">
            <Select value={f.serviceType} onChange={set("serviceType")}>
              {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              {types.length === 0 && <option value="other">Otros</option>}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={f.priority} onChange={set("priority")}>
              <option value="normal">Normal</option>
              <option value="urgente">Urgente</option>
            </Select>
          </Field>
          <Field label="SLA (min llegada)"><Input value={f.slaMinutes} onChange={set("slaMinutes")} className="w-28" placeholder="p. ej. 60" /></Field>
        </Section>

        <Section title="Cliente final y solicitante">
          <Field label="Nombre del cliente *"><Input value={f.customerName} onChange={set("customerName")} className="w-56" /></Field>
          <Field label="Teléfono del cliente *"><Input value={f.customerPhone} onChange={set("customerPhone")} className="w-40" /></Field>
          <Field label="Solicitante (si difiere)"><Input value={f.requesterName} onChange={set("requesterName")} className="w-48" /></Field>
          <Field label="Tel. solicitante"><Input value={f.requesterPhone} onChange={set("requesterPhone")} className="w-36" /></Field>
          <Field label="Email"><Input value={f.requesterEmail} onChange={set("requesterEmail")} className="w-56" /></Field>
          <Field label="Idioma">
            <Select value={f.requesterLanguage} onChange={set("requesterLanguage")}>
              <option value="es">Español</option><option value="ca">Català</option><option value="en">English</option><option value="fr">Français</option>
            </Select>
          </Field>
          <Field label="Observaciones" w="w-full"><Input value={f.requesterNotes} onChange={set("requesterNotes")} className="w-full" /></Field>
        </Section>

        <Section title="Ubicación">
          <Field label="Dirección *" w="w-full"><Input value={f.address} onChange={set("address")} className="w-full" placeholder="Dirección o punto de referencia" /></Field>
          <Field label="Latitud"><Input value={f.lat} onChange={set("lat")} className="w-32" placeholder="41.1189" /></Field>
          <Field label="Longitud"><Input value={f.lng} onChange={set("lng")} className="w-32" placeholder="1.2445" /></Field>
          <Field label="Carretera"><Input value={f.road} onChange={set("road")} className="w-28" placeholder="AP-7" /></Field>
          <Field label="Km"><Input value={f.km} onChange={set("km")} className="w-20" /></Field>
          <Field label="Sentido"><Input value={f.direction} onChange={set("direction")} className="w-36" placeholder="Barcelona" /></Field>
          <Field label="Referencia del lugar"><Input value={f.placeRef} onChange={set("placeRef")} className="w-48" placeholder="Área de servicio…" /></Field>
          {f.lat && f.lng && (
            <a
              href={`https://www.google.com/maps?q=${f.lat},${f.lng}`}
              target="_blank" rel="noreferrer"
              className="self-end rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-cyan-300 hover:bg-slate-700"
            >
              Ver en Maps ↗
            </a>
          )}
        </Section>

        <Section title="Vehículo o activo">
          <Field label="Tipo">
            <Select value={f.vehicleType} onChange={set("vehicleType")}>
              {vehicleTypes.length === 0 && <option value="car">Turismo</option>}
              {vehicleTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Marca"><Input value={f.make} onChange={set("make")} className="w-32" /></Field>
          <Field label="Modelo"><Input value={f.model} onChange={set("model")} className="w-32" /></Field>
          <Field label="Matrícula"><Input value={f.plate} onChange={set("plate")} className="w-32" /></Field>
          <Field label="VIN"><Input value={f.vin} onChange={set("vin")} className="w-48" /></Field>
          <Field label="Combustible"><Input value={f.fuel} onChange={set("fuel")} className="w-28" disabled={f.electric} placeholder={f.electric ? "eléctrico" : "diésel…"} /></Field>
          <Field label="Peso (t)"><Input value={f.weight} onChange={set("weight")} className="w-24" /></Field>
          <Field label="Carga"><Input value={f.cargo} onChange={set("cargo")} className="w-40" /></Field>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-1.5 text-[13px] text-slate-300"><input type="checkbox" checked={f.electric} onChange={set("electric")} /> Eléctrico</label>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-300"><input type="checkbox" checked={f.trailer} onChange={set("trailer")} /> Remolque</label>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-300"><input type="checkbox" checked={f.dangerous} onChange={set("dangerous")} /> Mercancía peligrosa</label>
          </div>
        </Section>

        <Section title="Incidencia">
          <Field label="Descripción *" w="w-full">
            <textarea
              value={f.description} onChange={set("description")} rows={3}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              placeholder="Qué ha ocurrido y qué servicio se solicita"
            />
          </Field>
          <Field label="Diagnóstico inicial" w="w-full"><Input value={f.diagnosis} onChange={set("diagnosis")} className="w-full" /></Field>
          <Field label="Observaciones internas" w="w-full"><Input value={f.notes} onChange={set("notes")} className="w-full" /></Field>
        </Section>

        <div className="flex gap-2 pb-8">
          <Button onClick={() => crear(false)} disabled={busy}>Crear asistencia</Button>
          <Button variant="ghost" onClick={() => crear(true)} disabled={busy}>Guardar borrador</Button>
        </div>
      </div>
    </div>
  );
}
