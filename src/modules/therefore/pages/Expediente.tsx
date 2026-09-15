/**
 * El detalle del expediente.
 *
 * Cabecera con lo que hay que saber de un vistazo —qué piden, cómo de urgente
 * es, cuánto lleva abierto— y debajo las pestañas: resumen, actuaciones,
 * albaranes analizados, validaciones, correos e histórico.
 *
 * Las de albaranes y validaciones cargan aparte y no con la ficha. Es a
 * propósito: el análisis puede estar todavía en la cola cuando se abre el
 * expediente, y quien sólo quiere ver qué se pide no tiene por qué esperar a
 * que se lea un PDF de sesenta páginas.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Upload } from "lucide-react";
import * as api from "../services/api";
import { textoActuacion } from "../services/bandeja";
import { useTherefore } from "../contexts/ThereforeContext";
import {
  Aviso,
  ChipAnalisis,
  ChipEstado,
  ChipEstadoActuacion,
  ChipPrioridad,
  Dato,
  ErrorBox,
  Modal,
  Pill,
  SelectField,
  TextAreaField,
  TextField,
  btnMini,
  btnPrimary,
  btnSecondary,
} from "../components/ui";
import AlbaranAnalizadoCard from "../components/AlbaranAnalizado";
import ValidacionesLista from "../components/Validaciones";
import { esHistorico, estadoParaPantalla } from "../services/analisis";
import { COLOR_NOTIFICACION, ETIQUETA_NOTIFICACION, ETIQUETA_TIPO } from "../types";
import type { Actuacion, Adjunto, AnalisisDeExpediente, ConsultaErp, Ficha, Notificacion } from "../types";
import { fmtFecha, fmtFechaHora } from "../../administracion/types";
import { aCentimos, eurosConSigno } from "../../cash/utils/money";

const PESTANAS = ["Resumen", "Actuaciones", "Albaranes", "Validaciones", "Correos", "Histórico"] as const;

/**
 * El umbral por debajo del cual una celda se enseña como dudosa.
 *
 * Es el valor por defecto del servidor (`albaran.umbral_confianza_campo`). El
 * panel no lee la configuración —sólo la ve quien puede editarla— así que usa
 * el mismo número; el que decide de verdad es el del servidor, que es quien
 * levanta la validación CAMPOS_CRITICOS.
 */
const UMBRAL_CAMPO = 0.85;
type PestanaDetalle = (typeof PESTANAS)[number];

