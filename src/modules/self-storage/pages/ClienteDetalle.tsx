/**
 * Ficha del cliente: datos, teléfonos (incluidos los autorizados para abrir por
 * llamada en la fase 3), contratos (1 cliente → N contratos, también en centros
 * distintos), bloqueo/desbloqueo con motivo y —fase 2— deuda, facturas, pagos,
 * método de pago guardado en Stripe e invitación al portal.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import type { CobrosCliente, FichaCliente, MetodoPago } from "../types";
import { TablaFacturas, FichaFactura } from "./Facturas";
import { TablaPagos } from "./Pagos";
import FormCliente from "../components/FormCliente";
import {
  Aviso,
  Cabecera,
  Cargando,
  CheckField,
  ChipCliente,
  ChipContrato,
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
  fecha,
  msgError,
  tdCls,
  thCls,
} from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function ClienteDetalle() {
  const { id = "" } = useParams();
  const { puede, etqTipoCliente } = useSelfStorage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cobros, setCobros] = useState<CobrosCliente | null>(null);
  const [metodos, setMetodos] = useState<MetodoPago[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const verCobros = puede("ss.billing.view");
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
    if (verCobros) {
      api.cobrosCliente(id).then(setCobros, (e) => setError(msgError(e)));
      // Stripe puede no estar configurado: sin métodos no es un error de la ficha.
      api.metodosCliente(id).then(setMetodos, () => setMetodos(null));
    }
  }, [id, verCobros]);

  const invitar = async () => {
    try {
      const r = await api.invitarAlPortal(id);
      setAviso(`Invitación al portal enviada a ${r.email}.`);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };
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
      {aviso && <Aviso tono="bien">{aviso}</Aviso>}
      {c.status === "blocked" && <Aviso tono="mal">Bloqueado: {c.statusReason}</Aviso>}

      <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato etiqueta="Teléfono">{c.phone}</Dato>
        <Dato etiqueta="Email">{c.email}</Dato>
        <Dato etiqueta="Dirección">{[c.address, c.postalCode, c.city, c.province, c.country].filter(Boolean).join(", ") || "—"}</Dato>
        <Dato etiqueta="Portal del cliente">
          {c.hasPortalAccount ? "Con cuenta" : "Sin cuenta"}
          {gestiona && (
            <button className={`${btnMini} ml-2`} onClick={() => void invitar()}>
              {c.hasPortalAccount ? "Reenviar invitación" : "Invitar"}
            </button>
          )}
        </Dato>
        {c.notes && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Dato etiqueta="Notas internas">{c.notes}</Dato>
          </div>
        )}
      </div>

      {verCobros && cobros && (
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-800 p-4">
          <Dato etiqueta="Deuda pendiente">
            <span className={cobros.debt.pendiente > 0 ? "font-bold text-amber-300" : ""}>{euros(cobros.debt.pendiente)}</span>
          </Dato>
          <Dato etiqueta="De ella, vencida">
            <span className={cobros.debt.vencida > 0 ? "font-bold text-rose-300" : ""}>{euros(cobros.debt.vencida)}</span>
          </Dato>
          <Dato etiqueta="Facturas pendientes">{cobros.debt.facturas}</Dato>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Contratos</h2>
          {puede("ss.contracts.manage") && c.status !== "blocked" && (
            <Link to={`/self-storage/contratos?nuevo=1&customerId=${c.id}`} className={btnMini}>
              Nuevo contrato
            </Link>
          )}
        </div>
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
            {c.contracts.length === 0 && <EmptyRow cols={7} text="Sin contratos." />}
            {c.contracts.map((k) => (
              <tr key={k.id} className="cursor-pointer border-t border-slate-700 hover:bg-slate-800/60" onClick={() => navigate(`/self-storage/contratos/${k.id}`)}>
                <td className={`${tdCls} font-bold text-sky-300`}>{k.contractNumber}</td>
                <td className={tdCls}>{k.centerName}</td>
                <td className={tdCls}>{k.unitCode}</td>
                <td className={tdCls}>{fecha(k.startDate)}</td>
                <td className={tdCls}>{euros(k.monthlyPrice)}</td>
                <td className={tdCls}>{k.members}</td>
                <td className={tdCls}>
                  <ChipContrato estado={k.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      {verCobros && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-bold">Facturas</h2>
            <TablaFacturas items={cobros?.invoices ?? null} sinCliente onAbrir={(fid) => setParams({ f: fid })} />
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-bold">Pagos</h2>
            <TablaPagos items={cobros?.payments ?? null} sinCliente onFactura={(fid) => setParams({ f: fid })} />
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-bold">Método de pago (Stripe)</h2>
            {metodos === null && <p className="text-[12px] text-slate-500">Sin datos de Stripe.</p>}
            {metodos?.length === 0 && <p className="text-[12px] text-slate-500">Sin métodos guardados. El cliente puede añadirlo desde el portal.</p>}
            {metodos && metodos.length > 0 && (
              <ul className="space-y-1 text-sm">
                {metodos.map((m) => (
                  <li key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">
                    {m.type === "sepa_debit" ? "SEPA" : (m.brand ?? m.type)} ···· {m.last4 ?? "—"}
                    {m.expMonth ? ` · caduca ${String(m.expMonth).padStart(2, "0")}/${m.expYear}` : ""}
                    {m.isDefault && <span className="ml-2 text-[11px] text-emerald-300">predeterminado</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {params.get("f") && <FichaFactura id={params.get("f")!} onCerrar={() => setParams({})} onCambio={() => void cargar()} />}

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
