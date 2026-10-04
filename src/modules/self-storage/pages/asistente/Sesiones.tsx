/**
 * Asistente IA → Sesiones: todas las conversaciones (consola y llamadas), con
 * filtros y las marcadas para revisión. Desde aquí se abre una conversación
 * de prueba en la consola de texto.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../../services/api";
import type { Pagina, SesionIA } from "../../types";
import { Cabecera, CheckField, EmptyRow, ErrorBox, Modal, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { IDIOMAS, etqIdioma, haceDias } from "../callcenter/formato";
import { ChipSesion, ConEstadoAsistente } from "./comun";
import { REVISION } from "./etiquetas";

function Contenido({ activo }: { activo: boolean }) {
  const [params] = useSearchParams();
  const [f, setF] = useState({ from: haceDias(29), status: "", reviewStatus: params.get("revision") ?? "", language: "" });
  const [datos, setDatos] = useState<Pagina<SesionIA> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(params.get("nueva") === "1");
  useEffect(() => {
    const filtro: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v) filtro[k] = v;
    api.sesionesIA({ ...filtro, limit: 200 }).then(
      (x) => (setDatos(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [f]);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <Cabecera titulo="Sesiones del asistente" descripcion="Conversaciones en la consola y en llamadas.">
        {activo && (
          <button className={btnPrimary} onClick={() => setNueva(true)}>
            Nueva conversación de prueba
          </button>
        )}
      </Cabecera>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <TextField label="Desde" type="date" value={f.from} onChange={set("from")} />
        <SelectField label="Estado" value={f.status} onChange={set("status")}>
          <option value="">Todos</option>
          <option value="active">En curso</option>
          <option value="finished">Terminadas</option>
          <option value="escalated">Escaladas</option>
          <option value="error">Con error</option>
        </SelectField>
        <SelectField label="Revisión" value={f.reviewStatus} onChange={set("reviewStatus")}>
          <option value="">Todas</option>
          <option value="pending">Pendientes de revisar</option>
          <option value="correct">Correctas</option>
          <option value="partial">Parcialmente correctas</option>
          <option value="incorrect">Incorrectas</option>
        </SelectField>
        <SelectField label="Idioma" value={f.language} onChange={set("language")}>
          <option value="">Todos</option>
          {IDIOMAS.map((i) => (
            <option key={i.code} value={i.code}>
              {i.label}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Inicio</th>
            <th className={thCls}>Origen</th>
            <th className={thCls}>Resumen</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Calidad</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!datos && <EmptyRow cols={6} text="Cargando…" />}
          {datos?.items.length === 0 && <EmptyRow cols={6} text="Sin sesiones." />}
          {datos?.items.map((s) => (
            <tr key={s.id} className="border-t border-slate-700 align-top">
              <td className={`${tdCls} whitespace-nowrap`}>
                {fechaHora(s.startedAt)}
                <div className="text-[11px] text-slate-400">
                  {s.provider} · {s.model ?? "—"} · {etqIdioma(s.language)}
                </div>
              </td>
              <td className={tdCls}>
                {s.mode === "call" ? (
                  s.callId ? (
                    <Link className="underline" to={`/self-storage/call-center/llamada/${s.callId}`}>
                      Llamada {s.callPhone ?? ""}
                    </Link>
                  ) : (
                    "Llamada"
                  )
                ) : (
                  "Consola"
                )}
                <div className="text-[11px] text-slate-400">{s.createdByName ?? ""}</div>
              </td>
              <td className={`${tdCls} max-w-md text-[12px]`}>{s.summary ?? "—"}</td>
              <td className={tdCls}>
                <ChipSesion estado={s.status} />
                <div className="text-[11px] text-slate-400">{s.turns} turnos</div>
              </td>
              <td className={`${tdCls} text-[12px]`}>
                {s.reviewStatus ? REVISION[s.reviewStatus] : s.flaggedForReview ? <span className="text-amber-300">Para revisar</span> : "—"}
                {s.flagReason && <div className="text-[11px] text-slate-400">{s.flagReason}</div>}
              </td>
              <td className={`${tdCls} text-right`}>
                <Link className={btnMini} to={`/self-storage/asistente/sesiones/${s.id}`}>
                  Abrir
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {nueva && activo && <NuevaSesion onCerrar={() => setNueva(false)} />}
    </div>
  );
}

function NuevaSesion({ onCerrar }: { onCerrar: () => void }) {
  const nav = useNavigate();
  const { centros, centroId } = useSelfStorage();
  const [simular, setSimular] = useState(true);
  const [phone, setPhone] = useState("");
  const [centerId, setCenterId] = useState(centroId ?? "");
  const [error, setError] = useState<string | null>(null);
  const empezar = async () => {
    try {
      const s = await api.iniciarSesionIA({ centerId: centerId || null, simulateCall: simular ? { phone: phone.trim() || null } : null });
      nav(`/self-storage/asistente/sesiones/${s.id}`);
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title="Nueva conversación de prueba"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void empezar()}>
            Empezar
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <SelectField label="Centro" value={centerId} onChange={setCenterId}>
          <option value="">— El de la configuración —</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <CheckField label="Simular una llamada (queda registrada en el Call Center como atendida por la IA)" checked={simular} onChange={setSimular} />
        {simular && <TextField label="Teléfono de quien «llama» (opcional)" value={phone} onChange={setPhone} placeholder="600 000 000" />}
        <p className="text-[12px] text-slate-400">Escribes como si fueras quien llama. Las herramientas son las reales de Mobilink (con tus permisos) y quedan registradas.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

export default function Sesiones() {
  return <ConEstadoAsistente>{(e) => <Contenido activo={e.enabled} />}</ConEstadoAsistente>;
}
