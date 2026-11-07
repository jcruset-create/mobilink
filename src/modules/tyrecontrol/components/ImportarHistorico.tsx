import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  agruparAlbaranes, albaranParaRpc, conciliarAlbaran, leerHoja1, leerHoja2, porPeriodo, resumir, sha256Hex,
  type AlbaranConciliado, type ResumenConciliacion,
} from "../services/importHistorico";
import {
  ampliarCargaImportacion, deshacerImportacion, importarHistorico, listarCargasImportacion, listarConservadasDeLote, listarEmpresas,
  type CargaImportacion, type ResultadoAlbaranImport, type ResultadoAmpliar, type ResultadoDeshacer, type ResultadoImportHistorico,
} from "../services/data";
import {
  descripcionDeMeses, etiquetaPeriodo, mesesElegidos as mesesMarcados, resumenPorMes, totalACrear,
} from "../services/lotesMensuales";
import type { Empresa } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "./ui";

/**
 * Importar el histórico de albaranes del taller (Hoja1 + Hoja2 del Excel de
 * Genes) como intervenciones históricas.
 *
 * El navegador LEE y CONCILIA (services/importHistorico.ts); la base decide
 * (tc_importar_historico): vehículo, plano, catálogo, duplicados, permisos.
 * Primero se simula contra la base —sin escribir nada— y se enseña albarán a
 * albarán qué pasaría; luego se carga por lotes mensuales, cada uno en su
 * transacción, con progreso. Lo que ya está no se repite; lo que cambió se
 * enseña y no se pisa; los duplicados probables se deciden a mano.
 */

const ORIGEN_POR_DEFECTO = "genes";

type EstadoVista = ResultadoAlbaranImport["estado"] | "sin_contenido";

