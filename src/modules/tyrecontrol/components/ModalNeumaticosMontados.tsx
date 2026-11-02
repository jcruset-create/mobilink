/**
 * Los neumáticos que el vehículo YA LLEVA PUESTOS, sobre el plano entero.
 *
 * Dos trabajos que se hacen aquí y que el histórico NO confunde:
 *
 *  - **Informar por primera vez**: el camión entra en TyreControl con sus
 *    gomas montadas desde hace meses. Apuntarlas no es una venta, ni un
 *    trabajo de taller, ni una salida de almacén.
 *  - **Actualizar lo que no coincide**: la rueda que hay delante no es la que
 *    dice la ficha. Eso corrige el REGISTRO; no es un cambio de neumático, no
 *    genera coste ni mano de obra, y la goma mal fichada pasa a «no
 *    localizado», no al almacén.
 *
 * Las dos escriben por funciones de la base que ya existían y que la tablet
 * usa desde hace meses. Aquí no se reimplementa ninguna regla: se le da al
 * panel la misma puerta, con el plano entero delante en vez de rueda a rueda.
 */

import { useEffect, useMemo, useState } from "react";
import {
  buscarNeumaticosParaCorregir, corregirMontado, corregirMontadoNuevaFicha,
  inventarioInicialFinalizar, inventarioInicialPosicion, listarReferenciasNeumatico,
} from "../services/data";
import {
  accionDeFila, borradorVacio, datosMedicion, descripcionNeumatico, etiquetaNeumatico,
  filasDelPlano, planoCompleto, posicionesSinInformar, resumen, validarFila,
  type BorradorFila, type FilaMontada,
} from "../services/neumaticosMontados";
import type { MontajeActual, Neumatico, PosicionVehiculo, ReferenciaNeumatico } from "../types";
import { baseMedida } from "../services/medidas";
import { Modal, inputCls } from "./ui";

interface Props {
  modo: "informar" | "actualizar";
  vehiculoId: string;
  empresaId: string;
  matricula?: string | null;
  posiciones: PosicionVehiculo[];
  montajes: MontajeActual[];
  /** Medida configurada del vehículo: filtra el catálogo por defecto. */
  medidaVehiculo?: string | null;
  kmActual?: number | null;
  onClose: () => void;
  /** Recargar el vehículo en la pantalla de detrás. */
  onChanged: () => void;
}

/** El mensaje que trae un error, sin quedarse en «[object Object]». */
function mensajeError(e: unknown, porDefecto: string): string {
  return e instanceof Error && e.message ? e.message : porDefecto;
}

/** Máximo de referencias que se pintan de golpe en un desplegable. */
const MAX_OPCIONES = 200;

