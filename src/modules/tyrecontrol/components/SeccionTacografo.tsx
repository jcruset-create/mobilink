import { useEffect, useRef, useState } from "react";
import { Gauge, Loader2, Paperclip, Upload } from "lucide-react";

import {
  adjuntarInformeTacografo, fichaTacografo, informesTacografo,
  type EstadoTacografo, type FichaTacografo, type InformeTacografo,
} from "../services/data";
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
 *
 * ── El clip ─────────────────────────────────────────────────────────────────
 *
 * Al lado de cada intervención, si tiene adjunto su informe técnico en PDF.
 * Los informes se piden APARTE de la ficha, no dentro: la URL viene firmada y
 * caduca en una hora, y así refrescarla no obliga a recargar el histórico.
 *
 * ── Quién decide qué pasa al subir un PDF ───────────────────────────────────
 *
 * El servidor, siempre. Esta pantalla manda el fichero y enseña lo que le
 * contesten: si la intervención no estaba, se crea; si estaba, solo se
 * adjunta; y si la matrícula del impreso no es la del vehículo abierto, NO se
 * reintenta sola —pregunta, porque subir el informe en la ficha de al lado es
 * el error fácil y el caro—.
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
  empresaId, vehiculoId, onBastidor,
}: {
  empresaId: string;
  vehiculoId: string;
  /**
   * El bastidor que dice el tacógrafo, para que la ficha pueda enseñarlo
   * arriba cuando el vehículo no lo tiene. Se avisa desde aquí en vez de
   * pedir los datos otra vez: esta sección ya los ha traído.
   */
  onBastidor?: (b: { valor: string; fecha: string } | null) => void;
}) {
  const [d, setD] = useState<FichaTacografo | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const [informes, setInformes] = useState<InformeTacografo[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [problema, setProblema] = useState("");
  /** El fichero que el servidor no acepta hasta que alguien confirme el vehículo. */
  const [aConfirmar, setAConfirmar] = useState<File | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const recargar = async () => {
    const [ficha, docs] = await Promise.all([
      fichaTacografo(empresaId, vehiculoId),
      informesTacografo(empresaId, vehiculoId).catch(() => [] as InformeTacografo[]),
    ]);
    setD(ficha);
    setInformes(docs);
  };

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    Promise.all([
      fichaTacografo(empresaId, vehiculoId),
      informesTacografo(empresaId, vehiculoId).catch(() => [] as InformeTacografo[]),
    ])
      .then(([ficha, docs]) => {
        if (!vivo) return;
        setD(ficha);
        setInformes(docs);
        onBastidor?.(ficha.tecnicos.bastidor ?? null);
      })
      .catch((e) => { if (vivo) setError(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // `onBastidor` fuera de las dependencias a propósito: es una función que
    // la ficha vuelve a crear en cada pintado, y meterla aquí pediría los
    // datos del tacógrafo en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, vehiculoId]);

  async function subir(archivo: File, confirmar = false) {
    setSubiendo(true); setAviso(""); setProblema(""); setAConfirmar(null);
    try {
      const r = await adjuntarInformeTacografo(empresaId, vehiculoId, archivo, confirmar);
      await recargar();
      setAviso([
        r.accion === "creada_y_adjuntada"
          ? `La intervención ${r.idOrigen} (${fecha(r.fecha)}) no estaba dada de alta: se ha `
            + "creado con los datos del informe y el PDF queda adjunto."
          : `El informe ${r.idOrigen} queda adjunto a su intervención, que ya estaba en el histórico.`,
        ...r.avisos,
      ].join(" "));
    } catch (e: any) {
      const texto = String(e?.message ?? e);
      setProblema(texto);
      // El servidor dice cuándo falta una confirmación; la pantalla no lo
      // adivina ni reintenta por su cuenta.
      if (/hay que confirmarlo/i.test(texto)) setAConfirmar(archivo);
    } finally {
      setSubiendo(false);
      if (campo.current) campo.current.value = "";
    }
  }

  if (cargando) return <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">Cargando tacógrafo…</div>;
  if (error) return <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>;
  if (!d) return null;

  const f = d.fila;
  const t = d.tecnicos;
  /** El informe de cada intervención: el más reciente si hubiera dos. */
  const informePor = new Map<string, InformeTacografo>();
  for (const i of informes) {
    if (i.intervencionId && !informePor.has(i.intervencionId)) informePor.set(i.intervencionId, i);
  }
  const huerfanos = informes.filter((i) => !i.intervencionId);

  return (
    <section className="bloque-informe rounded-lg bg-slate-800 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black">
          <Gauge size={16} /> Tacógrafo
        </h2>
        <label className="no-imprimir inline-flex cursor-pointer items-center gap-2 rounded-md
                          bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-100
                          hover:bg-slate-600">
          {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {subiendo ? "Leyendo el informe…" : "Adjuntar informe (PDF)"}
          <input
            ref={campo}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={subiendo}
            onChange={(e) => { const a = e.target.files?.[0]; if (a) subir(a); }}
          />
        </label>
      </div>

      {aviso && (
        <div className="no-imprimir mb-3 rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-200">
          {aviso}
        </div>
      )}
      {problema && (
        <div className="no-imprimir mb-3 rounded-md bg-rose-500/10 p-3 text-xs text-rose-200">
          {problema}
          {aConfirmar && (
            <button
              type="button"
              className="ml-2 rounded bg-rose-500/20 px-2 py-1 font-bold text-rose-100 hover:bg-rose-500/30"
              onClick={() => subir(aConfirmar, true)}
            >
              Sí, es este vehículo: adjuntar igualmente
            </button>
          )}
        </div>
      )}

      {f.estado === "sin_datos" ? (
        <p className="text-sm text-slate-400">
          No hay ninguna intervención de tacógrafo registrada para este vehículo. Eso no
          significa que no lo tenga: significa que no está en el sistema. Si tienes el
          informe técnico en PDF, adjúntalo y la intervención se dará de alta con sus datos.
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
            <Dato et="Bastidor" v={t.bastidor} />
            {/*
              La generación se lee de la versión de software, no de la
              referencia: `1381.4521402002` tiene un 4 detrás de 1381 y es un
              digital 3.0. La decide el servidor; aquí solo se pinta.
            */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Software</div>
              <div className="text-sm font-semibold text-slate-100">{t.version?.valor ?? "—"}</div>
              {f.generacion.generacion !== "desconocida" && (
                <div
                  className={`text-[10px] font-bold ${
                    f.generacion.generacion === "digital" ? "text-slate-400" : "text-sky-300"}`}
                  title={f.generacion.detalle}
                >
                  {f.generacion.etiqueta}
                </div>
              )}
              {t.version && <div className="text-[10px] text-slate-500">de la del {fecha(t.version.fecha)}</div>}
            </div>
            <Dato et="Parámetro K" v={t.paramK} />
            <Dato et="Parámetro W" v={t.paramW} />
            <Dato et="Parámetro L" v={t.paramL} />
            <Dato et="Medida calibrada" v={t.medida} />
          </div>

          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Histórico · {d.historico.length} intervención(es)
            {informes.length > 0 && ` · ${informes.length} informe(s) adjunto(s)`}
          </h3>
          <TableWrap>
            <thead><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Tipo</th>
              <th className={thCls}>Resultado</th><th className={thCls}>Km</th>
              <th className={thCls}>Medida</th><th className={thCls}>Técnico</th>
              <th className={thCls}>Informe</th>
            </tr></thead>
            <tbody>
              {d.historico.map((h) => {
                const inf = informePor.get(h.id);
                return (
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
                    <td className={tdCls}>
                      {inf?.url
                        ? (
                          <a
                            href={inf.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Ver o descargar ${inf.nombre}`}
                            className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"
                          >
                            <Paperclip size={14} />
                            <span className="text-[11px]">PDF</span>
                          </a>
                        )
                        : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          {huerfanos.length > 0 && (
            <div className="mt-3 rounded-md bg-slate-700/40 p-3 text-xs text-slate-300">
              <div className="mb-1 font-bold">
                {huerfanos.length} informe(s) sin intervención
              </div>
              {/* Pasa cuando se deshace el lote que las había importado: el PDF
                  no se borra con ellas, así que sigue aquí y se puede abrir. */}
              <div className="mb-2 text-slate-400">
                Su intervención ya no está en el histórico. El PDF se conserva.
              </div>
              <ul className="flex flex-wrap gap-3">
                {huerfanos.map((i) => (
                  <li key={i.id}>
                    {i.url
                      ? (
                        <a href={i.url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
                          <Paperclip size={14} /> {i.nombre}
                        </a>
                      )
                      : i.nombre}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
