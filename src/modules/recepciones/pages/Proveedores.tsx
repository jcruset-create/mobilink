/**
 * Proveedores de mercancía y el mapeo de sus artículos a los de Mobilink.
 *
 * El mapeo no es obligatorio para recepcionar: sólo hace que la pantalla del
 * muelle enseñe «HANKOOK AH35 245/70 R17.5 136M» en vez de la descripción del
 * proveedor. Se confirma aquí o desde el propio pedido.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { EmptyRow, ErrorBox, Modal, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import type { MapeoArticulo, Proveedor } from "../types";

export default function Proveedores() {
  const { puede, refrescar } = useRecepciones();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [mapeos, setMapeos] = useState<MapeoArticulo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [mapeando, setMapeando] = useState<Proveedor | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.listarProveedores(), api.listarMapeos()]);
      setProveedores(p.proveedores);
      setMapeos(m.mapeos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los proveedores");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function alternar(p: Proveedor) {
    try {
      await api.actualizarProveedor(p.id, { activo: !p.activo });
      await Promise.all([cargar(), refrescar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido actualizar");
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-100">Proveedores</h1>
          <p className="text-[12px] text-slate-400">Quién nos manda mercancía y cómo se llaman sus artículos en Mobilink.</p>
        </div>
        {puede("recepciones.proveedores.manage") && (
          <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" /> Nuevo proveedor
          </button>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Código</th>
            <th className={thCls}>Nombre</th>
            <th className={thCls}>NIF</th>
            <th className={thCls}>Remitentes de correo</th>
            <th className={`${thCls} text-right`}>Artículos mapeados</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {proveedores.length === 0 && <EmptyRow cols={6} text="Sin proveedores. Da de alta el primero: NEUMÁTICOS SOLEDAD." />}
          {proveedores.map((p) => (
            <tr key={p.id} className={`border-t border-slate-700/60 ${p.activo ? "" : "opacity-50"}`}>
              <td className={`${tdCls} font-bold`}>{p.codigo}</td>
              <td className={tdCls}>{p.nombre}</td>
              <td className={tdCls}>{p.nif ?? "—"}</td>
              <td className={`${tdCls} text-[12px] text-slate-400`}>{p.remitentesCorreo.join(", ") || "—"}</td>
              <td className={`${tdCls} text-right`}>{mapeos.filter((m) => m.proveedorId === p.id).length}</td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                {puede("recepciones.recibir") && (
                  <button className={btnMini} onClick={() => setMapeando(p)}>
                    Mapeo de artículos
                  </button>
                )}
                {puede("recepciones.proveedores.manage") && (
                  <button className={`${btnMini} ml-1`} onClick={() => void alternar(p)}>
                    {p.activo ? "Dar de baja" : "Reactivar"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {creando && (
        <NuevoProveedor
          onClose={() => setCreando(false)}
          onCreado={async () => {
            setCreando(false);
            await Promise.all([cargar(), refrescar()]);
          }}
        />
      )}
      {mapeando && <Mapeo proveedor={mapeando} mapeos={mapeos.filter((m) => m.proveedorId === mapeando.id)} onClose={() => setMapeando(null)} onCambio={cargar} />}
    </div>
  );
}

function NuevoProveedor({ onClose, onCreado }: { onClose: () => void; onCreado: () => Promise<void> }) {
  const [codigo, setCodigo] = useState("SOLEDAD");
  const [nombre, setNombre] = useState("NEUMÁTICOS SOLEDAD");
  const [nif, setNif] = useState("");
  const [remitentes, setRemitentes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api.crearProveedor({
        codigo,
        nombre,
        nif: nif || undefined,
        remitentesCorreo: remitentes.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
      });
      await onCreado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el proveedor");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Nuevo proveedor"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void guardar()} disabled={guardando || !codigo.trim() || !nombre.trim()}>
            Crear
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Código" value={codigo} onChange={setCodigo} placeholder="SOLEDAD" />
        <TextField label="Nombre" value={nombre} onChange={setNombre} placeholder="NEUMÁTICOS SOLEDAD" />
        <TextField label="NIF" value={nif} onChange={setNif} />
        <TextField label="Remitentes de correo (para la fase siguiente)" value={remitentes} onChange={setRemitentes} placeholder="pedidos@soledad.es, albaranes@soledad.es" />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">El código va en el nombre de los ficheros: SOLEDAD_2028450461_ORIGINAL.pdf.</p>
    </Modal>
  );
}

function Mapeo({ proveedor, mapeos, onClose, onCambio }: { proveedor: Proveedor; mapeos: MapeoArticulo[]; onClose: () => void; onCambio: () => Promise<void> }) {
  const [descripcion, setDescripcion] = useState("");
  const [productoTexto, setProductoTexto] = useState("");
  const [ean, setEan] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    try {
      await api.confirmarMapeo({ proveedorId: proveedor.id, descripcionProveedor: descripcion, productoTexto: productoTexto || undefined, ean: ean || undefined });
      setDescripcion("");
      setProductoTexto("");
      setEan("");
      await onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar el mapeo");
    }
  }

  return (
    <Modal title={`Artículos de ${proveedor.nombre}`} onClose={onClose} wide>
      {error && <ErrorBox>{error}</ErrorBox>}
      <p className="mb-3 text-sm text-slate-300">
        Cómo se escribe cada artículo en Mobilink. Si se deja «Artículo Mobilink» vacío, se usa la lectura automática de la descripción (marca, modelo, medida e índice). El EAN queda guardado para el escaneo de más adelante.
      </p>
      <div className="mb-3 grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto]">
        <input className={inputCls} placeholder="Descripción del proveedor (245/70X17.5 HANKOOK AH35 136M)" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        <input className={inputCls} placeholder="Artículo Mobilink (opcional)" value={productoTexto} onChange={(e) => setProductoTexto(e.target.value)} />
        <input className={inputCls} placeholder="EAN" value={ean} onChange={(e) => setEan(e.target.value)} />
        <button className={btnPrimary} onClick={() => void confirmar()} disabled={!descripcion.trim()}>
          Confirmar
        </button>
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Descripción del proveedor</th>
            <th className={thCls}>Artículo Mobilink</th>
            <th className={thCls}>EAN</th>
            <th className={`${thCls} text-right`}>Usos</th>
          </tr>
        </thead>
        <tbody>
          {mapeos.length === 0 && <EmptyRow cols={4} text="Sin mapeos todavía." />}
          {mapeos.map((m) => (
            <tr key={m.id} className="border-t border-slate-700/60">
              <td className={tdCls}>{m.descripcionProveedor}</td>
              <td className={`${tdCls} font-semibold`}>{m.productoTexto ?? "—"}</td>
              <td className={tdCls}>{m.ean ?? "—"}</td>
              <td className={`${tdCls} text-right`}>{m.vecesUsado}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Modal>
  );
}
