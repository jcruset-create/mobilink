import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  cerrarLoteEtiquetas, confirmarSerie, descartarFoto, listarFotosLote,
  listarLotesEtiquetas, reabrirFoto, type FotoEtiqueta, type LoteEtiquetas,
} from "../etiquetas/datos";
import {
  clavesRepetidas, esRepetida, imprimible, normalizarSerie, porRevisar,
  resumirLote, serieEditable,
} from "../etiquetas/revision";

/**
 * Revisar los números de un lote y mandar a imprimir.
 *
 * ── La regla de esta pantalla ───────────────────────────────────────────────
 *
 * Lo que la IA leyó es una PROPUESTA. Nada se imprime hasta que una persona
 * mira la foto y confirma el número. Por eso la foto se ve grande y ampliable
 * al lado de la casilla: confirmar sin poder leer el flanco no sería confirmar,
 * sería dar por bueno.
 *
 * Y lo que leyó la máquina se conserva aunque se corrija: es lo único que
 * permite saber después si el lector acierta.
 *
 * NO SE CREA NINGÚN NEUMÁTICO AQUÍ. No hay alta, ni montaje, ni stock, ni
 * coste: se prepara una etiqueta con un número.
 */
export default function EtiquetasLote() {
  const { loteId = "" } = useParams();
  const navegar = useNavigate();
  const [lote, setLote] = useState<LoteEtiquetas | null>(null);
  const [fotos, setFotos] = useState<FotoEtiqueta[]>([]);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      const [ls, fs] = await Promise.all([listarLotesEtiquetas(), listarFotosLote(loteId)]);
      setLote(ls.find((l) => l.id === loteId) ?? null);
      setFotos(fs);
      // El borrador se rehace con lo que hay guardado: lo que ya confirmó
      // alguien manda sobre lo que leyó la IA.
      setBorrador(Object.fromEntries(fs.map((f) => [f.id, serieEditable(f)])));
    } catch (e: any) {
      setError(e?.message || "No se ha podido leer el lote");
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loteId]);

  const repetidas = useMemo(() => clavesRepetidas(fotos), [fotos]);
  const resumen = useMemo(() => resumirLote(fotos), [fotos]);
  const listas = useMemo(() => fotos.filter(imprimible), [fotos]);

  async function accion(trabajo: () => Promise<void>, hecho: string) {
    setMsg("");
    try {
      await trabajo();
      setMsg(hecho);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se ha podido guardar");
    }
  }

  if (cargando) return <div className="text-slate-500">Cargando…</div>;
  if (!lote) return <div className="text-rose-400">Este lote no existe o no es de un cliente que puedas ver.</div>;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to=".." className="text-xs text-slate-400 hover:text-slate-200">← Etiquetas</Link>
          <h1 className="text-lg font-black">
            {lote.codigo}
            <span className="ml-2 text-sm font-normal text-slate-400">
              {lote.empresa?.nombre ?? ""}
            </span>
          </h1>
        </div>
        <div className="flex gap-2">
          {lote.estado === "abierto" && (
            <button
              onClick={() => accion(() => cerrarLoteEtiquetas(lote.id), "Lote cerrado")}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
            >
              Cerrar lote
            </button>
          )}
          <button
            disabled={listas.length === 0}
            onClick={() => navegar(`imprimir?ids=${listas.map((f) => f.id).join(",")}`)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Imprimir {listas.length > 0 ? `(${listas.length})` : ""}
          </button>
        </div>
      </div>

      {/* Los recuentos salen todos de la MISMA lista de fotos: no pueden
          contradecirse entre ellos ni con lo que se ve debajo. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>{resumen.total} fotos</span>
        {resumen.porRevisar > 0 && <span className="text-amber-300">{resumen.porRevisar} por revisar</span>}
        <span>{resumen.confirmadas} confirmadas</span>
        {resumen.impresas > 0 && <span>{resumen.impresas} impresas</span>}
        {resumen.descartadas > 0 && <span>{resumen.descartadas} descartadas</span>}
        {resumen.repetidas > 0 && (
          <span className="font-bold text-rose-300">
            ⚠ {resumen.repetidas} con el número repetido
          </span>
        )}
      </div>

      {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
      {msg && <div className="mb-3 text-sm text-emerald-400">{msg}</div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fotos.map((f) => {
          const repetida = f.estado !== "descartada" && esRepetida(f, repetidas);
          const valor = borrador[f.id] ?? "";
          const cambiado = valor !== serieEditable(f);
          return (
            <div
              key={f.id}
              className={`rounded-2xl border bg-slate-800 p-3 ${
                repetida ? "border-rose-500" : "border-slate-700"
              } ${f.estado === "descartada" ? "opacity-50" : ""}`}
            >
              <button
                onClick={() => setAmpliada(f.foto_url)}
                className="block w-full overflow-hidden rounded-xl bg-black"
                title="Ver la foto grande"
              >
                <img
                  src={f.foto_url}
                  alt="Flanco del neumático"
                  className="h-40 w-full object-contain"
                  loading="lazy"
                />
              </button>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={valor}
                  onChange={(e) =>
                    setBorrador({ ...borrador, [f.id]: normalizarSerie(e.target.value) })
                  }
                  placeholder="Número de serie"
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm tracking-wider text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  disabled={!valor}
                  onClick={() => accion(() => confirmarSerie(f.id, valor), "Número confirmado")}
                  className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  {f.estado === "confirmada" || f.estado === "impresa"
                    ? cambiado ? "Corregir" : "Confirmado"
                    : "Confirmar"}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {porRevisar(f) && f.dudoso && (
                  <span className="text-amber-300">Número poco claro: compruébalo</span>
                )}
                {porRevisar(f) && !f.serie_detectada && (
                  <span className="text-amber-300">Sin número leído: escríbelo a mano</span>
                )}
                {repetida && (
                  <span className="font-bold text-rose-300">
                    ⚠ POSIBLE DUPLICADO: este número está en otra foto
                  </span>
                )}
                {f.estado === "impresa" && <span className="text-slate-400">Ya impresa</span>}
                {f.estado === "descartada" && <span className="text-slate-400">Descartada</span>}
                {/* Lo que leyó la máquina, siempre a la vista cuando se ha
                    corregido: así se sabe si el lector acierta. */}
                {f.serie_detectada && f.serie_confirmada &&
                  f.serie_detectada !== f.serie_confirmada && (
                    <span className="text-slate-500">
                      La IA leyó <span className="font-mono">{f.serie_detectada}</span>
                    </span>
                  )}
                <span className="ml-auto">
                  {f.estado === "descartada" ? (
                    <button
                      onClick={() => accion(() => reabrirFoto(f.id), "Vuelve a estar por revisar")}
                      className="text-slate-400 underline hover:text-slate-200"
                    >
                      Recuperar
                    </button>
                  ) : (
                    <button
                      onClick={() => accion(() => descartarFoto(f.id), "Foto descartada")}
                      className="text-slate-400 underline hover:text-slate-200"
                    >
                      Descartar
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {fotos.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
          Este lote todavía no tiene fotos.
        </div>
      )}

      {/* La foto grande: sin poder leer el flanco, confirmar no sería
          confirmar. */}
      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setAmpliada(null)}
        >
          <img src={ampliada} alt="Flanco ampliado" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
