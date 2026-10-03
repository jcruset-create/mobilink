/**
 * Trasteros del centro: lista con filtros, alta, edición y cambio de estado.
 *
 * El precio se introduce como base o como PVP, y opcionalmente la cuota de IVA
 * en euros; el tipo de IVA es el general de la empresa: el servidor
 * calcula lo que falte y comprueba que cuadre. Ningún precio vive en el panel.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import type { TipoTrastero, Trastero, UnitStatus, Zona } from "../types";
import {
  Aviso,
  Cabecera,
  CheckField,
  ChipUnidad,
  EmptyRow,
  ErrorBox,
  Modal,
  SelectField,
  TableWrap,
  TextAreaField,
  TextField,
  btnMini,
  btnPrimary,
  btnSecondary,
  decimal,
  euros,
  inputCls,
  medidas,
  tdCls,
  thCls,
} from "../components/ui";
import CambioEstado from "../components/CambioEstado";
import { useSelfStorage } from "../contexts/SelfStorageContext";

const n = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));

function ModalTrastero({
  centerId,
  trastero,
  zonas,
  tipos,
  onCerrar,
  onHecho,
}: {
  centerId: string;
  trastero: Trastero | null;
  zonas: Zona[];
  tipos: TipoTrastero[];
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const t = trastero;
  const [f, setF] = useState({
    zoneId: t?.zone.id ?? zonas[0]?.id ?? "",
    unitTypeId: t?.unitType?.id ?? "",
    code: t?.code ?? "",
    name: t?.name ?? "",
    widthCm: String(t?.widthCm ?? ""),
    lengthCm: String(t?.lengthCm ?? ""),
    heightCm: String(t?.heightCm ?? ""),
    areaM2: t ? String(t.areaM2) : "",
    volumeM3: t ? String(t.volumeM3) : "",
    modoPrecio: "pvp" as "pvp" | "base",
    precio: t ? String(t.monthlyPriceGross) : "",
    // Cuota de IVA en EUROS (no porcentaje). Vacía = la calcula el servidor con el IVA general.
    vatAmount: t ? String(t.vatAmount) : "",
    depositAmount: String(t?.depositAmount ?? 0),
    image3dUrl: t?.image3dUrl ?? "",
    publicVisible: t?.publicVisible ?? true,
    notes: t?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    setError(null);
    const precio = n(f.precio);
    const datos: Record<string, unknown> = {
      zoneId: f.zoneId,
      unitTypeId: f.unitTypeId || null,
      code: f.code,
      name: f.name,
      widthCm: n(f.widthCm),
      lengthCm: n(f.lengthCm),
      heightCm: n(f.heightCm),
      areaM2: n(f.areaM2),
      volumeM3: n(f.volumeM3),
      vatAmount: n(f.vatAmount),
      depositAmount: n(f.depositAmount) ?? 0,
      image3dUrl: f.image3dUrl.trim() || null,
      publicVisible: f.publicVisible,
      notes: f.notes,
    };
    if (precio !== undefined) datos[f.modoPrecio === "pvp" ? "monthlyPriceGross" : "monthlyPrice"] = precio;
    // En una edición, sólo se mandan las medidas derivadas si se han tocado.
    if (t && f.areaM2 === String(t.areaM2)) delete datos.areaM2;
    if (t && f.volumeM3 === String(t.volumeM3)) delete datos.volumeM3;
    if (t && f.vatAmount === String(t.vatAmount) && precio === (f.modoPrecio === "pvp" ? t.monthlyPriceGross : t.monthlyPrice)) {
      delete datos.vatAmount;
      delete datos.monthlyPriceGross;
      delete datos.monthlyPrice;
    }
    try {
      if (t) await api.editarTrastero(t.id, datos);
      else await api.crearTrastero({ ...datos, centerId });
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  };

  return (
    <Modal
      wide
      title={t ? `Trastero ${t.code}` : "Nuevo trastero"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>Cancelar</button>
          <button className={btnPrimary} onClick={guardar}>Guardar</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Número de trastero" value={f.code} onChange={(v) => set("code", v.toUpperCase())} />
        <SelectField label="Zona" value={f.zoneId} onChange={(v) => set("zoneId", v)}>
          {zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Tipo (opcional)" value={f.unitTypeId} onChange={(v) => set("unitTypeId", v)}>
          <option value="">—</option>
          {tipos.map((ti) => (
            <option key={ti.id} value={ti.id}>
              {ti.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Ancho (cm)" value={f.widthCm} onChange={(v) => set("widthCm", v)} type="number" />
        <TextField label="Largo (cm)" value={f.lengthCm} onChange={(v) => set("lengthCm", v)} type="number" />
        <TextField label="Alto (cm)" value={f.heightCm} onChange={(v) => set("heightCm", v)} type="number" />
        <TextField label="m² (vacío = calcular)" value={f.areaM2} onChange={(v) => set("areaM2", v)} />
        <TextField label="m³ (vacío = calcular)" value={f.volumeM3} onChange={(v) => set("volumeM3", v)} />
        <TextField label="Nombre (opcional)" value={f.name} onChange={(v) => set("name", v)} />
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Precio mensual</span>
          <div className="flex gap-1">
            <select className={`${inputCls} w-24`} value={f.modoPrecio} onChange={(e) => set("modoPrecio", e.target.value)}>
              <option value="pvp">PVP</option>
              <option value="base">Base</option>
            </select>
            <input className={inputCls} value={f.precio} onChange={(e) => set("precio", e.target.value)} inputMode="decimal" />
          </div>
        </label>
        <TextField label="Cuota de IVA en € (vacío = con el IVA general)" value={f.vatAmount} onChange={(v) => set("vatAmount", v)} />
        <TextField label="Fianza (€)" value={f.depositAmount} onChange={(v) => set("depositAmount", v)} />
        <TextField label="Imagen 3D propia (URL https, opcional)" value={f.image3dUrl} onChange={(v) => set("image3dUrl", v)} />
        <CheckField label="Visible en la web pública" checked={f.publicVisible} onChange={(v) => set("publicVisible", v)} />
      </div>
      <div className="mt-3">
        <TextAreaField label="Notas internas (nunca públicas)" value={f.notes} onChange={(v) => set("notes", v)} />
      </div>
      {t && (
        <p className="mt-2 text-[11px] text-slate-400">
          Ahora: base {euros(t.monthlyPrice)} + cuota de IVA {euros(t.vatAmount)} = PVP {euros(t.monthlyPriceGross)} (IVA general al fijarlo:{" "}
          {decimal(t.taxRate)} %). El precio de un contrato ya firmado no cambia al cambiar el del trastero.
        </p>
      )}
    </Modal>
  );
}

export default function Trasteros() {
  const { centroId, puede, etqUnidad } = useSelfStorage();
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<Trastero[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [tipos, setTipos] = useState<TipoTrastero[]>([]);
  const [filtro, setFiltro] = useState<{ zoneId: string; status: string; q: string }>({ zoneId: "", status: "", q: "" });
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Trastero | null | "nuevo">(null);
  const [estado, setEstado] = useState<Trastero | null>(null);
  const verClientes = puede("ss.customers.view");

  const cargar = useCallback(async () => {
    if (!centroId) return;
    try {
      const [l, z, t] = await Promise.all([
        api.trasteros({ centerId: centroId, zoneId: filtro.zoneId || undefined, status: filtro.status || undefined, q: filtro.q || undefined }),
        api.zonas(centroId),
        api.tipos(centroId),
      ]);
      setLista(l);
      setZonas(z);
      setTipos(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [centroId, filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ?editar=<id> abre la ficha (lo usa el plano).
  useEffect(() => {
    const id = params.get("editar");
    if (!id) return;
    api
      .trastero(id)
      .then((t) => setEditar(t))
      .catch(() => {})
      .finally(() => {
        params.delete("editar");
        setParams(params, { replace: true });
      });
  }, [params, setParams]);

  if (!centroId) return <Aviso tono="info">Elige o crea un centro para ver sus trasteros.</Aviso>;

  return (
    <div className="space-y-4">
      <Cabecera titulo="Trasteros" descripcion={`${lista.length} trastero(s)`}>
        {puede("ss.units.manage") && (
          <button className={btnPrimary} disabled={!zonas.length} onClick={() => setEditar("nuevo")} title={zonas.length ? undefined : "Crea antes una zona"}>
            Nuevo trastero
          </button>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input className={inputCls} placeholder="Buscar por número…" value={filtro.q} onChange={(e) => setFiltro((x) => ({ ...x, q: e.target.value }))} />
        <select className={inputCls} value={filtro.zoneId} onChange={(e) => setFiltro((x) => ({ ...x, zoneId: e.target.value }))}>
          <option value="">Todas las zonas</option>
          {zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={filtro.status} onChange={(e) => setFiltro((x) => ({ ...x, status: e.target.value }))}>
          <option value="">Todos los estados</option>
          {(["available", "occupied", "reserved", "maintenance", "blocked"] as UnitStatus[]).map((s) => (
            <option key={s} value={s}>
              {etqUnidad(s)}
            </option>
          ))}
        </select>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Nº</th>
            <th className={thCls}>Zona</th>
            <th className={`${thCls} hidden md:table-cell`}>Tipo</th>
            <th className={`${thCls} hidden sm:table-cell`}>Medidas</th>
            <th className={thCls}>m²</th>
            <th className={`${thCls} hidden lg:table-cell`}>m³</th>
            <th className={thCls}>PVP/mes</th>
            <th className={thCls}>Estado</th>
            {verClientes && <th className={`${thCls} hidden md:table-cell`}>Cliente</th>}
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && <EmptyRow cols={10} text="No hay trasteros con estos filtros." />}
          {lista.map((t) => (
            <tr key={t.id} className="border-t border-slate-700">
              <td className={`${tdCls} font-bold`}>{t.code}</td>
              <td className={tdCls}>{t.zone.name}</td>
              <td className={`${tdCls} hidden md:table-cell`}>{t.unitType?.name ?? "—"}</td>
              <td className={`${tdCls} hidden sm:table-cell`}>{medidas(t.widthCm, t.lengthCm, t.heightCm)}</td>
              <td className={tdCls}>{decimal(t.areaM2)}</td>
              <td className={`${tdCls} hidden lg:table-cell`}>{decimal(t.volumeM3)}</td>
              <td className={tdCls}>{euros(t.monthlyPriceGross)}</td>
              <td className={tdCls}>
                <ChipUnidad estado={t.status} />
              </td>
              {verClientes && <td className={`${tdCls} hidden md:table-cell`}>{t.customer?.name ?? "—"}</td>}
              <td className={`${tdCls} space-x-1 whitespace-nowrap text-right`}>
                {puede("ss.units.status") && (
                  <button className={btnMini} onClick={() => setEstado(t)}>
                    Estado
                  </button>
                )}
                {puede("ss.units.manage") && (
                  <button className={btnMini} onClick={() => setEditar(t)}>
                    Editar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editar && (
        <ModalTrastero
          centerId={centroId}
          trastero={editar === "nuevo" ? null : editar}
          zonas={zonas}
          tipos={tipos}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            void cargar();
          }}
        />
      )}
      {estado && (
        <CambioEstado
          trastero={estado}
          onCerrar={() => setEstado(null)}
          onHecho={() => {
            setEstado(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}
