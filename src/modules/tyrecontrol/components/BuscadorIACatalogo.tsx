/**
 * «Buscar neumáticos con IA»: de una frase a fichas de catálogo.
 *
 * Lo que hace la pantalla y lo que NO hace:
 *
 *  · Buscar y enseñar lo encontrado, con el estado de cada modelo y la fuente
 *    de la que sale. Cada fila se puede abrir y comprobar.
 *  · Crear SOLO lo que se marque, y solo tras confirmar. Se marcan solos los
 *    nuevos verificados; los demás hay que marcarlos a mano después de mirar
 *    por qué están en revisión.
 *  · Crear va por `crearReferenciaNeumatico`, el mismo servicio que «Nueva
 *    referencia»: resuelve marca, modelo y medida, y si la referencia ya
 *    existía devuelve la que hay en vez de duplicarla.
 *
 * Nada se guarda sin que alguien lo marque y confirme. Y lo que la búsqueda no
 * ha podido verificar no se puede marcar: no es que se desaconseje, es que la
 * casilla no está.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, ExternalLink, AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

import { crearReferenciaNeumatico, listarMarcas, listarMedidas } from "../services/data";
import CompletarFichasIA from "./CompletarFichasIA";
import { opcionesConElegido } from "../catalogo/usos";
import SelectorConAlta from "./SelectorConAlta";
import { buscarModelosIA, type RespuestaBusquedaIA } from "../services/catalogoIABusqueda";
import { ejeDelCandidato, type Candidato, type EstadoCandidato } from "../services/catalogoIA";
import { Modal, TableWrap, tdCls, thCls } from "./ui";

/**
 * Lo último que se buscó, para que cerrar la ventana no tire dos minutos de
 * trabajo.
 *
 * Vive fuera del componente a propósito: la ventana se desmonta al cerrarla y
 * cualquier estado interno se iría con ella. Sobrevive mientras no se cambie
 * de pantalla ni se recargue, que es justo donde está el clic accidental.
 * Guardarlo más allá de eso pediría guardar la búsqueda en el servidor, y eso
 * es otra cosa.
 */
let ultimaBusqueda: {
  marca: string; medida: string; modelo: string;
  resp: RespuestaBusquedaIA;
  marcados: Set<string>;
  ediciones: Record<string, Edicion>;
} | null = null;

