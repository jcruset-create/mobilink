import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

import { fichaTacografo, type FichaTacografo, type EstadoTacografo } from "../services/data";
import { TableWrap, tdCls, thCls } from "./ui";

/**
 * La sección Tacógrafo de la ficha de un vehículo.
 *
 * Es UNA fila del control de tacógrafos, con su histórico al lado. No calcula
 * nada: lo pide al servidor, que usa el mismo módulo que alimenta la pantalla
 * de control. Si lo calculara aquí, un día la ficha diría «vence el 14/04» y
 * el control otra fecha.
 *
 * ── Los datos técnicos llevan FECHA ─────────────────────────────────────────
 *
 * Cada campo sale de la intervención más reciente que lo traía, que no tiene
 * por qué ser la última: una transferencia no informa el número de serie, y
 * dejarlo vacío escondería un dato que existe. Por eso cada valor enseña de
 * cuándo es; un número de serie sin fecha no dice si es el de ahora.
 */

const TONO: Record<EstadoTacografo, string> = {
  vigente: "text-emerald-300",
  proxima: "text-amber-300",
  vencida: "text-rose-300",
  sin_datos: "text-slate-400",
};

const ETIQUETA: Record<EstadoTacografo, string> = {
  vigente: "Vigente",
  proxima: "Vence pronto",
  vencida: "Vencido",
  sin_datos: "Sin datos",
};

const fecha = (iso?: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : String(iso);
};

/** Un dato técnico con la fecha de la que sale. */
function Dato({ et, v }: { et: string; v: { valor: string; fecha: string } | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{et}</div>
      <div className="text-sm font-semibold text-slate-100">{v?.valor ?? "—"}</div>
      {v && <div className="text-[10px] text-slate-500">de la del {fecha(v.fecha)}</div>}
    </div>
  );
}

export default function SeccionTacografo({
  empresaId, vehiculoId,
}: { empresaId: string; vehiculoId: string }) {
  const [d, setD] = useState<FichaTacografo | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    fichaTacografo(empresaId, vehiculoId)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setError(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [empresaId, vehiculoId]);

  if (cargando) return <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">Cargando tacógrafo…</div>;
  if (error) return <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>;
  if (!d) return null;

  const f = d.fila;
  const t = d.tecnicos;

  return (
    <section className="bloque-informe rounded-lg bg-slate-800 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-black">
        <Gauge size={16} /> Tacógrafo
      </h2>

      {f.estado === "sin_datos" ? (
        <p className="text-sm text-slate-400">
          No hay ninguna intervención de tacógrafo registrada para este vehículo. Eso no
          significa que no lo tenga: significa que no está en el sistema.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estado</div>
              <div className={`text-xl font-black ${TONO[f.estado]}`}>{ETIQUETA[f.estado]}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Última intervención</div>
              <div className="text-sm font-semibold text-slate-100">{fecha(f.ultima)}</div>
              <div className="text-[10px] text-slate-500">{f.ultimoTipo ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Próxima revisión</div>
              <div className="text-sm font-semibold text-slate-100">{fecha(f.proxima)}</div>
              <div className="text-[10px] text-slate-500">cada {d.regla.meses} meses</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {f.diasRestantes != null && f.diasRestantes < 0 ? "Días de retraso" : "Días restantes"}
              </div>
              <div className={`text-xl font-black tabular-nums ${TONO[f.estado]}`}>
                {f.diasRestantes == null ? "—" : Math.abs(f.diasRestantes)}
              </div>
            </div>
          </div>

          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Datos técnicos
          </h3>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Dato et="Tipo" v={t.tipoTacografo} />
            <Dato et="Fabricante" v={t.fabricante} />
            <Dato et="Referencia" v={t.referencia} />
            <Dato et="Nº de serie" v={t.numSerie} />
            <Dato et="Nº sensor" v={t.numSensor} />
            <Dato et="Software" v={t.version} />
            <Dato et="Parámetro K" v={t.paramK} />
            <Dato et="Parámetro W" v={t.paramW} />
            <Dato et="Parámetro L" v={t.paramL} />
            <Dato et="Medida calibrada" v={t.medida} />
          </div>

          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Histórico · {d.historico.length} intervención(es)
          </h3>
          <TableWrap>
            <thead><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Tipo</th>
              <th className={thCls}>Resultado</th><th className={thCls}>Km</th>
              <th className={thCls}>Medida</th><th className={thCls}>Técnico</th>
            </tr></thead>
            <tbody>
              {d.historico.map((h) => (
                <tr key={h.id}>
                  <td className={`${tdCls} font-semibold`}>{fecha(h.fecha)}</td>
                  <td className={`${tdCls} text-[11px]`}>{h.tipoOperacion ?? "—"}</td>
                  <td className={tdCls}>
                    {h.resultado === "Favorable"
                      ? <span className="text-emerald-300">Favorable</span>
                      : <span className="text-slate-500">{h.resultado ?? "—"}</span>}
                  </td>
                  <td className={`${tdCls} tabular-nums`}>
                    {h.kmNuevo == null ? "—" : h.kmNuevo.toLocaleString("es-ES")}
                    {h.kmSospechoso && (
                      <span className="ml-1 text-[10px] text-amber-300" title="La lectura baja respecto a la anterior">⚠</span>
                    )}
                  </td>
                  <td className={tdCls}>{h.medidaNorm ?? h.medidaOrigen ?? "—"}</td>
                  <td className={`${tdCls} text-[11px] text-slate-400`}>{h.tecnico ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}
    </section>
  );
}