export default function ModalNeumaticosMontados({
  modo, vehiculoId, empresaId, matricula, posiciones, montajes, medidaVehiculo, kmActual, onClose, onChanged,
}: Props) {
  const filas = useMemo(() => filasDelPlano(posiciones, montajes), [posiciones, montajes]);
  const [borradores, setBorradores] = useState<Record<string, BorradorFila>>({});
  const [referencias, setReferencias] = useState<ReferenciaNeumatico[]>([]);
  const [busquedaRef, setBusquedaRef] = useState("");
  const [soloMedida, setSoloMedida] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [hechas, setHechas] = useState<string[]>([]);   // códigos guardados en esta sesión
  const [fallos, setFallos] = useState<{ codigo: string; error: string }[]>([]);
  const [km, setKm] = useState("");
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => { listarReferenciasNeumatico().then(setReferencias).catch(() => setReferencias([])); }, []);

  const b = (posicionId: string): BorradorFila => borradores[posicionId] ?? borradorVacio();
  const set = (posicionId: string, cambio: Partial<BorradorFila>) =>
    setBorradores((prev) => ({ ...prev, [posicionId]: { ...b(posicionId), ...cambio } }));

  // El catálogo, filtrado. Por defecto solo la medida del vehículo: ofrecer
  // las 500 referencias para elegir una 295/80R22.5 es ofrecer un error.
  const opciones = useMemo(() => {
    const t = busquedaRef.trim().toLowerCase();
    return referencias
      .filter((r) => !soloMedida || !medidaVehiculo || baseMedida(r.tyre_size?.medida) === baseMedida(medidaVehiculo))
      .filter((r) => !t || (r.referencia_completa ?? "").toLowerCase().includes(t))
      .slice(0, MAX_OPCIONES);
  }, [referencias, busquedaRef, soloMedida, medidaVehiculo]);

  const plan = resumen(filas, borradores);
  const completo = planoCompleto(filas);
  const faltan = posicionesSinInformar(filas);
  // El inventario inicial solo se cierra si se ha abierto: en un vehículo que
  // ya estaba operativo y solo se viene a corregir, no hay nada que cerrar.
  const hayInventarioAbierto = modo === "informar" && (hechas.length > 0 || completo);

  /** Pone la misma referencia y la misma profundidad en todas las libres. */
  function aplicarATodas(referenciaId: string, profundidad: string) {
    setBorradores((prev) => {
      const siguiente = { ...prev };
      for (const f of filas) {
        if (f.montajeId) continue;
        siguiente[f.posicionId] = { ...(siguiente[f.posicionId] ?? borradorVacio()), referenciaId, profundidadMm: profundidad };
      }
      return siguiente;
    });
  }

  async function guardar() {
    setGuardando(true); setMsg(""); setFallos([]);
    const ok: string[] = [];
    const mal: { codigo: string; error: string }[] = [];
    // De una en una y a propósito: cada posición es una llamada que puede
    // fallar por su cuenta (un número de serie repetido, una medida que no
    // encaja) y lo que haya entrado bien tiene que quedarse dentro.
    for (const fila of filas) {
      const borrador = b(fila.posicionId);
      const accion = accionDeFila(fila, borrador);
      if (accion === "nada") continue;
      const error = validarFila(fila, borrador);
      if (error) { mal.push({ codigo: fila.codigo, error }); continue; }
      try {
        if (accion === "informar" || accion === "medir") {
          await inventarioInicialPosicion({
            vehiculoId, posicionId: fila.posicionId,
            // Al medir una posición ya informada la base no mira la
            // referencia: ve que hay goma y solo corrige la medición. Se
            // manda null en vez de una cualquiera, que es lo que de verdad
            // pasa: aquí nadie ha elegido un neumático de catálogo.
            referenciaId: borrador.referenciaId || null,
            datos: datosMedicion(borrador),
          });
        } else if (accion === "corregir") {
          await corregirMontado({
            montajeId: fila.montajeId!, neumaticoCorrectoId: borrador.neumaticoCorrectoId,
            observaciones: borrador.motivo.trim() || null, metodo: "busqueda",
          });
        } else {
          await corregirMontadoNuevaFicha({
            montajeId: fila.montajeId!, marca: borrador.marca.trim(),
            modelo: borrador.modelo.trim() || null, medida: borrador.medida.trim(),
            dot: borrador.dot.trim() || null, numeroSerie: borrador.numeroSerie.trim() || null,
            observaciones: borrador.motivo.trim() || null, metodo: "manual",
          });
        }
        ok.push(fila.codigo);
        setBorradores((prev) => { const s = { ...prev }; delete s[fila.posicionId]; return s; });
      } catch (e: unknown) {
        mal.push({ codigo: fila.codigo, error: mensajeError(e, "Error al guardar") });
      }
    }
    setHechas((prev) => [...prev, ...ok]);
    setFallos(mal);
    setGuardando(false);
    if (ok.length) onChanged();
    setMsg(ok.length
      ? `Guardadas ${ok.length} posiciones${mal.length ? `; ${mal.length} sin guardar` : ""}.`
      : mal.length ? "No se ha podido guardar ninguna." : "No había nada que guardar.");
  }

  async function finalizar() {
    setGuardando(true); setMsg("");
    try {
      const kmNum = km.trim() ? Number(km.trim().replace(",", ".")) : null;
      const r = await inventarioInicialFinalizar({ vehiculoId, km: Number.isFinite(kmNum as number) ? kmNum : null });
      setCerrado(true);
      setMsg(r.ya_estaba ? "El inventario inicial ya estaba cerrado." : "Inventario inicial cerrado. El vehículo queda operativo.");
      onChanged();
    } catch (e: unknown) {
      setMsg(mensajeError(e, "No se ha podido cerrar el inventario"));
    } finally { setGuardando(false); }
  }

  const titulo = modo === "informar"
    ? `Informar los neumáticos que ya lleva montados${matricula ? ` · ${matricula}` : ""}`
    : `Actualizar los neumáticos montados${matricula ? ` · ${matricula}` : ""}`;

  return (
    <Modal
      title={titulo}
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12px] text-slate-400">
            {plan.total === 0 ? "Nada pendiente de guardar." : (
              <>
                Se va a escribir en <b className="text-slate-100">{plan.total}</b>{" "}
                {plan.total === 1 ? "posición" : "posiciones"}
                {plan.informar > 0 && <> · {plan.informar} a informar</>}
                {plan.corregir > 0 && <> · {plan.corregir} a corregir</>}
                {plan.medir > 0 && <> · {plan.medir} a medir</>}
              </>
            )}
            {plan.errores.length > 0 && (
              <div className="mt-1 text-amber-300">
                {plan.errores.length} {plan.errores.length === 1 ? "fila" : "filas"} sin completar: {plan.errores.map((e) => e.codigo).join(", ")}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button>
            <button
              onClick={guardar}
              disabled={guardando || plan.total === 0 || plan.errores.length > 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Aviso modo={modo} />

        {modo === "informar" && (
          <BloqueCatalogo
            opciones={opciones}
            totalReferencias={referencias.length}
            busqueda={busquedaRef}
            onBusqueda={setBusquedaRef}
            soloMedida={soloMedida}
            onSoloMedida={setSoloMedida}
            medidaVehiculo={medidaVehiculo ?? null}
            libres={filas.filter((f) => !f.montajeId).length}
            onAplicar={aplicarATodas}
          />
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Posición</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Qué hay</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Prof. mm</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Presión bar</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Nº serie / DOT</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <Fila
                  key={fila.posicionId}
                  fila={fila}
                  borrador={b(fila.posicionId)}
                  modo={modo}
                  empresaId={empresaId}
                  opciones={opciones}
                  guardada={hechas.includes(fila.codigo)}
                  onCambio={(c) => set(fila.posicionId, c)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {fallos.length > 0 && (
          <div className="rounded-lg border border-rose-700/50 bg-rose-500/5 p-3 text-[12px] text-rose-200">
            <div className="font-bold">Lo que no ha entrado, y por qué:</div>
            {fallos.map((f) => <div key={f.codigo} className="mt-1">· <b>{f.codigo}</b>: {f.error}</div>)}
          </div>
        )}

        {msg && <div className="text-[12px] font-semibold text-slate-200">{msg}</div>}

        {hayInventarioAbierto && !cerrado && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400">Cerrar el inventario inicial</div>
            <div className="mt-1 text-[12px] text-slate-400">
              Deja el vehículo operativo. Hace falta goma y profundidad en todas las posiciones del plano.
              {!completo && faltan.length > 0 && (
                <div className="mt-1 text-amber-300">Faltan por informar: {faltan.join(", ")}</div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Kilómetros del vehículo (opcional)</span>
                <input className={`${inputCls} w-40`} inputMode="numeric" value={km}
                       onChange={(e) => setKm(e.target.value)} placeholder={kmActual != null ? String(kmActual) : "—"} />
              </label>
              <button onClick={finalizar} disabled={guardando || !completo}
                      className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                Finalizar inventario inicial
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Los kilómetros solo suben: una lectura más baja que la que ya hay no se escribe.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Aviso({ modo }: { modo: "informar" | "actualizar" }) {
  if (modo === "informar") {
    return (
      <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/5 p-3 text-[12px] text-emerald-200">
        Esto <b>no es un montaje</b>: no descuenta stock, no genera coste ni mano de obra y no factura.
        Son las gomas que el vehículo <b>ya llevaba puestas</b> cuando entró en Mobilink, y se apuntan
        con la profundidad que tienen hoy, no con la de dibujo del catálogo.
        <div className="mt-1">
          La profundidad es obligatoria. La presión, solo si la has medido: en blanco queda como no
          medida, que no es lo mismo que cero.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-[12px] text-amber-200">
      Esto <b>no es un cambio de neumático</b>: no se registra montaje ni desmontaje y no genera coste
      ni mano de obra. Solo corrige qué neumático dice Mobilink que hay en cada posición, para que
      coincida con lo que hay de verdad.
      <div className="mt-1">
        El que estaba mal registrado pasa a <b>no localizado</b>, no al almacén: que la ficha
        estuviera mal no significa que la goma esté en la estantería.
      </div>
    </div>
  );
}

function BloqueCatalogo({
  opciones, totalReferencias, busqueda, onBusqueda, soloMedida, onSoloMedida, medidaVehiculo, libres, onAplicar,
}: {
  opciones: ReferenciaNeumatico[]; totalReferencias: number; busqueda: string; onBusqueda: (v: string) => void;
  soloMedida: boolean; onSoloMedida: (v: boolean) => void; medidaVehiculo: string | null;
  libres: number; onAplicar: (referenciaId: string, profundidad: string) => void;
}) {
  const [refTodas, setRefTodas] = useState("");
  const [profTodas, setProfTodas] = useState("");
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="text-[11px] font-bold uppercase text-slate-400">El neumático del catálogo</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input className={inputCls} placeholder="Buscar marca, modelo o medida"
               value={busqueda} onChange={(e) => onBusqueda(e.target.value)} />
        {medidaVehiculo && (
          <label className="flex items-center gap-2 text-[12px] text-slate-300">
            <input type="checkbox" checked={!soloMedida} onChange={(e) => onSoloMedida(!e.target.checked)} />
            Mostrar todas las medidas (por defecto solo {medidaVehiculo})
          </label>
        )}
      </div>
      {libres > 1 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-700/60 pt-3">
          <label className="block grow">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Mismo neumático en las {libres} libres</span>
            <select className={inputCls} value={refTodas} onChange={(e) => setRefTodas(e.target.value)}>
              <option value="">— elige una referencia —</option>
              {opciones.map((r) => <option key={r.id} value={r.id}>{r.referencia_completa}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Prof. mm</span>
            <input className={`${inputCls} w-24`} inputMode="decimal" value={profTodas}
                   onChange={(e) => setProfTodas(e.target.value)} placeholder="12,5" />
          </label>
          <button
            onClick={() => onAplicar(refTodas, profTodas)}
            disabled={!refTodas}
            className="rounded bg-slate-700 px-3 py-2 text-[12px] font-bold text-slate-100 disabled:opacity-40"
          >
            Poner en todas
          </button>
        </div>
      )}
      {opciones.length === 0 && (
        <div className="mt-2 text-[11px] text-amber-300">
          Sin referencias que encajen{medidaVehiculo && soloMedida ? ` con la medida ${medidaVehiculo}` : ""}.
          Si la goma no está en el catálogo, hay que darla de alta antes.
        </div>
      )}
      {opciones.length >= MAX_OPCIONES && (
        <div className="mt-2 text-[11px] text-slate-500">
          Se muestran {MAX_OPCIONES} de {totalReferencias}: afina la búsqueda.
        </div>
      )}
    </div>
  );
}

function Fila({
  fila, borrador, modo, empresaId, opciones, guardada, onCambio,
}: {
  fila: FilaMontada; borrador: BorradorFila; modo: "informar" | "actualizar";
  empresaId: string; opciones: ReferenciaNeumatico[]; guardada: boolean;
  onCambio: (c: Partial<BorradorFila>) => void;
}) {
  const error = validarFila(fila, borrador);
  const accion = accionDeFila(fila, borrador);
  const libre = !fila.montajeId;
  // En «actualizar» una posición libre no se puede informar: no hay qué
  // corregir todavía. Dejar los campos abiertos sin que escriban nada sería
  // peor que no enseñarlos.
  const soloLectura = libre && modo === "actualizar";

  return (
    <>
      <tr className="border-t border-slate-700/60 align-top">
        <td className="px-3 py-2">
          <div className="font-semibold text-slate-100">{fila.codigo}</div>
          {guardada && <div className="text-[11px] font-bold text-emerald-400">guardada</div>}
          {accion !== "nada" && !guardada && (
            <div className="text-[11px] text-sky-300">
              {accion === "informar" ? "se informa" : accion === "medir" ? "se mide" : "se corrige"}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          {libre ? (
            modo === "informar" ? (
              <select className={`${inputCls} min-w-[16rem]`} value={borrador.referenciaId}
                      onChange={(e) => onCambio({ referenciaId: e.target.value })}>
                <option value="">— libre, sin informar —</option>
                {opciones.map((r) => <option key={r.id} value={r.id}>{r.referencia_completa}</option>)}
              </select>
            ) : (
              <span className="text-[12px] text-slate-500">Libre · se informa desde «Informar los que ya lleva»</span>
            )
          ) : (
            <div>
              <div className="font-semibold text-slate-100">{etiquetaNeumatico(fila.neumatico)}</div>
              <div className="text-[12px] text-slate-400">{descripcionNeumatico(fila.neumatico)}</div>
              {modo === "actualizar" && (
                <div className="mt-1 flex gap-3 text-[12px]">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={borrador.coincide} onChange={() => onCambio({ coincide: true })} />
                    Coincide
                  </label>
                  <label className="flex items-center gap-1 text-amber-300">
                    <input type="radio" checked={!borrador.coincide} onChange={() => onCambio({ coincide: false })} />
                    No coincide
                  </label>
                </div>
              )}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <input className={`${inputCls} w-20`} inputMode="decimal" value={borrador.profundidadMm}
                 onChange={(e) => onCambio({ profundidadMm: e.target.value })}
                 disabled={soloLectura} placeholder={libre ? "obligatoria" : "—"} />
        </td>
        <td className="px-3 py-2">
          <input className={`${inputCls} w-20`} inputMode="decimal" value={borrador.presionBar}
                 onChange={(e) => onCambio({ presionBar: e.target.value })} disabled={soloLectura} placeholder="—" />
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <input className={`${inputCls} w-28`} value={borrador.numeroSerie}
                   onChange={(e) => onCambio({ numeroSerie: e.target.value })} disabled={soloLectura} placeholder="Nº serie" />
            <input className={`${inputCls} w-20`} value={borrador.dot}
                   onChange={(e) => onCambio({ dot: e.target.value })} disabled={soloLectura} placeholder="DOT" />
          </div>
        </td>
      </tr>

      {!libre && !borrador.coincide && (
        <tr className="border-t border-slate-800 bg-slate-900/50">
          <td />
          <td colSpan={4} className="px-3 py-3">
            <Correccion fila={fila} borrador={borrador} empresaId={empresaId} onCambio={onCambio} />
          </td>
        </tr>
      )}

      {error && (
        <tr className="bg-slate-900/40">
          <td />
          <td colSpan={4} className="px-3 pb-2 text-[11px] font-semibold text-amber-300">{error}</td>
        </tr>
      )}
    </>
  );
}

/** Qué goma hay de verdad: una ficha que ya existe, o una que no estaba. */
function Correccion({
  fila, borrador, empresaId, onCambio,
}: { fila: FilaMontada; borrador: BorradorFila; empresaId: string; onCambio: (c: Partial<BorradorFila>) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState<Neumatico[]>([]);

  useEffect(() => {
    if (borrador.correccion !== "ficha") return;
    const t = setTimeout(() => {
      buscarNeumaticosParaCorregir(empresaId, busqueda).then(setCandidatos).catch(() => setCandidatos([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, empresaId, borrador.correccion]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-[12px]">
        <label className="flex items-center gap-1">
          <input type="radio" checked={borrador.correccion === "ficha"}
                 onChange={() => onCambio({ correccion: "ficha" })} />
          La goma que hay ya tiene ficha
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={borrador.correccion === "nueva"}
                 onChange={() => onCambio({ correccion: "nueva" })} />
          No está dada de alta
        </label>
      </div>

      {borrador.correccion === "ficha" ? (
        <div>
          <input className={inputCls} placeholder="Nº interno, nº de serie, RFID o DOT"
                 value={busqueda} onChange={(e) => { setBusqueda(e.target.value); onCambio({ neumaticoCorrectoId: "" }); }} />
          {/* No salen las montadas: ofrecer una que ya rueda en otro vehículo
              solo sirve para que la base lo rechace después. Sí salen las no
              localizadas y las usadas, que es donde suele estar la goma
              cuando el registro estaba mal. */}
          <select className={`${inputCls} mt-2`} size={5} value={borrador.neumaticoCorrectoId}
                  onChange={(e) => onCambio({ neumaticoCorrectoId: e.target.value })}>
            <option value="">— elige la ficha —</option>
            {candidatos.map((n) => (
              <option key={n.id} value={n.id}>
                {etiquetaNeumatico(n)} · {[n.marca, n.medida].filter(Boolean).join(" ")} · {n.estado}
              </option>
            ))}
          </select>
          {candidatos.length === 0 && (
            <div className="mt-1 text-[11px] text-amber-300">
              Ninguna ficha libre encaja. Si la goma que has encontrado no está dada de alta,
              marca «No está dada de alta» y se crea aquí.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={inputCls} placeholder="Marca *" value={borrador.marca}
                 onChange={(e) => onCambio({ marca: e.target.value })} />
          <input className={inputCls} placeholder="Modelo" value={borrador.modelo}
                 onChange={(e) => onCambio({ modelo: e.target.value })} />
          <input className={inputCls} placeholder="Medida *" value={borrador.medida}
                 onChange={(e) => onCambio({ medida: e.target.value })} />
        </div>
      )}

      <input className={inputCls} value={borrador.motivo} onChange={(e) => onCambio({ motivo: e.target.value })}
             placeholder={`Por qué se corrige ${fila.codigo} (p. ej.: revisión en papel del 01/09, la rueda no era la fichada)`} />
    </div>
  );
}
