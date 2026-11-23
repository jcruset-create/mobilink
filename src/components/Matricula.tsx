import { dibujoMatricula } from "../modules/matriculaEs";

/**
 * Una matrícula dibujada como la placa de su país: la española con su banda
 * azul y la «E», la de remolque en rojo, la de otro país de la UE con su
 * letra (o sin letra si el país no se sabe), y cualquier otra en un recuadro
 * liso tal como está escrita. Qué es cada una lo decide `dibujoMatricula`.
 *
 * `pais` es el «País de la matrícula» guardado, si lo hay; sin él se deduce.
 */
type Tamano = "xs" | "sm" | "md" | "lg" | "xl";

const TAMANOS: Record<Tamano, { caja: string; banda: string; estrellas: string; relleno: string }> = {
  xs: { caja: "h-5 text-[11px]", banda: "w-3 text-[6px]", estrellas: "h-1.5 w-1.5", relleno: "gap-1 px-1.5" },
  sm: { caja: "h-7 text-sm", banda: "w-4 text-[8px]", estrellas: "h-2 w-2", relleno: "gap-1.5 px-2" },
  md: { caja: "h-9 text-xl", banda: "w-5 text-[10px]", estrellas: "h-2.5 w-2.5", relleno: "gap-2 px-2.5" },
  lg: { caja: "h-12 text-2xl", banda: "w-6 text-[11px]", estrellas: "h-3 w-3", relleno: "gap-2.5 px-3" },
  xl: { caja: "h-14 text-3xl", banda: "w-7 text-xs", estrellas: "h-3.5 w-3.5", relleno: "gap-3 px-3.5" },
};

const FONDOS = { blanco: "bg-white", rojo: "bg-red-600", amarillo: "bg-yellow-400", liso: "bg-slate-200" } as const;

export default function Matricula({
  plate, pais, size, grande = false,
}: { plate: string; pais?: string | null; size?: Tamano; grande?: boolean }) {
  const d = dibujoMatricula(plate, pais);
  const t = TAMANOS[size ?? (grande ? "md" : "sm")];
  return (
    <span
      role="img"
      aria-label={`Matrícula ${d.partes.join(" ")}`}
      className={`inline-flex shrink-0 items-stretch overflow-hidden rounded border-2 border-black align-middle font-mono font-black leading-none ${t.caja} ${FONDOS[d.fondo]} ${
        d.letrasRojas ? "text-red-700" : "text-black"
      }`}
    >
      {d.banda && (
        <span className={`flex flex-col items-center justify-end bg-[#003399] pb-0.5 font-sans text-white ${t.banda}`}>
          <span className={`mb-auto mt-0.5 rounded-full border border-dotted border-yellow-400 ${t.estrellas}`} />
          {d.pais}
        </span>
      )}
      <span className={`flex items-center whitespace-nowrap tracking-wide ${t.relleno}`}>
        {d.partes.map((p, i) => (
          <span key={i}>{i > 0 && d.separador !== " " ? d.separador : ""}{p}</span>
        ))}
      </span>
    </span>
  );
}