export default function ImportarHistorico({ h1, h2, nombreArchivo, bytes }: {
  // Sin fichero (h1 vacío) el panel sirve igual para lo que no necesita Excel:
  // ver las cargas anteriores, ampliarlas al alcance actual y deshacerlas.
  h1: Record<string, unknown>[]; h2: Record<string, unknown>[]; nombreArchivo: string; bytes: ArrayBuffer | null;
}) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [origen, setOrigen] = useState(ORIGEN_POR_DEFECTO);
  const [conciliados, setConciliados] = useState<AlbaranConciliado[] | null>(null);
  const [resumen, setResumen] = useState<ResumenConciliacion | null>(null);
  const [sha, setSha] = useState("");
  const [simulacion, setSimulacion] = useState<Map<string, ResultadoAlbaranImport> | null>(null);
  const [forzar, setForzar] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<EstadoVista | "todos" | "incidencias">("todos");
  const [progreso, setProgreso] = useState<{ periodo: string; r: ResultadoImportHistorico | null; error?: string }[]>([]);
  const [cargaId, setCargaId] = useState<string | null>(null);
  const [cargas, setCargas] = useState<CargaImportacion[]>([]);
  const [ocupado, setOcupado] = useState<"conciliando" | "simulando" | "importando" | "deshaciendo" | null>(null);
  const [error, setError] = useState("");
  const [deshacer, setDeshacer] = useState<{ loteId: string; r: ResultadoDeshacer; excluir: Set<string> } | null>(null);
  const [ampliacion, setAmpliacion] = useState<{ cargaId: string; r: ResultadoAmpliar } | null>(null);
  /*
   * Qué meses se importan. `null` es «todos», que es como se comportaba
   * antes de que esto existiera: un fichero recién leído no cambia de
   * conducta por haber añadido la pantalla.
   *
   * La SIMULACIÓN sigue recorriendo el fichero entero —es solo lectura y es
   * la foto que hace falta para decidir—; lo que se recorta es lo que se
   * ESCRIBE.
   */
  const [meses, setMeses] = useState<Set<string> | null>(null);

  useEffect(() => { listarEmpresas().then(setEmpresas).catch(() => setEmpresas([])); }, []);
  useEffect(() => { if (empresaId) listarCargasImportacion(empresaId).then(setCargas).catch(() => setCargas([])); }, [empresaId]);

  // 1. Conciliar en el navegador (sin base de datos). Sin fichero no hay nada
  //    que conciliar: el panel se abre solo para gestionar cargas anteriores.
  useEffect(() => {
    let vivo = true;
    if (!bytes || h1.length === 0) { setConciliados(null); setResumen(null); setSha(""); return; }
    (async () => {
      setOcupado("conciliando"); setError(""); setSimulacion(null); setProgreso([]); setCargaId(null); setMeses(null);
      try {
        const l1 = leerHoja1(h1), l2 = leerHoja2(h2);
        const { albaranes, entradas, salidasSinAlbaran } = agruparAlbaranes(l1, l2);
        const out: AlbaranConciliado[] = [];
        for (const a of albaranes) out.push(await conciliarAlbaran(a));
        out.sort((a, b) => (a.fecha ?? "") < (b.fecha ?? "") ? -1 : (a.fecha ?? "") > (b.fecha ?? "") ? 1 : a.origen_doc < b.origen_doc ? -1 : 1);
        const huella = await sha256Hex(Array.from(new Uint8Array(bytes)).map((b) => String.fromCharCode(b)).join(""));
        if (!vivo) return;
        setConciliados(out); setResumen(resumir(out, entradas.length, salidasSinAlbaran.length)); setSha(huella);
      } catch (e: any) { if (vivo) setError(e?.message || "No se ha podido leer el fichero"); }
      finally { if (vivo) setOcupado(null); }
    })();
    return () => { vivo = false; };
  }, [h1, h2, bytes]);

  const lotes = useMemo(() => (conciliados ? porPeriodo(conciliados) : new Map<string, AlbaranConciliado[]>()), [conciliados]);
  const filasMes = useMemo(() => resumenPorMes(lotes, simulacion), [lotes, simulacion]);
  const periodosElegidos = useMemo(() => mesesMarcados([...lotes.keys()], meses), [lotes, meses]);
  const aCrear = useMemo(() => totalACrear(filasMes, meses), [filasMes, meses]);
  const marcado = (p: string) => !meses || meses.has(p);
  function alternarMes(p: string) {
    setMeses((prev) => {
      const base = new Set(prev ?? [...lotes.keys()]);
      if (base.has(p)) base.delete(p); else base.add(p);
      return base;
    });
  }

  function lotePara(periodo: string, albs: AlbaranConciliado[], extra: Record<string, unknown> = {}) {
    return {
      periodo, fichero: nombreArchivo, sha256_fichero: sha, carga_id: cargaId,
      forzar_docs: [...forzar].filter((d) => albs.some((a) => a.origen_doc === d)),
      albaranes: albs.map(albaranParaRpc), ...extra,
    };
  }

  // 2. Simular contra la base: solo lectura.
  async function simular() {
    if (!empresaId || !conciliados) return;
    setOcupado("simulando"); setError("");
    try {
      const mapa = new Map<string, ResultadoAlbaranImport>();
      for (const [periodo, albs] of lotes) {
        const r = await importarHistorico(empresaId, origen.trim(), lotePara(periodo, albs), true);
        for (const a of r.albaranes) mapa.set(a.origen_doc, a);
      }
      setSimulacion(mapa);
    } catch (e: any) { setError(e?.message || "No se ha podido simular"); }
    finally { setOcupado(null); }
  }

  // 3. Importar, lote a lote. Un lote que falla no revierte los anteriores:
  //    se enseña y se puede reintentar (idempotente).
  async function importar() {
    if (!empresaId || !conciliados || !simulacion) return;
    if (periodosElegidos.length === 0) return;
    // El número y los meses del «¿seguro?» son los de lo MARCADO, no los del
    // fichero: es la última pantalla antes de escribir y tiene que decir lo
    // que de verdad va a pasar.
    const n = aCrear ?? 0;
    if (!window.confirm(
      `Se van a crear ${n} intervenciones históricas de ${descripcionDeMeses(periodosElegidos)}.`
      + (periodosElegidos.length < lotes.size
        ? `\n\nLos otros ${lotes.size - periodosElegidos.length} mes(es) del fichero NO se tocan: se pueden cargar después, y repetir el fichero no duplica lo ya metido.`
        : "")
      + "\n\nNada de lo actual (montajes, stock, neumáticos, km) se toca. ¿Seguir?")) return;
    setOcupado("importando"); setError(""); setProgreso([]);
    let carga = cargaId;
    for (const [periodo, albs] of lotes) {
      if (!marcado(periodo)) continue;
      try {
        const r = await importarHistorico(empresaId, origen.trim(), lotePara(periodo, albs, { carga_id: carga }), false);
        carga = r.carga_id ?? carga; setCargaId(carga);
        setProgreso((p) => [...p, { periodo, r }]);
      } catch (e: any) {
        setProgreso((p) => [...p, { periodo, r: null, error: e?.message || "Error" }]);
      }
    }
    setOcupado(null);
    setSimulacion(null);
    listarCargasImportacion(empresaId).then(setCargas).catch(() => undefined);
  }

  /**
   * Cargas importadas con el alcance antiguo: les faltan las fichas de las
   * unidades nuevas y las salidas por sustitución. Esto se las añade sin
   * duplicar nada; primero en seco, y solo se aplica si el usuario lo pide.
   */
  async function ampliar(cargaId: string, simular: boolean) {
    setOcupado("importando"); setError("");
    try {
      const r = await ampliarCargaImportacion(cargaId, simular);
      setAmpliacion({ cargaId, r });
      if (!simular) setCargas(await listarCargasImportacion(empresaId));
    } catch (e: any) { setError(e?.message || "No se ha podido ampliar la carga"); }
    finally { setOcupado(null); }
  }

  async function prepararDeshacer(loteId: string) {
    setOcupado("deshaciendo"); setError("");
    try { setDeshacer({ loteId, r: await deshacerImportacion(loteId, [], true), excluir: new Set() }); }
    catch (e: any) { setError(e?.message || "No se ha podido comprobar el lote"); }
    finally { setOcupado(null); }
  }
  async function confirmarDeshacer() {
    if (!deshacer) return;
    const aBorrar = deshacer.r.detalle.filter((d) => d.resultado === "borrada" && !deshacer.excluir.has(d.intervencion_id)).length;
    if (!window.confirm(`Se van a borrar ${aBorrar} intervenciones importadas (con sus operaciones, servicios y líneas). Las modificadas después se conservan. ¿Seguir?`)) return;
    setOcupado("deshaciendo"); setError("");
    try {
      const r = await deshacerImportacion(deshacer.loteId, [...deshacer.excluir], false);
      setDeshacer({ ...deshacer, r });
      listarCargasImportacion(empresaId).then(setCargas).catch(() => undefined);
    } catch (e: any) { setError(e?.message || "No se ha podido deshacer"); }
    finally { setOcupado(null); }
  }

  const estadoDe = (a: AlbaranConciliado): EstadoVista =>
    a.estado === "sin_contenido" ? "sin_contenido" : a.estado === "bloqueado" ? "bloqueado" : (simulacion?.get(a.origen_doc)?.estado ?? "se_crearia");
  const ETIQUETA: Record<EstadoVista, [string, string]> = {
    se_crearia: ["Se crearía", "text-sky-300"], creada: ["Creada", "text-emerald-300"], ya_presente: ["Ya presente", "text-slate-400"],
    cambiado: ["Cambiado", "text-amber-300"], bloqueado: ["Bloqueado", "text-rose-300"], duplicado_probable: ["Duplicado probable", "text-amber-300"],
    sin_contenido: ["Sin contenido", "text-slate-500"],
  };
  const cuenta = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of conciliados ?? []) { const e = estadoDe(a); c[e] = (c[e] ?? 0) + 1; }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conciliados, simulacion]);
  const visibles = (conciliados ?? []).filter((a) => {
    if (filtro === "todos") return true;
    if (filtro === "incidencias") return a.incidencias.length > 0 || a.estado === "bloqueado";
    return estadoDe(a) === filtro;
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-800 p-3 text-[12px] text-slate-300">
        <div className="mb-2 font-bold text-slate-100">Histórico de albaranes · {nombreArchivo}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${inputCls} max-w-[260px]`} value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setSimulacion(null); }}>
            <option value="">Empresa…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <label className="flex items-center gap-1" title="Nombre del sistema del que salen los albaranes. Forma parte de la referencia de origen de cada registro.">
            Sistema de origen
            <input className={`${inputCls} w-28`} value={origen} onChange={(e) => { setOrigen(e.target.value); setSimulacion(null); }} />
            <span className="text-slate-500">(propuesta: {ORIGEN_POR_DEFECTO}; a confirmar)</span>
          </label>
          <button onClick={simular} disabled={!empresaId || !origen.trim() || !conciliados || !!ocupado}
            className="rounded bg-slate-700 px-3 py-1.5 font-bold text-white disabled:opacity-50">
            {ocupado === "simulando" ? "Simulando…" : "Simular contra la base (no escribe)"}
          </button>
          <button onClick={importar} disabled={!simulacion || !!ocupado || periodosElegidos.length === 0}
            className="rounded bg-emerald-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">
            {ocupado === "importando" ? "Importando…"
              : periodosElegidos.length === 0 ? "Importar (ningún mes marcado)"
              : `Importar ${descripcionDeMeses(periodosElegidos)}${aCrear != null ? ` · ${aCrear} albaranes` : ""}`}
          </button>
        </div>
        <div className="mt-2 text-slate-400">
          Una intervención por albarán y matrícula; una operación por neumático, sin ficha; servicios agregados; cada línea con su importe.
          No toca montajes actuales, stock, neumáticos, revisiones ni kilómetros. Las entradas del depósito no se importan.
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {ocupado === "conciliando" && <div className="text-sm text-slate-400">Conciliando albaranes…</div>}

      {resumen && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi t="Albaranes" v={resumen.albaranes} />
          <Kpi t="Importables" v={resumen.importables} tono="text-sky-300" />
          <Kpi t="Bloqueados" v={resumen.bloqueados} tono={resumen.bloqueados ? "text-rose-300" : "text-emerald-300"} />
          <Kpi t="Sin contenido" v={resumen.sinContenido} tono="text-slate-400" />
          <Kpi t="Operaciones (neumáticos)" v={resumen.operaciones} tono="text-emerald-300" />
          <Kpi t="Servicios" v={resumen.servicios} />
          <div className="rounded-lg bg-slate-800 p-3 text-[11px] text-slate-400 sm:col-span-3 lg:col-span-6">
            Nuevas {resumen.porCondicion.nueva} · usadas {resumen.porCondicion.usada} · recauchutadas {resumen.porCondicion.recauchutada} · líneas de origen {resumen.lineas}
            · entradas del depósito (no se importan) {resumen.entradasDeposito}{resumen.salidasSinAlbaran ? ` · salidas sin albarán ${resumen.salidasSinAlbaran}` : ""}
            {simulacion && <> · simulado: se crearían {cuenta.se_crearia ?? 0}, ya presentes {cuenta.ya_presente ?? 0}, cambiados {cuenta.cambiado ?? 0}, duplicados probables {cuenta.duplicado_probable ?? 0}, bloqueados por la base {[...simulacion.values()].filter((x) => x.estado === "bloqueado").length}</>}
          </div>
        </div>
      )}

      {/*
        Qué meses se importan.

        El fichero de Plana trae diez meses y el botón los recorría todos:
        «importar un mes y medirlo» no se podía hacer. Aquí se marcan, y lo
        que no esté marcado no se escribe. La simulación sigue mirando el
        fichero entero, que es solo lectura y es la foto que hace falta para
        decidir cuál cargar primero.
      */}
      {lotes.size > 1 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">
              Meses del fichero · se importan los marcados ({periodosElegidos.length} de {lotes.size})
            </div>
            <div className="flex gap-2 text-[12px]">
              <button onClick={() => setMeses(null)}
                className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-700">Todos</button>
              <button onClick={() => setMeses(new Set())}
                className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-700">Ninguno</button>
              <button onClick={() => setMeses(new Set([...lotes.keys()].slice(0, 1)))}
                className="rounded border border-sky-500 px-2 py-1 font-bold text-sky-300 hover:bg-sky-500/10"
                title="El más antiguo del fichero: por donde se empieza para medir una carga antes de seguir">
                Solo el primero
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {filasMes.map((m) => (
              <label key={m.periodo}
                className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[12px] ${
                  marcado(m.periodo) ? "border-emerald-600/50 bg-emerald-500/5" : "border-slate-700 bg-slate-900/40 opacity-60"
                }`}>
                <input type="checkbox" checked={marcado(m.periodo)} onChange={() => alternarMes(m.periodo)} />
                <span className="w-20 font-bold capitalize text-slate-100">{etiquetaPeriodo(m.periodo)}</span>
                <span className="text-slate-400">{m.albaranes} alb.</span>
                {/* Sin simular no hay número: un cero diría «este mes no trae
                    nada», y lo que pasa es que nadie lo ha calculado. */}
                {m.seCrearian != null && (
                  <>
                    <span className="font-bold text-emerald-300">{m.seCrearian} se crearían</span>
                    {m.yaPresentes ? <span className="text-slate-500">· {m.yaPresentes} ya están</span> : null}
                    {m.bloqueados ? <span className="text-rose-300">· {m.bloqueados} bloq.</span> : null}
                  </>
                )}
              </label>
            ))}
          </div>

          {!simulacion && (
            <div className="mt-2 text-[11px] text-slate-500">
              Simula primero: hasta entonces solo se sabe cuántos albaranes trae cada mes, no cuántos entrarían.
            </div>
          )}
          {periodosElegidos.length === 0 && (
            <div className="mt-2 text-[11px] font-bold text-amber-300">
              Ningún mes marcado: no hay nada que importar.
            </div>
          )}
        </div>
      )}

      {progreso.length > 0 && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3 text-[12px]">
          <div className="mb-1 font-bold text-emerald-200">Carga {cargaId ?? ""}</div>
          {progreso.map((p) => (
            <div key={p.periodo} className={p.error ? "text-rose-300" : "text-slate-300"}>
              {p.periodo}: {p.error ? `ERROR — ${p.error} (el lote no ha escrito nada; se puede reintentar)` :
                `creadas ${p.r!.creadas} · ya presentes ${p.r!.ya_presentes} · cambiados ${p.r!.cambiados} · bloqueados ${p.r!.bloqueados} · duplicados probables ${p.r!.duplicados_probables}`}
            </div>
          ))}
        </div>
      )}

      {conciliados && (
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-bold uppercase text-[11px] text-slate-400">Vista previa</span>
            {(["todos", "incidencias", "se_crearia", "ya_presente", "cambiado", "duplicado_probable", "bloqueado", "sin_contenido"] as const).map((f) => (
              <button key={f} onClick={() => setFiltro(f)}
                className={`rounded px-2 py-0.5 ${filtro === f ? "bg-sky-700 text-white" : "bg-slate-700 text-slate-300"}`}>
                {f === "todos" ? "Todos" : f === "incidencias" ? "Con incidencias" : ETIQUETA[f][0]}{f !== "todos" && f !== "incidencias" && cuenta[f] ? ` (${cuenta[f]})` : ""}
              </button>
            ))}
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Albarán</th><th className={thCls}>Matrícula</th><th className={thCls}>Km</th>
              <th className={thCls}>Neumáticos</th><th className={thCls}>Servicios</th><th className={thCls}>Estado</th><th className={thCls}>Detalle</th>
            </tr></thead>
            <tbody>
              {visibles.slice(0, 400).map((a) => {
                const e = estadoDe(a); const s = simulacion?.get(a.origen_doc);
                return (
                  <tr key={a.origen_doc} className="border-t border-slate-700/60 align-top">
                    <td className={tdCls + " text-slate-400"}>{a.fecha ?? "—"}</td>
                    <td className={tdCls + " font-mono text-slate-200"}>{a.documento}</td>
                    <td className={tdCls + " font-mono text-slate-300"}>{a.matricula || "—"}</td>
                    <td className={tdCls + " text-slate-400"}>{a.km ?? "—"}</td>
                    <td className={tdCls + " text-slate-300"}>
                      {a.grupos.map((g) => (
                        <div key={g.id} className={g.montaje ? "" : "text-slate-500"}>
                          {g.n} {g.cond} {g.medida ?? ""} {g.marca ?? ""} {g.modelo ?? ""}{!g.montaje ? " (entrega, sin montaje)" : g.evidencia !== "anotacion" ? " (por mano de obra)" : ""}
                        </div>
                      ))}
                      {a.nuevas_total > 0 && s?.posiciones_deducidas != null && <div className="text-[11px] text-slate-500">posiciones deducidas: {s.posiciones_deducidas}</div>}
                    </td>
                    <td className={tdCls + " text-slate-400"}>{a.servicios.map((x) => `${x.servicio} ×${x.cantidad}`).join(", ") || "—"}</td>
                    <td className={tdCls}>
                      <span className={`font-bold ${ETIQUETA[e][1]}`}>{ETIQUETA[e][0]}</span>
                      {e === "duplicado_probable" && (
                        <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-200">
                          <input type="checkbox" checked={forzar.has(a.origen_doc)}
                            onChange={(ev) => { const n = new Set(forzar); ev.target.checked ? n.add(a.origen_doc) : n.delete(a.origen_doc); setForzar(n); setSimulacion(null); }} />
                          importar igualmente
                        </label>
                      )}
                      {s?.intervencion_id && e !== "se_crearia" && (
                        <Link to={`/tyrecontrol/intervenciones/${s.intervencion_id}`} className="ml-2 text-[11px] text-sky-300 hover:underline">ver</Link>
                      )}
                    </td>
                    <td className={tdCls + " text-[11px]"}>
                      {a.bloqueante && <div className="text-rose-300">{a.bloqueante}</div>}
                      {s?.motivo && <div className="text-amber-300">{s.motivo}</div>}
                      {a.incidencias.map((i, k) => <div key={k} className="text-amber-200">{i}</div>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {visibles.length > 400 && <div className="mt-1 text-[11px] text-slate-500">…y {visibles.length - 400} más (usa los filtros).</div>}
        </div>
      )}

      {empresaId && cargas.length > 0 && (
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase text-slate-400">Cargas anteriores de esta empresa</div>
            <Link to="/tyrecontrol/importar/identificar" className="text-[11px] text-sky-300 hover:underline">Unidades por identificar →</Link>
          </div>
          {cargas.map((c) => (
            <div key={c.id} className="mb-2 rounded border border-slate-700 p-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2 text-slate-200">
                <span>{new Date(c.creado_at).toLocaleString("es-ES")} · {c.fichero ?? "—"} · origen <b>{c.origen_sistema}</b> · <span className="uppercase text-slate-400">{c.estado.replace(/_/g, " ")}</span></span>
                {(c.alcance ?? 1) < 2 && c.estado !== "deshecha" && (
                  <>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-300" title="Importada antes de las fichas y las sustituciones">sin fichas ni salidas</span>
                    <button onClick={() => void ampliar(c.id, true)} disabled={!!ocupado}
                      className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-50">Comprobar ampliación…</button>
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {(c.lotes ?? []).map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1">
                    <span className="font-mono">{l.periodo}</span>
                    <span className="text-slate-400">{l.estado.replace(/_/g, " ")}{l.resumen && typeof l.resumen.creadas === "number" ? ` · ${l.resumen.creadas} creadas` : ""}</span>
                    {l.estado !== "deshecho" && (
                      <button onClick={() => void prepararDeshacer(l.id)} disabled={!!ocupado}
                        className="rounded border border-amber-600 px-1.5 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Deshacer…</button>
                    )}
                    {l.estado === "parcialmente_deshecho" && <Conservadas loteId={l.id} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ampliacion && (
        <div className="mb-3 rounded-lg border border-sky-600/40 bg-sky-500/5 p-3 text-[12px]">
          <div className="mb-1 font-bold text-sky-200">
            {ampliacion.r.simulacion ? "Comprobación de ampliación" : "Carga ampliada"} ·{" "}
            {ampliacion.r.ampliadas} {ampliacion.r.simulacion ? "se ampliarían" : "ampliadas"} ·{" "}
            {ampliacion.r.fichas} fichas · {ampliacion.r.salidas} salidas
            {ampliacion.r.sin_ampliar > 0 ? ` · ${ampliacion.r.sin_ampliar} sin ampliar` : ""}
          </div>
          {ampliacion.r.detalle.filter((d) => d.motivo).slice(0, 10).map((d, i) => (
            <div key={i} className="text-slate-300">· {d.origen_doc}: {d.motivo}</div>
          ))}
          <div className="mt-2 flex gap-2">
            {ampliacion.r.simulacion && ampliacion.r.ampliadas > 0 && (
              <button onClick={() => void ampliar(ampliacion.cargaId, false)} disabled={!!ocupado}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Ampliar de verdad</button>
            )}
            <button onClick={() => setAmpliacion(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cerrar</button>
          </div>
        </div>
      )}

      {deshacer && (
        <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-[12px]">
          <div className="mb-1 font-bold text-amber-200">
            {deshacer.r.simulacion ? "Comprobación de deshacer" : "Resultado de deshacer"} · lote {deshacer.loteId.slice(0, 8)} ·
            {" "}{deshacer.r.borradas} {deshacer.r.simulacion ? "se borrarían" : "borradas"} · {deshacer.r.conservadas} conservadas
            {deshacer.r.estado ? ` · ${deshacer.r.estado.replace(/_/g, " ")}` : ""}
          </div>
          <div className="max-h-64 overflow-auto">
            {deshacer.r.detalle.map((d) => (
              <div key={d.intervencion_id} className={d.resultado === "conservada" ? "text-amber-200" : "text-slate-300"}>
                {d.origen_doc}: {d.resultado}{d.motivos?.length ? ` — ${d.motivos.join(" · ")}` : ""}
                {deshacer.r.simulacion && d.resultado === "borrada" && (
                  <label className="ml-2 inline-flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={deshacer.excluir.has(d.intervencion_id)}
                      onChange={(ev) => { const n = new Set(deshacer.excluir); ev.target.checked ? n.add(d.intervencion_id) : n.delete(d.intervencion_id); setDeshacer({ ...deshacer, excluir: n }); }} />
                    conservar
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {deshacer.r.simulacion && (
              <button onClick={confirmarDeshacer} disabled={!!ocupado || deshacer.r.borradas === 0}
                className="rounded bg-amber-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">
                {ocupado === "deshaciendo" ? "Deshaciendo…" : "Deshacer lo que no haya cambiado"}
              </button>
            )}
            <button onClick={() => setDeshacer(null)} className="rounded border border-slate-600 px-3 py-1.5 text-slate-200">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Conservadas({ loteId }: { loteId: string }) {
  const [lista, setLista] = useState<{ origen_doc: string; motivo_conservada: string | null }[] | null>(null);
  return (
    <span className="text-[11px]">
      {lista == null
        ? <button onClick={() => listarConservadasDeLote(loteId).then(setLista).catch(() => setLista([]))} className="text-sky-300 hover:underline">qué queda</button>
        : <span className="text-amber-200">{lista.map((x) => `${x.origen_doc.split("|")[0]} (${x.motivo_conservada ?? "—"})`).join("; ") || "nada"}</span>}
    </span>
  );
}

function Kpi({ t, v, tono = "text-slate-100" }: { t: string; v: number; tono?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="text-[10px] font-bold uppercase text-slate-400">{t}</div>
      <div className={`mt-1 text-2xl font-black ${tono}`}>{v}</div>
    </div>
  );
}
