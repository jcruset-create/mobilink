import { useMemo, useState } from "react";
import {
  leerParteProveedor, guardarParteGuiado, listarVehiculos, listarPosiciones,
  listarMontajesVehiculo, listarReferenciasNeumatico, listarCatOperaciones, listarMedidas,
} from "../services/data";
import {
  interpretarParte, claveDeParte, estadoDeDestino,
  type LecturaParteProveedor, type PropuestaParte,
} from "../services/parteProveedor";
import { baseMedida } from "../services/medidas";
import type {
  CatDestino, MedidaNeumatico, MontajeActual, ReferenciaNeumatico, Vehiculo,
} from "../types";
import { TableWrap, inputCls, tdCls, thCls } from "../components/ui";

/**
 * Importar el parte de trabajo que manda el taller.
 *
 * El proveedor manda un PDF escaneado con lo que le ha hecho al vehículo. Hoy
 * eso se teclea a mano —ocho filas de presiones y profundidades, más los
 * montajes— y por eso casi nunca se teclea: la flota se queda sin el histórico
 * justo de los días en que pasó algo.
 *
 * Aquí se lee, se propone y **una persona confirma**. Nada se guarda antes:
 * lo que sale de una foto de un papel torcido se mira antes de meterlo en el
 * histórico de un neumático.
 */

/** El proveedor del que es el parte. De momento uno; el código no lo asume. */
const PROVEEDORES = [{ codigo: "comercial_sea", nombre: "Comercial Sea · El Gegant del Pneumàtic" }];

type Fase = "subir" | "revisar" | "guardado";

function normalizarMatricula(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function aDataUri(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => mal(new Error("No se ha podido leer el fichero"));
    fr.readAsDataURL(f);
  });
}

