/**
 * Tipos de trastero: la representación comercial y la imagen 3D compartida.
 * Quince boxes de ~2,5 m² usan el mismo tipo y la misma imagen; cada box
 * conserva sus medidas reales.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import type { TipoTrastero } from "../types";
import { Cabecera, CheckField, EmptyRow, ErrorBox, Modal, SelectField, TableWrap, TextAreaField, TextField, btnMini, btnPrimary, btnSecondary, decimal, medidas, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

function ModalTipo({ tipo, onCerrar, onHecho }: { tipo: TipoTrastero | null; onCerrar: () => void; onHecho: () => void }) {
  const { centros, centroId } = useSelfStorage();
  const [ambito, setAmbito] = useState<string>(tipo ? (tipo.centerId ?? "") : "");
  const [code, setCode] = useState(tipo?.code ?? "");
  const [name, setName] = useState(tipo?.name ?? "");
  const [ancho, setAncho] = useState(String(tipo?.widthCm ?? ""));
  const [largo, setLargo] = useState(String(tipo?.lengthCm ?? ""));
  const [alto, setAlto] = useState(String(tipo?.heightCm ?? ""));
  const [imagen, setImagen] = useState(tipo?.image3dUrl ?? "");
  const [descripcion, setDescripcion] = useState(tipo?.capacityDescription ?? "");
  const [ejemplos, setEjemplos] = useState((tipo?.capacityExamples ?? []).join("\n"));
  const [activo, setActivo] = useState(tipo?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setError(null);
    const datos = {
      name,
      widthCm: Number(ancho),
      lengthCm: Number(largo),
      heightCm: Number(alto),
      image3dUrl: imagen.trim() || null,
      capacityDescription: descripcion,
      capacityExamples: ejemplos.split("\n").map((s) => s.trim()).filter(Boolean),
      active: activo,
    };
    try {
      if (tipo) await api.editarTipo(tipo.id, datos);
      else await api.crearTipo({ ...datos, code, centerId: ambito || null });
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  };

  return (
    <Modal
      title={tipo ? `Tipo ${tipo.name}` : "Nuevo tipo de trastero"}
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
        {!tipo && <TextField label="Código (p. ej. BOX-2.5)" value={code} onChange={(v) => setCode(v.toUpperCase())} />}
        <TextField label="Nombre comercial" value={name} onChange={setName} placeholder="Trastero 2,5 m²" />
        {!tipo && (
          <SelectField label="Ámbito" value={ambito} onChange={setAmbito}>
            <option value="">Todos los centros</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                Sólo {c.name}
                {c.id === centroId ? " (actual)" : ""}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Ancho nominal (cm)" value={ancho} onChange={setAncho} type="number" />
        <TextField label="Largo nominal (cm)" value={largo} onChange={setLargo} type="number" />
        <TextField label="Alto nominal (cm)" value={alto} onChange={setAlto} type="number" />
        <TextField label="Imagen 3D (URL https)" value={imagen} onChange={setImagen} />
        <CheckField label="Activo" checked={activo} onChange={setActivo} />
      </div>
      <div className="mt-3 space-y-3">
        <TextAreaField label="Qué cabe (descripción)" value={descripcion} onChange={setDescripcion} />
        <TextAreaField label="Ejemplos orientativos (uno por línea)" value={ejemplos} onChange={setEjemplos} rows={4} placeholder={"Contenido de un piso de 1 habitación\n20 cajas de mudanza"} />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">m² y m³ nominales se calculan con las medidas.</p>
    </Modal>
  );
}

export default function Tipos() {
  const { puede, centroId, centros } = useSelfStorage();
  const [tipos, setTipos] = useState<TipoTrastero[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<TipoTrastero | null | "nuevo">(null);
  const gestiona = puede("ss.units.manage");

  const cargar = useCallback(async () => {
    try {
      setTipos(await api.tipos(centroId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [centroId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-4">
      <Cabecera titulo="Tipos de trastero" descripcion="Representación comercial e imagen 3D que comparten varios trasteros.">
        {gestiona && (
          <button className={btnPrimary} onClick={() => setEditar("nuevo")}>
            Nuevo tipo
          </button>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Imagen</th>
            <th className={thCls}>Código</th>
            <th className={thCls}>Nombre</th>
            <th className={thCls}>Medidas</th>
            <th className={thCls}>m² / m³</th>
            <th className={thCls}>Ámbito</th>
            <th className={thCls}>Trasteros</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {tipos.length === 0 && <EmptyRow cols={8} text="Sin tipos. Son opcionales: sirven para compartir imagen 3D y descripción de capacidad." />}
          {tipos.map((t) => (
            <tr key={t.id} className={`border-t border-slate-700 ${t.active ? "" : "opacity-50"}`}>
              <td className={tdCls}>{t.image3dUrl ? <img src={t.image3dUrl} alt={t.name} className="h-10 w-14 rounded object-cover" loading="lazy" /> : "—"}</td>
              <td className={tdCls}>{t.code}</td>
              <td className={tdCls}>{t.name}</td>
              <td className={tdCls}>{medidas(t.widthCm, t.lengthCm, t.heightCm)}</td>
              <td className={tdCls}>
                {decimal(t.nominalAreaM2)} m² · {decimal(t.nominalVolumeM3)} m³
              </td>
              <td className={tdCls}>{t.centerId ? (centros.find((c) => c.id === t.centerId)?.name ?? "Otro centro") : "Todos"}</td>
              <td className={tdCls}>{t.trasteros}</td>
              <td className={`${tdCls} text-right`}>
                {gestiona && (
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
        <ModalTipo
          tipo={editar === "nuevo" ? null : editar}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}
