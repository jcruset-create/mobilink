/**
 * La ficha del bloc: su rango, quién lo tiene, cuánto lleva escaneado, qué OR
 * faltan y todo lo que se ha hecho con él.
 *
 * Lo primero que se lee es el PROGRESO y la lista de lo que falta, porque es
 * la pregunta que trae a la gente a esta pantalla. La rejilla de las 25 OR va
 * justo debajo: cada casilla con su color y un clic para ver el papel.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, LogIn, LogOut, Pencil, RefreshCw, Trash2 } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import {
  Aviso,
  Cabecera,
  CheckField,
  ChipEstadoBloc,
  Dato,
  ErrorBox,
  LeyendaOrs,
  Modal,
  Progreso,
  RejillaOrs,
  TextAreaField,
  TextField,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "../components/ui";
import VisorDocumento from "../components/VisorDocumento";
import type { FichaBloc } from "../types";
import { ETIQUETA_ACCION } from "../types";
import { fmtFecha, fmtFechaHora } from "../../administracion/types";

const hoy = () => new Date().toISOString().slice(0, 10);

type Dialogo = "entregar" | "devolver" | "cerrar" | "editar" | "borrar" | null;

export default function Bloc() {
  const { id = "" } = useParams();
  const { puede, refrescarIndicadores } = useOrManuales();

  const [ficha, setFicha] = useState<FichaBloc | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [verDocumento, setVerDocumento] = useState<{ id: string; numeroOr: number } | null>(null);
  const navegar = useNavigate();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFicha(await api.bloc(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido abrir el bloc");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function tras(accion: () => Promise<FichaBloc>) {
    setError(null);
    try {
      setFicha(await accion());
      setDialogo(null);
      await refrescarIndicadores();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido completar la acción");
    }
  }

  if (cargando && !ficha) return <p className="text-sm text-slate-400">Cargando el bloc…</p>;
  if (!ficha) return <div>{error && <ErrorBox>{error}</ErrorBox>}</div>;

  const { bloc, ors, progreso, entregas, eventos } = ficha;
  const entregado = bloc.estado === "ENTREGADO";
  const cerrado = bloc.estado === "CERRADO";

  return (
    <div>
      <Cabecera titulo={`Bloc ${bloc.numeroBloc}`} descripcion={`OR ${bloc.orInicial} – ${bloc.orFinal}`}>
        <Link to="/or-manuales/blocs" className={`${btnSecondary} flex items-center gap-2`}>
          <ArrowLeft className="h-4 w-4" /> Blocs
        </Link>
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
        {puede("or-manuales.bloc.entregar") && !cerrado && !entregado && (
          <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setDialogo("entregar")}>
            <LogOut className="h-4 w-4" /> Entregar
          </button>
        )}
        {puede("or-manuales.bloc.entregar") && entregado && (
          <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setDialogo("devolver")}>
            <LogIn className="h-4 w-4" /> Registrar devolución
          </button>
        )}
        {puede("or-manuales.bloc.cerrar") && !cerrado && (
          <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => setDialogo("cerrar")}>
            <CheckCircle2 className="h-4 w-4" /> Cerrar bloc
          </button>
        )}
        {puede("or-manuales.bloc.create") && !cerrado && (
          <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => setDialogo("editar")}>
            <Pencil className="h-4 w-4" /> Editar
          </button>
        )}
        {puede("or-manuales.bloc.eliminar") && !cerrado && (
          <button className={`${btnDanger} flex items-center gap-2`} onClick={() => setDialogo("borrar")}>
            <Trash2 className="h-4 w-4" /> Borrar
          </button>
        )}
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        {/* Datos */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Situación</span>
            <ChipEstadoBloc estado={bloc.estado} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Dato rotulo="Responsable" valor={bloc.responsableNombre ?? "—"} />
            <Dato rotulo="Creado" valor={fmtFecha(bloc.fechaCreacion)} />
            <Dato rotulo="Entregado" valor={fmtFecha(bloc.fechaEntrega) || "—"} />
            <Dato rotulo="Devuelto" valor={fmtFecha(bloc.fechaDevolucion) || "—"} />
            <Dato rotulo="Cerrado" valor={bloc.closedAt ? fmtFechaHora(bloc.closedAt) : null} />
          </div>
          {bloc.observaciones && (
            <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-900/60 p-2 text-[13px] text-slate-300">{bloc.observaciones}</p>
          )}
        </div>

        {/* Progreso y lo que falta */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-black tabular-nums text-slate-100">
              {progreso.archivadas} / {progreso.total}
            </span>
            <span className="text-lg font-bold text-slate-400">{progreso.porcentaje} %</span>
          </div>
          <Progreso archivadas={progreso.archivadas} total={progreso.total} />

          {progreso.faltan.length > 0 ? (
            <div className="mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                OR pendientes ({progreso.faltan.length})
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {progreso.faltan.map((n) => (
                  <span key={n} className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[13px] font-bold tabular-nums text-rose-300">
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-emerald-300">Están las {progreso.total} hojas del bloc.</p>
          )}

          {progreso.enRevision > 0 && (
            <div className="mt-3">
              <Aviso tono="aviso">
                {progreso.enRevision} documento(s) de este bloc esperan a que alguien los confirme.{" "}
                <Link to="/or-manuales/pendientes" className="underline">
                  Revisarlos
                </Link>
              </Aviso>
            </div>
          )}
        </div>
      </div>

      {/* Las OR, una a una */}
      <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Las {progreso.total} OR del bloc</span>
          <LeyendaOrs />
        </div>
        <RejillaOrs ors={ors} onAbrir={(documentoId, numeroOr) => setVerDocumento({ id: documentoId, numeroOr })} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Custodia */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Entregas y devoluciones</div>
          {entregas.length === 0 ? (
            <p className="text-[13px] text-slate-500">Este bloc no ha salido del cajón.</p>
          ) : (
            <ul className="space-y-2">
              {entregas.map((e) => (
                <li key={e.id} className="rounded-lg bg-slate-900/60 p-2 text-[13px]">
                  <div className="font-semibold text-slate-200">{e.responsableNombre ?? "Sin responsable"}</div>
                  <div className="text-slate-400">
                    {fmtFecha(e.fechaEntrega)} → {e.fechaDevolucion ? fmtFecha(e.fechaDevolucion) : "sin devolver"}
                  </div>
                  {e.observaciones && <div className="text-slate-400">{e.observaciones}</div>}
                  {e.observacionesDevolucion && <div className="text-slate-400">Devolución: {e.observacionesDevolucion}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Histórico del bloc */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Histórico</div>
          {eventos.length === 0 ? (
            <p className="text-[13px] text-slate-500">Todavía no hay movimientos.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {eventos.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-2 border-b border-slate-700/40 py-1 text-[12px]">
                  <span className="font-semibold text-slate-200">{ETIQUETA_ACCION[ev.accion] ?? ev.accion}</span>
                  <span className="text-slate-500">{fmtFechaHora(ev.createdAt)}</span>
                  {ev.usuarioNombre && <span className="text-slate-400">{ev.usuarioNombre}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {dialogo === "entregar" && <DialogoEntregar onCerrar={() => setDialogo(null)} onGuardar={(d) => tras(() => api.entregarBloc(id, d))} />}
      {dialogo === "devolver" && <DialogoDevolver onCerrar={() => setDialogo(null)} onGuardar={(d) => tras(() => api.devolverBloc(id, d))} />}
      {dialogo === "editar" && (
        <DialogoEditar bloc={bloc} onCerrar={() => setDialogo(null)} onGuardar={(d) => tras(() => api.editarBloc(id, d))} />
      )}
      {dialogo === "borrar" && (
        <DialogoBorrar
          bloc={bloc}
          progreso={progreso}
          onCerrar={() => setDialogo(null)}
          onBorrar={async (motivo) => {
            setError(null);
            try {
              await api.eliminarBloc(id, { confirmar: true, motivo });
              await refrescarIndicadores();
              navegar("/or-manuales/blocs");
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se ha podido borrar el bloc");
              setDialogo(null);
            }
          }}
        />
      )}
      {dialogo === "cerrar" && (
        <DialogoCerrar
          progreso={progreso}
          onCerrar={() => setDialogo(null)}
          onGuardar={(d) => tras(() => api.cerrarBloc(id, d))}
        />
      )}

      {verDocumento && (
        <Modal title={`OR ${verDocumento.numeroOr}`} onClose={() => setVerDocumento(null)} wide>
          <VisorDocumento documentoId={verDocumento.id} nombre={`OR_${verDocumento.numeroOr}.pdf`} />
        </Modal>
      )}
    </div>
  );
}

/* ── Los diálogos ────────────────────────────────────────────────────────── */

function DialogoEntregar({
  onCerrar,
  onGuardar,
}: {
  onCerrar: () => void;
  onGuardar: (d: { responsableNombre: string; fechaEntrega: string; observaciones?: string }) => void;
}) {
  const [responsable, setResponsable] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState("");

  return (
    <Modal
      title="Entregar el bloc"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={!responsable.trim()}
            onClick={() => onGuardar({ responsableNombre: responsable.trim(), fechaEntrega: fecha, observaciones: observaciones.trim() || undefined })}
          >
            Entregar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Responsable" value={responsable} onChange={setResponsable} placeholder="Quién se lleva el bloc" />
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Fecha de entrega</span>
          <input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <TextAreaField label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
      </div>
    </Modal>
  );
}

function DialogoDevolver({
  onCerrar,
  onGuardar,
}: {
  onCerrar: () => void;
  onGuardar: (d: { fechaDevolucion: string; observaciones?: string }) => void;
}) {
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState("");

  return (
    <Modal
      title="Registrar la devolución"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => onGuardar({ fechaDevolucion: fecha, observaciones: observaciones.trim() || undefined })}>
            Registrar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Fecha de devolución</span>
          <input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <TextAreaField label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
        <Aviso tono="info">
          Al devolverlo, el bloc queda pendiente de escaneo o incompleto según las hojas que falten. El estado se calcula solo.
        </Aviso>
      </div>
    </Modal>
  );
}

function DialogoCerrar({
  progreso,
  onCerrar,
  onGuardar,
}: {
  progreso: FichaBloc["progreso"];
  onCerrar: () => void;
  onGuardar: (d: { observaciones?: string }) => void;
}) {
  const [observaciones, setObservaciones] = useState("");
  const puedeCerrarse = progreso.pendientes === 0 && progreso.enRevision === 0 && progreso.duplicadas === 0;

  return (
    <Modal
      title="Cerrar el bloc"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!puedeCerrarse} onClick={() => onGuardar({ observaciones: observaciones.trim() || undefined })}>
            Cerrar el bloc
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {puedeCerrarse ? (
          <Aviso tono="bien">Están las {progreso.total} hojas y no queda nada por revisar.</Aviso>
        ) : (
          <Aviso tono="mal">
            {progreso.pendientes > 0
              ? `Faltan ${progreso.pendientes} OR por archivar: ${progreso.faltan.join(", ")}.`
              : "Hay documentos pendientes de revisar en este bloc."}
          </Aviso>
        )}
        <TextAreaField label="Observaciones del cierre" value={observaciones} onChange={setObservaciones} rows={2} />
        <p className="text-[12px] text-slate-400">
          Un bloc cerrado deja de recalcularse y no admite documentos nuevos. Sus hojas siguen consultándose en el histórico.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Editar el bloc.
 *
 * El NÚMERO sí se puede cambiar —los blocs se renumeran cuando se borra uno de
 * prueba—; el RANGO de OR no aparece porque no se toca: cambiarlo dejaría
 * huérfanas las hojas ya archivadas. Un rango mal puesto se arregla borrando el
 * bloc y creándolo bien, y por eso el botón de borrar está al lado.
 */
function DialogoEditar({
  bloc,
  onCerrar,
  onGuardar,
}: {
  bloc: FichaBloc["bloc"];
  onCerrar: () => void;
  onGuardar: (d: { numeroBloc: string; responsableNombre: string; observaciones: string }) => void;
}) {
  const [numero, setNumero] = useState(bloc.numeroBloc);
  const [responsable, setResponsable] = useState(bloc.responsableNombre ?? "");
  const [observaciones, setObservaciones] = useState(bloc.observaciones ?? "");

  return (
    <Modal
      title={`Editar el bloc ${bloc.numeroBloc}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={!numero.trim()}
            onClick={() =>
              onGuardar({ numeroBloc: numero.trim(), responsableNombre: responsable.trim(), observaciones: observaciones.trim() })
            }
          >
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Número de bloc" value={numero} onChange={setNumero} placeholder="001" />
        <TextField label="Responsable" value={responsable} onChange={setResponsable} placeholder="Quién lo tiene" />
        <TextAreaField label="Observaciones" value={observaciones} onChange={setObservaciones} rows={3} />
        <Aviso tono="info">
          El rango de OR ({bloc.orInicial} – {bloc.orFinal}) no se puede cambiar: las hojas ya archivadas se quedarían sin
          su sitio. Si el rango está mal, borra el bloc y vuelve a crearlo.
        </Aviso>
      </div>
    </Modal>
  );
}

/**
 * Borrar el bloc.
 *
 * Se enseña ANTES de borrar lo que se va a perder —las OR y las hojas que
 * tuviera archivadas— porque es la única operación del módulo que quita papel
 * del archivo. Lo único que sobrevive es el histórico.
 */
function DialogoBorrar({
  bloc,
  progreso,
  onCerrar,
  onBorrar,
}: {
  bloc: FichaBloc["bloc"];
  progreso: FichaBloc["progreso"];
  onCerrar: () => void;
  onBorrar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [borrando, setBorrando] = useState(false);

  return (
    <Modal
      title={`Borrar el bloc ${bloc.numeroBloc}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className={btnDanger}
            disabled={!confirmado || borrando}
            onClick={() => {
              setBorrando(true);
              onBorrar(motivo.trim());
            }}
          >
            {borrando ? "Borrando…" : "Borrar el bloc"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Aviso tono="mal">
          Se borran el bloc <b>{bloc.numeroBloc}</b> y sus {progreso.total} OR ({bloc.orInicial} – {bloc.orFinal}).
          {progreso.archivadas > 0 && (
            <>
              {" "}
              Las <b>{progreso.archivadas} hoja(s) ya archivadas</b> se retiran con él.
            </>
          )}{" "}
          El número queda libre para otro bloc.
        </Aviso>
        <TextField label="Motivo (queda en el histórico)" value={motivo} onChange={setMotivo} placeholder="alta de prueba" />
        <CheckField label={`Sí, borrar el bloc ${bloc.numeroBloc}`} checked={confirmado} onChange={setConfirmado} />
        <p className="text-[12px] text-slate-400">
          El histórico conserva que este bloc existió, quién lo borró y cuándo. Los ficheros escaneados no se destruyen.
        </p>
      </div>
    </Modal>
  );
}
