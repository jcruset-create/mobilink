/**
 * Centros y zonas. Multi-centro desde el primer día: empresa → centros →
 * zonas → trasteros (y, en la fase 3, puertas).
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import type { Centro, Zona } from "../types";
import {
  Cabecera,
  CheckField,
  EmptyRow,
  ErrorBox,
  Modal,
  SelectField,
  TableWrap,
  TextField,
  btnMini,
  btnPrimary,
  btnSecondary,
  tdCls,
  thCls,
} from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

type FormCentro = { code: string; name: string; address: string; postalCode: string; city: string; province: string; phone: string; email: string; publicVisible: boolean; status: "active" | "inactive" };
const vacioCentro: FormCentro = { code: "", name: "", address: "", postalCode: "", city: "", province: "", phone: "", email: "", publicVisible: false, status: "active" };

function ModalCentro({ centro, onCerrar, onHecho }: { centro: Centro | null; onCerrar: () => void; onHecho: () => void }) {
  const [f, setF] = useState<FormCentro>(
    centro
      ? {
          code: centro.code,
          name: centro.name,
          address: centro.address ?? "",
          postalCode: centro.postalCode ?? "",
          city: centro.city ?? "",
          province: centro.province ?? "",
          phone: centro.phone ?? "",
          email: centro.email ?? "",
          publicVisible: centro.publicVisible,
          status: centro.status,
        }
      : vacioCentro
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormCentro>(k: K, v: FormCentro[K]) => setF((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    setError(null);
    const datos = {
      name: f.name,
      address: f.address,
      postalCode: f.postalCode,
      city: f.city,
      province: f.province,
      phone: f.phone,
      email: f.email.trim() || null,
      publicVisible: f.publicVisible,
    };
    try {
      if (centro) await api.editarCentro(centro.id, { ...datos, status: f.status });
      else await api.crearCentro({ ...datos, code: f.code });
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  };

  return (
    <Modal
      title={centro ? `Centro ${centro.name}` : "Nuevo centro"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>Cancelar</button>
          <button className={btnPrimary} onClick={guardar}>Guardar</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!centro && <TextField label="Código (p. ej. REUS)" value={f.code} onChange={(v) => set("code", v.toUpperCase())} />}
        <TextField label="Nombre" value={f.name} onChange={(v) => set("name", v)} />
        <TextField label="Dirección" value={f.address} onChange={(v) => set("address", v)} />
        <TextField label="Código postal" value={f.postalCode} onChange={(v) => set("postalCode", v)} />
        <TextField label="Población" value={f.city} onChange={(v) => set("city", v)} />
        <TextField label="Provincia" value={f.province} onChange={(v) => set("province", v)} />
        <TextField label="Teléfono" value={f.phone} onChange={(v) => set("phone", v)} />
        <TextField label="Email" value={f.email} onChange={(v) => set("email", v)} />
        {centro && (
          <SelectField label="Estado" value={f.status} onChange={(v) => set("status", v as FormCentro["status"])}>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </SelectField>
        )}
        <CheckField label="Visible en la web pública (fase 4)" checked={f.publicVisible} onChange={(v) => set("publicVisible", v)} />
      </div>
    </Modal>
  );
}

function ModalZona({ centerId, zona, onCerrar, onHecho }: { centerId: string; zona: Zona | null; onCerrar: () => void; onHecho: () => void }) {
  const [code, setCode] = useState(zona?.code ?? "");
  const [name, setName] = useState(zona?.name ?? "");
  const [floor, setFloor] = useState(zona?.floor ?? "");
  const [sortOrder, setSortOrder] = useState(String(zona?.sortOrder ?? 0));
  const [status, setStatus] = useState(zona?.status ?? "active");
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setError(null);
    const orden = Number(sortOrder) || 0;
    try {
      if (zona) await api.editarZona(zona.id, { name, floor, sortOrder: orden, status });
      else await api.crearZona(centerId, { code, name, floor, sortOrder: orden });
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  };

  return (
    <Modal
      title={zona ? `Zona ${zona.name}` : "Nueva zona"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>Cancelar</button>
          <button className={btnPrimary} onClick={guardar}>Guardar</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!zona && <TextField label="Código (p. ej. Z2)" value={code} onChange={(v) => setCode(v.toUpperCase())} />}
        <TextField label="Nombre" value={name} onChange={setName} placeholder="Zona 2" />
        <TextField label="Planta" value={floor} onChange={setFloor} />
        <TextField label="Orden" value={sortOrder} onChange={setSortOrder} type="number" />
        {zona && (
          <SelectField label="Estado" value={status} onChange={(v) => setStatus(v as Zona["status"])}>
            <option value="active">Activa</option>
            <option value="inactive">Inactiva</option>
          </SelectField>
        )}
      </div>
    </Modal>
  );
}

export default function Centros() {
  const { puede, centroId, fijarCentro, refrescar } = useSelfStorage();
  const [centros, setCentros] = useState<Centro[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editCentro, setEditCentro] = useState<Centro | null | "nuevo">(null);
  const [editZona, setEditZona] = useState<Zona | null | "nueva">(null);
  const gestiona = puede("ss.centers.manage");

  const cargar = useCallback(async () => {
    try {
      setCentros(await api.centros());
      if (centroId) setZonas(await api.zonas(centroId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const tras = async () => {
    setEditCentro(null);
    setEditZona(null);
    await refrescar();
    await cargar();
  };

  return (
    <div className="space-y-4">
      <Cabecera titulo="Centros y zonas" descripcion="Empresa → centros → zonas → trasteros">
        {gestiona && (
          <button className={btnPrimary} onClick={() => setEditCentro("nuevo")}>
            Nuevo centro
          </button>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Código</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Población</th>
            <th className={thCls}>Zonas</th>
            <th className={thCls}>Trasteros</th>
            <th className={thCls}>Estado</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {centros.length === 0 && <EmptyRow cols={7} text="Sin centros todavía." />}
          {centros.map((c) => (
            <tr key={c.id} className={`border-t border-slate-700 ${c.id === centroId ? "bg-orange-500/10" : ""}`}>
              <td className={tdCls}>{c.code}</td>
              <td className={tdCls}>{c.name}</td>
              <td className={tdCls}>{c.city ?? "—"}</td>
              <td className={tdCls}>{c.zonas}</td>
              <td className={tdCls}>{c.trasteros}</td>
              <td className={tdCls}>{c.status === "active" ? "Activo" : "Inactivo"}</td>
              <td className={`${tdCls} space-x-1 text-right`}>
                {c.id !== centroId && (
                  <button className={btnMini} onClick={() => fijarCentro(c.id)}>
                    Trabajar con este
                  </button>
                )}
                {gestiona && (
                  <button className={btnMini} onClick={() => setEditCentro(c)}>
                    Editar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {centroId && (
        <>
          <Cabecera titulo={`Zonas de ${centros.find((c) => c.id === centroId)?.name ?? ""}`}>
            {gestiona && (
              <button className={btnPrimary} onClick={() => setEditZona("nueva")}>
                Nueva zona
              </button>
            )}
          </Cabecera>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Código</th>
                <th className={thCls}>Zona</th>
                <th className={thCls}>Planta</th>
                <th className={thCls}>Trasteros</th>
                <th className={thCls}>Estado</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {zonas.length === 0 && <EmptyRow cols={6} text="Este centro no tiene zonas. Cada trastero pertenece a una zona." />}
              {zonas.map((z) => (
                <tr key={z.id} className="border-t border-slate-700">
                  <td className={tdCls}>{z.code}</td>
                  <td className={tdCls}>{z.name}</td>
                  <td className={tdCls}>{z.floor ?? "—"}</td>
                  <td className={tdCls}>{z.trasteros}</td>
                  <td className={tdCls}>{z.status === "active" ? "Activa" : "Inactiva"}</td>
                  <td className={`${tdCls} text-right`}>
                    {gestiona && (
                      <button className={btnMini} onClick={() => setEditZona(z)}>
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {editCentro && <ModalCentro centro={editCentro === "nuevo" ? null : editCentro} onCerrar={() => setEditCentro(null)} onHecho={tras} />}
      {editZona && centroId && <ModalZona centerId={centroId} zona={editZona === "nueva" ? null : editZona} onCerrar={() => setEditZona(null)} onHecho={tras} />}
    </div>
  );
}
