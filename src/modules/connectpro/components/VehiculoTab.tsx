/**
 * Connect Pro — ficha del vehículo de una asistencia.
 *
 * Antes esta pestaña solo pintaba los campos que tuvieran valor, así que una
 * asistencia abierta por teléfono se quedaba en "Tipo: car" y no había forma de
 * saber si faltaba el dato o si nadie lo había pedido. Ahora se ven **todos**
 * los campos, los vacíos marcados, y se pueden rellenar desde aquí: la
 * matrícula y el modelo casi nunca se saben al abrir el servicio.
 */

import { useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Button, Input, Select, ErrorBanner } from "./ui";

export type VehicleData = {
  type?: string | null; make?: string | null; model?: string | null;
  plate?: string | null; vin?: string | null; color?: string | null;
  fuel?: string | null; electric?: boolean; trailer?: boolean;
  weight?: string | null; cargo?: string | null; dangerousGoods?: boolean;
};

type VehicleType = { code: string; name: string; active: boolean };

const COMBUSTIBLES = [
  ["", "Sin indicar"], ["gasolina", "Gasolina"], ["diesel", "Diésel"],
  ["electric", "Eléctrico"], ["hibrido", "Híbrido"], ["glp", "GLP"], ["gnc", "GNC"],
] as const;

/** Campos que hacen falta para identificar el vehículo en carretera. */
const IMPRESCINDIBLES: (keyof VehicleData)[] = ["plate", "make", "model"];

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  const vacio = value == null || value === "" || value === false;
  return (
    <div className="flex gap-2 border-b border-slate-700/40 py-1.5 text-[13px]">
      <span className="w-44 shrink-0 text-slate-500">{label}</span>
      <span className={vacio ? "text-slate-600" : "text-slate-200"}>
        {vacio ? "—" : value === true ? "Sí" : value}
      </span>
    </div>
  );
}

export default function VehiculoTab({
  assistanceId, vehicle, editable, onSaved,
}: {
  assistanceId: number;
  vehicle: VehicleData;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState<VehicleData>(vehicle);
  const [tipos, setTipos] = useState<VehicleType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setF(vehicle); }, [vehicle]);

  useEffect(() => {
    if (!editando || tipos.length) return;
    boFetch<{ vehicle_types?: VehicleType[] }>("/catalogs")
      .then((r) => setTipos((r.vehicle_types ?? []).filter((t) => t.active)))
      .catch(() => {});
  }, [editando, tipos.length]);

  const faltan = IMPRESCINDIBLES.filter((k) => !f[k]);

  const guardar = async () => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/assistances/${assistanceId}/vehicle`, { method: "PATCH", body: f });
      setEditando(false);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof VehicleData) => (e: any) =>
    setF((prev) => ({
      ...prev,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  const tipoLabel = tipos.find((t) => t.code === vehicle.type)?.name ?? vehicle.type;

  if (!editando) {
    return (
      <div>
        {editable && faltan.length > 0 && (
          <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
            Ficha incompleta: falta {faltan.map((k) => (
              { plate: "la matrícula", make: "la marca", model: "el modelo" } as Record<string, string>
            )[k]).join(", ")}.
          </div>
        )}
        <Dato label="Tipo" value={tipoLabel} />
        <Dato label="Matrícula" value={vehicle.plate} />
        <Dato label="Marca" value={vehicle.make} />
        <Dato label="Modelo" value={vehicle.model} />
        <Dato label="Color" value={vehicle.color} />
        <Dato label="VIN / bastidor" value={vehicle.vin} />
        <Dato label="Combustible" value={
          COMBUSTIBLES.find(([c]) => c === vehicle.fuel)?.[1] ?? vehicle.fuel
        } />
        <Dato label="Eléctrico" value={vehicle.electric} />
        <Dato label="Remolque" value={vehicle.trailer} />
        <Dato label="Peso" value={vehicle.weight} />
        <Dato label="Carga" value={vehicle.cargo} />
        <Dato label="Mercancía peligrosa" value={vehicle.dangerousGoods} />
        {editable && (
          <div className="mt-3">
            <Button onClick={() => setEditando(true)}>
              {faltan.length ? "Completar ficha" : "Editar"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Tipo">
          <Select value={f.type ?? "car"} onChange={set("type")}>
            {tipos.length === 0 && <option value="car">Turismo</option>}
            {tipos.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Campo>
        <Campo label="Matrícula">
          {/* En mayúsculas siempre: el core la guarda así y si no, la misma
              matrícula escrita de dos formas no cruza con el histórico. */}
          <Input
            value={f.plate ?? ""}
            onChange={(e) => setF((p) => ({ ...p, plate: e.target.value.toUpperCase() }))}
            placeholder="0000ABC"
          />
        </Campo>
        <Campo label="Marca"><Input value={f.make ?? ""} onChange={set("make")} /></Campo>
        <Campo label="Modelo"><Input value={f.model ?? ""} onChange={set("model")} /></Campo>
        <Campo label="Color"><Input value={f.color ?? ""} onChange={set("color")} /></Campo>
        <Campo label="VIN / bastidor">
          <Input
            value={f.vin ?? ""}
            onChange={(e) => setF((p) => ({ ...p, vin: e.target.value.toUpperCase() }))}
          />
        </Campo>
        <Campo label="Combustible">
          <Select value={f.fuel ?? ""} onChange={set("fuel")}>
            {COMBUSTIBLES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
        </Campo>
        <Campo label="Peso"><Input value={f.weight ?? ""} onChange={set("weight")} placeholder="p. ej. 3.500 kg" /></Campo>
        <Campo label="Carga"><Input value={f.cargo ?? ""} onChange={set("cargo")} /></Campo>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-slate-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.electric} onChange={set("electric")} /> Eléctrico
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.trailer} onChange={set("trailer")} /> Lleva remolque
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.dangerousGoods} onChange={set("dangerousGoods")} /> Mercancía peligrosa
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <Button onClick={guardar} disabled={busy}>Guardar</Button>
        <Button variant="ghost" onClick={() => { setF(vehicle); setEditando(false); }} disabled={busy}>
          Cancelar
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        La matrícula y el "marca modelo" se copian también a la asistencia del
        taller, que es de donde salen el informe y el parte.
      </p>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}
