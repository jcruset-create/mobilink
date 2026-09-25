/**
 * Los números con los que el módulo decide qué corre más y qué es lo mismo.
 *
 * Están los de la prioridad y los del motor de deduplicación, que son los que
 * hoy hacen algo. Los umbrales del parser de documentos aparecerán aquí cuando
 * exista el código que los lee: una pantalla con mandos desconectados es peor
 * que no tenerla, porque alguien los mueve y se cree que ha cambiado algo.
 *
 * ── Los castigos son negativos, y eso cambia el lector ──────────────────────
 *
 * «Factura distinta» resta 40. El lector de los pesos de prioridad rechaza los
 * negativos a propósito —un peso de prioridad negativo no significa nada— así
 * que aquí hace falta otro que los admita. Con el primero, un −40 se habría
 * guardado en silencio como el valor por defecto.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import { Aviso, ErrorBox, TextField, btnPrimary, btnSecondary } from "../components/ui";
import type { Config } from "../types";

export default function Configuracion() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setConfig(await api.leerConfig());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la configuración");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <p className="text-[13px] text-slate-400">Cargando…</p>;
  if (!config) return <ErrorBox>{error ?? "Sin configuración"}</ErrorBox>;

  const num = (v: string, sinValor: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : sinValor;
  };

  /** Igual, pero admitiendo el signo: los castigos del deduplicador restan. */
  const numConSigno = (v: string, sinValor: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : sinValor;
  };

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setGuardado(false);
    try {
      setConfig(await api.guardarConfig(config));
      setGuardado(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-black">Configuración</h1>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-4">
        <Aviso tono="info">
          La prioridad sale de sumar: días abierto × peso, reclamaciones × peso, y un tanto fijo si
          el correo venía urgente o si Therefore ha mandado una tarea vencida. Los umbrales
          reparten ese número entre las cuatro prioridades.
        </Aviso>
      </div>

      <section className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-bold">Pesos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Por cada día abierto"
            value={String(config.pesos.diasAbierto)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, diasAbierto: num(v, 0) } })
            }
          />
          <TextField
            label="Por cada reclamación"
            value={String(config.pesos.reclamaciones)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, reclamaciones: num(v, 0) } })
            }
          />
          <TextField
            label="Si viene marcado urgente"
            value={String(config.pesos.urgente)}
            onChange={(v) => setConfig({ ...config, pesos: { ...config.pesos, urgente: num(v, 0) } })}
          />
          <TextField
            label="Si hay tarea vencida"
            value={String(config.pesos.tareaVencida)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, tareaVencida: num(v, 0) } })
            }
          />
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-bold">Umbrales</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="A partir de aquí, normal"
            value={String(config.umbrales.baja)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, baja: num(v, 0) } })
            }
          />
          <TextField
            label="A partir de aquí, alta"
            value={String(config.umbrales.alta)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, alta: num(v, 0) } })
            }
          />
          <TextField
            label="A partir de aquí, crítica"
            value={String(config.umbrales.critica)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, critica: num(v, 0) } })
            }
          />
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-1 text-sm font-bold">Cuándo dos correos son el mismo asunto</h2>
        <p className="mb-3 text-[12px] text-slate-400">
          Cada coincidencia entre el correo que llega y un expediente que ya existe suma (o resta)
          puntos. Por encima del umbral de fusión se enlazan sin preguntar; entre los dos umbrales
          se deja en Revisión; por debajo del de revisión, se abre un expediente nuevo.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["mismaFactura", "Misma factura"],
              ["mismoAlbaran", "Mismo albarán"],
              ["mismoProveedor", "Mismo proveedor"],
              ["mismoImporte", "Mismo importe"],
              ["mismaEmpresa", "Misma sociedad"],
              ["mismoDocumento", "Mismo adjunto"],
              ["mismaAccion", "Misma acción sobre el albarán"],
              ["mismoHilo", "Mismo hilo de correo"],
              ["facturaDiferente", "Factura distinta (resta)"],
              ["proveedorDiferente", "Proveedor distinto (resta)"],
              ["tipoIncompatible", "Incidencia frente a aprobación (resta)"],
            ] as const
          ).map(([clave, rotulo]) => (
            <TextField
              key={clave}
              label={rotulo}
              value={String(config.dedupe.pesos[clave])}
              onChange={(v) =>
                setConfig({
                  ...config,
                  dedupe: {
                    ...config.dedupe,
                    pesos: {
                      ...config.dedupe.pesos,
                      [clave]: numConSigno(v, config.dedupe.pesos[clave]),
                    },
                  },
                })
              }
            />
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TextField
            label="A partir de aquí se enlaza solo"
            value={String(config.dedupe.umbrales.fusionar)}
            onChange={(v) =>
              setConfig({
                ...config,
                dedupe: {
                  ...config.dedupe,
                  umbrales: {
                    ...config.dedupe.umbrales,
                    fusionar: num(v, config.dedupe.umbrales.fusionar),
                  },
                },
              })
            }
          />
          <TextField
            label="A partir de aquí se pregunta"
            value={String(config.dedupe.umbrales.revisar)}
            onChange={(v) =>
              setConfig({
                ...config,
                dedupe: {
                  ...config.dedupe,
                  umbrales: {
                    ...config.dedupe.umbrales,
                    revisar: num(v, config.dedupe.umbrales.revisar),
                  },
                },
              })
            }
          />
          <TextField
            label="Días hacia atrás que se miran"
            value={String(config.dedupe.ventanaDias)}
            onChange={(v) =>
              setConfig({
                ...config,
                dedupe: { ...config.dedupe, ventanaDias: num(v, config.dedupe.ventanaDias) },
              })
            }
          />
        </div>
      </section>

      {/*
        Los del análisis del albarán. La tolerancia merece la advertencia que
        lleva escrita: no está para que cuadren más albaranes, está para que un
        redondeo de céntimo no llene la cola de revisiones. Subirla a un euro no
        arregla nada, sólo deja de enseñar los descuadres de un euro.
      */}
      <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-1 text-sm font-bold">Análisis de albaranes</h2>
        <p className="mb-3 text-[12px] text-slate-400">
          Cuánto tiene que parecerse el número del papel al pedido para darlo por bueno, y a partir
          de qué diferencia se pide revisión.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Coincidencia segura (0 a 1)"
            value={String(config.albaran.umbrales.match)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: {
                  ...config.albaran,
                  umbrales: { ...config.albaran.umbrales, match: num(v, config.albaran.umbrales.match) },
                },
              })
            }
          />
          <TextField
            label="Coincidencia dudosa (0 a 1)"
            value={String(config.albaran.umbrales.incierto)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: {
                  ...config.albaran,
                  umbrales: {
                    ...config.albaran.umbrales,
                    incierto: num(v, config.albaran.umbrales.incierto),
                  },
                },
              })
            }
          />
          <TextField
            label="Tolerancia en céntimos (sólo redondeos)"
            value={String(config.albaran.toleranciaCentimos)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: {
                  ...config.albaran,
                  toleranciaCentimos: num(v, config.albaran.toleranciaCentimos),
                },
              })
            }
          />
          <TextField
            label="Confianza mínima por campo (0 a 1)"
            value={String(config.albaran.umbralConfianzaCampo)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: {
                  ...config.albaran,
                  umbralConfianzaCampo: num(v, config.albaran.umbralConfianzaCampo),
                },
              })
            }
          />
          <TextField
            label="Intentos antes de rendirse"
            value={String(config.albaran.maxIntentos)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: { ...config.albaran, maxIntentos: num(v, config.albaran.maxIntentos) },
              })
            }
          />
          <TextField
            label="Páginas máximas por documento"
            value={String(config.albaran.maxPaginas)}
            onChange={(v) =>
              setConfig({
                ...config,
                albaran: { ...config.albaran, maxPaginas: num(v, config.albaran.maxPaginas) },
              })
            }
          />
        </div>
      </section>

      <SeccionRevision />

      <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-1 text-sm font-bold">Autocierre</h2>
        <p className="mb-3 text-[12px] text-slate-400">
          Un expediente resuelto que nadie vuelve a tocar se cierra solo pasados estos días. Se
          puede reabrir, así que equivocarse por poco no cuesta nada; con una reclamación pendiente
          no se cierra nunca.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Días resuelto antes de cerrar"
            value={String(config.diasAutocierre)}
            onChange={(v) => setConfig({ ...config, diasAutocierre: num(v, config.diasAutocierre) })}
          />
        </div>
      </section>

      <Buzon />

      <div className="flex items-center gap-3">
        <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {guardado && (
          <span className="text-[13px] text-emerald-300">
            Guardado. Se aplica al recalcular cada expediente.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * El estado del buzón y sus últimas pasadas.
 *
 * Lo que se enseña es si está leyendo y qué ha hecho, nunca cómo se conecta:
 * las credenciales son variables de entorno del servidor y esta pantalla no
 * las ve ni las pide. Lo único que se edita aquí es la lista de remitentes,
 * porque ésa sí es una decisión de quien gestiona el módulo y no de quien
 * despliega.
 */
function Buzon() {
  const [estado, setEstado] = useState<api.EstadoBuzon | null>(null);
  const [remitentes, setRemitentes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [desdeHistorico, setDesdeHistorico] = useState("");
  const [cargandoHistorico, setCargandoHistorico] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const e = await api.estadoBuzon();
      setEstado(e);
      setRemitentes(e.remitentes.join(", "));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido leer el estado del buzón");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarLista() {
    setAviso(null);
    try {
      const r = await api.guardarRemitentes(remitentes);
      setRemitentes(r.remitentes.join(", "));
      setAviso(r.remitentes.length ? "Lista guardada." : "Lista vacía: se aceptará todo lo que llegue al buzón.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar la lista");
    }
  }

  async function revisar() {
    setRevisando(true);
    setAviso(null);
    try {
      const r = await api.revisarBuzon();
      setAviso(`${r.correos} correo(s): ${r.procesados} procesado(s), ${r.ignorados} ignorado(s), ${r.errores} error(es).`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido revisar el buzón");
    } finally {
      setRevisando(false);
    }
  }

  async function cargarHistorico() {
    if (!desdeHistorico) return;
    setCargandoHistorico(true);
    setAviso(null);
    try {
      const r = await api.cargarHistorico(new Date(desdeHistorico).toISOString());
      setAviso(
        `Histórico: ${r.correos} correo(s), ${r.procesados} procesado(s), ${r.ignorados} ignorado(s), ${r.errores} error(es).` +
          (r.correos > 0 ? " Repite la carga hasta que salga a cero." : "")
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el histórico");
    } finally {
      setCargandoHistorico(false);
    }
  }

  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

  // La pasada más reciente es la primera: el motivo que se enseña es el suyo,
  // no el de cualquier fallo viejo que ya esté resuelto.
  const ultimoFallo = estado?.pasadas[0]?.error ?? null;

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <h2 className="mb-1 text-sm font-bold">Buzón de Therefore</h2>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!estado ? (
        <p className="text-[13px] text-slate-400">Cargando…</p>
      ) : (
        <>
          <p className="mb-3 text-[12px] text-slate-400">
            {estado.configurado ? (
              <>
                Leyendo <span className="text-slate-200">{estado.usuario}</span> cada {estado.cadaMinutos} min
                {estado.activadoEl && <> · activado el {fecha(estado.activadoEl)}</>}
              </>
            ) : (
              <>
                Apagado: faltan las credenciales del buzón en el servidor (variables{" "}
                <span className="font-mono">THEREFORE_IMAP_*</span>). Los correos se pueden importar a mano
                mientras tanto.
              </>
            )}
          </p>

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[280px] flex-1">
              <TextField
                label="Remitentes admitidos: direcciones o dominios (@proveedor.com), separados por comas; vacío = todos"
                value={remitentes}
                onChange={setRemitentes}
              />
            </div>
            <button onClick={() => void guardarLista()} className={btnSecondary}>
              Guardar lista
            </button>
            <button onClick={() => void revisar()} className={btnSecondary} disabled={!estado.configurado || revisando}>
              {revisando ? "Revisando…" : "Revisar buzón ahora"}
            </button>
          </div>
          {/*
            El histórico es una acción aparte a propósito: lo anterior a la
            activación no entra nunca por accidente. Se pide con una fecha y se
            repite hasta que la pasada salga a cero.
          */}
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px]">
              <TextField
                label="Cargar histórico desde (aaaa-mm-dd)"
                value={desdeHistorico}
                onChange={setDesdeHistorico}
              />
            </div>
            <button
              onClick={() => void cargarHistorico()}
              className={btnSecondary}
              disabled={!estado.configurado || cargandoHistorico || !desdeHistorico}
            >
              {cargandoHistorico ? "Cargando…" : "Cargar histórico"}
            </button>
          </div>
          {aviso && <p className="mb-3 text-[12px] text-emerald-300">{aviso}</p>}

          {/*
            El fallo de la última pasada, arriba y entero.
            Cuando el buzón deja de ir, TODAS las pasadas fallan por lo mismo:
            en la tabla son once renglones iguales al final de una columna
            estrecha, y hubo días de «Command failed» sin que nadie leyera el
            motivo. Aquí se lee, y dice qué paso falló y qué contestó el
            servidor.
          */}
          {ultimoFallo && (
            <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              <b>El buzón no se está leyendo.</b> {ultimoFallo}
            </p>
          )}

          {estado.pasadas.length > 0 && (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 font-normal">Cuándo</th>
                  <th className="py-1 font-normal">Correos</th>
                  <th className="py-1 font-normal">Procesados</th>
                  <th className="py-1 font-normal">Ignorados</th>
                  <th className="py-1 font-normal">Errores</th>
                  <th className="py-1 font-normal">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {estado.pasadas.map((p) => (
                  <tr key={p.id} className="border-t border-slate-700/60">
                    <td className="py-1">
                      {fecha(p.iniciada_at)}
                      {p.origen === "manual" && <span className="ml-1 text-slate-500">(a mano)</span>}
                    </td>
                    <td className="py-1">{p.correos}</td>
                    <td className="py-1">{p.procesados}</td>
                    <td className="py-1">{p.ignorados}</td>
                    <td className={`py-1 ${p.errores ? "text-amber-300" : ""}`}>{p.errores}</td>
                    <td className={`py-1 ${p.error ? "text-rose-300" : "text-slate-400"}`}>
                      {p.error ?? (p.terminada_at ? "OK" : "en curso")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/* ── Documentos para revisión ────────────────────────────────────────────── */

/**
 * Los PDF que el análisis no supo leer, en un zip, para afinar el parser con
 * papel de verdad. Cada fichero lleva el expediente, el albarán pedido y el
 * estado en el nombre, y el zip trae un índice con el motivo.
 */
function SeccionRevision() {
  const [dias, setDias] = useState("30");
  const [descargando, setDescargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setDescargando(true);
    setAviso(null);
    setError(null);
    try {
      const n = Math.min(365, Math.max(1, Math.round(Number(dias) || 30)));
      const blob = await api.descargarRevision(n);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `therefore-revision-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setAviso("Descargado. Pásale el zip a quien afine el parser: lleva precios de compra, no lo reenvíes por ahí.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido descargar");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <h2 className="mb-1 text-sm font-bold">Documentos para revisión</h2>
      <p className="mb-3 text-[12px] text-slate-400">
        Los PDF cuyo análisis quedó en REVISAR o en ERROR, en un solo zip con un índice
        (expediente, albarán pedido, estado y motivo). Es lo que hace falta para afinar el parser
        con documentos reales.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <TextField label="Últimos días" value={dias} onChange={setDias} />
        </div>
        <button onClick={() => void descargar()} className={btnSecondary} disabled={descargando}>
          {descargando ? "Preparando…" : "Descargar documentos para revisión"}
        </button>
      </div>
    </section>
  );
}
