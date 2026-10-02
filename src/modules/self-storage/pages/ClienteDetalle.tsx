/**
 * Ficha del cliente: datos, teléfonos (incluidos los autorizados para abrir por
 * llamada en la fase 3), contratos (1 cliente → N contratos, también en centros
 * distintos) y bloqueo/desbloqueo con motivo.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../services/api";
import type { FichaCliente } from "../types";
import FormCliente from "../components/FormCliente";
import {
  Aviso,
  Cabecera,
  Cargando,
  CheckField,
  ChipCliente,
  Dato,
  EmptyRow,
  ErrorBox,
  Modal,
  TableWrap,
  TextAreaField,
  TextField,
  btnDanger,
  btnMini,
  btnPrimary,
  btnSecondary,
  euros,
  tdCls,
  thCls,
} from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function ClienteDetalle() {
  const { id = "" } = useParams();
  const { puede, etqTipoCliente, etqContrato } = useSelfStorage();
  const [c, setC] = useState<FichaCliente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState(false);
  const [bloqueo, setBloqueo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [tel, setTel] = useState({ phone: "", label: "", allowDoorAccess: false });
  const gestiona = puede("ss.customers.manage");

  const cargar = useCallback(async () => {
    try {
      setC(await api.cliente(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiarEstado = async (status: "active" | "blocked" | "inactive", statusReason?: string) => {
    try {
      await api.editarCliente(id, { status, statusReason });
      setBloqueo(false);
      setMotivo("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar el estado");
    }
  };

  const anadirTel = async () => {
    try {
      await api.anadirTelefono(id, { phone: tel.phone, label: tel.label || undefined, allowDoorAccess: tel.allowDoorAccess });
      setTel({ phone: "", label: "", allowDoorAccess: false });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido añadir el teléfono");
    }
  };

  const quitarTel = async (phoneId: string) => {
    try {
      await api.quitarTelefono(id, phoneId);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido quitar");
    }
  };

  if (error && !c) return <ErrorBox>{error}</ErrorBox>;
  if (!c) return <Cargando />;

  return (
    <div className="space-y-4">
      <Cabecera titulo={c.displayName} descripcion={`${etqTipoCliente(c.customerType)} · ${c.taxId}`}>
        <ChipCliente estado={c.status} />
        {gestiona && (
          <>
            <button className={btnSecondary} onClick={() => setEditar(true)}>
              Editar
            </button>
            {c.status === "blocked" ? (
              <button className={btnPrimary} onClick={() => void cambiarEstado("active")}>
                Desbloquear
              </button>
            ) : (
              <button className={btnDanger} onClick={() => setBloqueo(true)}>
                Bloquear
              </button>
            )}
          </>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      {c.status === "blocked" && <Aviso tono="mal">Bloqueado: {c.statusReason}</Aviso>}

      <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato etiqueta="Teléfono">{c.phone}</Dato>
        <Dato etiqueta="Email">{c.email}</Dato>
        <Dato etiqueta="Dirección">{[c.address, c.postalCode, c.city, c.province, c.country].filter(Boolean).join(", ") || "—"}</Dato>
        <Dato etiqueta="Portal del cliente">{c.hasPortalAccount ? "Con cuenta" : "Sin cuenta (fase 4)"}</Dato>
        {c.notes && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Dato etiqueta="Notas internas">{c.notes}</Dato>
          </div>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Contratos</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={thCls}>Centro</th>
              <th className={thCls}>Trastero</th>
              <th className={thCls}>Desde</th>
              <th className={thCls}>Base/mes</th>
              <th className={thCls}>Autorizados</th>
              <th className={thCls}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {c.contracts.length === 0 && <EmptyRow cols={7} text="Sin contratos. La contratación llega en la fase 2." />}
            {c.contracts.map((k) => (
              <tr key={k.id} className="border-t border-slate-700">
                <td className={tdCls}>{k.contractNumber}</td>
                <td className={tdCls}>{k.centerName}</td>
                <td className={tdCls}>{k.unitCode}</td>
                <td className={tdCls}>{k.startDate}</td>
                <td className={tdCls}>{euros(k.monthlyPrice)}</td>
                <td className={tdCls}>{k.members}</td>
                <td className={tdCls}>{etqContrato(k.status)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Teléfonos</h2>
        <p className="text-[12px] text-slate-400">
          Los marcados «abre puertas» se sincronizarán con la lista de llamadas autorizadas del RUT241 en la fase 3. Un mismo número sólo puede abrir
          para un cliente.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={thCls}>Etiqueta</th>
              <th className={thCls}>Abre puertas</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {c.phones.length === 0 && <EmptyRow cols={4} text="Sin teléfonos adicionales." />}
            {c.phones.map((p) => (
              <tr key={p.id} className="border-t border-slate-700">
                <td className={tdCls}>{p.phone}</td>
                <td className={tdCls}>{p.label ?? "—"}</td>
                <td className={tdCls}>{p.allowDoorAccess ? "Sí" : "No"}</td>
                <td className={`${tdCls} text-right`}>
                  {gestiona && (
                    <button className={btnMini} onClick={() => void quitarTel(p.id)}>
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {gestiona && (
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <TextField label="Teléfono" value={tel.phone} onChange={(v) => setTel((t) => ({ ...t, phone: v }))} />
            <TextField label="Etiqueta" value={tel.label} onChange={(v) => setTel((t) => ({ ...t, label: v }))} />
            <CheckField label="Abre puertas" checked={tel.allowDoorAccess} onChange={(v) => setTel((t) => ({ ...t, allowDoorAccess: v }))} />
            <button className={btnPrimary} disabled={!tel.phone.trim()} onClick={() => void anadirTel()}>
              Añadir
            </button>
          </div>
        )}
      </section>

      <Link to="/self-storage/clientes" className="text-[12px] text-slate-400 underline">
        Volver a clientes
      </Link>

      {editar && (
        <FormCliente
          cliente={c}
          onCerrar={() => setEditar(false)}
          onHecho={() => {
            setEditar(false);
            void cargar();
          }}
        />
      )}
      {bloqueo && (
        <Modal
          title={`Bloquear a ${c.displayName}`}
          onClose={() => setBloqueo(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setBloqueo(false)}>Cancelar</button>
              <button className={btnDanger} disabled={!motivo.trim()} onClick={() => void cambiarEstado("blocked", motivo)}>
                Bloquear
              </button>
            </div>
          }
        >
          <TextAreaField label="Motivo (obligatorio, queda en la auditoría)" value={motivo} onChange={setMotivo} />
          <p className="mt-2 text-[12px] text-slate-400">En la fase 3 un cliente bloqueado no podrá abrir ninguna puerta.</p>
        </Modal>
      )}
    </div>
  );
}
