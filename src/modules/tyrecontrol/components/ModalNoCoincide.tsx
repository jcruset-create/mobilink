/**
 * «No coincide»: la goma que hay puesta no es la que Mobilink dice. Es una
 * CORRECCIÓN DE FICHA, no un trabajo: no se monta ni se desmonta nada, no
 * genera coste, y la que estaba mal registrada pasa a no localizada.
 *
 * Dos caminos: elegir una ficha que ya existe (buscándola por nº interno,
 * serie, RFID o DOT) o dar de alta una goma nueva eligiéndola del catálogo.
 *
 * Se abre desde el plano del vehículo y desde Revisión de vehículo.
 */
import { useEffect, useState } from "react";
import {
  buscarNeumaticosParaCorregir, corregirConReferencia, corregirMontado, listarReferenciasNeumatico,
} from "../services/data";
import { mismaMedida } from "../services/medidas";
import type { MontajeActual, Neumatico, ReferenciaNeumatico } from "../types";
import { inputCls, Modal } from "./ui";

export default function ModalNoCoincide({ montaje, empresaId, onClose, onCorregido }: {
  montaje: MontajeActual;
  empresaId: string;
  onClose: () => void;
  onCorregido: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [correccionBusqueda, setCorreccionBusqueda] = useState("");
  const [correccionOpciones, setCorreccionOpciones] = useState<Neumatico[]>([]);
  const [correccionElegido, setCorreccionElegido] = useState("");
  const [correccionObs, setCorreccionObs] = useState("");
  const [correccionMsg, setCorreccionMsg] = useState("");
  // La goma de verdad no tiene ficha: se da de alta eligiéndola del catálogo.
  const [correccionModo, setCorreccionModo] = useState<"ficha" | "catalogo">("ficha");
  const [referencias, setReferencias] = useState<ReferenciaNeumatico[] | null>(null);
  const [refBusqueda, setRefBusqueda] = useState("");
  const [refElegida, setRefElegida] = useState("");
  const [refDot, setRefDot] = useState("");
  const [refSerie, setRefSerie] = useState("");

  // Se busca al abrir y a cada tecla, con una espera corta: el técnico teclea
  // el número que ve en el flanco y quiere verlo aparecer, no darle a un botón.
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      buscarNeumaticosParaCorregir(empresaId, correccionBusqueda)
        .then((r) => { if (vivo) setCorreccionOpciones(r); })
        .catch(() => { if (vivo) setCorreccionOpciones([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [correccionBusqueda, empresaId]);

  // El catálogo se lee una vez, al pasar a «goma nueva del catálogo».
  useEffect(() => {
    if (correccionModo !== "catalogo" || referencias) return;
    let vivo = true;
    listarReferenciasNeumatico()
      .then((r) => { if (vivo) setReferencias(r); })
      .catch((e: unknown) => { if (vivo) { setReferencias([]); setCorreccionMsg((e as Error)?.message ?? "No se ha podido leer el catálogo"); } });
    return () => { vivo = false; };
  }, [correccionModo, referencias]);

  async function confirmarCorreccion() {
    if (correccionModo === "catalogo") {
      const ref = referencias?.find((r) => r.id === refElegida);
      if (!ref) return;
      setSaving(true); setCorreccionMsg("");
      try {
        await corregirConReferencia({
          montajeId: montaje.id, referencia: ref,
          dot: refDot.trim() || null, numeroSerie: refSerie.trim() || null,
          observaciones: correccionObs.trim() || null,
        });
        onCorregido();
      } catch (e: unknown) {
        setCorreccionMsg((e as Error)?.message || "Error en la corrección");
      } finally { setSaving(false); }
      return;
    }
    if (!correccionElegido) return;
    setSaving(true); setCorreccionMsg("");
    try {
      await corregirMontado({
        montajeId: montaje.id,
        neumaticoCorrectoId: correccionElegido,
        observaciones: correccionObs.trim() || null,
        // Desde el panel se elige una ficha que ya existe, buscándola.
        metodo: "busqueda",
      });
      onCorregido();
    } catch (e: unknown) {
      setCorreccionMsg((e as Error)?.message || "Error en la corrección");
    } finally { setSaving(false); }
  }

      const actual = montaje.neumatico;
      const elegido = correccionOpciones.find((n) => n.id === correccionElegido);
      const refSel = referencias?.find((r) => r.id === refElegida) ?? null;
      // Por defecto, el catálogo de la misma medida que la goma registrada:
      // ofrecer 500 referencias para elegir una 295/80R22.5 es ofrecer un error.
      const t = refBusqueda.trim().toLowerCase();
      const refsVisibles = (referencias ?? [])
        .filter((r) => (t
          ? (r.referencia_completa ?? "").toLowerCase().includes(t)
          : !actual?.medida || mismaMedida(r.tyre_size?.medida ?? "", actual.medida)))
        .slice(0, 300);
      const puedeCorregir = correccionModo === "catalogo" ? !!refSel : !!correccionElegido;
      return (
        <Modal
          title="No coincide: corregir el neumático registrado"
          onClose={onClose}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              <button onClick={confirmarCorreccion} disabled={saving || !puedeCorregir}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "Corrigiendo…" : "Corregir el registro"}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-[12px] text-amber-200">
              Esto <b>no es un trabajo de taller</b>: no se registra montaje ni desmontaje y no
              genera coste ni mano de obra. Solo corrige qué neumático dice Mobilink que hay en
              esta posición, para que coincida con lo que hay de verdad.
              <div className="mt-1">
                El que estaba mal registrado pasa a <b>no localizado</b>, no al almacén: que la
                ficha estuviera mal no significa que la goma esté en la estantería.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <div className="text-[11px] font-bold uppercase text-slate-500">Lo que hay registrado</div>
                <div className="mt-1 font-semibold text-slate-100">{actual?.numero_interno ?? actual?.codigo_interno ?? actual?.numero_serie ?? "—"}</div>
                <div className="text-[12px] text-slate-400">{[actual?.marca, actual?.modelo, actual?.medida].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/5 p-3">
                <div className="text-[11px] font-bold uppercase text-emerald-500">Lo que hay de verdad</div>
                {correccionModo === "catalogo" ? (
                  <>
                    <div className="mt-1 font-semibold text-slate-100">{refSel ? "Ficha nueva" : "Elígela del catálogo"}</div>
                    <div className="text-[12px] text-slate-400">{refSel?.referencia_completa ?? "—"}</div>
                  </>
                ) : (
                  <>
                    <div className="mt-1 font-semibold text-slate-100">{elegido ? (elegido.numero_interno ?? elegido.codigo_interno ?? elegido.numero_serie ?? "—") : "Elígelo abajo"}</div>
                    <div className="text-[12px] text-slate-400">{elegido ? [elegido.marca, elegido.modelo, elegido.medida].filter(Boolean).join(" · ") : "—"}</div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-1 rounded-lg bg-slate-900/60 p-1 text-[12px]">
              {([["ficha", "Ya tiene ficha"], ["catalogo", "Goma nueva del catálogo"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setCorreccionModo(k)}
                  className={`flex-1 rounded px-3 py-1.5 font-semibold ${correccionModo === k ? "bg-sky-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
                  {l}
                </button>
              ))}
            </div>

            {correccionModo === "catalogo" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-bold uppercase text-slate-400">Buscar en el catálogo</label>
                  <input className={inputCls} placeholder={`Marca, modelo o medida${actual?.medida ? ` (sin escribir nada: ${actual.medida})` : ""}`}
                         value={refBusqueda} onChange={(e) => { setRefBusqueda(e.target.value); setRefElegida(""); }} />
                  <select className={`${inputCls} mt-2`} size={8} value={refElegida}
                          onChange={(e) => setRefElegida(e.target.value)}>
                    {refsVisibles.map((r) => <option key={r.id} value={r.id}>{r.referencia_completa}</option>)}
                  </select>
                  {referencias === null && <div className="mt-1 text-[11px] text-slate-400">Leyendo el catálogo…</div>}
                  {referencias !== null && refsVisibles.length === 0 && (
                    <div className="mt-1 text-[11px] text-amber-300">
                      No hay ninguna referencia que encaje. Si falta, créala en Catálogo de neumáticos con «+ Nueva referencia».
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-400">DOT (opcional)</label>
                    <input className={inputCls} placeholder="4524" value={refDot} onChange={(e) => setRefDot(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-400">Nº de serie (opcional)</label>
                    <input className={inputCls} value={refSerie} onChange={(e) => setRefSerie(e.target.value)} />
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Se da de alta una ficha nueva con esta referencia, ya montada en esta posición.
                </div>
              </div>
            )}

            {correccionModo === "ficha" && <div>
              <label className="text-[11px] font-bold uppercase text-slate-400">Buscar la ficha</label>
              <input className={inputCls} placeholder="Nº interno, nº de serie, RFID o DOT"
                     value={correccionBusqueda} onChange={(e) => { setCorreccionBusqueda(e.target.value); setCorreccionElegido(""); }} />
              {/* No salen las montadas: ofrecer una que ya rueda en otro
                  vehículo solo sirve para que la base de datos lo rechace
                  después. Sí salen las no localizadas y las usadas, que es
                  donde suele estar la goma cuando el registro estaba mal. */}
              <select className={`${inputCls} mt-2`} size={8} value={correccionElegido}
                      onChange={(e) => setCorreccionElegido(e.target.value)}>
                {correccionOpciones.map((n) => (
                  <option key={n.id} value={n.id}>
                    {(n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? n.id.slice(0, 8))}
                    {" · "}{[n.marca, n.medida].filter(Boolean).join(" ")}
                    {" · "}{n.estado}
                  </option>
                ))}
              </select>
              {correccionOpciones.length === 0 && (
                <div className="mt-1 text-[11px] text-amber-300">
                  No hay ninguna ficha libre que encaje. Si la goma que has encontrado no está
                  dada de alta, usa «Goma nueva del catálogo».
                </div>
              )}
            </div>}

            <div>
              <label className="text-[11px] font-bold uppercase text-slate-400">Por qué se corrige</label>
              <input className={inputCls} placeholder="P. ej.: revisión en papel del 01/09, la rueda no era la fichada"
                     value={correccionObs} onChange={(e) => setCorreccionObs(e.target.value)} />
            </div>

            {correccionMsg && <div className="text-[12px] text-red-300">{correccionMsg}</div>}
          </div>
        </Modal>
      );
}
