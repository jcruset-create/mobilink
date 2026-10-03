/**
 * Piezas de accesos que comparten la pantalla «Accesos» y la ficha del
 * contrato: registro de aperturas, accesos temporales (alta con el enlace que
 * se enseña UNA vez) y su lista. Ninguna decide si alguien entra: lo decide
 * el servidor con el mismo motor para todos.
 */

import { useState } from "react";
import * as api from "../services/api";
import type { AccesoTemporal, EventoAcceso } from "../types";
import { Aviso, CheckField, EmptyRow, ErrorBox, Modal, Pill, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "./ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

/** Enlace público de un acceso temporal (el token sólo existe en la respuesta del alta). */
const enlaceTemporal = (token: string) => `${window.location.origin}/trasteros/abrir/${token}`;

function ChipResultado({ e }: { e: EventoAcceso }) {
  if (e.decision === "denied") return <Pill className="bg-rose-500/20 text-rose-300">Denegado</Pill>;
  const c = {
    succeeded: ["Abierta", "bg-emerald-500/20 text-emerald-300"],
    pending: ["Enviando…", "bg-amber-500/20 text-amber-300"],
    failed: ["Fallo del equipo", "bg-rose-500/20 text-rose-300"],
    timeout: ["Sin respuesta", "bg-rose-500/20 text-rose-300"],
    not_attempted: ["No ejecutada", "bg-slate-600/40 text-slate-300"],
  }[e.executionStatus] ?? [e.executionStatus, "bg-slate-600/40 text-slate-300"];
  return <Pill className={c[1]}>{c[0]}</Pill>;
}

export function TablaEventos({ eventos, conPuerta = true }: { eventos: EventoAcceso[] | null; conPuerta?: boolean }) {
  const { etqMotivoAcceso, etqMetodoAcceso } = useSelfStorage();
  const cols = conPuerta ? 6 : 5;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Cuándo</th>
          <th className={thCls}>Quién</th>
          {conPuerta && <th className={thCls}>Puerta</th>}
          <th className={thCls}>Cómo</th>
          <th className={thCls}>Resultado</th>
          <th className={thCls}>Motivo · respuesta del equipo</th>
        </tr>
      </thead>
      <tbody>
        {!eventos && <EmptyRow cols={cols} text="Cargando…" />}
        {eventos?.length === 0 && <EmptyRow cols={cols} text="Sin aperturas registradas." />}
        {eventos?.map((e) => (
          <tr key={e.id} className="border-t border-slate-700 align-top">
            <td className={`${tdCls} whitespace-nowrap`}>{fechaHora(e.requestedAt)}</td>
            <td className={tdCls}>
              {e.actorName ?? "—"}
              <div className="text-[11px] text-slate-400">
                {{ staff: "personal", customer: "titular", member: "autorizado", guest: "invitado" }[e.actorType] ?? e.actorType}
                {e.contractNumber ? ` · ${e.contractNumber}` : ""}
              </div>
            </td>
            {conPuerta && (
              <td className={tdCls}>
                {e.doorName ?? "—"}
                {e.deviceName && <div className="text-[11px] text-slate-400">{e.deviceName}</div>}
              </td>
            )}
            <td className={tdCls}>{etqMetodoAcceso(e.method)}</td>
            <td className={tdCls}>
              <ChipResultado e={e} />
            </td>
            <td className={`${tdCls} text-[12px]`}>
              {e.decision === "denied" ? etqMotivoAcceso(e.reason) : e.deviceResponse && !e.deviceResponse.ok ? `${e.deviceResponse.code ?? ""} ${e.deviceResponse.message ?? ""}` : e.latencyMs != null ? `${e.latencyMs} ms` : "—"}
              {e.adminReason && <div className="text-slate-400">«{e.adminReason}»</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function TablaTemporales({ lista, gestiona, onRevocar }: { lista: AccesoTemporal[] | null; gestiona: boolean; onRevocar: (t: AccesoTemporal) => void }) {
  const [ahora] = useState(() => Date.now());
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Persona</th>
          <th className={thCls}>Puertas</th>
          <th className={thCls}>Vigencia</th>
          <th className={thCls}>Usos</th>
          <th className={thCls}>Estado</th>
          <th className={thCls} />
        </tr>
      </thead>
      <tbody>
        {!lista && <EmptyRow cols={6} text="Cargando…" />}
        {lista?.length === 0 && <EmptyRow cols={6} text="Sin accesos temporales." />}
        {lista?.map((t) => {
          const caducado = new Date(t.endsAt).getTime() < ahora;
          const agotado = t.maxUses != null && t.usesCount >= t.maxUses;
          const vivo = t.status === "active" && !caducado && !agotado;
          return (
            <tr key={t.id} className={`border-t border-slate-700 align-top ${vivo ? "" : "opacity-60"}`}>
              <td className={tdCls}>
                {t.fullName}
                <div className="text-[11px] text-slate-400">
                  {t.holderType === "holder" ? "titular" : "invitado"}
                  {t.phone ? ` · ${t.phone}` : ""}
                  {t.hasLink ? " · con enlace" : ""}
                  {t.contractNumber ? ` · ${t.contractNumber}` : ""}
                </div>
              </td>
              <td className={tdCls}>{t.doors.map((d) => d.name).join(", ")}</td>
              <td className={`${tdCls} text-[12px]`}>
                {fechaHora(t.startsAt)} → {fechaHora(t.endsAt)}
              </td>
              <td className={tdCls}>{t.maxUses == null ? `${t.usesCount} (sin límite)` : `${t.usesCount} / ${t.maxUses}`}</td>
              <td className={tdCls}>
                {t.status === "revoked" ? (
                  <Pill className="bg-slate-600/40 text-slate-300">Revocado</Pill>
                ) : caducado ? (
                  <Pill className="bg-slate-600/40 text-slate-300">Caducado</Pill>
                ) : agotado ? (
                  <Pill className="bg-slate-600/40 text-slate-300">Usado</Pill>
                ) : (
                  <Pill className="bg-emerald-500/20 text-emerald-300">Vigente</Pill>
                )}
              </td>
              <td className={`${tdCls} text-right`}>
                {gestiona && t.status === "active" && !caducado && (
                  <button className={btnMini} onClick={() => onRevocar(t)}>
                    Revocar
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

/** «AAAA-MM-DDTHH:MM» local para un <input type="datetime-local">. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function FormTemporal({
  puertas,
  centerId,
  contractId,
  onCerrar,
  onHecho,
}: {
  puertas: { id: string; name: string }[];
  centerId?: string | null;
  contractId?: string | null;
  onCerrar: () => void;
  onHecho: (t: AccesoTemporal) => void;
}) {
  const ahora = new Date();
  const [f, setF] = useState({
    fullName: "",
    holderType: "guest" as "guest" | "holder",
    phone: "",
    email: "",
    startsAt: local(ahora),
    endsAt: local(new Date(ahora.getTime() + 24 * 3600_000)),
    usos: "1",
    withLink: true,
    doorIds: [] as string[],
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setError(null);
    try {
      const t = await api.crearTemporal({
        centerId: contractId ? null : centerId,
        contractId: contractId ?? null,
        holderType: f.holderType,
        fullName: f.fullName.trim(),
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        startsAt: new Date(f.startsAt).toISOString(),
        endsAt: new Date(f.endsAt).toISOString(),
        maxUses: f.usos === "" ? null : Number(f.usos),
        doorIds: f.doorIds,
        withLink: f.withLink,
        notes: f.notes.trim() || null,
      });
      onHecho(t);
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title="Nuevo acceso temporal"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!f.fullName.trim() || f.doorIds.length === 0} onClick={() => void guardar()}>
            Crear
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextField label="Nombre" value={f.fullName} onChange={(v) => set("fullName", v)} />
          <SelectField label="Es" value={f.holderType} onChange={(v) => set("holderType", v as "guest" | "holder")}>
            <option value="guest">Invitado</option>
            <option value="holder">El titular</option>
          </SelectField>
          <TextField label="Teléfono (abre llamando si la puerta lo permite)" value={f.phone} onChange={(v) => set("phone", v)} placeholder="+34…" />
          <TextField label="Email (opcional)" value={f.email} onChange={(v) => set("email", v)} />
          <TextField label="Desde" type="datetime-local" value={f.startsAt} onChange={(v) => set("startsAt", v)} />
          <TextField label="Hasta" type="datetime-local" value={f.endsAt} onChange={(v) => set("endsAt", v)} />
          <SelectField label="Usos" value={f.usos} onChange={(v) => set("usos", v)}>
            <option value="1">Un solo uso</option>
            <option value="2">2 usos</option>
            <option value="5">5 usos</option>
            <option value="10">10 usos</option>
            <option value="">Sin límite dentro de las fechas</option>
          </SelectField>
          <CheckField label="Generar enlace para abrir desde el móvil" checked={f.withLink} onChange={(v) => set("withLink", v)} />
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Puertas</div>
          <div className="flex flex-wrap gap-1">
            {puertas.map((p) => {
              const on = f.doorIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`rounded-lg px-2 py-1 text-[12px] ${on ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-300"}`}
                  onClick={() => set("doorIds", on ? f.doorIds.filter((x) => x !== p.id) : [...f.doorIds, p.id])}
                >
                  {p.name}
                </button>
              );
            })}
            {puertas.length === 0 && <span className="text-[12px] text-slate-400">No hay puertas en este centro.</span>}
          </div>
        </div>
        <TextField label="Notas" value={f.notes} onChange={(v) => set("notes", v)} />
        <p className="text-[12px] text-slate-400">
          Usa el mismo motor que el resto de accesos: {contractId ? "si el contrato se bloquea (impago, seguridad…), este acceso tampoco abre." : "fechas, usos y puertas se comprueban en cada intento."}
          {f.phone.trim() && f.usos !== "" ? " Por llamada sólo entran los accesos sin límite de usos (la llamada no se puede contar)." : ""}
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

/** El enlace recién creado: se enseña una sola vez (el servidor sólo guarda su huella). */
export function EnlaceCreado({ t, onCerrar }: { t: AccesoTemporal; onCerrar: () => void }) {
  const url = t.token ? enlaceTemporal(t.token) : null;
  const [copiado, setCopiado] = useState(false);
  return (
    <Modal
      title={`Acceso temporal de ${t.fullName}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={onCerrar}>
            Hecho
          </button>
        </div>
      }
    >
      {url ? (
        <div className="space-y-2">
          <Aviso tono="aviso">Copia el enlace ahora: no se vuelve a mostrar. Si se pierde, revoca este acceso y crea otro.</Aviso>
          <div className="break-all rounded-lg bg-slate-900 p-2 font-mono text-[12px]">{url}</div>
          <button
            className={btnMini}
            onClick={() =>
              void navigator.clipboard.writeText(url).then(
                () => setCopiado(true),
                () => setCopiado(false)
              )
            }
          >
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-300">Creado sin enlace{t.phone ? ": abrirá llamando desde su teléfono." : "."}</p>
      )}
    </Modal>
  );
}
