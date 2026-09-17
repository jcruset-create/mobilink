import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listarLotesEtiquetas, type LoteEtiquetas } from "../etiquetas/datos";
import { TableWrap, tdCls, thCls } from "../components/ui";

/**
 * Los lotes de etiquetado, con lo que lleva cada uno.
 *
 * El operario fotografía las gomas nuevas desde la tablet; aquí se revisan los
 * números y se imprimen las etiquetas. ESTO NO ES INVENTARIO: etiquetar no
 * crea neumáticos, no mueve stock y no genera coste. Una goma etiquetada sigue
 * sin existir en TyreControl hasta que alguien la monta por el camino de
 * siempre.
 */
const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function Etiquetas() {
  const [lotes, setLotes] = useState<LoteEtiquetas[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLotes(await listarLotesEtiquetas());
      } catch (e: any) {
        setError(e?.message || "No se han podido leer los lotes");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const porRevisar = lotes.reduce((n, l) => n + l.por_revisar, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-black">
          Etiquetas de neumáticos{porRevisar > 0 ? ` · ${porRevisar} por revisar` : ""}
        </h1>
        <Link
          to="calibrar"
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
        >
          Hoja de calibración
        </Link>
      </div>

      {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}

      {cargando ? (
        <div className="text-slate-500">Cargando…</div>
      ) : lotes.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
          Todavía no hay lotes. Los abre el operario desde la tablet, en
          «Etiquetar neumáticos».
        </div>
      ) : (
        <TableWrap>
          <thead className="bg-slate-900">
            <tr>
              <th className={thCls}>Lote</th>
              <th className={thCls}>Cliente</th>
              <th className={thCls}>Abierto</th>
              <th className={thCls}>Fotos</th>
              <th className={thCls}>Por revisar</th>
              <th className={thCls}>Confirmadas</th>
              <th className={thCls}>Impresas</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.id} className="border-t border-slate-700">
                <td className={`${tdCls} font-bold`}>{l.codigo}</td>
                <td className={tdCls}>{l.empresa?.nombre ?? "—"}</td>
                <td className={tdCls}>{fecha(l.created_at)}</td>
                <td className={tdCls}>{l.fotos}</td>
                <td className={tdCls}>
                  {l.por_revisar > 0 ? (
                    <span className="font-bold text-amber-300">{l.por_revisar}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={tdCls}>{l.confirmadas || "—"}</td>
                <td className={tdCls}>{l.impresas || "—"}</td>
                <td className={tdCls}>
                  <Link
                    to={l.id}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
                  >
                    Revisar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
