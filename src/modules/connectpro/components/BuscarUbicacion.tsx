/**
 * Connect Pro — situar la ubicación del aviso escribiéndola como venga.
 *
 * Es el mismo buscador del mapa operativo, traído al alta. Quien coge el
 * teléfono recibe la ubicación como se la dan —"AP-7 km 234 sentido
 * Barcelona", un código postal, un enlace de Google Maps que ha mandado el
 * conductor por WhatsApp— y hasta ahora tenía que ir al mapa, buscarla allí,
 * copiar las coordenadas y volver. Cada salto es una ocasión de pegar la
 * coordenada equivocada.
 *
 * Rellena dirección, latitud y longitud, y dice CON QUÉ PRECISIÓN lo ha
 * situado. Eso último importa: un punto kilométrico interpolado no es lo mismo
 * que una coordenada exacta, y quien manda la grúa tiene derecho a saberlo
 * antes de que alguien conduzca hasta allí.
 */

import { useState } from "react";
import { boFetch } from "../services/api";
import { Input, Button } from "./ui";

type Resultado = {
  punto: { lat: number; lng: number };
  etiqueta: string;
  tipo: string;
  precision: "exacta" | "interpolada" | "aproximada";
  avisos: string[];
  workshops: Array<{
    id: number; name: string; distanceKm: number; enCobertura: boolean;
    city: string | null; province: string | null;
  }>;
};

const PRECISION: Record<string, { texto: string; clase: string }> = {
  exacta: { texto: "Punto exacto", clase: "text-emerald-300" },
  interpolada: { texto: "Punto aproximado sobre la vía", clase: "text-amber-300" },
  aproximada: { texto: "Zona aproximada, no un punto", clase: "text-amber-300" },
};

export default function BuscarUbicacion({ onEncontrado }: {
  onEncontrado: (r: { lat: number; lng: number; etiqueta: string }) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);

  const buscar = async () => {
    if (!consulta.trim()) return;
    setBuscando(true); setError(null);
    try {
      const r = await boFetch<Resultado>(`/geo/search?q=${encodeURIComponent(consulta.trim())}`);
      setRes(r);
      onEncontrado({ lat: r.punto.lat, lng: r.punto.lng, etiqueta: r.etiqueta });
    } catch (e: any) {
      setError(e.message);
      setRes(null);
    } finally { setBuscando(false); }
  };

  const p = res ? PRECISION[res.precision] ?? PRECISION.aproximada : null;

  return (
    <div className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
          className="min-w-[280px] flex-1"
          placeholder="Localidad, código postal, AP-7 km 234, coordenadas o enlace de Google Maps"
        />
        <Button onClick={buscar} disabled={buscando || !consulta.trim()}>
          {buscando ? "Buscando…" : "Buscar en el mapa"}
        </Button>
      </div>

      {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}

      {res && (
        <div className="mt-2 flex flex-col gap-1 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-300">{res.etiqueta}</span>
            <span className="text-slate-500">
              {res.punto.lat.toFixed(5)}, {res.punto.lng.toFixed(5)}
            </span>
            {p && <span className={p.clase}>· {p.texto}</span>}
            <a
              href={`https://www.google.com/maps?q=${res.punto.lat},${res.punto.lng}`}
              target="_blank" rel="noreferrer"
              className="text-cyan-300 hover:underline"
            >
              Comprobar en Maps ↗
            </a>
          </div>

          {res.avisos.map((a, i) => (
            <p key={i} className="text-amber-300">⚠ {a}</p>
          ))}

          {/* Los talleres cercanos son la decisión siguiente: verlos ya aquí
              ahorra abrir el mapa para saber si hay alguien cerca. */}
          {res.workshops.length > 0 && (
            <p className="text-slate-500">
              Talleres cerca:{" "}
              {res.workshops.slice(0, 3).map((w, i) => (
                <span key={w.id}>
                  {i > 0 && " · "}
                  <span className={w.enCobertura ? "text-emerald-300" : "text-slate-400"}>
                    {w.name} ({w.distanceKm.toFixed(0)} km{w.enCobertura ? "" : ", fuera de cobertura"})
                  </span>
                </span>
              ))}
            </p>
          )}
          {res.workshops.length === 0 && (
            <p className="text-amber-300">
              ⚠ Ningún taller de la red cerca de ese punto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
