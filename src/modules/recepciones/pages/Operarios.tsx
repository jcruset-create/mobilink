/**
 * El padrón del muelle: quién puede firmar una recepción.
 *
 * No son usuarios de Mobilink. El tablet del muelle lo abre un encargado por
 * la mañana y por él pasan cinco personas en el turno; estas son esas
 * personas, y su PIN es lo que firma el papel de cada recepción.
 *
 * El PIN no se enseña NUNCA, ni aquí ni en la API: sólo se puede poner uno
 * nuevo. Eso es también la salida cuando alguien se lo olvida o se queda
 * bloqueado por fallarlo cinco veces.
 *
 * Ojo con lo que implica dar de alta al primero: a partir de ese momento,
 * cerrar una recepción en ese centro exige elegir operario y teclear su PIN.
 * Mientras la lista esté vacía, firma la sesión.
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, UserCheck } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, EmptyRow, ErrorBox, Modal, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import type { Operario } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function Operarios() {
  const { centros, centroId, puede } = useRecepciones();
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [cambiandoPin, setCambiandoPin] = useState<Operario | null>(null);
  // La hora se congela al cargar: mirar el reloj mientras se pinta no es puro,
  // y para decidir si un bloqueo sigue vivo basta con la de la última carga.
  const [ahora, setAhora] = useState(() => Date.now());
  const puedeGestionar = puede("recepciones.operarios.manage");

  const cargar = useCallback(async () => {
    try {
      const r = await api.listarOperarios();
      setOperarios(r.operarios);
      setAhora(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los operarios");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function alternar(o: Operario) {
    try {
      await api.actualizarOperario(o.id, { activo: !o.activo });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar el operario");
    }
  }

  const nombreCentro = (id: string | null) => (id ? (centros.find((c) => c.id === id)?.nombre ?? "—") : "Todos los centros");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-100">Operarios del muelle</h1>
          <p className="text-[12px] text-slate-400">Quién puede firmar una recepción con su PIN. No son usuarios de Mobilink.</p>
        </div>
        {puedeGestionar && (
          <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" /> Nuevo operario
          </button>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {operarios.length === 0 && (
        <div className="mb-3">
          <Aviso tono="info">
            Todavía no hay operarios: las recepciones las firma quien tenga la sesión abierta. En cuanto des de alta al primero, cerrar una recepción pedirá
            elegirlo y teclear su PIN.
          </Aviso>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Operario</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Alta</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {operarios.length === 0 && <EmptyRow cols={5} text="Sin operarios dados de alta." />}
          {operarios.map((o) => {
            const bloqueado = o.bloqueadoHasta !== null && new Date(o.bloqueadoHasta).getTime() > ahora;
            return (
              <tr key={o.id} className="border-t border-slate-700/60">
                <td className={`${tdCls} font-bold`}>
                  <span className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-slate-500" /> {o.nombre}
                  </span>
                </td>
                <td className={tdCls}>{nombreCentro(o.centroId)}</td>
                <td className={tdCls}>
                  {!o.activo ? (
                    <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-[11px] font-bold text-slate-300">De baja</span>
                  ) : bloqueado ? (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                      Bloqueado hasta {fmtFechaHora(o.bloqueadoHasta)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">Activo</span>
                  )}
                </td>
                <td className={`${tdCls} text-[12px] text-slate-400`}>
                  {fmtFechaHora(o.createdAt)}
                  {o.creadoNombre ? ` · ${o.creadoNombre}` : ""}
                </td>
                <td className={`${tdCls} text-right`}>
                  {puedeGestionar && (
                    <div className="flex justify-end gap-1">
                      <button className={`${btnMini} flex items-center gap-1`} onClick={() => setCambiandoPin(o)}>
                        <KeyRound className="h-3.5 w-3.5" /> {bloqueado ? "Desbloquear con un PIN nuevo" : "Cambiar PIN"}
                      </button>
                      <button className={btnMini} onClick={() => void alternar(o)}>
                        {o.activo ? "Dar de baja" : "Reactivar"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {creando && <NuevoOperario centros={centros} centroFijo={centroId} onClose={() => setCreando(false)} onCreado={cargar} />}
      {cambiandoPin && <CambiarPin operario={cambiandoPin} onClose={() => setCambiandoPin(null)} onHecho={cargar} />}
    </div>
  );
}

/** Un PIN sólo se escribe: se pide dos veces porque no hay forma de leerlo después. */
function CamposPin({ pin, repetir, onPin, onRepetir }: { pin: string; repetir: string; onPin: (v: string) => void; onRepetir: (v: string) => void }) {
  const soloDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  return (
    <>
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">PIN (4 a 8 dígitos)</label>
        <input type="password" inputMode="numeric" autoComplete="new-password" className={`${inputCls} text-center text-xl tracking-[0.4em]`} value={pin} onChange={(e) => onPin(soloDigitos(e.target.value))} />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Repite el PIN</label>
        <input type="password" inputMode="numeric" autoComplete="new-password" className={`${inputCls} text-center text-xl tracking-[0.4em]`} value={repetir} onChange={(e) => onRepetir(soloDigitos(e.target.value))} />
      </div>
      {pin.length > 0 && pin.length < 4 && <p className="text-[12px] text-amber-300">Hacen falta al menos 4 dígitos.</p>}
      {repetir.length > 0 && pin !== repetir && <p className="text-[12px] text-rose-300">Los dos PIN no coinciden.</p>}
    </>
  );
}

function NuevoOperario({
  centros,
  centroFijo,
  onClose,
  onCreado,
}: {
  centros: { id: string; nombre: string }[];
  centroFijo: string | null;
  onClose: () => void;
  onCreado: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [centro, setCentro] = useState(centroFijo ?? "");
  const [pin, setPin] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const valido = nombre.trim().length > 0 && pin.length >= 4 && pin === repetir;

  async function guardar() {
    setGuardando(true);
    try {
      await api.crearOperario({ nombre: nombre.trim(), pin, centroId: centro || null });
      await onCreado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el operario");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Nuevo operario"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void guardar()} disabled={guardando || !valido}>
            {guardando ? "Guardando…" : "Crear"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Nombre y apellidos" value={nombre} onChange={setNombre} />
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Centro</label>
          <select className={inputCls} value={centro} onChange={(e) => setCentro(e.target.value)} disabled={centroFijo !== null}>
            <option value="">Todos los centros</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">Con un centro, sólo aparece y sólo firma en ése.</p>
        </div>
        <CamposPin pin={pin} repetir={repetir} onPin={setPin} onRepetir={setRepetir} />
      </div>
    </Modal>
  );
}

function CambiarPin({ operario, onClose, onHecho }: { operario: Operario; onClose: () => void; onHecho: () => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api.actualizarOperario(operario.id, { pin });
      await onHecho();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar el PIN");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={`PIN de ${operario.nombre}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void guardar()} disabled={guardando || pin.length < 4 || pin !== repetir}>
            {guardando ? "Guardando…" : "Guardar PIN"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-[12px] text-slate-400">
          El PIN anterior no se puede consultar: sólo se puede poner uno nuevo. Guardarlo levanta además cualquier bloqueo por PIN fallidos.
        </p>
        <CamposPin pin={pin} repetir={repetir} onPin={setPin} onRepetir={setRepetir} />
      </div>
    </Modal>
  );
}
