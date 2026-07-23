import type { MontajeSnapshot } from "../services/data";

// Plano de un snapshot pintado SOBRE la imagen real del chasis, con las
// tarjetas de cada posición en sus coordenadas (%). Si no hay imagen o
// coordenadas, cae a una rejilla esquemática por eje.
export default function PlanoSnapshot({ titulo, snap, imagen, cambiadas, conAveria }: {
  titulo?: string; snap: MontajeSnapshot[] | null | undefined; imagen?: string | null;
  cambiadas?: Set<string>; conAveria?: boolean;
}) {
  const items = snap ?? [];
  const tieneCoords = !!imagen && items.some((s) => s.x != null && s.y != null);

  const clases = (s: MontajeSnapshot) => {
    const averia = conAveria && s.averias && s.averias.length;
    const cambiada = cambiadas?.has(s.posicion_id ?? "");
    return averia ? "border-red-500 bg-red-950/70" : cambiada ? "border-emerald-500 bg-emerald-950/70" : "border-slate-600 bg-slate-900/85";
  };
  const contenido = (s: MontajeSnapshot) => (
    <>
      <div className="truncate font-semibold text-slate-300">{s.codigo ?? "—"}</div>
      {s.marca ? (
        <>
          <div className="truncate text-slate-100">{s.marca}</div>
          <div className="truncate text-slate-400">{s.medida ?? ""}</div>
          <div className="truncate text-slate-400">{s.mm != null ? `${s.mm} mm` : "— mm"}{s.presion != null ? ` · ${s.presion} bar` : ""}</div>
        </>
      ) : <div className="text-slate-500">Libre</div>}
      {conAveria && s.averias && s.averias.length ? <div className="mt-0.5 truncate font-semibold text-red-400">⚠ {s.averias.join(" · ")}</div> : null}
    </>
  );

  return (
    <div className="flex-1 min-w-0">
      {titulo ? <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{titulo}</div> : null}
      {tieneCoords ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
          <img src={imagen!} alt={titulo ?? "Plano"} className="block w-full" />
          {items.map((s, k) => (
            <div key={k}
              className={`absolute rounded border ${clases(s)} px-1 py-0.5 text-[8px] leading-tight`}
              style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${Math.max(s.w ?? 16, 12)}%` }}>
              {contenido(s)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {(() => {
            const lado = (c?: string | null) => /IZQ|_I$|IZQUIER/i.test(c ?? "") ? "izq" : "der";
            const ejes = Array.from(new Set(items.map((s) => s.eje ?? 99))).sort((a, b) => a - b);
            if (!ejes.length) return <div className="text-[12px] text-slate-500">Sin datos.</div>;
            return ejes.map((e) => {
              const izq = items.find((s) => (s.eje ?? 99) === e && lado(s.codigo) === "izq");
              const der = items.find((s) => (s.eje ?? 99) === e && lado(s.codigo) === "der");
              const celda = (s?: MontajeSnapshot) => s
                ? <div className={`min-h-[52px] rounded-lg border ${clases(s)} px-2 py-1.5 text-[11px]`}>{contenido(s)}</div>
                : <div className="min-h-[52px] rounded-lg border border-dashed border-slate-700/60" />;
              return <div key={e} className="grid grid-cols-2 gap-1.5">{celda(izq)}{celda(der)}</div>;
            });
          })()}
        </div>
      )}
    </div>
  );
}
