/**
 * La bandeja de excepciones: lo que el módulo no ha podido archivar solo.
 *
 * Entra aquí lo que no se identificó, lo que se leyó con poca confianza, lo
 * duplicado y lo que falló. Cada fila trae lo que hace falta para decidir sin
 * abrir otra pantalla: qué número creyó leer, con qué confianza, de qué texto
 * lo sacó y qué bloc le tocaría.
 *
 * La regla que gobierna la pantalla es la del encargo: nunca se adivina. Si el
 * módulo no está seguro, lo pone aquí y espera.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Eye, RefreshCw, Replace, Trash2, Wand2 } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import {
  Aviso,
  Cabecera,
  ChipEstadoDocumento,
  Confianza,
  Dato,
  ErrorBox,
  Modal,
  TextField,
  btnMini,
  btnPrimary,
  btnSecondary,
} from "../components/ui";
import VisorDocumento from "../components/VisorDocumento";
import type { Documento } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function Pendientes() {
  const { puede, refrescarIndicadores, etiquetaMetodo } = useOrManuales();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ver, setVer] = useState<Documento | null>(null);
  const [asignar, setAsignar] = useState<Documento | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.documentosPendientes();
      setDocumentos(r.documentos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los documentos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(id: string, fn: () => Promise<unknown>) {
    setTrabajando(id);
    setError(null);
    try {
      await fn();
      await cargar();
      await refrescarIndicadores();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido completar la acción");
    } finally {
      setTrabajando(null);
    }
  }

  const gestiona = puede("or-manuales.documento.gestionar");

  return (
    <div>
      <Cabecera titulo="Documentos pendientes" descripcion="Lo que no se ha podido archivar solo. Nada se archiva por si acaso.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      {documentos.length === 0 && !cargando && (
        <Aviso tono="bien">No hay nada pendiente: todo lo escaneado está archivado en su OR.</Aviso>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        {documentos.map((d) => (
          <div key={d.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold text-slate-100">{d.nombreArchivo}</div>
                <div className="text-[11px] text-slate-500">
                  {fmtFechaHora(d.fechaCarga)} · {d.usuarioCargaNombre ?? "—"}
                  {d.paginaOrigen ? ` · pág. ${d.paginaOrigen} de ${d.nombreOriginal}` : ""}
                </div>
              </div>
              <ChipEstadoDocumento estado={d.estadoProcesamiento} />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato rotulo="Nº detectado" valor={d.ocrNumeroDetectado ?? "—"} />
              <Dato rotulo="Confianza" valor={<Confianza valor={d.ocrConfianza} />} />
              <Dato rotulo="Cómo se leyó" valor={etiquetaMetodo(d.ocrMetodo)} />
              <Dato rotulo="Bloc" valor={d.numeroBloc ?? "—"} />
            </div>

            {d.ocrTexto && (
              <p className="mt-2 truncate rounded-lg bg-slate-900/60 px-2 py-1 text-[12px] text-slate-400" title={d.ocrTexto}>
                Leído: «{d.ocrTexto}»
              </p>
            )}

            {d.errorMensaje && <p className="mt-2 text-[12px] text-rose-300">{d.errorMensaje}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              <button className={`${btnMini} flex items-center gap-1`} onClick={() => setVer(d)}>
                <Eye className="h-3.5 w-3.5" /> Ver
              </button>
              {gestiona && (
                <>
                  <button className={`${btnMini} flex items-center gap-1`} onClick={() => setAsignar(d)}>
                    <Wand2 className="h-3.5 w-3.5" /> Asignar OR
                  </button>
                  <button
                    className={`${btnMini} flex items-center gap-1`}
                    disabled={trabajando === d.id}
                    onClick={() => void accion(d.id, () => api.reprocesarDocumento(d.id))}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Volver a procesar
                  </button>
                  {d.estadoProcesamiento === "REVISION" && (
                    <button
                      className={`${btnMini} flex items-center gap-1`}
                      disabled={trabajando === d.id}
                      onClick={() => void accion(d.id, () => api.confirmarDocumento(d.id))}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                    </button>
                  )}
                  {d.estadoProcesamiento === "DUPLICADO" && (
                    <button
                      className={`${btnMini} flex items-center gap-1`}
                      disabled={trabajando === d.id}
                      onClick={() => void accion(d.id, () => api.sustituirDocumento(d.id))}
                    >
                      <Replace className="h-3.5 w-3.5" /> Sustituir al que hay
                    </button>
                  )}
                  <button
                    className={`${btnMini} flex items-center gap-1 text-rose-300`}
                    disabled={trabajando === d.id}
                    onClick={() => {
                      if (confirm(`¿Eliminar «${d.nombreArchivo}»? El fichero se conserva y queda en el histórico.`)) {
                        void accion(d.id, () => api.eliminarDocumento(d.id, "eliminado desde la bandeja"));
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {ver && (
        <Modal title={ver.nombreArchivo} onClose={() => setVer(null)} wide>
          <VisorDocumento documentoId={ver.id} nombre={ver.nombreArchivo} tipo={ver.tipoArchivo} />
        </Modal>
      )}

      {asignar && (
        <DialogoAsignar
          documento={asignar}
          onCerrar={() => setAsignar(null)}
          onAsignar={async (numeroOr) => {
            await accion(asignar.id, () => api.asignarOr(asignar.id, numeroOr));
            setAsignar(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Asignar a mano.
 *
 * Al escribir el número se busca su bloc y se enseña ANTES de confirmar: es la
 * comprobación que evita archivar la hoja en el sitio equivocado por un dedazo.
 */
