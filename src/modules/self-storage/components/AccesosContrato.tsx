/**
 * Ficha del contrato → accesos: personas autorizadas (cada una con su propia
 * identidad en el registro: «María abrió»), qué puertas abre HOY el contrato
 * y por qué (lo evalúa el servidor), permisos manuales, accesos temporales y
 * las últimas aperturas.
 *
 * Los permisos «de contrato» los genera Mobilink a partir de la zona del
 * trastero; aquí sólo se añaden o quitan los manuales.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import type { AccesoTemporal, AccesosContrato as Datos, EventoAcceso, MiembroContrato, Puerta } from "../types";
import { EnlaceCreado, FormTemporal, TablaEventos, TablaTemporales } from "./Accesos";
import { CheckField, EmptyRow, ErrorBox, Modal, Pill, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "./ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function AccesosContrato({ contractId, centerId }: { contractId: string; centerId: string }) {
  const { puede, etqMotivoAcceso, etqTipoPuerta } = useSelfStorage();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [miembros, setMiembros] = useState<MiembroContrato[] | null>(null);
  const [temporales, setTemporales] = useState<AccesoTemporal[] | null>(null);
  const [eventos, setEventos] = useState<EventoAcceso[] | null>(null);
  const [puertas, setPuertas] = useState<Puerta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editMiembro, setEditMiembro] = useState<MiembroContrato | "nuevo" | null>(null);
  const [nuevoPermiso, setNuevoPermiso] = useState(false);
  const [nuevoTemporal, setNuevoTemporal] = useState(false);
  const [creado, setCreado] = useState<AccesoTemporal | null>(null);
  const gestiona = puede("ss.access.manage");

  const cargar = useCallback(async () => {
    try {
      const [a, m, t, e, p] = await Promise.all([
        api.accesosContrato(contractId),
        api.miembros(contractId),
        api.temporales({ contractId }),
        api.eventosAcceso({ contractId, limit: 30 }),
        api.puertas(centerId),
      ]);
      setDatos(a);
      setMiembros(m);
      setTemporales(t);
      setEventos(e);
      setPuertas(p);
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [contractId, centerId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const accion = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setAviso(ok);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold">Accesos</h2>
      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <div className="text-[12px] text-emerald-300">{aviso}</div>}

      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase text-slate-400">Puertas del contrato (ahora mismo)</div>
        <div className="flex flex-wrap gap-1">
          {datos?.puertas.length === 0 && <span className="text-[12px] text-slate-400">El centro no tiene puertas dadas de alta.</span>}
          {datos?.puertas.map((p) => (
            <Pill key={p.doorId} className={p.granted ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/60 text-slate-300"}>
              {p.doorName} · {etqTipoPuerta(p.doorType)} · {p.granted ? "abre" : etqMotivoAcceso(p.reason)}
            </Pill>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Personas autorizadas</div>
          {gestiona && (
            <button className={btnMini} onClick={() => setEditMiembro("nuevo")}>
              Añadir
            </button>
          )}
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Nombre</th>
              <th className={thCls}>Contacto</th>
              <th className={thCls}>Puede</th>
              <th className={thCls}>Estado</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {miembros?.length === 0 && <EmptyRow cols={5} text="Sólo el titular." />}
            {miembros?.map((m) => (
              <tr key={m.id} className="border-t border-slate-700">
                <td className={tdCls}>{m.fullName}</td>
                <td className={`${tdCls} text-[12px]`}>{[m.phone, m.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className={`${tdCls} text-[12px]`}>
                  {[m.allowApp && `app${m.hasPortalAccount ? "" : " (sin invitar)"}`, m.allowPhone && "llamada"].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className={tdCls}>{{ active: "Activa", suspended: "Suspendida", revoked: "Retirada" }[m.status]}</td>
                <td className={`${tdCls} space-x-1 text-right`}>
                  {gestiona && m.status === "active" && m.allowApp && m.email && !m.hasPortalAccount && (
                    <button className={btnMini} onClick={() => void accion(() => api.invitarMiembro(contractId, m.id), `Invitación enviada a ${m.email}.`)}>
                      Invitar al portal
                    </button>
                  )}
                  {gestiona && (
                    <button className={btnMini} onClick={() => setEditMiembro(m)}>
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Permisos</div>
          {gestiona && (
            <button className={btnMini} onClick={() => setNuevoPermiso(true)}>
              Permiso manual
            </button>
          )}
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Puerta</th>
              <th className={thCls}>Origen</th>
              <th className={thCls}>Vigencia</th>
              <th className={thCls}>Estado</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {datos?.permisos.length === 0 && <EmptyRow cols={5} text="Sin permisos (el contrato aún no está activo o el centro no tiene puertas)." />}
            {datos?.permisos.map((p) => (
              <tr key={p.id} className={`border-t border-slate-700 ${p.status === "active" ? "" : "opacity-50"}`}>
                <td className={tdCls}>{p.doorName}</td>
                <td className={tdCls}>{p.source === "contract" ? "Por contrato" : "Manual"}</td>
                <td className={`${tdCls} text-[12px]`}>{p.validFrom || p.validUntil ? `${fechaHora(p.validFrom)} → ${fechaHora(p.validUntil)}` : "Mientras dure el contrato"}</td>
                <td className={tdCls}>{p.status === "active" ? "Activo" : `Revocado ${fechaHora(p.revokedAt)}`}</td>
                <td className={`${tdCls} text-right`}>
                  {gestiona && p.source === "manual" && p.status === "active" && (
                    <button className={btnMini} onClick={() => void accion(() => api.revocarPermiso(contractId, p.id))}>
                      Revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Accesos temporales</div>
          {gestiona && (
            <button className={btnMini} onClick={() => setNuevoTemporal(true)}>
              Nuevo
            </button>
          )}
        </div>
        <TablaTemporales
          lista={temporales}
          gestiona={gestiona}
          onRevocar={(t) => {
            if (window.confirm(`¿Revocar el acceso de ${t.fullName}?`)) void accion(() => api.revocarTemporal(t.id));
          }}
        />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase text-slate-400">Últimas aperturas</div>
        <TablaEventos eventos={eventos} />
      </div>

      {editMiembro && (
        <FormMiembro
          contractId={contractId}
          m={editMiembro === "nuevo" ? null : editMiembro}
          onCerrar={() => setEditMiembro(null)}
          onHecho={() => {
            setEditMiembro(null);
            void cargar();
          }}
        />
      )}
      {nuevoPermiso && (
        <FormPermiso
          contractId={contractId}
          puertas={puertas.filter((p) => p.enabled)}
          onCerrar={() => setNuevoPermiso(false)}
          onHecho={() => {
            setNuevoPermiso(false);
            void cargar();
          }}
        />
      )}
      {nuevoTemporal && (
        <FormTemporal
          puertas={puertas.filter((p) => p.enabled)}
          contractId={contractId}
          onCerrar={() => setNuevoTemporal(false)}
          onHecho={(t) => {
            setNuevoTemporal(false);
            setCreado(t);
            void cargar();
          }}
        />
      )}
      {creado && <EnlaceCreado t={creado} onCerrar={() => setCreado(null)} />}
    </section>
  );
}

function FormMiembro({ contractId, m, onCerrar, onHecho }: { contractId: string; m: MiembroContrato | null; onCerrar: () => void; onHecho: () => void }) {
  const [f, setF] = useState({
    fullName: m?.fullName ?? "",
    phone: m?.phone ?? "",
    email: m?.email ?? "",
    allowApp: m?.allowApp ?? false,
    allowPhone: m?.allowPhone ?? true,
    status: m?.status ?? "active",
    notes: m?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    const d = { fullName: f.fullName.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, allowApp: f.allowApp, allowPhone: f.allowPhone, notes: f.notes.trim() || null };
    try {
      if (m) await api.editarMiembro(contractId, m.id, { ...d, status: f.status });
      else await api.crearMiembro(contractId, d);
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title={m ? m.fullName : "Nueva persona autorizada"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!f.fullName.trim()} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Nombre" value={f.fullName} onChange={(v) => set("fullName", v)} />
        <TextField label="Teléfono" value={f.phone} onChange={(v) => set("phone", v)} placeholder="+34…" />
        <TextField label="Email (para la app)" value={f.email} onChange={(v) => set("email", v)} />
        {m && (
          <SelectField label="Estado" value={f.status} onChange={(v) => set("status", v as MiembroContrato["status"])}>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="revoked">Retirada</option>
          </SelectField>
        )}
        <CheckField label="Abre con la app" checked={f.allowApp} onChange={(v) => set("allowApp", v)} />
        <CheckField label="Abre llamando" checked={f.allowPhone} onChange={(v) => set("allowPhone", v)} />
        <TextField label="Notas" value={f.notes} onChange={(v) => set("notes", v)} />
      </div>
      <p className="mt-2 text-[12px] text-slate-400">Entra con su propia identidad: en el registro aparece su nombre, no el del titular. Si el contrato se bloquea, ella tampoco abre.</p>
      {error && <ErrorBox>{error}</ErrorBox>}
    </Modal>
  );
}

function FormPermiso({ contractId, puertas, onCerrar, onHecho }: { contractId: string; puertas: Puerta[]; onCerrar: () => void; onHecho: () => void }) {
  const [doorId, setDoorId] = useState("");
  const [hasta, setHasta] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    try {
      await api.concederPermiso(contractId, { doorId, validUntil: hasta ? new Date(hasta).toISOString() : null, notes: notas.trim() || null });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title="Permiso manual"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!doorId} onClick={() => void guardar()}>
            Conceder
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <SelectField label="Puerta" value={doorId} onChange={setDoorId}>
          <option value="">— Elige —</option>
          {puertas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Hasta (opcional)" type="datetime-local" value={hasta} onChange={setHasta} />
        <TextField label="Motivo" value={notas} onChange={setNotas} />
        <p className="text-[12px] text-slate-400">Un permiso manual no salta los bloqueos: con el contrato bloqueado no abre.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
