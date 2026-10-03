/**
 * Accesos → Puertas: el estado del hardware.
 *
 * Por puerta: dispositivo, salida, online/offline, última comunicación, última
 * apertura y último error, con «Probar conexión» y «Abrir» (apertura
 * administrativa, auditada) según permisos. Pestaña de dispositivos con sus
 * salidas, la sincronización de teléfonos (deseado frente a real) y, en los
 * simulados, los mandos del simulador.
 *
 * Aquí no se decide quién puede entrar: eso es del servidor (evaluateAccess).
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import { CONNECTION_TYPES, DOOR_TYPES, type ConnectionType, type Dispositivo, type DoorType, type Puerta, type Zona } from "../types";
import {
  Aviso,
  Cabecera,
  CheckField,
  EmptyRow,
  ErrorBox,
  Modal,
  Pill,
  SelectField,
  TableWrap,
  TextField,
  btnMini,
  btnPrimary,
  btnSecondary,
  fechaHora,
  msgError,
  tdCls,
  thCls,
} from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

function ChipConexion({ estado }: { estado: Puerta["deviceStatus"] }) {
  if (!estado) return <Pill className="bg-slate-700/60 text-slate-400">Sin dispositivo</Pill>;
  const c = { online: ["En línea", "bg-emerald-500/20 text-emerald-300"], offline: ["Sin conexión", "bg-rose-500/20 text-rose-300"], unknown: ["Sin comprobar", "bg-slate-600/40 text-slate-300"] }[estado];
  return <Pill className={c[1]}>{c[0]}</Pill>;
}

function ChipSync({ estado }: { estado: Dispositivo["syncStatus"] }) {
  if (!estado) return <span className="text-slate-500">—</span>;
  const c = { synced: ["Al día", "bg-emerald-500/20 text-emerald-300"], pending: ["Pendiente de aplicar", "bg-amber-500/20 text-amber-300"], failed: ["Fallida", "bg-rose-500/20 text-rose-300"] }[estado];
  return <Pill className={c[1]}>{c[0]}</Pill>;
}

export default function Puertas() {
  const { centroId, puede, etqTipoPuerta, etqConexion } = useSelfStorage();
  const [pestana, setPestana] = useState<"puertas" | "dispositivos">("puertas");
  const [lista, setLista] = useState<Puerta[] | null>(null);
  const [disp, setDisp] = useState<Dispositivo[] | null>(null);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "bien" | "mal" | "info"; texto: string } | null>(null);
  const [editPuerta, setEditPuerta] = useState<Puerta | "nueva" | null>(null);
  const [editDisp, setEditDisp] = useState<Dispositivo | "nuevo" | null>(null);
  const [abriendo, setAbriendo] = useState<Puerta | null>(null);
  const gestiona = puede("ss.devices.manage");

  const cargar = useCallback(async () => {
    if (!centroId) return;
    try {
      const [p, d, z] = await Promise.all([api.puertas(centroId), api.dispositivos(centroId), api.zonas(centroId)]);
      setLista(p);
      setDisp(d);
      setZonas(z);
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [centroId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const probar = async (deviceId: string) => {
    try {
      const r = await api.probarDispositivo(deviceId);
      setAviso(r.ok ? { tono: "bien", texto: `Conexión correcta (${r.latencyMs} ms).` } : { tono: "mal", texto: `Sin conexión: ${r.code ?? ""} ${r.message ?? ""}` });
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };

  if (!centroId) return <Aviso tono="info">Elige o crea un centro.</Aviso>;

  return (
    <div className="space-y-3">
      <Cabecera titulo="Puertas" descripcion="Estado del hardware. Quién puede entrar lo decide Mobilink; el dispositivo sólo ejecuta.">
        {gestiona && pestana === "puertas" && (
          <button className={btnPrimary} onClick={() => setEditPuerta("nueva")}>
            Nueva puerta
          </button>
        )}
        {gestiona && pestana === "dispositivos" && (
          <button className={btnPrimary} onClick={() => setEditDisp("nuevo")}>
            Nuevo dispositivo
          </button>
        )}
      </Cabecera>
      <div className="flex gap-1 text-[13px]">
        {(["puertas", "dispositivos"] as const).map((p) => (
          <button key={p} className={`rounded-lg px-3 py-1.5 ${pestana === p ? "bg-orange-600 text-white" : "bg-slate-800 text-slate-300"}`} onClick={() => setPestana(p)}>
            {p === "puertas" ? "Puertas" : "Dispositivos y sincronización"}
          </button>
        ))}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

      {pestana === "puertas" && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Puerta</th>
              <th className={thCls}>Dispositivo · salida</th>
              <th className={thCls}>Conexión</th>
              <th className={thCls}>Última comunicación</th>
              <th className={thCls}>Última apertura</th>
              <th className={thCls}>Último error</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {!lista && <EmptyRow cols={7} text="Cargando…" />}
            {lista?.length === 0 && <EmptyRow cols={7} text="Sin puertas. Da de alta el dispositivo y luego sus puertas." />}
            {lista?.map((p) => (
              <tr key={p.id} className={`border-t border-slate-700 align-top ${p.enabled ? "" : "opacity-50"}`}>
                <td className={tdCls}>
                  <div className="font-bold">{p.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {etqTipoPuerta(p.doorType)}
                    {p.zoneName ? ` · ${p.zoneName}` : ""}
                    {p.allowApp ? " · app" : ""}
                    {p.allowPhone ? " · llamada" : ""}
                    {p.accessSchedule?.rules?.length ? " · con horario" : ""}
                  </div>
                </td>
                <td className={tdCls}>
                  {p.deviceName ? (
                    <>
                      {p.deviceName}
                      <div className="text-[11px] text-slate-400">
                        Salida {p.outputNumber} · {p.connectionType ? etqConexion(p.connectionType) : ""}
                      </div>
                    </>
                  ) : (
                    <span className="text-amber-300">Sin salida asignada</span>
                  )}
                </td>
                <td className={tdCls}>
                  <ChipConexion estado={p.deviceStatus} />
                </td>
                <td className={tdCls}>{fechaHora(p.lastSeenAt)}</td>
                <td className={tdCls}>{fechaHora(p.lastOpenedAt)}</td>
                <td className={`${tdCls} max-w-[16rem] text-[11px] text-rose-300`}>
                  {p.lastError ? (
                    <>
                      {p.lastError}
                      <div className="text-slate-500">{fechaHora(p.lastErrorAt)}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${tdCls} space-y-1 text-right text-[11px]`}>
                  {p.deviceId && puede("ss.devices.test") && (
                    <button className={btnMini} onClick={() => void probar(p.deviceId!)}>
                      Probar conexión
                    </button>
                  )}{" "}
                  {puede("ss.access.open") && p.deviceId && (
                    <button className={btnMini} onClick={() => setAbriendo(p)}>
                      Abrir
                    </button>
                  )}{" "}
                  {gestiona && (
                    <button className={btnMini} onClick={() => setEditPuerta(p)}>
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {pestana === "dispositivos" && (
        <div className="space-y-3">
          {disp?.length === 0 && <Aviso tono="info">Sin dispositivos. Empieza con uno «Simulador» para probar todo sin el RUT241.</Aviso>}
          {disp?.map((d) => (
            <TarjetaDispositivo key={d.id} d={d} gestiona={gestiona} puedeProbar={puede("ss.devices.test")} onProbar={() => void probar(d.id)} onEditar={() => setEditDisp(d)} onCambio={() => void cargar()} onError={setError} />
          ))}
        </div>
      )}

      {editPuerta && (
        <FormPuerta
          puerta={editPuerta === "nueva" ? null : editPuerta}
          centerId={centroId}
          zonas={zonas}
          dispositivos={disp ?? []}
          tipos={DOOR_TYPES}
          etqTipo={etqTipoPuerta}
          onCerrar={() => setEditPuerta(null)}
          onHecho={() => {
            setEditPuerta(null);
            void cargar();
          }}
        />
      )}
      {editDisp && (
        <FormDispositivo
          d={editDisp === "nuevo" ? null : editDisp}
          centerId={centroId}
          etqConexion={etqConexion}
          onCerrar={() => setEditDisp(null)}
          onHecho={() => {
            setEditDisp(null);
            void cargar();
          }}
        />
      )}
      {abriendo && (
        <AbrirPuerta
          p={abriendo}
          onCerrar={() => setAbriendo(null)}
          onHecho={(texto, bien) => {
            setAbriendo(null);
            setAviso({ tono: bien ? "bien" : "mal", texto });
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function AbrirPuerta({ p, onCerrar, onHecho }: { p: Puerta; onCerrar: () => void; onHecho: (texto: string, bien: boolean) => void }) {
  const { etqMotivoAcceso } = useSelfStorage();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const abrir = async () => {
    setEnviando(true);
    try {
      const r = await api.abrirPuerta(p.id, motivo.trim());
      onHecho(r.opened ? `${p.name}: abierta.` : `${p.name}: no se ha abierto (${r.decision === "denied" ? etqMotivoAcceso(r.reason) : r.executionStatus}). ${r.message}`, r.opened);
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };
  return (
    <Modal
      title={`Abrir «${p.name}»`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={enviando} onClick={() => void abrir()}>
            {enviando ? "Abriendo…" : "Abrir ahora"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField label="Motivo (opcional)" value={motivo} onChange={setMotivo} placeholder="Cliente sin batería, mantenimiento…" />
        <p className="text-[12px] text-slate-400">Apertura administrativa: queda registrada con tu nombre, la puerta, la hora, el motivo y el resultado del dispositivo.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

function TarjetaDispositivo({
  d,
  gestiona,
  puedeProbar,
  onProbar,
  onEditar,
  onCambio,
  onError,
}: {
  d: Dispositivo;
  gestiona: boolean;
  puedeProbar: boolean;
  onProbar: () => void;
  onEditar: () => void;
  onCambio: () => void;
  onError: (m: string) => void;
}) {
  const { etqConexion } = useSelfStorage();
  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onCambio();
    } catch (e) {
      onError(msgError(e));
    }
  };
  const sim = d.simulation ?? {};
  const deseados = d.syncDesired ?? [];
  const reales = d.syncActual ?? [];
  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-lg font-black">{d.name}</div>
          <div className="text-[12px] text-slate-400">
            {d.manufacturer} {d.model} · {etqConexion(d.connectionType)}
            {d.endpoint ? ` · ${d.endpoint}` : ""}
            {d.phoneNumber ? ` · SIM ${d.phoneNumber}` : ""}
            {d.firmware ? ` · firmware ${d.firmware}` : ""}
          </div>
          {d.credentialsSecretName && <div className="text-[11px] text-slate-500">Credenciales en la variable de entorno {d.credentialsSecretName}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <ChipConexion estado={d.status} />
          {puedeProbar && (
            <button className={btnMini} onClick={onProbar}>
              Probar conexión
            </button>
          )}
          {gestiona && (
            <>
              <button className={btnMini} onClick={() => void accion(() => api.sincronizarDispositivo(d.id))}>
                Sincronizar teléfonos
              </button>
              <button className={btnMini} onClick={onEditar}>
                Editar
              </button>
            </>
          )}
        </div>
      </div>
      {d.lastError && (
        <div className="text-[12px] text-rose-300">
          Último error ({fechaHora(d.lastErrorAt)}): {d.lastError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Salidas</div>
          <ul className="space-y-1 text-[13px]">
            {d.outputs.map((o) => (
              <li key={o.id} className="flex items-center justify-between rounded-lg bg-slate-900 px-2 py-1">
                <span>
                  {o.outputNumber}. {o.name} · pulso {o.pulseDurationMs} ms {o.enabled ? "" : "(deshabilitada)"}
                </span>
                <span className="text-[11px] text-slate-400">{o.doorName ? `→ ${o.doorName}` : "sin puerta"}</span>
              </li>
            ))}
          </ul>
          {gestiona && (
            <button
              className={`${btnMini} mt-1`}
              onClick={() => {
                const sig = Math.max(0, ...d.outputs.map((o) => o.outputNumber)) + 1;
                void accion(() => api.crearSalida(d.id, { outputNumber: sig, name: `Salida ${sig}` }));
              }}
            >
              Añadir salida
            </button>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-400">
            Teléfonos autorizados (lista del dispositivo) <ChipSync estado={d.syncStatus} />
          </div>
          {d.phoneAccessMode === "none" ? (
            <p className="text-[12px] text-slate-400">Este dispositivo no abre por llamada.</p>
          ) : (
            <div className="space-y-1 text-[12px]">
              <div>
                <span className="text-slate-400">Calculada por Mobilink ({deseados.length}): </span>
                {deseados.join(", ") || "ninguno"}
              </div>
              <div>
                <span className="text-slate-400">Aplicada en el equipo ({reales.length}): </span>
                {d.syncActual ? reales.join(", ") || "ninguno" : "nunca sincronizado"}
              </div>
              <div className="text-slate-500">
                Último intento {fechaHora(d.syncLastAttemptAt)} · último éxito {fechaHora(d.syncLastSuccessAt)}
                {d.syncStatus === "failed" && d.syncNextAttemptAt ? ` · reintento ${fechaHora(d.syncNextAttemptAt)}` : ""}
              </div>
              {d.syncError && d.syncStatus !== "synced" && <div className="text-rose-300">{d.syncError}</div>}
              {d.syncStatus !== "synced" && (
                <Aviso tono="aviso">Hasta que se aplique, el equipo sigue con la lista anterior para las llamadas. La app ya aplica los cambios al instante.</Aviso>
              )}
            </div>
          )}
        </div>
      </div>

      {d.connectionType === "mock" && gestiona && (
        <div className="space-y-1 rounded-lg border border-dashed border-slate-600 p-2 text-[12px]">
          <div className="font-semibold text-slate-300">Simulador</div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {[
              ["En línea", { ...sim, online: true }],
              ["Sin conexión", { ...sim, online: false }],
              ["Abre bien", { ...sim, open: "ok" }],
              ["No contesta al abrir", { ...sim, open: "timeout" }],
              ["La salida falla", { ...sim, open: "output_failed" }],
              ["Sincroniza bien", { ...sim, sync: "ok" }],
              ["Sincronización falla", { ...sim, sync: "fail" }],
            ].map(([txt, valor]) => (
              <button key={txt as string} className={btnMini} onClick={() => void accion(() => api.editarDispositivo(d.id, { simulation: valor }))}>
                {txt as string}
              </button>
            ))}
          </div>
          <div className="text-slate-500">Ahora: {JSON.stringify(sim)}</div>
        </div>
      )}
    </div>
  );
}

function FormPuerta({
  puerta,
  centerId,
  zonas,
  dispositivos,
  tipos,
  etqTipo,
  onCerrar,
  onHecho,
}: {
  puerta: Puerta | null;
  centerId: string;
  zonas: Zona[];
  dispositivos: Dispositivo[];
  tipos: readonly DoorType[];
  etqTipo: (t: DoorType) => string;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [f, setF] = useState({
    name: puerta?.name ?? "",
    doorType: (puerta?.doorType ?? "main") as DoorType,
    zoneId: puerta?.zoneId ?? "",
    deviceOutputId: puerta?.deviceOutputId ?? "",
    enabled: puerta?.enabled ?? true,
    allowApp: puerta?.allowApp ?? true,
    allowPhone: puerta?.allowPhone ?? true,
    horario: puerta?.accessSchedule?.rules?.[0] ? `${puerta.accessSchedule.rules[0].from}-${puerta.accessSchedule.rules[0].to}` : "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const salidas = dispositivos.flatMap((d) => d.outputs.map((o) => ({ ...o, deviceName: d.name })));

  const guardar = async () => {
    setError(null);
    // Horario sencillo «HH:MM-HH:MM» todos los días; vacío = 24 h.
    let accessSchedule: unknown = null;
    if (f.horario.trim()) {
      const m = f.horario.trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if (!m) return setError("Horario: escribe «07:00-22:00» o déjalo vacío para 24 h.");
      accessSchedule = { rules: [{ days: [1, 2, 3, 4, 5, 6, 7], from: m[1], to: m[2] }] };
    }
    const d = {
      name: f.name,
      doorType: f.doorType,
      zoneId: f.doorType === "zone" ? f.zoneId || null : null,
      deviceOutputId: f.deviceOutputId || null,
      enabled: f.enabled,
      allowApp: f.allowApp,
      allowPhone: f.allowPhone,
      accessSchedule,
    };
    try {
      if (puerta) await api.editarPuerta(puerta.id, d);
      else await api.crearPuerta({ ...d, centerId });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };

  return (
    <Modal
      title={puerta ? `Puerta «${puerta.name}»` : "Nueva puerta"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!f.name.trim() || (f.doorType === "zone" && !f.zoneId)} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Nombre" value={f.name} onChange={(v) => set("name", v)} />
        <SelectField label="Tipo" value={f.doorType} onChange={(v) => set("doorType", v as DoorType)}>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {etqTipo(t)}
            </option>
          ))}
        </SelectField>
        {f.doorType === "zone" && (
          <SelectField label="Zona" value={f.zoneId} onChange={(v) => set("zoneId", v)}>
            <option value="">— Elige —</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Salida del dispositivo" value={f.deviceOutputId} onChange={(v) => set("deviceOutputId", v)}>
          <option value="">— Sin asignar —</option>
          {salidas.map((o) => (
            <option key={o.id} value={o.id} disabled={Boolean(o.doorId && o.doorId !== puerta?.id)}>
              {o.deviceName} · salida {o.outputNumber}
              {o.doorId && o.doorId !== puerta?.id ? ` (ya es «${o.doorName}»)` : ""}
            </option>
          ))}
        </SelectField>
        <TextField label="Horario (vacío = 24 h)" value={f.horario} onChange={(v) => set("horario", v)} placeholder="07:00-22:00" />
        <CheckField label="Habilitada" checked={f.enabled} onChange={(v) => set("enabled", v)} />
        <CheckField label="Abre con la app" checked={f.allowApp} onChange={(v) => set("allowApp", v)} />
        <CheckField label="Abre por llamada" checked={f.allowPhone} onChange={(v) => set("allowPhone", v)} />
      </div>
      <p className="mt-2 text-[12px] text-slate-400">
        Las principales las abren todos los contratos activos del centro; las de zona, sólo los contratos con trastero en esa zona. Interiores y «otras» se dan a
        mano desde el contrato.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
    </Modal>
  );
}

function FormDispositivo({ d, centerId, etqConexion, onCerrar, onHecho }: { d: Dispositivo | null; centerId: string; etqConexion: (t: ConnectionType) => string; onCerrar: () => void; onHecho: () => void }) {
  const [f, setF] = useState({
    name: d?.name ?? "",
    model: d?.model ?? "RUT241",
    serial: d?.serial ?? "",
    imei: d?.imei ?? "",
    phoneNumber: d?.phoneNumber ?? "",
    connectionType: (d?.connectionType ?? "mock") as ConnectionType,
    endpoint: d?.endpoint ?? "",
    credentialsSecretName: d?.credentialsSecretName ?? "",
    phoneAccessMode: d?.phoneAccessMode ?? "rut_whitelist",
    enabled: d?.enabled ?? true,
    driverOptions: JSON.stringify(d?.driverOptions ?? {}),
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    setError(null);
    let driverOptions: unknown;
    try {
      driverOptions = JSON.parse(f.driverOptions || "{}");
    } catch {
      return setError("Opciones del adapter: no es un JSON válido.");
    }
    const datos = {
      name: f.name,
      model: f.model,
      serial: f.serial || null,
      imei: f.imei || null,
      phoneNumber: f.phoneNumber || null,
      connectionType: f.connectionType,
      endpoint: f.endpoint || null,
      credentialsSecretName: f.credentialsSecretName || null,
      phoneAccessMode: f.phoneAccessMode,
      enabled: f.enabled,
      driverOptions,
    };
    try {
      if (d) await api.editarDispositivo(d.id, datos);
      else await api.crearDispositivo({ ...datos, centerId });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };

  return (
    <Modal
      wide
      title={d ? `Dispositivo «${d.name}»` : "Nuevo dispositivo"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!f.name.trim()} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TextField label="Nombre" value={f.name} onChange={(v) => set("name", v)} />
        <TextField label="Modelo" value={f.model} onChange={(v) => set("model", v)} />
        <SelectField label="Conexión" value={f.connectionType} onChange={(v) => set("connectionType", v as ConnectionType)}>
          {CONNECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {etqConexion(t)}
            </option>
          ))}
        </SelectField>
        <TextField label="Nº de serie" value={f.serial} onChange={(v) => set("serial", v)} />
        <TextField label="IMEI" value={f.imei} onChange={(v) => set("imei", v)} />
        <TextField label="Teléfono de la SIM (al que se llama)" value={f.phoneNumber} onChange={(v) => set("phoneNumber", v)} />
        {f.connectionType !== "mock" && (
          <>
            <TextField label="Endpoint (https://host:puerto)" value={f.endpoint} onChange={(v) => set("endpoint", v)} />
            <TextField label="Variable de entorno con las credenciales" value={f.credentialsSecretName} onChange={(v) => set("credentialsSecretName", v.toUpperCase())} placeholder="SS_RUT241_REUS" />
            <TextField label="Opciones del adapter (JSON, sin secretos)" value={f.driverOptions} onChange={(v) => set("driverOptions", v)} />
          </>
        )}
        <SelectField label="Apertura por llamada" value={f.phoneAccessMode} onChange={(v) => set("phoneAccessMode", v as typeof f.phoneAccessMode)}>
          <option value="rut_whitelist">Lista de teléfonos en el RUT241</option>
          <option value="none">No abre por llamada</option>
        </SelectField>
        <CheckField label="Habilitado" checked={f.enabled} onChange={(v) => set("enabled", v)} />
      </div>
      {f.connectionType !== "mock" && (
        <p className="mt-2 text-[12px] text-slate-400">
          Las credenciales NO se guardan aquí: van en una variable de entorno del servidor (en Render) con el JSON {"{"}"username","password"{"}"}; aquí sólo su nombre.
        </p>
      )}
      {!d && <p className="mt-2 text-[12px] text-slate-400">Se crea con una salida (la del RUT241); se pueden añadir más.</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
    </Modal>
  );
}