function DialogoAsignar({
  documento,
  onCerrar,
  onAsignar,
}: {
  documento: Documento;
  onCerrar: () => void;
  onAsignar: (numeroOr: number) => Promise<void>;
}) {
  const [numero, setNumero] = useState(documento.ocrNumeroDetectado ? String(documento.ocrNumeroDetectado) : "");
  const [encontrado, setEncontrado] = useState<{ bloc: string; rango: string; estado: string } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const n = Number(numero);
    if (!Number.isInteger(n) || n <= 0) {
      setEncontrado(null);
      setAviso(null);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await api.buscar(String(n));
          if (!vivo) return;
          if (r.or && r.bloc) {
            setEncontrado({ bloc: r.bloc.numeroBloc, rango: `${r.bloc.orInicial} - ${r.bloc.orFinal}`, estado: r.or.estado });
            setAviso(r.or.documentoPrincipalId ? "Esta OR ya tiene documento: el nuevo se guardará como duplicado." : null);
          } else {
            setEncontrado(null);
            setAviso("Esa OR no pertenece a ningún bloc dado de alta.");
          }
        } catch {
          if (vivo) setEncontrado(null);
        } finally {
          if (vivo) setBuscando(false);
        }
      })();
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [numero]);

  const n = Number(numero);
  const valido = Number.isInteger(n) && n > 0 && Boolean(encontrado);

  return (
    <Modal
      title="Asignar la OR"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={!valido || guardando}
            onClick={async () => {
              setGuardando(true);
              try {
                await onAsignar(n);
              } finally {
                setGuardando(false);
              }
            }}
          >
            {guardando ? "Archivando…" : "Asignar y archivar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Número de OR" value={numero} onChange={setNumero} placeholder="1043" type="number" />

        {buscando && <p className="text-[13px] text-slate-400">Buscando su bloc…</p>}

        {encontrado && (
          <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-3 text-[13px] text-teal-100">
            <div className="text-lg font-black">OR {numero}</div>
            <div>
              Bloc {encontrado.bloc} · rango {encontrado.rango}
            </div>
          </div>
        )}

        {aviso && <Aviso tono="aviso">{aviso}</Aviso>}
      </div>
    </Modal>
  );
}
