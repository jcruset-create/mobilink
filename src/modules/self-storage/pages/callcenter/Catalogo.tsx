/**
 * Call Center → Motivos y resultados. Los de partida no cambian de código (los
 * usan los informes y el estado en que queda la llamada), pero se renombran,
 * ordenan y desactivan. Se pueden añadir propios: un resultado propio termina
 * la llamada sin cerrarla.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import { PRIORITIES, type EntradaCatalogo, type Priority } from "../../types";
import { Aviso, Cabecera, ErrorBox, Modal, Pill, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { useEstadoCallCenter } from "./useEstadoCallCenter";

export default function Catalogo() {
  const { puede, etqPrioridad } = useSelfStorage();
  const { estado } = useEstadoCallCenter();
  const [lista, setLista] = useState<EntradaCatalogo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<EntradaCatalogo | { nuevo: "reason" | "result" } | null>(null);
  const gestiona = puede("ss.callcenter.configure");

  const cargar = useCallback(() => {
    api.catalogoLlamadas().then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);
  if (estado && !estado.global) return <Aviso tono="aviso">El Call Center está desactivado en este servidor.</Aviso>;

  const tabla = (kind: "reason" | "result") => (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold">{kind === "reason" ? "Motivos de llamada" : "Resultados"}</h2>
        {gestiona && (
          <button className={btnMini} onClick={() => setEditar({ nuevo: kind })}>
            Añadir
          </button>
        )}
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Etiqueta</th>
            <th className={thCls}>Código</th>
            {kind === "reason" && <th className={thCls}>Prioridad por defecto</th>}
            <th className={thCls}>Estado</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {lista
            ?.filter((x) => x.kind === kind)
            .map((x) => (
              <tr key={x.id} className={`border-t border-slate-700 ${x.active ? "" : "opacity-50"}`}>
                <td className={tdCls}>{x.label}</td>
                <td className={`${tdCls} font-mono text-[12px] text-slate-400`}>
                  {x.code} {x.isSystem && <Pill className="bg-slate-700 text-slate-300">de partida</Pill>}
                </td>
                {kind === "reason" && <td className={tdCls}>{x.defaultPriority ? etqPrioridad(x.defaultPriority) : "—"}</td>}
                <td className={tdCls}>{x.active ? "Activo" : "Desactivado"}</td>
                <td className={`${tdCls} space-x-1 text-right`}>
                  {gestiona && (
                    <>
                      <button className={btnMini} onClick={() => setEditar(x)}>
                        Editar
                      </button>
                      <button className={btnMini} onClick={() => void api.editarEntradaCatalogo(x.id, { active: !x.active }).then(cargar, (e) => setError(msgError(e)))}>
                        {x.active ? "Desactivar" : "Activar"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </section>
  );

  return (
    <div className="space-y-4">
      <Cabecera titulo="Motivos y resultados" descripcion="El vocabulario del Call Center. Lo usan la pantalla de la llamada y los informes." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {tabla("reason")}
      {tabla("result")}
      {editar && (
        <FormEntrada
          e={"nuevo" in editar ? null : editar}
          kind={"nuevo" in editar ? editar.nuevo : editar.kind}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function FormEntrada({ e, kind, onCerrar, onHecho }: { e: EntradaCatalogo | null; kind: "reason" | "result"; onCerrar: () => void; onHecho: () => void }) {
  const { etqPrioridad } = useSelfStorage();
  const [label, setLabel] = useState(e?.label ?? "");
  const [code, setCode] = useState(e?.code ?? "");
  const [prioridad, setPrioridad] = useState<string>(e?.defaultPriority ?? "");
  const [orden, setOrden] = useState(String(e?.sortOrder ?? ""));
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    const comun = { label: label.trim(), ...(kind === "reason" ? { defaultPriority: (prioridad || null) as Priority | null } : {}), ...(orden ? { sortOrder: Number(orden) } : {}) };
    try {
      if (e) await api.editarEntradaCatalogo(e.id, comun);
      else await api.crearEntradaCatalogo({ kind, code: code.trim(), ...comun });
      onHecho();
    } catch (x) {
      setError(msgError(x));
    }
  };
  return (
    <Modal
      title={e ? `Editar «${e.label}»` : kind === "reason" ? "Nuevo motivo" : "Nuevo resultado"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!label.trim() || (!e && !/^[a-z][a-z0-9_]{1,39}$/.test(code.trim()))} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <TextField label="Etiqueta" value={label} onChange={setLabel} />
        {!e && <TextField label="Código (minúsculas y _; no se puede cambiar después)" value={code} onChange={(v) => setCode(v.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />}
        {kind === "reason" && (
          <SelectField label="Prioridad por defecto" value={prioridad} onChange={setPrioridad}>
            <option value="">— Ninguna —</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {etqPrioridad(p)}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Orden" type="number" value={orden} onChange={setOrden} />
        {kind === "result" && !e && <p className="text-[12px] text-slate-400">Un resultado propio termina la llamada sin cerrarla; los de partida deciden si queda cerrada, en seguimiento o escalada.</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
