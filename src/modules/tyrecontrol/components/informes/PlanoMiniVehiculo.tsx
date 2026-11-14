import type { RuedaMarcada, EstadoRueda } from "../../services/alertasPorVehiculo";

/**
 * El plano del vehículo en pequeño: su foto de chasis con un recuadro por
 * rueda y los milímetros dentro.
 *
 * El relleno dice el estado y el número los milímetros. Los cuatro colores
 * llevan el texto en blanco y pasan el contraste: un verde claro con letra
 * blanca no se leería, así que el «bien» es verde OSCURO.
 */
const RELLENO: Record<EstadoRueda, string> = {
  ok: "bg-green-800 text-white",
  cambiar: "bg-red-600 text-white ring-[1.5px] ring-red-200",
  presion: "bg-amber-700 text-white ring-[1.5px] ring-amber-200",
  // Por confirmar: ni verde ni rojo. Violeta, que no significa nada más aquí.
  por_confirmar: "bg-violet-700 text-white ring-[1.5px] ring-violet-200",
  sin_medir: "bg-slate-600 text-slate-100",
  // Un hueco sin neumático no es un estado de la goma: va sin relleno.
  vacia: "border border-dashed border-slate-500 bg-slate-900/40 text-transparent",
};

export default function PlanoMiniVehiculo({
  foto, ruedas, ancho = 300, alt,
}: {
  foto: string | null;
  ruedas: RuedaMarcada[];
  /** El ancho de la foto. El chasis es vertical, así que de aquí sale el alto. */
  ancho?: number;
  alt: string;
}) {
  return (
    <div className="relative mx-auto" style={{ width: ancho, maxWidth: "100%" }}>
      {foto ? (
        <img
          src={foto}
          alt={alt}
          loading="lazy"
          className="block w-full rounded-md border border-slate-700"
          style={{ height: "auto" }}
        />
      ) : (
        // Sin foto de chasis el plano se pinta igual: los recuadros siguen
        // diciendo el eje y el lado, que es lo que hay que leer. Son 3 de los
        // 65 vehículos con aviso (configuraciones 2x2 y 2x4x4, sin imagen).
        <div
          className="flex items-end justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/60 pb-1 text-[10px] text-slate-500"
          style={{ height: ancho * 1.5 }}
          role="img"
          aria-label={`${alt} · sin foto de chasis`}
        >
          sin foto de chasis
        </div>
      )}

      {ruedas.map((r) =>
        r.marca ? (
          <span
            key={r.codigo}
            title={r.titulo}
            className={`absolute box-border min-w-[28px] -translate-x-1/2 -translate-y-1/2 rounded px-1 py-[2px] text-center text-[11px] font-extrabold tabular-nums ${RELLENO[r.estado]}`}
            style={{ left: `${r.marca.left}%`, top: `${r.marca.top}%` }}
          >
            {r.texto || " "}
          </span>
        ) : null,
      )}
    </div>
  );
}
