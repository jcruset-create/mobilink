import type { RevisionDetalle } from "../types";

/**
 * La profundidad de una rueda en la ficha de una revisión.
 *
 * Con medición doble enseña las DOS bandas (interior y exterior) debajo de
 * la mínima, que es la oficial —la que leen todos los demás informes— y
 * avisa de desgaste irregular si la diferencia llega al umbral de la empresa
 * (`deltaUmbralMm`, null = sin aviso). Una revisión antigua, de una sola
 * medición, se ve igual que siempre.
 */
export function deltaBandas(d: Pick<RevisionDetalle, "profundidad_int_mm" | "profundidad_ext_mm">): number | null {
  if (d.profundidad_int_mm == null || d.profundidad_ext_mm == null) return null;
  return Math.abs(Number(d.profundidad_int_mm) - Number(d.profundidad_ext_mm));
}

export function desgasteIrregular(
  d: Pick<RevisionDetalle, "profundidad_int_mm" | "profundidad_ext_mm">,
  deltaUmbralMm: number | null | undefined,
): boolean {
  const delta = deltaBandas(d);
  return deltaUmbralMm != null && delta != null && delta >= Number(deltaUmbralMm) - 1e-9;
}

const mm = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("es-ES", { maximumFractionDigits: 1 });

export default function CeldaProfundidad({ d, deltaUmbralMm }: {
  d: RevisionDetalle;
  deltaUmbralMm?: number | null;
}) {
  if (d.no_accesible) return <span>No accesible</span>;
  if (d.profundidad_mm == null) return <span>—</span>;
  const hayBandas = d.profundidad_int_mm != null || d.profundidad_ext_mm != null;
  const delta = deltaBandas(d);
  return (
    <div className="leading-tight">
      <span className={hayBandas ? "font-semibold text-slate-200" : undefined}>{mm(d.profundidad_mm)} mm</span>
      {hayBandas && (
        <div className="text-[11px] text-slate-500">
          int {mm(d.profundidad_int_mm)} · ext {mm(d.profundidad_ext_mm)}
        </div>
      )}
      {desgasteIrregular(d, deltaUmbralMm) && (
        <div className="mt-0.5 inline-block rounded bg-amber-500/15 px-1.5 text-[10.5px] font-bold text-amber-300"
          title="Diferencia entre la banda interior y la exterior: suele indicar alineación o presión incorrectas.">
          Desgaste irregular · Δ {mm(delta)} mm
        </div>
      )}
    </div>
  );
}