const ESTADO: Record<EstadoCandidato, { texto: string; clase: string; Icono: typeof CheckCircle2 }> = {
  nuevo: { texto: "Nuevo", clase: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30", Icono: CheckCircle2 },
  existente: { texto: "Ya está", clase: "bg-slate-600/30 text-slate-300 ring-1 ring-slate-500/30", Icono: XCircle },
  revisar: { texto: "Revisar", clase: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30", Icono: AlertTriangle },
  no_verificado: { texto: "Sin verificar", clase: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30", Icono: HelpCircle },
};

/**
 * Casillas de índices: 16 px de letra en el móvil (con menos, el iPhone hace
 * zoom al tocarlas y la casilla se sale de la vista: parece que no escribe) y
 * al entrar se selecciona lo que haya, para que lo tecleado lo sustituya.
 */
const IDX = "rounded-lg border border-slate-600 bg-slate-900 px-1.5 py-1 text-base text-slate-100 outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 sm:text-[12px]";

/** Lo editable de una fila antes de guardarla. */
type Edicion = { indiceCargaSimple: string; indiceCargaDoble: string; codigoVelocidad: string };

type Resultado = { modelo: string; ok: boolean; detalle: string };

export default function BuscadorIACatalogo({ onClose, onCreado, inicial }: {
  /** `creados`: lo que se acaba de dar de alta (para buscarlo y elegirlo después). */
  onClose: () => void; onCreado: (creados?: Array<{ marca: string; modelo: string; medida: string }>) => void;
  /** Abrir ya con esta marca, medida y modelo («Dar de alta con IA» desde Depurar catálogo). */
  inicial?: { marca: string; medida: string; modelo?: string };
}) {
  // Con `inicial` distinto de la última búsqueda, se empieza de cero.
  const otra = !!inicial && (inicial.marca !== ultimaBusqueda?.marca || inicial.medida !== ultimaBusqueda?.medida
    || (inicial.modelo ?? "") !== (ultimaBusqueda?.modelo ?? ""));
  const previa = otra ? null : ultimaBusqueda;
  const [marca, setMarca] = useState(inicial?.marca ?? previa?.marca ?? "");
  const [medida, setMedida] = useState(inicial?.medida ?? previa?.medida ?? "");
  const [modelo, setModelo] = useState(inicial?.modelo ?? previa?.modelo ?? "");
  const [marcas, setMarcas] = useState<string[]>([]);
  const [medidas, setMedidas] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [resp, setResp] = useState<RespuestaBusquedaIA | null>(previa?.resp ?? null);
  const [marcados, setMarcados] = useState<Set<string>>(previa?.marcados ?? new Set());
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>(previa?.ediciones ?? {});
  const [avisoCierre, setAvisoCierre] = useState(false);
  /** Referencias recién creadas cuya ficha se está rellenando. */
  const [rellenar, setRellenar] = useState<string[] | null>(null);

  // Las listas del catálogo. Si fallan, los desplegables salen vacíos y se
  // sigue pudiendo teclear: buscar una marca que no tenemos es el caso normal.
  useEffect(() => {
    void listarMarcas().then((ms) => setMarcas(ms.map((m) => m.nombre))).catch(() => setMarcas([]));
    void listarMedidas().then((ms) => setMedidas(ms.map((m) => m.valor))).catch(() => setMedidas([]));
  }, []);
  const [confirmando, setConfirmando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

  const clave = (c: Candidato) => `${c.fabricante}|${c.modelo}|${c.medida}`;

  const candidatos = resp?.candidatos ?? [];
  const seleccionados = useMemo(
    () => candidatos.filter((c) => marcados.has(clave(c))),
    [candidatos, marcados],
  );

  async function buscar() {
    if (!marca.trim() || !medida.trim() || buscando) return;
    setBuscando(true); setError(""); setResp(null); setResultados(null);
    setMarcados(new Set()); setEdiciones({});
    try {
      const r = await buscarModelosIA({ marca: marca.trim(), medida: medida.trim(), modelo: modelo.trim() || undefined });
      setResp(r);
      // Se marcan solos los que se pueden crear sin tocar nada. Lo demás pide
      // una decisión, y marcarlo por ellos sería tomarla.
      setMarcados(new Set(r.candidatos.filter((c) => c.estado === "nuevo").map(clave)));
      const ed: Record<string, Edicion> = {};
      for (const c of r.candidatos) {
        ed[clave(c)] = {
          indiceCargaSimple: c.indiceCargaSimple ?? "",
          indiceCargaDoble: c.indiceCargaDoble ?? "",
          codigoVelocidad: (c.codigoVelocidad ?? "").toUpperCase(),
        };
      }
      setEdiciones(ed);
    } catch (e: any) {
      setError(e?.message ?? "No se ha podido buscar");
    } finally {
      setBuscando(false);
    }
  }

  // Se guarda en cada cambio, no solo al buscar: así cerrar sin querer tampoco
  // se lleva por delante las casillas marcadas ni los índices corregidos.
  useEffect(() => {
    if (resp) ultimaBusqueda = { marca, medida, modelo, resp, marcados, ediciones };
  }, [marca, medida, modelo, resp, marcados, ediciones]);

  function alternar(c: Candidato) {
    const k = clave(c);
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  }

  function editar(c: Candidato, campo: keyof Edicion, valor: string) {
    const k = clave(c);
    setEdiciones((prev) => ({ ...prev, [k]: { ...prev[k], [campo]: valor } }));
  }

  /** Lo que impide guardar una fila concreta, ya con lo editado a mano. */
  function problema(c: Candidato): string {
    const e = ediciones[clave(c)];
    if (!e?.indiceCargaSimple.trim()) return "falta el índice de carga";
    if (!/^\d{2,3}$/.test(e.indiceCargaSimple.trim())) return "el índice de carga no es un número de 2 o 3 cifras";
    if (e.indiceCargaDoble.trim() && !/^\d{2,3}$/.test(e.indiceCargaDoble.trim())) return "el índice de carga doble no cuadra";
    if (e.codigoVelocidad.trim() && !/^[A-Za-z]$/.test(e.codigoVelocidad.trim())) return "el código de velocidad es una sola letra";
    return "";
  }

  const bloqueados = seleccionados.filter((c) => problema(c));

  async function crear() {
    setCreando(true);
    const out: Resultado[] = [];
    const creadas: string[] = [];
    const hechas = new Set<string>();
    const altas: Array<{ marca: string; modelo: string; medida: string }> = [];
    for (const c of seleccionados) {
      const e = ediciones[clave(c)];
      try {
        const id = await crearReferenciaNeumatico({
          marca: c.fabricante,
          modelo: c.modelo,
          medida: c.medida,
          indiceCargaSimple: e.indiceCargaSimple.trim(),
          indiceCargaDoble: e.indiceCargaDoble.trim() || null,
          codigoVelocidad: e.codigoVelocidad.trim().toUpperCase(),
          // El catálogo solo admite cuatro ejes; lo que no encaje va sin eje
          // antes que con uno inventado, y el alta no revienta por ello.
          eje: ejeDelCandidato(c.posicion),
          aplicacion: c.utilizacion ?? null,
        });
        creadas.push(id);
        hechas.add(clave(c));
        altas.push({ marca: c.fabricante, modelo: c.modelo, medida: c.medida });
        out.push({ modelo: `${c.fabricante} ${c.modelo}`, ok: true, detalle: "Creado" });
      } catch (err: any) {
        out.push({ modelo: `${c.fabricante} ${c.modelo}`, ok: false, detalle: err?.message ?? "No se ha podido crear" });
      }
    }
    setResultados(out);
    // Lo creado ya está en el catálogo: se desmarca y pasa a «Ya está», para
    // que «Crear» no vuelva a ofrecerlo.
    if (hechas.size) {
      setMarcados((m) => new Set([...m].filter((k) => !hechas.has(k))));
      setResp((r) => r && {
        ...r,
        candidatos: r.candidatos.map((c) => hechas.has(clave(c))
          ? { ...c, estado: "existente" as const, motivo: "Creado ahora en el catálogo." }
          : c),
      });
    }
    setCreando(false);
    setConfirmando(false);
    if (out.some((r) => r.ok)) onCreado(altas);
    // Y a continuación, la ficha técnica de lo creado (profundidad, diámetro,
    // cargas, etiqueta UE…), con la misma búsqueda y reglas de «Completar fichas».
    if (creadas.length) setRellenar([...new Set(creadas)]);
  }

  return (
    <Modal
      title="Buscar neumáticos con IA"
      // Cerrar con una búsqueda en marcha tira dos minutos de espera, y el
      // servidor la termina y se cobra igual: solo se pierde la respuesta.
      // Por eso se pregunta en vez de obedecer el clic.
      onClose={() => (buscando ? setAvisoCierre(true) : onClose())}
      size="xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <SelectorConAlta
              label="Marca"
              opciones={opcionesConElegido(marcas, marca)}
              valor={marca}
              onChange={setMarca}
              // No se da de alta nada: lo tecleado solo sirve para esta
              // búsqueda. Dar de alta la marca antes de saber si sus modelos
              // existen sería ensuciar el catálogo para poder consultarlo.
              onCrear={async (n) => n.trim()}
              placeholder="CEAT"
              deshabilitado={buscando}
              ayuda="Si no está en la lista, pulsa ＋ y escríbela. No se da de alta: solo se usa para buscar."
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <SelectorConAlta
              label="Medida"
              opciones={opcionesConElegido(medidas, medida)}
              valor={medida}
              onChange={setMedida}
              onCrear={async (n) => n.trim()}
              placeholder="295/80R22.5"
              deshabilitado={buscando}
              ayuda="La del neumático que buscas, no la del vehículo."
            />
          </div>
          <label className="block min-w-[9rem] flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-400">Modelo (opcional)</span>
            <input id="buscador-ia-modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} disabled={buscando}
              placeholder="AH31" maxLength={80}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base text-slate-100 outline-none focus:ring-2 focus:ring-sky-500 sm:text-sm" />
            <span className="mt-1 block text-[11px] text-slate-500">Para buscar solo ese modelo. Vacío: todos los de la marca y medida.</span>
          </label>
          <button
            onClick={() => void buscar()}
            disabled={buscando || !marca.trim() || !medida.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Search size={15} /> {buscando ? "Buscando…" : "Buscar modelos"}
          </button>
        </div>

        {buscando && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-[13px] text-sky-200">
            Buscando en los catálogos del fabricante y de distribuidores. Tarda hasta un
            par de minutos: está leyendo páginas, no contestando de memoria.
          </div>
        )}

        {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[13px] text-rose-200">{error}</div>}

        {resp && (
          <>
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-[13px]">
              <p className="text-slate-300">
                He entendido: marca <b className="text-slate-100">{resp.consulta.fabricante ?? "—"}</b>,
                medida <b className="text-slate-100">{resp.consulta.medida ?? "—"}</b>
                {resp.consulta.modelo && <>, modelo <b className="text-slate-100">{resp.consulta.modelo}</b></>}.
                {resp.enCatalogo > 0 && (
                  <> En el catálogo ya hay {resp.enCatalogo} referencia{resp.enCatalogo === 1 ? "" : "s"} de esa marca.</>
                )}
              </p>
              {resp.aviso && <p className="mt-1 text-amber-300">{resp.aviso}</p>}
              {resp.citas.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12px] text-slate-500 hover:text-slate-300">
                    {resp.citas.length} página{resp.citas.length === 1 ? "" : "s"} consultada{resp.citas.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {resp.citas.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 hover:underline break-all">{u}</a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {candidatos.length > 0 && (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={thCls}></th>
                      <th className={thCls}>Estado</th>
                      <th className={thCls}>Modelo</th>
                      <th className={thCls}>Medida</th>
                      <th className={thCls}>Carga</th>
                      <th className={thCls}>Vel.</th>
                      <th className={thCls}>Uso</th>
                      <th className={thCls}>M+S / 3PMSF</th>
                      <th className={thCls}>Fuente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidatos.map((c) => {
                      const k = clave(c);
                      const e = ediciones[k];
                      const est = ESTADO[c.estado];
                      const puede = c.estado !== "no_verificado" && c.estado !== "existente";
                      const mal = marcados.has(k) ? problema(c) : "";
                      return (
                        <tr key={k} className="border-t border-slate-700/60 align-top">
                          <td className={tdCls}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-emerald-500"
                              checked={marcados.has(k)}
                              disabled={!puede}
                              onChange={() => alternar(c)}
                              aria-label={`Seleccionar ${c.modelo}`}
                            />
                          </td>
                          <td className={tdCls}>
                            <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${est.clase}`}>
                              <est.Icono size={12} /> {est.texto}
                            </span>
                            <div className="mt-1 max-w-[16rem] text-[11px] text-slate-400">{c.motivo}</div>
                            {mal && <div className="mt-1 text-[11px] text-rose-300">No se puede guardar: {mal}</div>}
                          </td>
                          <td className={tdCls}>
                            <div className="font-semibold text-slate-100">{c.modelo}</div>
                            <div className="text-[11px] text-slate-500">{c.fabricante}</div>
                          </td>
                          <td className={tdCls + " whitespace-nowrap text-slate-300"}>{c.medida}</td>
                          <td className={tdCls}>
                            <div className="flex items-center gap-1">
                              <input className={IDX + " w-16"} inputMode="numeric" onFocus={(ev) => ev.target.select()} value={e?.indiceCargaSimple ?? ""}
                                onChange={(ev) => editar(c, "indiceCargaSimple", ev.target.value)} disabled={!puede} aria-label="Índice de carga" />
                              <span className="text-slate-600">/</span>
                              <input className={IDX + " w-16"} inputMode="numeric" onFocus={(ev) => ev.target.select()} value={e?.indiceCargaDoble ?? ""}
                                onChange={(ev) => editar(c, "indiceCargaDoble", ev.target.value)} disabled={!puede} aria-label="Índice de carga doble" />
                            </div>
                          </td>
                          <td className={tdCls}>
                            <input className={IDX + " w-12 uppercase"} maxLength={1} onFocus={(ev) => ev.target.select()} value={e?.codigoVelocidad ?? ""}
                              onChange={(ev) => editar(c, "codigoVelocidad", ev.target.value)} disabled={!puede} aria-label="Código de velocidad" />
                          </td>
                          <td className={tdCls + " text-[12px] text-slate-400"}>
                            {[c.posicion, c.utilizacion].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className={tdCls + " text-[12px] text-slate-400"}>
                            {c.ms ? "M+S" : "—"} / {c.tresPmsf ? "3PMSF" : "—"}
                          </td>
                          <td className={tdCls}>
                            {c.fuentes.length === 0 ? <span className="text-[11px] text-rose-300">sin fuente</span> : (
                              <ul className="space-y-0.5">
                                {c.fuentes.slice(0, 3).map((f) => (
                                  <li key={f.url}>
                                    <a href={f.url} target="_blank" rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline">
                                      <ExternalLink size={10} /> {f.titulo?.slice(0, 40) || new URL(f.url).hostname}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {c.parecidos.length > 0 && (
                              <div className="mt-1 text-[11px] text-amber-300/80">
                                Ya hay: {c.parecidos.map((p) => `${p.modelo} ${p.medida}`).join(", ")}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}

            {candidatos.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 pt-3">
                <div className="text-[12px] text-slate-400">
                  {seleccionados.length} seleccionado{seleccionados.length === 1 ? "" : "s"} de {candidatos.length}
                  {bloqueados.length > 0 && (
                    <span className="text-rose-300"> · {bloqueados.length} con datos que faltan</span>
                  )}
                </div>
                <button
                  onClick={() => setConfirmando(true)}
                  disabled={!seleccionados.length || bloqueados.length > 0 || creando}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Crear {seleccionados.length} en catálogo
                </button>
              </div>
            )}
          </>
        )}

        {resultados && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
            <p className="text-sm font-bold text-slate-200">Resultado</p>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {resultados.map((r, i) => (
                <li key={i} className={r.ok ? "text-emerald-300" : "text-rose-300"}>
                  {r.ok ? "✓" : "✗"} {r.modelo} — {r.detalle}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {avisoCierre && (
        <Modal title="La búsqueda sigue en marcha" onClose={() => setAvisoCierre(false)}>
          <p className="text-sm text-slate-300">
            Si cierras ahora pierdes el resultado. El servidor termina de buscar igual
            —y se cobra igual—, pero la respuesta no llega a ninguna parte.
          </p>
          <p className="mt-2 text-[13px] text-slate-400">
            Si necesitas hacer otra cosa, cambia de pestaña del navegador y vuelve: así no
            se pierde. Lo que sí la pierde es cambiar de pantalla o recargar.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setAvisoCierre(false)}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white hover:bg-sky-500">Seguir esperando</button>
            <button onClick={onClose}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300">Cerrar y perderla</button>
          </div>
        </Modal>
      )}

      {confirmando && (
        <Modal title="Confirmar alta en el catálogo" onClose={() => setConfirmando(false)}>
          <p className="text-sm text-slate-300">
            Se van a crear {seleccionados.length} referencia{seleccionados.length === 1 ? "" : "s"} en el
            catálogo. Compruébalas: una vez dentro, las ve todo el mundo.
          </p>
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto text-[13px] text-slate-200">
            {seleccionados.map((c) => {
              const e = ediciones[clave(c)];
              return (
                <li key={clave(c)}>
                  · {c.fabricante} {c.modelo} {c.medida} {e.indiceCargaSimple}
                  {e.indiceCargaDoble ? `/${e.indiceCargaDoble}` : ""}{e.codigoVelocidad.toUpperCase()}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setConfirmando(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300">Cancelar</button>
            <button onClick={() => void crear()} disabled={creando}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {creando ? "Creando…" : "Sí, crear"}
            </button>
          </div>
        </Modal>
      )}
      {rellenar && (
        <CompletarFichasIA referenciaIds={rellenar} onClose={() => setRellenar(null)} onCambio={() => onCreado()} />
      )}
    </Modal>
  );
}