export default function ParteProveedor() {
  const [fase, setFase] = useState<Fase>("subir");
  const [proveedor, setProveedor] = useState(PROVEEDORES[0].codigo);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [nombreFichero, setNombreFichero] = useState("");

  const [lectura, setLectura] = useState<LecturaParteProveedor | null>(null);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [propuesta, setPropuesta] = useState<PropuestaParte | null>(null);
  const [montajes, setMontajes] = useState<MontajeActual[]>([]);
  const [referencias, setReferencias] = useState<ReferenciaNeumatico[]>([]);
  const [destinos, setDestinos] = useState<CatDestino[]>([]);

  // Lo que decide quien confirma.
  const [km, setKm] = useState("");
  const [referenciaId, setReferenciaId] = useState("");
  const [destino, setDestino] = useState("");
  const [cambiosMarcados, setCambiosMarcados] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<{ numero: string | null; ya: boolean; avisos: string[] } | null>(null);

  async function onFichero(f: File | undefined) {
    if (!f) return;
    setError(""); setCargando(true); setNombreFichero(f.name);
    try {
      const l = await leerParteProveedor({ dataUri: await aDataUri(f), nombre: f.name });
      setLectura(l);

      // El vehículo, por matrícula. No se da de alta nada desde un parte: un
      // vehículo sin tipo no tiene plano y sus medidas no irían a ningún sitio.
      const matricula = normalizarMatricula(l.matricula);
      const vehiculos = await listarVehiculos();
      const v = vehiculos.find((x) => normalizarMatricula(x.matricula) === matricula) ?? null;
      setVehiculo(v);
      if (!v) {
        setPropuesta(null);
        setError(`El parte es del vehículo ${l.matricula ?? "(sin matrícula)"} y no está dado de alta.`);
        setFase("revisar");
        return;
      }

      const [posiciones, mon, cat, meds] = await Promise.all([
        listarPosiciones(v.tipo_vehiculo_id ?? ""),
        listarMontajesVehiculo(v.id),
        listarCatOperaciones().catch(() => null),
        listarMedidas().catch(() => [] as MedidaNeumatico[]),
      ]);
      setMontajes(mon);
      setDestinos(cat?.destinos ?? []);

      const medidaVehiculo = meds.find((m) => m.id === v.medida_id)?.valor ?? null;
      const p = interpretarParte(l, {
        posiciones: posiciones.map((x) => ({
          id: x.id, codigo_posicion: x.codigo_posicion, nombre: x.nombre,
          eje: x.eje, orden_visual: x.orden_visual,
        })),
        kmActual: Number(v.km_actual) || null,
        medidaVehiculo,
      });
      setPropuesta(p);
      setKm(l.km != null ? String(l.km) : "");
      setCambiosMarcados(new Set(p.cambios.map((c) => c.posicionId)));

      // Las referencias de la medida facturada, para elegir cuál se montó.
      if (p.neumatico) {
        const todas = await listarReferenciasNeumatico({ q: "" }).catch(() => [] as ReferenciaNeumatico[]);
        const dela = todas.filter((r) => baseMedida(r.referencia_completa ?? "") === baseMedida(p.neumatico!.medida));
        setReferencias(dela.length ? dela : todas);
        if (dela.length === 1) setReferenciaId(dela[0].id);
      }
      setFase("revisar");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  const cambios = useMemo(
    () => (propuesta?.cambios ?? []).filter((c) => cambiosMarcados.has(c.posicionId)),
    [propuesta, cambiosMarcados]);

  function puedeGuardar(): string | null {
    if (!propuesta || !vehiculo || !lectura) return "Falta leer el parte";
    if (propuesta.errores.length) return propuesta.errores[0];
    if (cambios.length > 0 && !referenciaId) return "Elige qué neumático se ha montado";
    if (cambios.length > 0 && !destino) return "Elige a dónde van las gomas que se han quitado";
    return null;
  }

  async function confirmar() {
    const impide = puedeGuardar();
    if (impide) { setError(impide); return; }
    setError(""); setCargando(true);
    try {
      const p = propuesta!; const v = vehiculo!; const l = lectura!;
      const kmNum = km.trim() === "" ? null : Number(km.trim());

      // Un montaje que sustituye: la RPC de catálogo lo hace en un paso si se
      // le dice qué montaje había. Se busca aquí porque el panel ya lo tiene.
      const acciones = cambios.map((c) => {
        const actual = montajes.find((m) => m.posicion_id === c.posicionId);
        return {
          rpc: "tc_montar_desde_catalogo",
          args: {
            p_vehiculo: v.id, p_posicion: c.posicionId, p_referencia: referenciaId,
            p_control_individual: null, p_datos: {}, p_km: kmNum, p_fecha: l.fecha || null,
            p_condicion: "nuevo",
            p_montaje_actual: actual?.id ?? null,
            p_motivo_desmontaje: "desgaste",
            // El catálogo de destinos habla de «carcasa» o «reclamación»; la
            // RPC quiere un estado. La traducción es la de siempre.
            p_destino_retirado: estadoDeDestino(
              destinos.find((d) => d.codigo === destino)?.estado_resultante ?? null),
            p_obs: `Parte del taller ${l.pt_numero ?? ""}`.trim(),
          },
        };
      });

      const r = await guardarParteGuiado({
        // La misma clave para el mismo papel: reimportarlo no monta seis gomas
        // donde se montaron tres.
        clave: claveDeParte(proveedor, l.pt_numero ?? ""),
        vehiculo_id: v.id,
        km: kmNum,
        sin_cuentakilometros: kmNum == null,
        lugar_servicio: "taller",
        observaciones: `Importado del parte ${l.pt_numero ?? ""} de ${
          PROVEEDORES.find((x) => x.codigo === proveedor)?.nombre ?? proveedor}`.trim(),
        mediciones: p.mediciones.map((m) => ({
          posicion_id: m.posicionId,
          neumatico_id: montajes.find((x) => x.posicion_id === m.posicionId)?.neumatico_id ?? null,
          profundidad_mm: m.profundidadMm,
          presion_bar: m.presionBar,
          metodo_profundidad: "manual",
          metodo_presion: "manual",
          observaciones: m.mmInt !== m.mmExt ? `Interior ${m.mmInt} / exterior ${m.mmExt}` : null,
        })),
        acciones,
        servicios: p.servicios.map((s) => ({ servicio: s.codigo, cantidad: s.cantidad, observaciones: s.origen })),
      });

      setResultado({ numero: r.numero, ya: r.ya_guardado, avisos: r.avisos ?? [] });
      setFase("guardado");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  // ── Pintado ───────────────────────────────────────────────────────────────

  if (fase === "guardado" && resultado) {
    return (
      <div className="p-4">
        <h1 className="mb-3 text-lg font-bold">Parte del taller</h1>
        <div className="rounded-lg bg-emerald-900/30 p-4 text-sm text-emerald-100">
          {resultado.ya
            ? <>Este parte <b>ya estaba guardado</b>: es el {resultado.numero}. No se ha duplicado nada.</>
            : <>Guardado como <b>{resultado.numero}</b>.</>}
        </div>
        {resultado.avisos.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-[13px] text-amber-300">
            {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        )}
        <button
          onClick={() => { setFase("subir"); setLectura(null); setPropuesta(null); setResultado(null); setNombreFichero(""); }}
          className="mt-4 rounded-lg bg-slate-700 px-4 py-2 text-sm">Importar otro</button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-lg font-bold">Parte del taller</h1>
      <p className="mb-4 max-w-3xl text-sm text-slate-400">
        Sube el parte de trabajo que manda el proveedor —el PDF escaneado o una foto— y se propone la
        revisión con sus medidas y los neumáticos que se han cambiado. <b>No se guarda nada hasta que
        lo confirmas</b>, y cada parte solo puede entrar una vez.
      </p>

      {fase === "subir" && (
        <div className="max-w-xl space-y-3 rounded-lg bg-slate-800 p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Proveedor</span>
            <select className={inputCls} value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              {PROVEEDORES.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="block cursor-pointer rounded-lg border border-dashed border-slate-600 p-6 text-center">
            <input type="file" accept="application/pdf,image/*" className="hidden" disabled={cargando}
                   onChange={(e) => { void onFichero(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            <span className="text-sm text-sky-400">
              {cargando ? "Leyendo el parte…" : "Elegir el PDF o la foto del parte"}
            </span>
            <span className="mt-1 block text-[11px] text-slate-500">PDF o imagen, hasta 8 MB</span>
          </label>
        </div>
      )}

      {error && <div className="mt-3 max-w-3xl rounded bg-rose-900/40 px-3 py-2 text-[13px] text-rose-200">{error}</div>}

      {fase === "revisar" && lectura && (
        <div className="mt-3 space-y-4">
          {/* Lo que dice el papel */}
          <div className="rounded-lg bg-slate-800 p-3 text-[13px]">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Lo que pone el parte</div>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
              <div><span className="text-slate-500">PT:</span> {lectura.pt_numero ?? "—"}</div>
              <div><span className="text-slate-500">Fecha:</span> {lectura.fecha ?? "—"}</div>
              <div><span className="text-slate-500">Matrícula:</span> {lectura.matricula ?? "—"}</div>
              <div><span className="text-slate-500">Cliente:</span> {lectura.cliente_nombre ?? "—"}</div>
              <div><span className="text-slate-500">Unidad:</span> {lectura.numero_unidad ?? "—"}</div>
              <div><span className="text-slate-500">Fichero:</span> {nombreFichero}</div>
            </div>
            {lectura.aviso && <div className="mt-2 text-amber-300">{lectura.aviso}</div>}
            {typeof lectura.confianza === "number" && lectura.confianza < 0.5 && (
              <div className="mt-1 text-amber-300">
                La lectura no es segura ({Math.round(lectura.confianza * 100)} %): repasa los números contra el papel.
              </div>
            )}
          </div>

          {propuesta?.errores.length ? (
            <div className="rounded-lg bg-rose-900/30 p-3 text-[13px] text-rose-100">
              <div className="mb-1 font-bold">Esto no se puede importar todavía</div>
              <ul className="list-disc pl-5">{propuesta.errores.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          ) : null}

          {propuesta && propuesta.avisos.length > 0 && (
            <ul className="list-disc rounded-lg bg-amber-900/20 p-3 pl-8 text-[13px] text-amber-200">
              {propuesta.avisos.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}

          {vehiculo && propuesta && (
            <>
              <div className="rounded-lg bg-slate-800 p-3">
                <div className="mb-2 flex flex-wrap items-end gap-4">
                  <div className="text-[13px]">
                    <span className="text-slate-500">Vehículo:</span>{" "}
                    <b>{vehiculo.matricula}</b> · {vehiculo.marca ?? "—"} {vehiculo.modelo ?? ""}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Kilómetros</span>
                    <input className={`${inputCls} max-w-[160px]`} value={km} inputMode="numeric"
                           onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ""))} />
                  </label>
                </div>

                <TableWrap>
                  <thead className="bg-slate-900"><tr>
                    <th className={thCls}>Nº</th><th className={thCls}>Posición</th>
                    <th className={thCls}>Presión</th><th className={thCls}>Profundidad</th>
                    <th className={thCls}>Int./Ext.</th><th className={thCls}>¿Se cambió?</th>
                  </tr></thead>
                  <tbody>
                    {[...propuesta.mediciones, ...propuesta.medicionesDeGomaNueva]
                      .sort((a, b) => a.numero - b.numero)
                      .map((m) => {
                      const esCambio = propuesta.cambios.some((c) => c.posicionId === m.posicionId);
                      return (
                        <tr key={m.posicionId} className="border-t border-slate-700/60">
                          <td className={tdCls + " text-slate-500"}>{m.numero}</td>
                          <td className={tdCls + " font-semibold"}>{m.codigo}</td>
                          <td className={tdCls}>{m.presionBar ?? "—"}</td>
                          <td className={tdCls}>
                            {m.profundidadMm ?? "—"} mm
                            {esCambio && (
                              <span className="ml-2 text-[11px] text-slate-500">
                                (de la goma nueva: no se guarda)
                              </span>
                            )}
                          </td>
                          <td className={tdCls + " text-slate-500"}>
                            {m.mmInt ?? "—"} / {m.mmExt ?? "—"}
                          </td>
                          <td className={tdCls}>
                            {esCambio ? (
                              <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                                <input type="checkbox" checked={cambiosMarcados.has(m.posicionId)}
                                       onChange={(e) => {
                                         const s = new Set(cambiosMarcados);
                                         if (e.target.checked) s.add(m.posicionId); else s.delete(m.posicionId);
                                         setCambiosMarcados(s);
                                       }} />
                                <span className="text-emerald-300">goma nueva</span>
                              </label>
                            ) : <span className="text-slate-600">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
                {propuesta.medicionesDeGomaNueva.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Las medidas de las ruedas cambiadas son de la goma que se acaba de poner, así que no se
                    guardan como medición: dirían que la que se retiró estaba nueva. La nueva entra con la
                    profundidad de dibujo de su referencia.
                  </p>
                )}
              </div>

              {propuesta.cambios.length > 0 && (
                <div className="grid gap-3 rounded-lg bg-slate-800 p-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                      Neumático que se ha montado
                    </span>
                    <select className={inputCls} value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)}>
                      <option value="">Elegir del catálogo…</option>
                      {referencias.map((r) => (
                        <option key={r.id} value={r.id}>{r.referencia_completa}</option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      El parte factura: {propuesta.neumatico?.texto ?? "no lo dice"}
                      {propuesta.neumatico?.precioUnitario != null
                        ? ` · ${propuesta.neumatico.precioUnitario} € por unidad` : ""}
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                      A dónde va la goma que se quita
                    </span>
                    <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value)}>
                      <option value="">Elegir…</option>
                      {destinos.map((d) => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
                    </select>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      El parte no lo dice: lo decides tú, y vale para las {cambios.length} ruedas.
                    </span>
                  </label>
                </div>
              )}

              <div className="rounded-lg bg-slate-800 p-3 text-[13px]">
                <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Servicios</div>
                {propuesta.servicios.length === 0
                  ? <div className="text-slate-500">Ninguno reconocido.</div>
                  : (
                    <ul className="space-y-1">
                      {propuesta.servicios.map((s) => (
                        <li key={s.codigo}>
                          <b>{s.cantidad}</b> × {s.codigo}
                          <span className="text-slate-500"> · del papel: {s.origen}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                {propuesta.serviciosSinCasar.length > 0 && (
                  <div className="mt-2 text-[12px] text-slate-500">
                    Sin equivalente en nuestro catálogo (no se guardan):{" "}
                    {propuesta.serviciosSinCasar.join(" · ")}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setFase("subir"); setLectura(null); setPropuesta(null); setError(""); }}
                        className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">
                  Cancelar
                </button>
                <button onClick={confirmar} disabled={cargando || !!puedeGuardar()}
                        title={puedeGuardar() ?? ""}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {cargando
                    ? "Guardando…"
                    : `Confirmar: ${propuesta.mediciones.length} medidas y ${cambios.length} cambios`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
