import type { ZoneRect } from "../vehicle-layouts/zones";
import type { MontajeActual } from "../types";

export type EstadoVisualNeumatico = "correcto" | "revision" | "sustituir_pronto" | "sustituir_ya" | "nuevo" | "reparacion" | "descartado" | "libre";

export const COLOR_ESTADO_VISUAL: Record<EstadoVisualNeumatico, string> = {
  correcto: "#22c55e",
  revision: "#eab308",
  sustituir_pronto: "#f97316",
  sustituir_ya: "#ef4444",
  nuevo: "#3b82f6",
  reparacion: "#a855f7",
  descartado: "#0f172a",
  libre: "#64748b",
};

export function getEstadoVisual(montaje: MontajeActual | undefined): EstadoVisualNeumatico {
  if (!montaje?.neumatico) return "libre";
  // Sin datos de profundidad/presión todavía (fase de inspecciones pendiente):
  // por ahora el estado visual refleja si el neumático es nuevo o está en curso normal.
  return "correcto";
}

interface TirePositionProps {
  zone: ZoneRect;
  montaje?: MontajeActual;
  seleccionado?: boolean;
  showDetails?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function TirePosition({
  zone, montaje, seleccionado, showDetails = true, onClick, onDoubleClick, onContextMenu, onMouseEnter, onMouseLeave,
}: TirePositionProps) {
  const estado = getEstadoVisual(montaje);
  const color = COLOR_ESTADO_VISUAL[estado];
  const ocupado = !!montaje?.neumatico;

  return (
    <g
      transform={`translate(${zone.x},${zone.y})`}
      className="cursor-pointer pointer-events-auto"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <rect
        width={zone.width}
        height={zone.height}
        rx={10}
        fill={ocupado ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.35)"}
        stroke={color}
        strokeWidth={seleccionado ? 4 : 2}
        strokeDasharray={ocupado ? undefined : "6 4"}
      />
      {ocupado && (
        <>
          <circle cx={zone.width / 2} cy={16} r={6} fill={color} />
          {showDetails && (
            <text x={zone.width / 2} y={zone.height / 2 - 4} textAnchor="middle" fontSize="15" fontWeight="700" fill="#e2e8f0">
              {montaje!.neumatico!.codigo_interno ?? montaje!.neumatico!.numero_serie ?? "—"}
            </text>
          )}
          {showDetails && (
            <text x={zone.width / 2} y={zone.height / 2 + 16} textAnchor="middle" fontSize="11" fill="#94a3b8">
              {montaje!.neumatico!.medida ?? ""}
            </text>
          )}
        </>
      )}
      {!ocupado && (
        <text x={zone.width / 2} y={zone.height / 2} textAnchor="middle" fontSize="11" fill="#64748b">
          Libre
        </text>
      )}
    </g>
  );
}
