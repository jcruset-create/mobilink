/**
 * Connect Pro — "Buscar coordenadas": saca la latitud y la longitud de la
 * dirección escrita al lado.
 *
 * De esas dos cifras dependen el reparto por cercanía y el radio de cobertura,
 * y hasta ahora había que ir a buscarlas a Google Maps y pegarlas a mano, que
 * es exactamente como se cuelan las de otro sitio.
 *
 * Si no se encuentra la dirección lo dice y no escribe nada: un punto
 * aproximado mandaría la asistencia a donde no es, y eso no se descubre hasta
 * que alguien conduce hasta allí.
 */

import { useState } from "react";
import { boFetch } from "../services/api";
import { Button } from "./ui";

export default function BotonCoordenadas({ direccion, onEncontrado, onError }: {
  direccion: { address?: string; postalCode?: string; city?: string; province?: string };
  onEncontrado: (p: { lat: number; lng: number }) => void;
  onError?: (mensaje: string) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const hayDatos = [direccion.address, direccion.city, direccion.postalCode]
    .some((v) => (v ?? "").trim());

  const buscar = async () => {
    setBuscando(true); setAviso(null);
    try {
      const p = await boFetch<{ lat: number; lng: number }>("/geocode", {
        method: "POST", body: direccion,
      });
      onEncontrado(p);
      setAviso("Coordenadas puestas. Compruébalas en el mapa antes de guardar.");
    } catch (e: any) {
      setAviso(null);
      onError?.(e.message);
    } finally { setBuscando(false); }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        disabled={buscando || !hayDatos}
        onClick={buscar}
        title={hayDatos
          ? "Sacar la latitud y la longitud de la dirección escrita"
          : "Escribe antes la dirección, el municipio o el código postal"}
      >
        {buscando ? "Buscando…" : "📍 Buscar coordenadas"}
      </Button>
      {aviso && <span className="text-[11px] text-emerald-300">{aviso}</span>}
    </div>
  );
}
