import { useEffect, useMemo, useState } from "react";
import {
  crearVehiculo, actualizarVehiculo, listarEmpresas, listarDelegaciones, listarTiposVehiculo,
  listarConfigEjes, listarTiposLlanta, listarMedidas, listarEjesVehiculo, guardarEjesVehiculo,
  listarMarcasVehiculo, aplicarFichaTecnica,
} from "../services/data";
import ModalNuevaMedida from "./ModalNuevaMedida";
import CrearVehiculoDesdeFicha, { type PendienteFicha } from "./CrearVehiculoDesdeFicha";
import type {
  Delegacion, Empresa, TipoVehiculo, Vehiculo, VehiculoInput, OrigenKm,
  ConfigEjes, TipoLlanta, MedidaNeumatico, VehiculoEje, MarcaVehiculo,
} from "../types";
import { ORIGEN_KM_LABELS, tipoLlantaLabel } from "../types";
import { Modal, inputCls, TextField, Field } from "./ui";

/*
 * El formulario del vehículo, uno solo.
 *
 * Vivía dentro de la pantalla de Vehículos, así que desde la ficha del
 * vehículo no se podía tocar nada: para corregir un bastidor había que
 * volver al listado, buscar la matrícula y editar allí. Ahora el formulario
 * es un componente y lo abren las dos pantallas, con los mismos campos y las
 * mismas validaciones.
 */

const VACIO: VehiculoInput = {
  empresa_id: "", delegacion_id: null, tipo_vehiculo_id: null, matricula: "", numero_unidad: "",
  marca: "", modelo: "", bastidor: "", fecha_matriculacion: null, webfleet_vehicle_id: "",
  km_actual: 0, origen_km: "manual", activo: true,
  config_ejes_id: null, medida_id: null, tipo_llanta_id: null, medidas_por_eje: false,
  revision_intervalo_dias: null, revision_intervalo_km: null,
};

