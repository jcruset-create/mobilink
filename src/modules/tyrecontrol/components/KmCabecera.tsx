import { useEffect, useState } from "react";
import { kmFichaVehiculo, type KmFicha } from "../services/data";

const km = (n: number) => `${Math.round(n).toLocaleString("es-ES")}`;
const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

function hace(min: number | null | undefined): string {
  if (min == null) return "";
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const nombreProveedor = (p: string | null) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "telemática");

/**
 * Los km de la cabecera de la ficha del vehículo.
 *
 * Al abrir se ve en el acto el último km conocido —con su fecha y de dónde
 * sale— y, en segundo plano, se pregunta a la telemática el de ahora. Si
 * contesta, manda; si no, se queda el último conocido diciendo que no se ha
 * podido leer. La ficha no espera a nadie.
 *
 * El km que viene en la ficha (`kmActual`) solo se usa mientras llega lo
 * demás, y nunca un 0: el de la importación del Excel parecía un dato.
 */
export default function KmCabecera({ vehiculoId, kmActual, procedencia }: {
  vehiculoId: string;
  kmActual: number | null | undefined;
  /** Lo que se decía hasta ahora de dónde sale `kmActual`. */
  procedencia?: string | null;
}) {
  const [datos, setDatos] = useState<KmFicha | null>(null);
  const [leyendo, setLeyendo] = useState(true);
  const [fallo, setFallo] = useState(false);

  async function leer(vivo: boolean) {
    try {
      const r = await kmFichaVehiculo(vehiculoId, vivo);
      setDatos((prev) => ({ ...r, ultimo: r.ultimo ?? prev?.ultimo ?? null }));
      setFallo(false);
    } catch {
      if (vivo) setFallo(true);
    }
  }

  async function leerTodo() {
    setLeyendo(true);
    await leer(false);
    await leer(true);
    setLeyendo(false);
  }

  useEffect(() => { void leerTodo(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vehiculoId]);

  const lectura = datos?.lectura ?? null;
  const ultimo = datos?.ultimo ?? null;
  const inicial = Number(kmActual) > 0 ? Number(kmActual) : null;

  // 1. La telemática ha dado km.
  if (lectura?.km != null) {
    const reciente = lectura.estado === "actualizado";
    return (
      <>
        <span className="ml-2 text-lg font-black text-slate-100">
          {km(lectura.km)} <span className="text-xs font-normal text-slate-400">km</span>
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${reciente ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
          title={[lectura.texto, lectura.aviso, datos?.guardado ? "Guardado como km del vehículo." : null].filter(Boolean).join(" ")}
        >
          {reciente ? "● ahora" : "lectura"} · {nombreProveedor(lectura.proveedor)} · {hace(lectura.antiguedadMin)}
        </span>
      </>
    );
  }

  // 2. Sin odómetro fiable de la telemática: el reconstruido (última lectura
  //    real + km de viajes) y, si no lo hay, el último conocido.
  const rec = datos?.reconstruido ?? null;
  const base = rec?.km ?? ultimo?.km ?? inicial;
  const sinTelematica = lectura?.estado === "sin_telematica";
  return (
    <>
      <span className="ml-2 text-lg font-black text-slate-100">
        {rec && rec.rodados !== 0 ? "≈ " : ""}{base != null ? km(base) : "—"} <span className="text-xs font-normal text-slate-400">km</span>
      </span>
      {rec && rec.rodados !== 0 ? (
        <span
          className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-300"
          title={`Reconstruido: ${rec.ancla.detalle} (${km(rec.ancla.km)} km) ${rec.rodados >= 0 ? "+" : "−"} ` +
            `${km(Math.abs(rec.rodados))} km de viajes de la telemática desde entonces. ` +
            "Cada revisión o montaje con km vuelve a anclar la cuenta."}
        >
          reconstruido · {rec.ancla.detalle} + viajes
        </span>
      ) : ultimo ? (
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${leyendo ? "bg-slate-700/60 text-slate-300" : "bg-amber-500/15 text-amber-300"}`}
          title={`Último km conocido: ${ultimo.detalle}`}
        >
          {leyendo ? "" : "último conocido · "}{ultimo.detalle || fecha(ultimo.fecha)}
        </span>
      ) : base != null ? (
        procedencia ? <span className="text-[11px] text-slate-500">({procedencia})</span> : null
      ) : (
        <span className="text-[11px] text-slate-500">sin lecturas de km (ni telemática, ni revisiones, ni montajes)</span>
      )}
      {leyendo ? (
        <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-300">
          <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-sky-300 border-r-transparent" />
          leyendo odómetro…
        </span>
      ) : lectura?.estado === "no_fiable" ? (
        <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300" title={lectura.texto}>
          ⚠ odómetro de la telemática no fiable{lectura.kmTelematica != null ? ` (marca ${km(lectura.kmTelematica)})` : ""}
        </span>
      ) : sinTelematica ? null : (fallo || lectura) && (
        <span className="text-[11px] text-slate-500" title={lectura?.texto ?? ""}>
          No se ha podido leer ahora ·{" "}
          <button className="underline hover:text-slate-300" onClick={() => void leerTodo()}>reintentar</button>
        </span>
      )}
    </>
  );
}