export default function Expediente() {
  const { id = "" } = useParams();
  const { puede, erpDisponible } = useTherefore();

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<PestanaDetalle>("Resumen");
  const [anadiendo, setAnadiendo] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFicha(await api.obtenerExpediente(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido abrir el expediente");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando && !ficha) return <p className="text-[13px] text-slate-400">Cargando…</p>;
  if (error && !ficha) return <ErrorBox>{error}</ErrorBox>;
  if (!ficha) return null;

  const { expediente: e, actuaciones, eventos } = ficha;
  const vivas = actuaciones.filter((a) => a.estado !== "DESCARTADA");
  const terminado = e.estado === "RESUELTO" || e.estado === "CERRADO";

  const titulo =
    vivas.length === 1
      ? textoActuacion(vivas[0])
      : vivas.length > 1
        ? `${vivas.length} actuaciones`
        : ETIQUETA_TIPO[e.tipo] ?? e.tipo;

  return (
    <div>
      <Link
        to="/therefore/bandeja"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" /> Bandeja
      </Link>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Cabecera */}
      <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-black">{e.numero}</h1>
          <span className="text-sm text-slate-300">{titulo}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ChipPrioridad prioridad={e.prioridad} manual={e.prioridadManual !== null} />
            <ChipEstado estado={e.estado} />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          {e.urgente && (
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 font-bold text-rose-300">
              URGENTE
            </span>
          )}
          {e.numeroReclamaciones > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
              {e.numeroReclamaciones === 1
                ? "1 reclamación"
                : `${e.numeroReclamaciones} reclamaciones`}
            </span>
          )}
          {e.requiereRevision && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
              Requiere revisión
            </span>
          )}
          <span className="text-slate-400">
            Abierto desde el {fmtFecha(e.fechaPrimeraNotificacion)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {puede("therefore.actuacion.manage") && !terminado && (
            <button onClick={() => setAnadiendo(true)} className={btnSecondary}>
              <Plus className="mr-1 inline h-4 w-4" /> Añadir actuación
            </button>
          )}
          {(puede("therefore.actuacion.manage") || puede("therefore.expediente.reopen")) && (
            <button onClick={() => setCambiandoEstado(true)} className={btnSecondary}>
              Cambiar estado
            </button>
          )}
          {puede("therefore.expediente.edit") && (
            <PrioridadManual expediente={e} onHecho={setFicha} />
          )}
        </div>
      </div>

      {/* Pestañas */}
      <div className="mb-3 flex gap-1 border-b border-slate-800">
        {PESTANAS.map((p) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[13px] ${
              pestana === p
                ? "border-sky-500 font-semibold text-sky-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {p}
            {p === "Actuaciones" && vivas.length > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                {vivas.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {pestana === "Resumen" && <Resumen ficha={ficha} />}
      {pestana === "Actuaciones" && (
        <Actuaciones
          ficha={ficha}
          erpDisponible={erpDisponible}
          puedeGestionar={puede("therefore.actuacion.manage")}
          onCambio={setFicha}
          onError={setError}
        />
      )}
      {pestana === "Albaranes" && (
        <Albaranes expedienteId={e.id} actuaciones={ficha.actuaciones} puedeReanalizar={puede("therefore.actuacion.manage")} />
      )}
      {pestana === "Validaciones" && <ValidacionesDelExpediente expedienteId={e.id} />}
      {pestana === "Correos" && <Correos expedienteId={e.id} />}
      {pestana === "Histórico" && <Historico eventos={eventos} />}

      {anadiendo && (
        <NuevaActuacion
          expedienteId={e.id}
          onCerrar={() => setAnadiendo(false)}
          onHecho={(f, nueva) => {
            setFicha(f);
            setAnadiendo(false);
            if (!nueva) {
              setError("Esa actuación ya estaba en el expediente; no se ha duplicado.");
            }
          }}
        />
      )}

      {cambiandoEstado && (
        <CambiarEstado
          ficha={ficha}
          onCerrar={() => setCambiandoEstado(false)}
          onHecho={(f) => {
            setFicha(f);
            setCambiandoEstado(false);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ── Correos ─────────────────────────────────────────────────────────────── */

/**
 * Los correos que han ido cayendo en este expediente, con su texto entero.
 *
 * Se piden aparte de la ficha y no con ella: son la parte más pesada —el cuerpo
 * completo de cada correo— y la mayoría de las veces nadie los abre. Cargarlos
 * siempre haría lenta la pantalla que sí se usa a diario.
 *
 * El texto se enseña TAL Y COMO llegó, sin recortar. Es la única prueba de qué
 * se pidió exactamente, y es lo que hay que mirar cuando una actuación no
 * cuadra con lo que el sistema entendió.
 */
/**
 * Carga el análisis del expediente. Devuelve también un recargador, porque
 * adjuntar un PDF o pedir un reanálisis cambia lo que hay que enseñar.
 */
function useAnalisis(expedienteId: string) {
  const [datos, setDatos] = useState<AnalisisDeExpediente | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.analisisDeExpediente(expedienteId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el análisis");
    }
  }, [expedienteId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return { datos, error, cargar };
}

function Albaranes({
  expedienteId,
  actuaciones,
  puedeReanalizar,
}: {
  expedienteId: string;
  actuaciones: Actuacion[];
  puedeReanalizar: boolean;
}) {
  const { datos, error, cargar } = useAnalisis(expedienteId);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  async function subir(archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(true);
    setErrorSubida(null);
    try {
      await api.subirDocumento(expedienteId, archivo);
      /*
       * El análisis lo hace un worker cada quince segundos, así que justo
       * después de subir todavía no hay nada. Se recarga igualmente —la fila
       * aparece «en cola», que es información— y quien mire volverá a entrar.
       */
      await cargar();
    } catch (e) {
      setErrorSubida(e instanceof Error ? e.message : "No se ha podido subir el documento");
    } finally {
      setSubiendo(false);
    }
  }

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!datos) return <p className="text-[13px] text-slate-400">Cargando…</p>;

  const vigentes = datos.albaranes.filter((a) => !esHistorico(a));
  const enCurso = vigentes.filter((a) => estadoParaPantalla(a).enCurso);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btnSecondary} cursor-pointer`}>
          <Upload className="mr-1 inline h-3 w-3" />
          {subiendo ? "Subiendo…" : "Adjuntar PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={subiendo}
            onChange={(ev) => void subir(ev.target.files?.[0])}
          />
        </label>
        <button onClick={() => void cargar()} className={btnMini}>
          Actualizar
        </button>
        {enCurso.length > 0 && (
          <span className="text-[12px] text-slate-400">
            {enCurso.length} en cola: el análisis va por detrás, vuelve en un momento.
          </span>
        )}
      </div>

      {errorSubida && <ErrorBox>{errorSubida}</ErrorBox>}

      {vigentes.length === 0 && (
        <Aviso tono="info">
          Ninguna actuación de este expediente pide un albarán, o todavía no ha llegado ninguna.
        </Aviso>
      )}

      {vigentes.map((a) => (
        <div key={a.id} className="space-y-2">
          <AlbaranAnalizadoCard
            albaran={a}
            actuacion={actuaciones.find((x) => x.id === a.actuacionId)}
            umbralCampo={UMBRAL_CAMPO}
            puedeReanalizar={puedeReanalizar}
            onReanalizado={() => void cargar()}
          />
        </div>
      ))}

      {datos.documentos.length > 0 && (
        <article className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <p className="mb-2 text-[13px] font-bold">Documentos</p>
          <ul className="space-y-1 text-[12px] text-slate-400">
            {datos.documentos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{d.hashArchivo.slice(0, 8)}</span>
                <span>{d.numeroDocumento ?? "(sin número)"}</span>
                {d.validacion === "DISCREPANCIA" && (
                  <Pill className="bg-amber-500/15 text-amber-300">No es la factura del correo</Pill>
                )}
              </li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

function ValidacionesDelExpediente({ expedienteId }: { expedienteId: string }) {
  const { datos, error } = useAnalisis(expedienteId);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!datos) return <p className="text-[13px] text-slate-400">Cargando…</p>;

  const vigentes = datos.albaranes.filter((a) => !esHistorico(a));
  if (vigentes.length === 0) {
    return <Aviso tono="info">No hay ningún albarán analizado todavía.</Aviso>;
  }

  return (
    <div className="space-y-3">
      {vigentes.map((a) => (
        <article key={a.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold">Albarán {a.numeroSolicitado}</span>
            <ChipAnalisis estado={a.estadoAnalisis ?? a.estadoProceso} />
          </header>
          <ValidacionesLista validaciones={a.validaciones} />
        </article>
      ))}
    </div>
  );
}

function Correos({ expedienteId }: { expedienteId: string }) {
  const [datos, setDatos] = useState<{ notificaciones: Notificacion[]; adjuntos: Adjunto[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .notificacionesDe(expedienteId)
      .then((d) => vivo && setDatos(d))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se han podido cargar"));
    return () => {
      vivo = false;
    };
  }, [expedienteId]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!datos) return <p className="text-[13px] text-slate-400">Cargando…</p>;
  if (datos.notificaciones.length === 0) {
    return (
      <Aviso tono="info">
        Este expediente no tiene correos: se abrió a mano. Los que lleguen de Therefore se irán
        añadiendo aquí.
      </Aviso>
    );
  }

  return (
    <div className="space-y-3">
      {datos.notificaciones.map((n) => {
        const suyos = datos.adjuntos.filter((a) => a.notificacionId === n.id);
        return (
          <article key={n.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <Pill className={COLOR_NOTIFICACION[n.tipoNotificacion] ?? "bg-slate-700 text-slate-400"}>
                {ETIQUETA_NOTIFICACION[n.tipoNotificacion] ?? n.tipoNotificacion}
              </Pill>
              <span className="text-[13px] font-bold">{n.asunto || "(sin asunto)"}</span>
              <span className="text-[12px] text-slate-500">
                {new Date(n.fechaEmail).toLocaleString("es-ES", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </header>
            <p className="mb-2 text-[12px] text-slate-400">
              De {n.remitente || "—"}
              {n.personaSolicitante ? ` · ${n.personaSolicitante}` : ""}
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 text-[12px] text-slate-300">
              {n.textoOriginal}
            </pre>
            {suyos.length > 0 && (
              <p className="mt-2 text-[12px] text-slate-400">
                Adjuntos: {suyos.map((a) => a.nombreArchivo || a.hashArchivo.slice(0, 8)).join(", ")}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ── Resumen ─────────────────────────────────────────────────────────────── */

function Resumen({ ficha }: { ficha: Ficha }) {
  const e = ficha.expediente;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Dato rotulo="Tipo" valor={ETIQUETA_TIPO[e.tipo] ?? e.tipo} />
        <Dato
          rotulo="Empresa"
          valor={[e.empresaCodigo, e.empresaNombre].filter(Boolean).join(" · ")}
        />
        <Dato
          rotulo="Proveedor"
          valor={[e.proveedorCodigo, e.proveedorNombre].filter(Boolean).join(" · ")}
        />
        <Dato rotulo="Cuenta contable" valor={e.cuentaContable} />
        <Dato rotulo="Factura" valor={e.facturaNumero} />
        <Dato rotulo="Fecha de factura" valor={e.facturaFecha ? fmtFecha(e.facturaFecha) : null} />
        <Dato
          rotulo="Importe"
          valor={
            e.importeCentimos !== null ? (
              <span className="tabular-nums">{eurosConSigno(e.importeCentimos)}</span>
            ) : null
          }
        />
        <Dato rotulo="Caso de Therefore" valor={e.casoReferencia} />
        <Dato rotulo="Prioridad (score)" valor={String(e.prioridadScore)} />
        <Dato rotulo="Notificaciones" valor={String(e.numeroNotificaciones)} />
        <Dato rotulo="Primera solicitud" valor={fmtFechaHora(e.fechaPrimeraNotificacion)} />
        <Dato rotulo="Última notificación" valor={fmtFechaHora(e.fechaUltimaNotificacion)} />
        <Dato
          rotulo="Resuelto"
          valor={e.fechaResolucion ? fmtFechaHora(e.fechaResolucion) : null}
        />
      </div>

      {e.observaciones && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Observaciones
          </div>
          <p className="whitespace-pre-wrap text-[13px] text-slate-200">{e.observaciones}</p>
        </div>
      )}

      {e.numeroNotificaciones === 0 && (
        <div className="mt-4">
          <Aviso tono="info">
            Este expediente se creó a mano: todavía no tiene ningún correo de Therefore detrás.
          </Aviso>
        </div>
      )}
    </div>
  );
}

/* ── Actuaciones ─────────────────────────────────────────────────────────── */

function Actuaciones({
  ficha,
  erpDisponible,
  puedeGestionar,
  onCambio,
  onError,
}: {
  ficha: Ficha;
  erpDisponible: boolean;
  puedeGestionar: boolean;
  onCambio: (f: Ficha) => void;
  onError: (m: string | null) => void;
}) {
  if (ficha.actuaciones.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center text-[13px] text-slate-400">
        Este expediente todavía no tiene actuaciones. Añade la primera para decir qué hay que hacer.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ficha.actuaciones.map((a) => (
        <TarjetaActuacion
          key={a.id}
          actuacion={a}
          erpDisponible={erpDisponible}
          puedeGestionar={puedeGestionar}
          onCambio={onCambio}
          onError={onError}
        />
      ))}
    </div>
  );
}

const VERBOS: Record<string, { etiqueta: string; desde: string[]; pideMotivo?: boolean }> = {
  iniciar: { etiqueta: "Iniciar", desde: ["PENDIENTE", "BLOQUEADA"] },
  resolver: { etiqueta: "Resolver", desde: ["PENDIENTE", "EN_PROCESO", "BLOQUEADA"] },
  bloquear: { etiqueta: "Bloquear", desde: ["PENDIENTE", "EN_PROCESO"], pideMotivo: true },
  descartar: {
    etiqueta: "Descartar",
    desde: ["PENDIENTE", "EN_PROCESO", "BLOQUEADA"],
    pideMotivo: true,
  },
  reabrir: { etiqueta: "Reabrir", desde: ["RESUELTA"] },
};

function TarjetaActuacion({
  actuacion: a,
  erpDisponible,
  puedeGestionar,
  onCambio,
  onError,
}: {
  actuacion: Actuacion;
  erpDisponible: boolean;
  puedeGestionar: boolean;
  onCambio: (f: Ficha) => void;
  onError: (m: string | null) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  // Lo guardado en la actuación, o lo recién consultado: el último manda.
  const [erp, setErp] = useState<ConsultaErp | null>((a.erpEstado as ConsultaErp | null) ?? null);

  async function consultarErp() {
    setConsultando(true);
    onError(null);
    try {
      setErp(await api.consultarErp(a.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido consultar el ERP");
    } finally {
      setConsultando(false);
    }
  }

  async function mover(verbo: string, datos: { motivo?: string; resultado?: string; erpReferencia?: string } = {}) {
    setOcupado(true);
    onError(null);
    try {
      onCambio(await api.moverActuacion(a.id, verbo, datos));
      setPidiendo(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido mover la actuación");
    } finally {
      setOcupado(false);
    }
  }

  const disponibles = Object.entries(VERBOS).filter(([, v]) => v.desde.includes(a.estado));

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold">{a.albaranSolicitado ?? "—"}</span>
        <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[11px] font-semibold">
          {a.tipoAccion}
        </span>
        {a.indicadorAdicional && (
          /*
           * No se sabe qué significa «T2». Se enseña tal cual y con su rótulo,
           * en vez de esconderlo o de traducirlo a algo inventado.
           */
          <span
            className="rounded-md bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300"
            title="Indicador que venía en el correo. No se interpreta."
          >
            {a.indicadorAdicional}
          </span>
        )}
        {a.importeCentimos !== null && (
          <span className="text-[12px] tabular-nums text-slate-400">
            {eurosConSigno(a.importeCentimos)}
          </span>
        )}
        <div className="ml-auto">
          <ChipEstadoActuacion estado={a.estado} />
        </div>
      </div>

      {(a.resultado || a.erpReferencia || a.observaciones) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Dato rotulo="Resultado" valor={a.resultado} />
          <Dato rotulo="Referencia del ERP" valor={a.erpReferencia} />
          <Dato rotulo="Observaciones" valor={a.observaciones} />
        </div>
      )}

      {/*
        Tres respuestas que no son lo mismo y se enseñan distinto: no se pudo
        consultar (null), el ERP dijo que no consta (existe: false), y aquí
        está. Y cuando hay papel y ERP, la comparación línea a línea: no se
        dice quién tiene razón, se enseñan los dos valores y decide quien mira.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {erpDisponible && a.albaranSolicitado && puedeGestionar ? (
          <button onClick={() => void consultarErp()} className={btnMini} disabled={consultando}>
            {consultando ? "Consultando…" : erp ? "Volver a consultar en el ERP" : "Consultar en el ERP"}
          </button>
        ) : (
          <span>{erpDisponible ? "Consulta al ERP disponible" : "Sin datos del ERP"}</span>
        )}
        {erp && (
          <span>
            {erp.estado === null
              ? `No se ha podido consultar (${erp.fuente}).`
              : erp.estado.existe
                ? `Según el ERP (${erp.fuente}) a las ${fmtFechaHora(erp.estado.consultadoAt)}: grabado${erp.estado.contabilizado ? " y contabilizado" : ""}${erp.estado.importeCentimos !== null ? `, ${eurosConSigno(erp.estado.importeCentimos)}` : ""}${erp.estado.facturaAsociada ? `, factura ${erp.estado.facturaAsociada}` : ""}.`
                : `No consta en el ERP (${erp.fuente}) a las ${fmtFechaHora(erp.estado.consultadoAt)}.`}
          </span>
        )}
      </div>
      {erp?.comparacion && <ComparacionErpBloque comparacion={erp.comparacion} />}

      {puedeGestionar && disponibles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {disponibles.map(([verbo, v]) => (
            <button
              key={verbo}
              className={btnMini}
              disabled={ocupado}
              onClick={() => (v.pideMotivo || verbo === "resolver" ? setPidiendo(verbo) : void mover(verbo))}
            >
              {v.etiqueta}
            </button>
          ))}
        </div>
      )}

      {pidiendo && (
        <PedirDatos
          verbo={pidiendo}
          onCerrar={() => setPidiendo(null)}
          onConfirmar={(datos) => void mover(pidiendo, datos)}
          ocupado={ocupado}
        />
      )}
    </div>
  );
}

/** Pide lo que hace falta antes de mover: el motivo, o el resultado y la referencia. */
function PedirDatos({
  verbo,
  onCerrar,
  onConfirmar,
  ocupado,
}: {
  verbo: string;
  onCerrar: () => void;
  onConfirmar: (datos: { motivo?: string; resultado?: string; erpReferencia?: string }) => void;
  ocupado: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState("");
  const [erpReferencia, setErpReferencia] = useState("");
  const resolviendo = verbo === "resolver";

  return (
    <Modal
      title={VERBOS[verbo]?.etiqueta ?? verbo}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={ocupado || (!resolviendo && !motivo.trim())}
            onClick={() =>
              onConfirmar(resolviendo ? { resultado, erpReferencia } : { motivo })
            }
          >
            Confirmar
          </button>
        </div>
      }
    >
      {resolviendo ? (
        <div className="space-y-3">
          <TextField label="Qué se ha hecho" value={resultado} onChange={setResultado} />
          <TextField
            label="Referencia en el ERP"
            value={erpReferencia}
            onChange={setErpReferencia}
            placeholder="Nº de albarán o de asiento"
          />
        </div>
      ) : (
        <TextAreaField
          label="Motivo"
          value={motivo}
          onChange={setMotivo}
          rows={3}
          placeholder="Quien se encuentre esto mañana necesita saber por qué."
        />
      )}
    </Modal>
  );
}

function NuevaActuacion({
  expedienteId,
  onCerrar,
  onHecho,
}: {
  expedienteId: string;
  onCerrar: () => void;
  onHecho: (f: Ficha, nueva: boolean) => void;
}) {
  const { vocabulario } = useTherefore();
  const [tipoAccion, setTipoAccion] = useState("GRABAR");
  const [albaran, setAlbaran] = useState("");
  const [importe, setImporte] = useState("");
  const [indicador, setIndicador] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const centimos = importe.trim() ? aCentimos(importe) : null;
  const importeMal = importe.trim().length > 0 && centimos === null;

  async function guardar() {
    if (importeMal) {
      setError("El importe no se entiende. Escríbelo como 199,95.");
      return;
    }
    setGuardando(true);
    try {
      const r = await api.anadirActuacion(expedienteId, {
        tipoAccion,
        albaranSolicitado: albaran,
        importeCentimos: centimos,
        indicadorAdicional: indicador,
      });
      onHecho(r, r.nueva);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido añadir la actuación");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Añadir actuación"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando}>
            {guardando ? "Añadiendo…" : "Añadir"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Acción" value={tipoAccion} onChange={setTipoAccion}>
          {(vocabulario?.acciones ?? ["GRABAR"]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </SelectField>
        <TextField label="Albarán" value={albaran} onChange={setAlbaran} placeholder="0501234" />
        <TextField label="Importe (€)" value={importe} onChange={setImporte} placeholder="199,95" />
        <TextField
          label="Indicador del correo"
          value={indicador}
          onChange={setIndicador}
          placeholder="T2"
        />
      </div>
      <p className="mt-2 text-[12px] text-slate-500">
        El indicador se guarda tal cual, sin interpretarlo.
      </p>
    </Modal>
  );
}

/* ── Estado y prioridad ──────────────────────────────────────────────────── */

function CambiarEstado({
  ficha,
  onCerrar,
  onHecho,
  onError,
}: {
  ficha: Ficha;
  onCerrar: () => void;
  onHecho: (f: Ficha) => void;
  onError: (m: string | null) => void;
}) {
  const { vocabulario } = useTherefore();
  const actual = ficha.expediente.estado;
  const [estado, setEstado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const posibles = (vocabulario?.estados ?? []).filter((e) => e !== actual);

  async function guardar() {
    if (!estado) return;
    setGuardando(true);
    onError(null);
    try {
      onHecho(await api.cambiarEstado(ficha.expediente.id, estado, motivo));
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido cambiar el estado");
      onCerrar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={`Estado de ${ficha.expediente.numero}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando || !estado}>
            Cambiar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <SelectField label={`Ahora está en ${actual}. Pasa a…`} value={estado} onChange={setEstado}>
          <option value="">Elige un estado</option>
          {posibles.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Motivo" value={motivo} onChange={setMotivo} rows={3} />
        <Aviso tono="info">
          Bloquear y reabrir piden motivo. No se puede dar por resuelto un expediente con
          actuaciones obligatorias sin resolver: resuélvelas o descártalas antes.
        </Aviso>
      </div>
    </Modal>
  );
}

function PrioridadManual({
  expediente,
  onHecho,
}: {
  expediente: Ficha["expediente"];
  onHecho: (f: Ficha) => void;
}) {
  const { vocabulario } = useTherefore();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(expediente.prioridadManual ?? "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      onHecho(
        await api.editarExpediente(expediente.id, {
          prioridadManual: valor as "" | "BAJA" | "NORMAL" | "ALTA" | "CRITICA",
        })
      );
      setAbierto(false);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <button onClick={() => setAbierto(true)} className={btnSecondary}>
        Prioridad
      </button>
      {abierto && (
        <Modal
          title="Prioridad"
          onClose={() => setAbierto(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setAbierto(false)} className={btnSecondary}>
                Cancelar
              </button>
              <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando}>
                Guardar
              </button>
            </div>
          }
        >
          <SelectField label="Fijar a mano" value={valor} onChange={setValor}>
            <option value="">Dejar que la calcule el sistema</option>
            {(vocabulario?.prioridades ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectField>
          <p className="mt-2 text-[12px] text-slate-500">
            La automática sale de los días abierto, las reclamaciones, la urgencia y las tareas
            vencidas. Ahora mismo puntúa {expediente.prioridadScore}.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ── Histórico ───────────────────────────────────────────────────────────── */

function Historico({ eventos }: { eventos: Ficha["eventos"] }) {
  if (eventos.length === 0) {
    return <p className="text-[13px] text-slate-400">Todavía no ha pasado nada.</p>;
  }
  return (
    <ol className="relative ml-1 border-l border-slate-700 pl-4">
      {eventos.map((ev) => (
        <li key={ev.id} className="relative py-2">
          <span className="absolute -left-[21px] top-3.5 h-2 w-2 rounded-full bg-sky-500" />
          <div className="text-[13px] text-slate-200">{ev.descripcion || ev.tipo}</div>
          <div className="text-[11px] text-slate-500">
            {fmtFechaHora(ev.occurredAt)}
            {ev.actorTipo === "usuario" ? " · una persona" : " · el sistema"}
            {ev.usuarioNombre ? ` (${ev.usuarioNombre})` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** El papel contra el ERP, línea a línea. Los dos valores al lado; decide quien mira. */
function ComparacionErpBloque({ comparacion: c }: { comparacion: NonNullable<ConsultaErp["comparacion"]> }) {
  const eur = (v: number | null) => (v === null ? "—" : eurosConSigno(v));
  return (
    <div className={`mt-2 rounded-xl border p-2 text-[12px] ${c.coincide ? "border-emerald-500/40" : "border-amber-500/40"}`}>
      <p className={`mb-1 font-bold ${c.coincide ? "text-emerald-300" : "text-amber-300"}`}>
        {c.coincide
          ? "El papel y el ERP coinciden línea a línea."
          : `${c.resumen.difieren} difieren · ${c.resumen.faltanEnErp} faltan en el ERP · ${c.resumen.sobranEnErp} sobran en el ERP` +
            (c.diferenciaTotalCentimos !== null ? ` · total papel − ERP: ${eur(c.diferenciaTotalCentimos)}` : "")}
      </p>
      {!c.coincide && (
        <ul className="space-y-0.5 text-slate-300">
          {c.lineas
            .filter((l) => l.tipo !== "IGUAL")
            .map((l, i) => (
              <li key={i} className="font-mono">
                {l.tipo === "DIFIERE" &&
                  `${l.referencia}: papel ${l.papel.cantidad ?? "—"} × ${eur(l.papel.importeCentimos)} · ERP ${l.erp.cantidad ?? "—"} × ${eur(l.erp.importeCentimos)} (${l.campos.join(", ")})`}
                {l.tipo === "FALTA_EN_ERP" && `${l.referencia}: en el papel (${l.papel.cantidad ?? "—"} × ${eur(l.papel.importeCentimos)}), no en el ERP`}
                {l.tipo === "SOBRA_EN_ERP" && `${l.referencia}: en el ERP (${l.erp.cantidad ?? "—"} × ${eur(l.erp.importeCentimos)}), no en el papel`}
                {l.tipo === "SIN_REFERENCIA" && "Una línea del papel sin referencia: no se puede comparar"}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