// "2x2x2" → [2,2,2] (nº de ejes y ruedas por eje)
function ruedasDeConfig(nombre: string | undefined): number[] {
  if (!nombre) return [];
  return nombre.split(/x/i).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

export default function EditorVehiculo({
  vehiculo, matriculasExistentes, onClose, onGuardado,
}: {
  /** El vehículo a editar; sin él, se está creando uno nuevo. */
  vehiculo?: Vehiculo | null;
  /** Para avisar de matrículas repetidas al crear desde una ficha técnica. */
  matriculasExistentes?: Set<string>;
  onClose: () => void;
  onGuardado: (vehiculoId: string) => void | Promise<void>;
}) {
  const esNuevo = !vehiculo;
  const [draft, setDraft] = useState<VehiculoInput>({ ...VACIO, ...(vehiculo ?? {}) });
  const [ejes, setEjes] = useState<VehiculoEje[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  const [marcasVeh, setMarcasVeh] = useState<MarcaVehiculo[]>([]);
  const [configEjes, setConfigEjes] = useState<ConfigEjes[]>([]);
  const [tiposLlanta, setTiposLlanta] = useState<TipoLlanta[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [marcaLibre, setMarcaLibre] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [crearDesdeFicha, setCrearDesdeFicha] = useState(false);
  const [pendienteFicha, setPendienteFicha] = useState<PendienteFicha | null>(null);
  const [modalMedida, setModalMedida] = useState<null | ((id: string) => void)>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [e, d, t, c, l, m] = await Promise.all([
          listarEmpresas(), listarDelegaciones(), listarTiposVehiculo(),
          listarConfigEjes(), listarTiposLlanta(), listarMedidas(),
        ]);
        if (!vivo) return;
        setEmpresas(e); setDelegaciones(d); setTipos(t);
        setConfigEjes(c); setTiposLlanta(l); setMedidas(m);
        // El desglose por eje se arma con la configuración ya cargada.
        if (vehiculo?.medidas_por_eje) {
          const guardados = await listarEjesVehiculo(vehiculo.id).catch(() => [] as VehiculoEje[]);
          if (vivo) setEjes(desglose(c, vehiculo.config_ejes_id, guardados));
        }
      } catch (er: any) {
        if (vivo) setMsg(er?.message || "Error cargando los catálogos");
      }
    })();
    listarMarcasVehiculo().then((m) => { if (vivo) setMarcasVeh(m); }).catch(() => undefined);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculo?.id]);

  const delegacionesForm = useMemo(
    () => delegaciones.filter((d) => !draft.empresa_id || d.empresa_id === draft.empresa_id),
    [delegaciones, draft.empresa_id],
  );

  // Recalcula las filas de ejes a partir de la configuración elegida,
  // conservando la medida/llanta ya seleccionada por eje.
  function desglose(confs: ConfigEjes[], configId: string | null | undefined, previos: VehiculoEje[]): VehiculoEje[] {
    const conf = confs.find((c) => c.id === configId);
    return ruedasDeConfig(conf?.nombre).map((r, i) => {
      const prev = previos.find((e) => e.eje === i + 1);
      return { eje: i + 1, ruedas: r, medida_id: prev?.medida_id ?? null, tipo_llanta_id: prev?.tipo_llanta_id ?? null };
    });
  }

  function cambiarConfig(configId: string | null) {
    setDraft((d) => ({ ...d, config_ejes_id: configId }));
    if (draft.medidas_por_eje) setEjes((prev) => desglose(configEjes, configId, prev));
  }

  function cambiarPorEje(activo: boolean) {
    setDraft((d) => ({ ...d, medidas_por_eje: activo }));
    if (activo) setEjes((prev) => desglose(configEjes, draft.config_ejes_id, prev));
  }

  const set = (p: Partial<VehiculoInput>) => setDraft((d) => ({ ...d, ...p }));
  const setEje = (eje: number, p: Partial<VehiculoEje>) =>
    setEjes((prev) => prev.map((e) => (e.eje === eje ? { ...e, ...p } : e)));

  async function medidaCreada(id: string) {
    setMedidas(await listarMedidas());
    modalMedida?.(id);
    setModalMedida(null);
  }

  async function guardar() {
    if (!draft.empresa_id) { setMsg("Selecciona empresa"); return; }
    if (!draft.matricula.trim()) { setMsg("La matrícula es obligatoria"); return; }
    setSaving(true); setMsg("");
    try {
      let vehiculoId = vehiculo?.id ?? null;
      if (vehiculoId) await actualizarVehiculo(vehiculoId, draft);
      else vehiculoId = await crearVehiculo(draft);
      if (draft.medidas_por_eje && vehiculoId) await guardarEjesVehiculo(vehiculoId, ejes);
      let avisoFicha = "";
      if (esNuevo && vehiculoId && pendienteFicha) {
        try {
          await aplicarFichaTecnica(pendienteFicha.docId, {
            ejes: pendienteFicha.ejes,
            configuracion: pendienteFicha.configuracion,
            atributos: pendienteFicha.atributos,
            vehiculoId,
          });
        } catch (e: any) {
          avisoFicha = ` (el vehículo se creó, pero no se pudieron guardar todos los datos de la ficha: ${e?.message || "error"})`;
        }
      }
      if (avisoFicha) setMsg(avisoFicha.trim());
      await onGuardado(vehiculoId!);
      if (!avisoFicha) onClose();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un vehículo con esa matrícula en la empresa." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  return (
    <>
      <Modal title={esNuevo ? "Nuevo vehículo" : `Editar ${draft.matricula || "vehículo"}`} onClose={onClose}
        footer={<div className="flex items-center justify-end gap-2">
          {msg && <span className="mr-auto text-[12px] text-amber-300">{msg}</span>}
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
        </div>}>
        {esNuevo && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-700/50 bg-sky-950/30 p-2">
            <button type="button" onClick={() => setCrearDesdeFicha(true)} disabled={!draft.empresa_id}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
              📎 Crear desde ficha técnica (PDF/foto)
            </button>
            <span className="text-[11px] text-slate-400">
              {draft.empresa_id ? (pendienteFicha ? "Datos de la ficha listos para guardar." : "Rellena el resto a mano o adjunta la ficha.") : "Elige antes la empresa."}
            </span>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Empresa *">
            <select className={inputCls} value={draft.empresa_id} onChange={(e) => set({ empresa_id: e.target.value, delegacion_id: null })}>
              <option value="">Selecciona…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </Field>
          <Field label="Delegación">
            <select className={inputCls} value={draft.delegacion_id ?? ""} onChange={(e) => set({ delegacion_id: e.target.value || null })}>
              <option value="">—</option>
              {delegacionesForm.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </Field>
          <TextField label="Matrícula *" value={draft.matricula ?? ""} onChange={(v) => set({ matricula: v })} />
          <TextField label="Nº de unidad (flota)" value={draft.numero_unidad ?? ""} onChange={(v) => set({ numero_unidad: v })} />
          <Field label="Tipo de vehículo">
            <select className={inputCls} value={draft.tipo_vehiculo_id ?? ""} onChange={(e) => { setMarcaLibre(false); set({ tipo_vehiculo_id: e.target.value || null }); }}>
              <option value="">—</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
            </select>
          </Field>
          <Field label="Marca">
            {(() => {
              const tipoId = draft.tipo_vehiculo_id ?? "";
              const delTipo = tipoId ? marcasVeh.filter((m) => m.tipo_ids.includes(tipoId)) : [];
              const actual = draft.marca ?? "";
              // Sin tipo elegido, o si la marca guardada no está en el
              // catálogo, se escribe a mano para no bloquear el alta.
              const enCatalogo = delTipo.some((m) => m.nombre === actual);
              if (marcaLibre || !tipoId || (actual && !enCatalogo && delTipo.length === 0)) {
                return (
                  <div className="flex gap-2">
                    <input className={inputCls} value={actual} onChange={(e) => set({ marca: e.target.value })}
                      placeholder={tipoId ? "Marca…" : "Elige antes el tipo de vehículo"} />
                    {tipoId && (
                      <button type="button" onClick={() => setMarcaLibre(false)}
                        className="rounded border border-slate-600 px-2 text-[11px] text-slate-300">lista</button>
                    )}
                  </div>
                );
              }
              return (
                <div className="flex items-center gap-2">
                  {(() => {
                    const logo = delTipo.find((m) => m.nombre === actual)?.logo_url;
                    return logo ? <img src={logo} alt={actual} className="h-7 w-10 rounded border border-slate-700 bg-slate-950 object-contain" /> : null;
                  })()}
                  <select className={inputCls} value={enCatalogo ? actual : ""}
                    onChange={(e) => {
                      if (e.target.value === "__otra__") { setMarcaLibre(true); set({ marca: "" }); return; }
                      set({ marca: e.target.value });
                    }}>
                    <option value="">—</option>
                    {actual && !enCatalogo && <option value={actual}>{actual} (fuera de catálogo)</option>}
                    {delTipo.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                    <option value="__otra__">Otra…</option>
                  </select>
                </div>
              );
            })()}
          </Field>
          <TextField label="Modelo" value={draft.modelo ?? ""} onChange={(v) => set({ modelo: v })} />
          <TextField label="Bastidor" value={draft.bastidor ?? ""} onChange={(v) => set({ bastidor: v })} />

          {/* Configuración de neumáticos */}
          <Field label="Configuración de ejes">
            <select className={inputCls} value={draft.config_ejes_id ?? ""} onChange={(e) => cambiarConfig(e.target.value || null)}>
              <option value="">—</option>
              {configEjes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.descripcion ? ` · ${c.descripcion}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Medidas diferentes por eje">
            <select className={inputCls} value={draft.medidas_por_eje ? "1" : "0"} onChange={(e) => cambiarPorEje(e.target.value === "1")}>
              <option value="0">No · misma medida en todo el vehículo</option>
              <option value="1">Sí · indicar medida por cada eje</option>
            </select>
          </Field>

          {!draft.medidas_por_eje && (
            <>
              <Field label="Medida de neumático">
                <div className="flex gap-1">
                  <select className={inputCls} value={draft.medida_id ?? ""} onChange={(e) => set({ medida_id: e.target.value || null })}>
                    <option value="">—</option>
                    {medidas.map((m) => <option key={m.id} value={m.id}>{m.valor}</option>)}
                  </select>
                  <button type="button" onClick={() => setModalMedida(() => (id: string) => set({ medida_id: id }))}
                    className="shrink-0 rounded-lg border border-emerald-600 px-2 text-sm font-bold text-emerald-300 hover:bg-emerald-600/10" title="Crear nueva medida">+</button>
                </div>
              </Field>
              <Field label="Tipo de llanta">
                <select className={inputCls} value={draft.tipo_llanta_id ?? ""} onChange={(e) => set({ tipo_llanta_id: e.target.value || null })}>
                  <option value="">—</option>
                  {tiposLlanta.map((l) => <option key={l.id} value={l.id}>{tipoLlantaLabel(l)}</option>)}
                </select>
              </Field>
            </>
          )}

          <Field label="Fecha matriculación">
            <input type="date" className={inputCls} value={draft.fecha_matriculacion ?? ""} onChange={(e) => set({ fecha_matriculacion: e.target.value || null })} />
          </Field>
          <Field label="Km actual">
            <input type="number" className={inputCls} value={draft.km_actual} onChange={(e) => set({ km_actual: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Origen km">
            <select className={inputCls} value={draft.origen_km} onChange={(e) => set({ origen_km: e.target.value as OrigenKm })}>
              {(Object.keys(ORIGEN_KM_LABELS) as OrigenKm[]).map((o) => <option key={o} value={o}>{ORIGEN_KM_LABELS[o]}</option>)}
            </select>
          </Field>
          <TextField label="Webfleet Vehicle ID" value={draft.webfleet_vehicle_id ?? ""} onChange={(v) => set({ webfleet_vehicle_id: v })} />
          <Field label="Revisión cada (días)">
            <input type="number" className={inputCls} value={draft.revision_intervalo_dias ?? ""} onChange={(e) => set({ revision_intervalo_dias: e.target.value === "" ? null : Number(e.target.value) })} placeholder="por defecto del tipo" />
          </Field>
          <Field label="Estado">
            <select className={inputCls} value={draft.activo ? "1" : "0"} onChange={(e) => set({ activo: e.target.value === "1" })}>
              <option value="1">Activo</option><option value="0">Inactivo</option>
            </select>
          </Field>
        </div>

        {/* Desglose por eje */}
        {draft.medidas_por_eje && (
          <div className="mt-3 rounded-lg border border-slate-700 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Medida y llanta por eje</div>
            {ejes.length === 0 ? (
              <div className="text-[12px] text-slate-500">Elige una configuración de ejes para desglosar los ejes.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {ejes.map((f) => (
                  <div key={f.eje} className="grid items-center gap-2 sm:grid-cols-[110px_1fr_1fr]">
                    <span className="text-[12px] font-semibold text-slate-300">Eje {f.eje} · {f.ruedas} rueda{f.ruedas === 1 ? "" : "s"}</span>
                    <div className="flex gap-1">
                      <select className={inputCls} value={f.medida_id ?? ""} onChange={(e) => setEje(f.eje, { medida_id: e.target.value || null })}>
                        <option value="">Medida…</option>
                        {medidas.map((m) => <option key={m.id} value={m.id}>{m.valor}</option>)}
                      </select>
                      <button type="button" onClick={() => setModalMedida(() => (id: string) => setEje(f.eje, { medida_id: id }))}
                        className="shrink-0 rounded-lg border border-emerald-600 px-2 text-sm font-bold text-emerald-300 hover:bg-emerald-600/10" title="Crear nueva medida">+</button>
                    </div>
                    <select className={inputCls} value={f.tipo_llanta_id ?? ""} onChange={(e) => setEje(f.eje, { tipo_llanta_id: e.target.value || null })}>
                      <option value="">Llanta…</option>
                      {tiposLlanta.map((l) => <option key={l.id} value={l.id}>{tipoLlantaLabel(l)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {modalMedida && <ModalNuevaMedida onClose={() => setModalMedida(null)} onCreated={medidaCreada} />}

      {crearDesdeFicha && (
        <CrearVehiculoDesdeFicha
          empresaId={draft.empresa_id}
          tipos={tipos}
          configEjes={configEjes}
          matriculasExistentes={matriculasExistentes ?? new Set<string>()}
          onClose={() => setCrearDesdeFicha(false)}
          onListo={(nuevo, pendiente) => {
            setDraft((d) => ({ ...d, ...nuevo }));
            setPendienteFicha(pendiente);
            setCrearDesdeFicha(false);
          }}
        />
      )}
    </>
  );
}
