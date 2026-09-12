import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Link2Off, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import {
  conciliar, crearVehiculo, darDeBaja, dejarDeIgnorar, desvincular, ignorar, listarCuentas, vincular,
  type Conciliacion, type CuentaTelematica, type VehiculoInterno,
} from "../services/conciliacion";
import { listarEmpresas } from "../services/data";
import type { Empresa } from "../types";

/**
 * Conciliación telemática: qué vehículos del proveedor son cuáles de aquí.
 *
 * La pantalla no decide nada. Enseña los cuatro cuadrantes y ofrece acciones,
 * y cada una de las que tiene efecto en TyreControl —crear un vehículo, darlo
 * de baja— pide confirmación. La única regla dura de la interfaz es que
 * **cuando la sincronización no ha sido completa, las bajas no se ofrecen**:
 * que un proveedor no conteste no significa que sus vehículos hayan
 * desaparecido, y un botón de baja al lado de una lista falsa es una forma
 * eficaz de vaciar una flota por error.
 */

type Cuadrante = "enlazados" | "soloProveedor" | "soloTyreControl" | "discrepancias";

const CAJA = "rounded-2xl border border-slate-700 bg-slate-800";
const BOTON = "rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40";

function fechaCorta(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Ficha compacta de un vehículo de TyreControl. */
function Interno({ v }: { v: VehiculoInterno }) {
  return (
    <div>
      <div className="font-black text-slate-100">{v.matricula || "sin matrícula"}</div>
      <div className="text-xs text-slate-400">
        {v.numeroUnidad ? `Flota ${v.numeroUnidad}` : "sin nº de flota"}
        {!v.activo && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">inactivo</span>}
      </div>
    </div>
  );
}

/** Ficha compacta de un vehículo del proveedor. */
function Externo({ v }: { v: { providerVehicleId: string; plate?: string; name?: string; vin?: string } }) {
  return (
    <div>
      <div className="font-black text-slate-100">{v.plate || v.name || "sin identificar"}</div>
      <div className="font-mono text-xs text-slate-400">
        ID {v.providerVehicleId}
        {v.plate && v.name && <span className="ml-2 font-sans">· {v.name}</span>}
        {v.vin && <span className="ml-2 font-sans">· {v.vin}</span>}
      </div>
    </div>
  );
}

export default function ConciliacionTelematica() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [cuentas, setCuentas] = useState<CuentaTelematica[]>([]);
  const [cuenta, setCuenta] = useState<CuentaTelematica | null>(null);
  const [datos, setDatos] = useState<Conciliacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Cuadrante>("enlazados");

  // Las empresas que la sesión puede ver: un administrador solo la suya, un
  // super-admin todas. Sin este selector la pantalla se quedaba clavada en la
  // empresa del perfil, y un super-admin no podía llegar a la de su cliente.
  useEffect(() => {
    listarEmpresas()
      .then((e) => {
        setEmpresas(e);
        if (e.length && !empresaId) setEmpresaId(e[0].id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    setCuenta(null);
    setDatos(null);
    listarCuentas(empresaId)
      .then((r) => {
        setCuentas(r.cuentas);
        // Con una sola cuenta se elige sola; con varias hay que decidir.
        setCuenta(r.cuentas.length === 1 ? r.cuentas[0] : null);
      })
      .catch((e) => setError(e.message));
  }, [empresaId]);

  const cargar = useCallback(async () => {
    if (!cuenta || !empresaId) return;
    setCargando(true);
    setError("");
    try {
      setDatos(await conciliar({ empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey }));
    } catch (e: any) {
      setError(e.message);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [cuenta, empresaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Ejecuta una acción, enseña el resultado y vuelve a conciliar. */
  async function accion(fn: () => Promise<unknown>, exito: string) {
    setError("");
    setMsg("");
    try {
      await fn();
      setMsg(exito);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const base = cuenta ? { empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey } : null;
  const r = datos?.resumen;
  const completa = r?.status === "complete";

  const TARJETAS: Array<{ key: Cuadrante; rotulo: string; n: number }> = [
    { key: "enlazados", rotulo: "Enlazados", n: r?.linkedCount ?? 0 },
    { key: "soloProveedor", rotulo: "Solo proveedor", n: r?.providerOnlyCount ?? 0 },
    { key: "soloTyreControl", rotulo: "Solo en TyreControl", n: r?.tyrecontrolOnlyCount ?? 0 },
    { key: "discrepancias", rotulo: "Discrepancias", n: r?.discrepancyCount ?? 0 },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Conciliación telemática</h1>
          <p className="text-xs text-slate-500">
            Qué vehículos del proveedor son cuáles de TyreControl. Nada se enlaza ni se da de baja solo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            aria-label="Empresa"
          >
            {empresas.length === 0 && <option value="">Cargando empresas…</option>}
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            value={cuenta ? `${cuenta.connectorKey}|${cuenta.accountKey}` : ""}
            aria-label="Cuenta telemática"
            onChange={(e) => {
              const [connectorKey, accountKey] = e.target.value.split("|");
              setCuenta(cuentas.find((c) => c.connectorKey === connectorKey && c.accountKey === accountKey) ?? null);
            }}
          >
            <option value="">Elige una cuenta…</option>
            {cuentas.map((c) => (
              <option key={`${c.connectorKey}|${c.accountKey}`} value={`${c.connectorKey}|${c.accountKey}`}>
                {c.connectorKey} · {c.nombre ?? c.accountKey}
              </option>
            ))}
          </select>
          <button
            onClick={() => void cargar()}
            disabled={!cuenta || cargando}
            className={`${BOTON} border-sky-600 py-2 text-sky-300 hover:bg-sky-500/10`}
          >
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
            {cargando ? "Conciliando…" : "Conciliar"}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {msg && <div className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{msg}</div>}

      {empresaId && cuentas.length === 0 && !error && (
        <div className={`${CAJA} p-8 text-center text-slate-400`}>
          <b>{empresas.find((e) => e.id === empresaId)?.nombre ?? "Esta empresa"}</b> no tiene
          ninguna cuenta de telemática configurada.
        </div>
      )}

      {r && (
        <>
          {/* ── Estado de la sincronización ── */}
          <div
            className={`mb-3 rounded-2xl border p-4 ${
              completa ? "border-slate-700 bg-slate-800" : "border-amber-600 bg-amber-500/10"
            }`}
          >
            <div className="flex items-start gap-3">
              {completa ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0">
                <div className="font-bold">
                  {completa
                    ? "Sincronización completa"
                    : r.status === "incomplete"
                      ? "Sincronización incompleta"
                      : "No se pudo sincronizar"}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(r.completedAt).toLocaleString("es-ES")} · {r.providerVehicleCount} vehículos leídos ·{" "}
                  {r.tyrecontrolVehicleCount} en TyreControl
                </div>
                {r.cuentas
                  .filter((c) => !c.ok)
                  .map((c) => (
                    <div key={`${c.connectorKey}|${c.accountKey}`} className="mt-1 text-xs text-amber-300">
                      La cuenta «{c.accountKey}» no respondió: {c.error}
                    </div>
                  ))}
                {!completa && (
                  <div className="mt-2 text-xs text-amber-200">
                    No se puede determinar qué vehículos han desaparecido, así que{" "}
                    <b>las bajas están deshabilitadas</b>.
                    {r.tyrecontrolUnknownCount > 0 && (
                      <>
                        {" "}Los <b>{r.tyrecontrolUnknownCount}</b> vehículos de TyreControl se
                        quedan sin clasificar: podrían estar perfectamente en la cuenta que no ha
                        contestado, y meterlos en «solo en TyreControl» sería decir que han
                        desaparecido.
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Tarjetas resumen, que son también los filtros ── */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TARJETAS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-2xl border p-4 text-left transition ${
                  tab === t.key ? "border-sky-500 bg-sky-500/10" : "border-slate-700 bg-slate-800 hover:border-slate-600"
                }`}
              >
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t.rotulo}</div>
                <div className="text-3xl font-black tabular-nums">{t.n}</div>
              </button>
            ))}
          </div>

          {/* ── A. Enlazados ── */}
          {tab === "enlazados" && (
            <div className={`${CAJA} divide-y divide-slate-700`}>
              {datos!.enlazados.length === 0 && <div className="p-6 text-center text-slate-400">Ninguno.</div>}
              {datos!.enlazados.map((f) => (
                <div key={f.externo.providerVehicleId} className="grid gap-3 p-4 md:grid-cols-4 md:items-center">
                  <Interno v={f.interno} />
                  <Externo v={f.externo} />
                  <div className="text-xs text-slate-400">
                    <div>{cuenta?.accountKey}</div>
                    <div>método: {f.metodo ?? "—"}</div>
                    <div>visto: {fechaCorta(f.ultimaVezVistoMs)}</div>
                  </div>
                  <div className="md:text-right">
                    <button
                      className={`${BOTON} border-slate-600 text-slate-300 hover:bg-slate-700`}
                      onClick={() =>
                        confirm(`¿Desvincular ${f.interno.matricula} de ${f.externo.providerVehicleId}?`) &&
                        void accion(
                          () =>
                            desvincular({
                              ...base,
                              tcVehicleId: f.interno.id,
                              externalVehicleId: f.externo.providerVehicleId,
                            }),
                          "Desvinculado. El enlace se conserva desactivado.",
                        )
                      }
                    >
                      <Link2Off className="mr-1 inline h-3.5 w-3.5" />
                      Desvincular
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── B. Solo en el proveedor ── */}
          {tab === "soloProveedor" && (
            <div className={`${CAJA} divide-y divide-slate-700`}>
              {datos!.soloProveedor.length === 0 && <div className="p-6 text-center text-slate-400">Ninguno.</div>}
              {datos!.soloProveedor.map((f) => (
                <div key={f.externo.providerVehicleId} className="grid gap-3 p-4 md:grid-cols-3 md:items-center">
                  <Externo v={f.externo} />
                  <div className="text-xs">
                    {f.propuesta ? (
                      <div className="rounded-lg bg-sky-500/10 p-2">
                        <div className="font-bold text-sky-300">Posible coincidencia</div>
                        <div className="text-slate-300">
                          {f.propuesta.matricula}
                          {f.propuesta.numeroUnidad ? ` · Flota ${f.propuesta.numeroUnidad}` : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500">
                        {f.externo.plate ? "Sin coincidencia en TyreControl" : "El proveedor no da matrícula"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {f.propuesta && (
                      <button
                        className={`${BOTON} border-sky-600 text-sky-300 hover:bg-sky-500/10`}
                        onClick={() =>
                          void accion(
                            () =>
                              vincular({
                                ...base,
                                tcVehicleId: f.propuesta!.id,
                                externalVehicleId: f.externo.providerVehicleId,
                                matchMethod: "plate_exact",
                                externalPlate: f.externo.plate ?? null,
                                externalName: f.externo.name ?? null,
                              }),
                            `Enlazado ${f.propuesta!.matricula}.`,
                          )
                        }
                      >
                        <Link2 className="mr-1 inline h-3.5 w-3.5" />
                        Vincular
                      </button>
                    )}
                    <button
                      className={`${BOTON} border-emerald-700 text-emerald-300 hover:bg-emerald-500/10`}
                      disabled={!f.externo.plate}
                      title={f.externo.plate ? "" : "Sin matrícula no se puede crear automáticamente"}
                      onClick={() =>
                        confirm(
                          `Se creará ${f.externo.plate} en TyreControl PENDIENTE DE VALIDAR. ` +
                            `No se rellenan tipo, ejes ni medidas: hay que completarlos después.`,
                        ) &&
                        void accion(
                          () =>
                            crearVehiculo({
                              ...base,
                              externalVehicleId: f.externo.providerVehicleId,
                              matricula: f.externo.plate,
                              bastidor: f.externo.vin ?? null,
                              externalName: f.externo.name ?? null,
                            }),
                          "Vehículo creado pendiente de validar y enlazado.",
                        )
                      }
                    >
                      <Plus className="mr-1 inline h-3.5 w-3.5" />
                      Crear en TyreControl
                    </button>
                    <button
                      className={`${BOTON} border-slate-600 text-slate-400 hover:bg-slate-700`}
                      onClick={() =>
                        void accion(
                          () => ignorar({ ...base, externalVehicleId: f.externo.providerVehicleId }),
                          "Ignorado. Dejará de aparecer en la lista.",
                        )
                      }
                    >
                      <XCircle className="mr-1 inline h-3.5 w-3.5" />
                      Ignorar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── C. Solo en TyreControl ── */}
          {tab === "soloTyreControl" && (
            <div className={`${CAJA} divide-y divide-slate-700`}>
              {datos!.soloTyreControl.length === 0 && <div className="p-6 text-center text-slate-400">Ninguno.</div>}
              {datos!.soloTyreControl.map((f) => (
                <div key={f.interno.id} className="grid gap-3 p-4 md:grid-cols-3 md:items-center">
                  <Interno v={f.interno} />
                  <div className="text-xs text-slate-400">
                    <div>Última vez visto: {fechaCorta(f.ultimaVezVistoMs)}</div>
                    {f.externoAnterior && <div className="font-mono">antes: {f.externoAnterior}</div>}
                    <div>
                      Neumáticos montados: <b className="text-slate-200">{f.interno.neumaticosMontados}</b>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <button
                      className={`${BOTON} border-rose-700 text-rose-300 hover:bg-rose-500/10`}
                      disabled={!r.bajasPermitidas}
                      title={
                        r.bajasPermitidas
                          ? ""
                          : "La sincronización no fue completa: no se puede afirmar que este vehículo haya desaparecido"
                      }
                      onClick={() =>
                        confirm(
                          `Este vehículo tiene ${f.interno.neumaticosMontados} neumáticos actualmente montados. ` +
                            `Darlo de baja no desmontará los neumáticos ni modificará su histórico.\n\n` +
                            `¿Dar de baja ${f.interno.matricula}?`,
                        ) &&
                        void accion(
                          () =>
                            darDeBaja({
                              ...base,
                              tcVehicleId: f.interno.id,
                              neumaticosMontadosVistos: f.interno.neumaticosMontados,
                              desvincularTambien: false,
                            }),
                          `${f.interno.matricula} dado de baja. Sus neumáticos siguen montados.`,
                        )
                      }
                    >
                      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                      Dar de baja
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── D. Discrepancias ── */}
          {tab === "discrepancias" && (
            <div className={`${CAJA} divide-y divide-slate-700`}>
              {datos!.discrepancias.length === 0 && <div className="p-6 text-center text-slate-400">Ninguna.</div>}
              {datos!.discrepancias.map((d, i) => (
                <div key={i} className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {d.detalle}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 md:items-center">
                    <div>{d.interno ? <Interno v={d.interno} /> : <span className="text-slate-500">—</span>}</div>
                    <div>{d.externo ? <Externo v={d.externo} /> : <span className="text-slate-500">—</span>}</div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {(d.candidatos ?? []).map((c) => (
                        <button
                          key={c.id}
                          className={`${BOTON} border-sky-600 text-sky-300 hover:bg-sky-500/10`}
                          onClick={() =>
                            void accion(
                              () =>
                                vincular({
                                  ...base,
                                  tcVehicleId: c.id,
                                  externalVehicleId: d.externo!.providerVehicleId,
                                  matchMethod: "manual",
                                  externalPlate: d.externo!.plate ?? null,
                                  externalName: d.externo!.name ?? null,
                                }),
                              `Enlazado con ${c.matricula}.`,
                            )
                          }
                        >
                          Vincular con {c.matricula}
                        </button>
                      ))}
                      {d.interno && d.enlace && (
                        <button
                          className={`${BOTON} border-slate-600 text-slate-300 hover:bg-slate-700`}
                          onClick={() =>
                            void accion(
                              () =>
                                desvincular({
                                  ...base,
                                  tcVehicleId: d.enlace!.mobilinkId,
                                  externalVehicleId: d.enlace!.externalCode,
                                }),
                              "Desvinculado.",
                            )
                          }
                        >
                          <Link2Off className="mr-1 inline h-3.5 w-3.5" />
                          Desvincular
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Ignorados: para que «dejar de ignorar» sea alcanzable ── */}
          {datos!.ignorados.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Ignorados ({datos!.ignorados.length})
              </h2>
              <div className={`${CAJA} divide-y divide-slate-700`}>
                {datos!.ignorados.map((ig) => (
                  <div key={ig.externalVehicleId} className="flex items-center justify-between gap-3 p-3">
                    <div className="font-mono text-xs text-slate-400">
                      {ig.externalVehicleId}
                      {ig.motivo && <span className="ml-2 font-sans">· {ig.motivo}</span>}
                    </div>
                    <button
                      className={`${BOTON} border-slate-600 text-slate-300 hover:bg-slate-700`}
                      onClick={() =>
                        void accion(
                          () => dejarDeIgnorar({ ...base, externalVehicleId: ig.externalVehicleId }),
                          "Vuelve a la lista.",
                        )
                      }
                    >
                      Dejar de ignorar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
