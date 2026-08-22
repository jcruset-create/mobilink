/**
 * Documentos emitidos de un expediente, dentro de su ficha.
 *
 * Un documento emitido es inmutable: no se corrige, se anula con motivo y se
 * emite otro. La pantalla lo dice así en vez de ofrecer un botón de «editar»
 * que no existe, porque es documentación legal y conviene que se note.
 */

import { useCallback, useEffect, useState } from "react";
import { Ban, FileDown, FilePlus2 } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import type { Documento, Emitible, TipoDocumento } from "../types";

const ETIQUETA: Record<TipoDocumento, string> = {
  justificante: "Justificante de transferencia",
  acuse_cliente: "Acuse de recibo — intransferibilidad",
  comunicacion_admin: "Comunicación a la administración",
};

function instante(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DocumentosExpediente({
  expedienteId,
  onCambio,
}: {
  expedienteId: string;
  /** Avisa a la ficha: emitir bloquea las firmas y cambia el estado. */
  onCambio: () => void;
}) {
  const { puede } = useTacografos();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [emitibles, setEmitibles] = useState<Emitible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Recarga la lista. Se usa tras emitir o anular; la carga inicial va aparte. */
  const cargar = useCallback(async () => {
    const r = await api.listarDocumentos(expedienteId);
    setDocumentos(r.documentos);
    setEmitibles(r.emitibles);
  }, [expedienteId]);

  /*
   * La carga inicial va inline y no llamando a `cargar`: el linter no puede
   * seguir la llamada a través del `useCallback` y la toma por un `setState`
   * síncrono dentro del efecto. Mismo patrón que `TacografosContext`.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api.listarDocumentos(expedienteId);
        if (!vivo) return;
        setDocumentos(r.documentos);
        setEmitibles(r.emitibles);
        setError(null);
      } catch (e) {
        if (vivo) {
          setError(e instanceof Error ? e.message : "No se han podido cargar los documentos");
        }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [expedienteId]);

  async function emitir(tipo: TipoDocumento) {
    setOcupado(tipo);
    setError(null);
    try {
      await api.emitirDocumento(expedienteId, tipo);
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido emitir el documento");
    } finally {
      setOcupado(null);
    }
  }

  async function anular(d: Documento) {
    // El motivo no es opcional: explicar por qué se retiró un documento firmado
    // es justo lo que pedirá una auditoría.
    const motivo = prompt("Motivo de la anulación:")?.trim();
    if (!motivo) return;
    setOcupado(d.id);
    setError(null);
    try {
      await api.anularDocumento(d.id, motivo);
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido anular");
    } finally {
      setOcupado(null);
    }
  }

  const vigentes = new Set(documentos.filter((d) => !d.anulado).map((d) => d.tipo));

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-800">
      <h2 className="bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
        Documentos
      </h2>
      <div className="p-3">
        {error && (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
            {error}
          </p>
        )}

        {puede("tacografos.documento.emit") && (
          <div className="mb-3 flex flex-wrap gap-2">
            {emitibles.map((e) => (
              <button
                key={e.tipo}
                onClick={() => void emitir(e.tipo)}
                disabled={ocupado !== null || vigentes.has(e.tipo)}
                title={
                  vigentes.has(e.tipo)
                    ? "Ya hay un documento vigente de este tipo. Anúlalo para emitir otro."
                    : undefined
                }
                className="flex items-center gap-1.5 rounded-lg border border-sky-500/50 px-3 py-2 text-[13px] text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
              >
                <FilePlus2 className="h-4 w-4" />
                {ocupado === e.tipo ? "Emitiendo…" : `Emitir ${e.etiqueta.toLowerCase()}`}
              </button>
            ))}
          </div>
        )}

        {cargando ? (
          <p className="text-[13px] text-slate-400">Cargando…</p>
        ) : documentos.length === 0 ? (
          <p className="text-[13px] text-slate-400">
            Todavía no se ha emitido ningún documento de este expediente.
          </p>
        ) : (
          <ul className="space-y-2">
            {documentos.map((d) => (
              <li
                key={d.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-[13px] ${
                  d.anulado ? "border-slate-800 text-slate-500" : "border-slate-700"
                }`}
              >
                <span className={d.anulado ? "line-through" : "font-semibold"}>
                  {ETIQUETA[d.tipo]}
                </span>
                <span className="text-slate-400">{instante(d.emitidoAtMs)}</span>
                <span className="text-[11px] text-slate-500">
                  v{d.plantillaVersion} · {d.hash.slice(0, 12)}…
                </span>
                {d.anulado && (
                  <span className="text-[11px] text-slate-400">Anulado: {d.motivoAnulacion}</span>
                )}
                <span className="ml-auto flex gap-2">
                  <a
                    href={api.urlDescarga(d.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-sky-400 hover:bg-slate-800"
                  >
                    <FileDown className="h-4 w-4" /> Abrir
                  </a>
                  {!d.anulado && puede("tacografos.documento.annul") && (
                    <button
                      onClick={() => void anular(d)}
                      disabled={ocupado !== null}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <Ban className="h-4 w-4" /> Anular
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
