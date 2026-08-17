/**
 * Configuración de Mobilink Cash: cajas físicas y catálogo de denominaciones.
 *
 * Es la pantalla que hay que visitar antes de poder usar el módulo, porque una
 * instalación nueva no trae ninguna caja: sin caja no hay jornada que abrir.
 *
 * Dos bloques con alcance MUY distinto, y por eso van separados y con permisos
 * distintos:
 *
 *  · Las cajas y las formas de cobro son de la empresa. Las gestiona un
 *    responsable.
 *  · El catálogo de denominaciones es de toda la instalación (la tabla no tiene
 *    empresa), así que solo lo toca un administrador y se avisa de ello en
 *    pantalla. Desactivar la moneda de 1 c aquí se la desactiva a todo el mundo.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Power, Pencil, Check, X, ImagePlus } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Aviso,
  Cabecera,
  EmptyRow,
  ErrorBox,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
  btnPrimary,
  btnMini,
} from "../components/ui";
import { euros } from "../utils/money";
import type { Denominacion, FormaPagoConfig } from "../types";
import * as api from "../services/api";

type CajaConfig = {
  id: number;
  centro: string;
  nombre: string;
  activa: boolean;
  jornadas: string;
  jornada_abierta: number | null;
};

export default function Configuracion() {
  const { puede } = useCash();

  return (
    <div className="space-y-4">
      <Cabecera
        titulo="Configuración"
        descripcion="Cajas físicas, formas de cobro y catálogo de denominaciones y cartuchos."
      />
      <Cajas />
      <FormasPago />
      {puede("cash.denominations.configure") ? <Denominaciones /> : <DenominacionesSoloLectura />}
    </div>
  );
}

// ── Cajas ──────────────────────────────────────────────────────────────────

function Cajas() {
  const { recargarConfiguracion } = useCash();
  const [cajas, setCajas] = useState<CajaConfig[]>([]);
  const [nombre, setNombre] = useState("");
  const [centro, setCentro] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState({ nombre: "", centro: "" });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await api.listarCajas();
      setCajas(r.cajas as CajaConfig[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las cajas");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
      // El selector de la barra superior y las denominaciones vienen del
      // arranque, así que hay que releerlo para que el cambio se vea ya.
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  const sinCajas = cajas.length === 0;

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Cajas físicas</h2>

      {error && <ErrorBox>{error}</ErrorBox>}

      {sinCajas && (
        <Aviso tono="aviso">
          No hay ninguna caja dada de alta, y sin caja no se puede abrir jornada. Crea aquí la
          primera: normalmente una por mostrador o por centro.
        </Aviso>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Nombre</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nombre.trim()) {
                void accion(async () => {
                  await api.crearCaja(nombre.trim(), centro.trim());
                  setNombre("");
                  setCentro("");
                });
              }
            }}
            placeholder="Mostrador principal"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Centro</span>
          <input
            value={centro}
            onChange={(e) => setCentro(e.target.value)}
            placeholder="tarragona"
            className={inputCls}
          />
        </label>
        <button
          onClick={() =>
            void accion(async () => {
              await api.crearCaja(nombre.trim(), centro.trim());
              setNombre("");
              setCentro("");
            })
          }
          disabled={ocupado || !nombre.trim()}
          className={btnPrimary}
        >
          <Plus className="mr-1 inline h-4 w-4" /> Crear caja
        </button>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Nombre</th>
            <th className={thCls}>Centro</th>
            <th className={`${thCls} text-right`}>Jornadas</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {sinCajas && <EmptyRow cols={5} text="Todavía no hay ninguna caja." />}
          {cajas.map((c) => {
            const enEdicion = editando === c.id;
            return (
              <tr key={c.id} className={`border-t border-slate-700 ${c.activa ? "" : "opacity-50"}`}>
                <td className={tdCls}>
                  {enEdicion ? (
                    <input
                      value={borrador.nombre}
                      onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
                      className={inputCls}
                    />
                  ) : (
                    <span className="font-medium text-slate-100">{c.nombre}</span>
                  )}
                </td>
                <td className={tdCls}>
                  {enEdicion ? (
                    <input
                      value={borrador.centro}
                      onChange={(e) => setBorrador({ ...borrador, centro: e.target.value })}
                      className={inputCls}
                    />
                  ) : (
                    c.centro || <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{c.jornadas}</td>
                <td className={tdCls}>
                  {c.jornada_abierta ? (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      Jornada abierta
                    </span>
                  ) : c.activa ? (
                    <span className="text-[11px] text-slate-400">Activa</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">De baja</span>
                  )}
                </td>
                <td className={tdCls}>
                  <div className="flex justify-end gap-1">
                    {enEdicion ? (
                      <>
                        <button
                          onClick={() =>
                            void accion(async () => {
                              await api.actualizarCaja(c.id, borrador);
                              setEditando(null);
                            })
                          }
                          disabled={ocupado}
                          className={btnMini}
                          title="Guardar"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditando(null)} className={btnMini} title="Cancelar">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditando(c.id);
                            setBorrador({ nombre: c.nombre, centro: c.centro });
                          }}
                          disabled={ocupado || Boolean(c.jornada_abierta)}
                          className={btnMini}
                          title={
                            c.jornada_abierta
                              ? "No se puede modificar con la jornada abierta"
                              : "Renombrar"
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void accion(() => api.actualizarCaja(c.id, { activa: !c.activa }))}
                          disabled={ocupado || Boolean(c.jornada_abierta)}
                          className={btnMini}
                          title={
                            c.jornada_abierta
                              ? "Cierra la jornada antes de dar de baja la caja"
                              : c.activa
                                ? "Dar de baja"
                                : "Reactivar"
                          }
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      <p className="text-[11px] text-slate-500">
        Dar de baja una caja no borra nada: sus jornadas y movimientos siguen en el histórico, solo
        deja de aparecer para abrir jornadas nuevas. Una caja con la jornada abierta no se puede
        modificar ni dar de baja.
      </p>
    </section>
  );
}

// ── Formas de cobro ────────────────────────────────────────────────────────

/**
 * Catálogo de formas de cobro de la empresa.
 *
 * Cada fila se convierte en un botón de la pantalla de cobros. La imagen es
 * opcional a propósito: sin ella el botón sale con el nombre, que es peor de
 * localizar de un vistazo pero funciona igual. Lo que no se puede es quedarse
 * sin ninguna forma activa, ni dar de baja el efectivo.
 */
function FormasPago() {
  const { recargarConfiguracion, puede } = useCash();
  const [formas, setFormas] = useState<FormaPagoConfig[]>([]);
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState({ nombre: "", orden: 0 });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const editable = puede("cash.configure");

  const cargar = useCallback(async () => {
    try {
      const r = await api.listarFormasPago();
      setFormas(r.formasPago);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las formas de cobro");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
      // Los botones de cobro salen del arranque: sin releerlo, el cambio no se
      // vería hasta recargar la página.
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  /** El servidor corta en 8 MB; avisar aquí ahorra subir la foto para nada. */
  const MAXIMO_IMAGEN = 8 * 1024 * 1024;

  async function subirImagen(id: number, fichero: File | undefined) {
    if (!fichero) return;
    if (fichero.size > MAXIMO_IMAGEN) {
      setError(
        `La imagen pesa ${(fichero.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB. ` +
          "Hazle una captura o redúcela antes de subirla."
      );
      return;
    }
    await accion(() => api.subirImagenFormaPago(id, fichero));
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Formas de cobro
      </h2>

      {error && <ErrorBox>{error}</ErrorBox>}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Nueva forma de cobro
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nombre.trim()) {
                  void accion(async () => {
                    await api.crearFormaPago({ nombre: nombre.trim() });
                    setNombre("");
                  });
                }
              }}
              placeholder="Vale regalo"
              className={inputCls}
            />
          </label>
          <button
            onClick={() =>
              void accion(async () => {
                await api.crearFormaPago({ nombre: nombre.trim() });
                setNombre("");
              })
            }
            disabled={ocupado || !nombre.trim()}
            className={btnPrimary}
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Botón</th>
            <th className={thCls}>Nombre</th>
            <th className={`${thCls} text-right`}>Orden</th>
            <th className={thCls}>Dónde sale</th>
            <th className={thCls}>Referencia</th>
            <th className={`${thCls} text-right`}>Usos</th>
            <th className={thCls}>Estado</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {formas.length === 0 && <EmptyRow cols={8} text="No hay formas de cobro." />}
          {formas.map((f) => {
            const enEdicion = editando === f.id;
            return (
              <tr key={f.id} className={f.activa ? "" : "opacity-60"}>
                <td className={tdCls}>
                  <div className="flex items-center gap-2">
                    {f.imagenUrl ? (
                      // `object-cover` y la misma proporción que el botón: la
                      // vista previa tiene que enseñar lo que se va a ver al
                      // cobrar, recorte incluido.
                      <img
                        src={f.imagenUrl}
                        alt=""
                        className="h-8 w-12 rounded border border-slate-700 bg-slate-900 object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-12 items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-500">
                        texto
                      </span>
                    )}
                    {editable && (
                      <>
                        <label
                          className={`${btnMini} cursor-pointer`}
                          title="Subir la imagen del botón"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={ocupado}
                            onChange={(e) => {
                              void subirImagen(f.id, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {f.imagenUrl && (
                          <button
                            onClick={() => void accion(() => api.actualizarFormaPago(f.id, { imagenUrl: null }))}
                            disabled={ocupado}
                            className={btnMini}
                            title="Quitar la imagen y dejar el nombre"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
                <td className={tdCls}>
                  {enEdicion ? (
                    <input
                      value={borrador.nombre}
                      onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
                      className={inputCls}
                    />
                  ) : (
                    <div>
                      <span className="font-medium text-slate-100">{f.nombre}</span>
                      <div className="text-[10px] text-slate-500">{f.codigo}</div>
                    </div>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {enEdicion ? (
                    <input
                      type="number"
                      value={borrador.orden}
                      onChange={(e) => setBorrador({ ...borrador, orden: Number(e.target.value) })}
                      className={`${inputCls} w-20 text-right`}
                    />
                  ) : (
                    <span className="text-slate-400">{f.orden}</span>
                  )}
                </td>
                <td className={tdCls}>
                  {/* Dos casillas en vez de dos columnas: en el móvil del
                      mostrador la tabla ya va justa de ancho. */}
                  <div className="flex flex-col gap-0.5">
                    {(
                      [
                        ["enCobros", "Cobros"],
                        ["enPagos", "Pagos"],
                      ] as const
                    ).map(([campo, etiqueta]) => (
                      <label key={campo} className="flex items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={f[campo]}
                          disabled={!editable || ocupado || f.afectaEfectivo}
                          onChange={() =>
                            void accion(() => api.actualizarFormaPago(f.id, { [campo]: !f[campo] }))
                          }
                          className="h-3.5 w-3.5 accent-sky-500"
                        />
                        <span className={f[campo] ? "text-slate-300" : "text-slate-500"}>
                          {etiqueta}
                        </span>
                      </label>
                    ))}
                  </div>
                </td>
                <td className={tdCls}>
                  <button
                    onClick={() =>
                      void accion(() =>
                        api.actualizarFormaPago(f.id, { pideReferencia: !f.pideReferencia })
                      )
                    }
                    disabled={!editable || ocupado || f.afectaEfectivo}
                    className="text-[11px] text-slate-300 disabled:text-slate-500"
                    title={
                      f.afectaEfectivo
                        ? "El efectivo no lleva referencia: la referencia es del banco"
                        : "Exigir referencia al cobrar"
                    }
                  >
                    {f.pideReferencia ? "Obligatoria" : "Opcional"}
                  </button>
                </td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{f.usos}</td>
                <td className={tdCls}>
                  {f.afectaEfectivo ? (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      Efectivo
                    </span>
                  ) : f.activa ? (
                    <span className="text-[11px] text-slate-400">Activa</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">De baja</span>
                  )}
                </td>
                <td className={tdCls}>
                  <div className="flex justify-end gap-1">
                    {enEdicion ? (
                      <>
                        <button
                          onClick={() =>
                            void accion(async () => {
                              await api.actualizarFormaPago(f.id, borrador);
                              setEditando(null);
                            })
                          }
                          disabled={ocupado}
                          className={btnMini}
                          title="Guardar"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditando(null)} className={btnMini} title="Cancelar">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditando(f.id);
                            setBorrador({ nombre: f.nombre, orden: f.orden });
                          }}
                          disabled={!editable || ocupado}
                          className={btnMini}
                          title="Renombrar o reordenar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void accion(() => api.actualizarFormaPago(f.id, { activa: !f.activa }))}
                          disabled={!editable || ocupado || f.afectaEfectivo}
                          className={btnMini}
                          title={
                            f.afectaEfectivo
                              ? "El efectivo no se puede dar de baja"
                              : f.activa
                                ? "Dar de baja"
                                : "Reactivar"
                          }
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      <p className="text-[11px] text-slate-500">
        Cada forma activa es un botón, por orden, en las pantallas que tenga marcadas. Se cobra por
        muchas vías pero a un proveedor se le suele pagar del cajón, así que de salida solo el
        efectivo sale en pagos; marca «Pagos» en las demás si alguna vez las necesitas. Si tiene
        imagen, el botón la enseña; si no, sale el nombre. Dar de baja una forma no toca el
        histórico: los cobros ya registrados con ella siguen ahí, solo deja de poder elegirse. El
        efectivo no se puede dar de baja ni quitar de ninguna de las dos pantallas, porque es el
        único que mueve el cajón.
      </p>
    </section>
  );
}

// ── Denominaciones ─────────────────────────────────────────────────────────

function Denominaciones() {
  const { recargarConfiguracion } = useCash();
  const [denominaciones, setDenominaciones] = useState<Denominacion[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api.listarDenominaciones();
      setDenominaciones(r.denominaciones);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el catálogo");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar(id: number, datos: { activa?: boolean; piezasPorCartucho?: number | null }) {
    setOcupado(id);
    setError("");
    try {
      await api.actualizarDenominacion(id, datos);
      await cargar();
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Denominaciones y cartuchos
      </h2>

      {error && <ErrorBox>{error}</ErrorBox>}

      <Aviso tono="aviso">
        Este catálogo es de <strong>toda la instalación</strong>, no de tu empresa: lo que se
        desactive aquí desaparece de las pantallas de caja de todos. El valor de cada denominación no
        se puede cambiar, porque es lo que da sentido a los movimientos ya registrados.
      </Aviso>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Denominación</th>
            <th className={thCls}>Tipo</th>
            <th className={`${thCls} text-right`}>Piezas por cartucho</th>
            <th className={`${thCls} text-right`}>Valor del cartucho</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {denominaciones.length === 0 && <EmptyRow cols={6} text="Cargando el catálogo…" />}
          {denominaciones.map((d) => (
            <tr key={d.id} className={`border-t border-slate-700 ${d.activa ? "" : "opacity-50"}`}>
              <td className={`${tdCls} font-bold tabular-nums`}>{d.etiqueta}</td>
              <td className={`${tdCls} text-[11px] text-slate-400`}>
                {d.tipo === "BILLETE" ? "Billete" : "Moneda"}
              </td>
              <td className={`${tdCls} text-right`}>
                {d.tipo === "MONEDA" ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue={d.piezasPorCartucho ?? ""}
                    placeholder="sin cartucho"
                    disabled={ocupado === d.id}
                    onBlur={(e) => {
                      const texto = e.target.value.replace(/\D/g, "");
                      const valor = texto === "" ? null : Number(texto);
                      if (valor !== d.piezasPorCartucho) void guardar(d.id, { piezasPorCartucho: valor });
                    }}
                    className="h-8 w-24 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm tabular-nums text-slate-100 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-sky-500"
                  />
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                {d.piezasPorCartucho ? euros(d.piezasPorCartucho * d.valor) : "—"}
              </td>
              <td className={tdCls}>
                <span className={`text-[11px] ${d.activa ? "text-slate-400" : "text-slate-500"}`}>
                  {d.activa ? "Activa" : "Desactivada"}
                </span>
              </td>
              <td className={tdCls}>
                <div className="flex justify-end">
                  <button
                    onClick={() => void guardar(d.id, { activa: !d.activa })}
                    disabled={ocupado === d.id}
                    className={btnMini}
                    title={d.activa ? "Desactivar" : "Activar"}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <p className="text-[11px] text-slate-500">
        El número de piezas por cartucho se guarda al salir del campo. No se puede desactivar una
        denominación que todavía tenga piezas en una caja abierta.
      </p>
    </section>
  );
}

/** Misma tabla sin controles, para quien no es administrador. */
function DenominacionesSoloLectura() {
  const { denominaciones } = useCash();

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Denominaciones y cartuchos
      </h2>
      <Aviso tono="info">
        El catálogo es de toda la instalación y solo lo puede modificar un administrador.
      </Aviso>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Denominación</th>
            <th className={thCls}>Tipo</th>
            <th className={`${thCls} text-right`}>Piezas por cartucho</th>
            <th className={`${thCls} text-right`}>Valor del cartucho</th>
          </tr>
        </thead>
        <tbody>
          {denominaciones.length === 0 && <EmptyRow cols={4} text="Sin denominaciones activas." />}
          {denominaciones.map((d) => (
            <tr key={d.id} className="border-t border-slate-700">
              <td className={`${tdCls} font-bold tabular-nums`}>{d.etiqueta}</td>
              <td className={`${tdCls} text-[11px] text-slate-400`}>
                {d.tipo === "BILLETE" ? "Billete" : "Moneda"}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{d.piezasPorCartucho ?? "—"}</td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                {d.piezasPorCartucho ? euros(d.piezasPorCartucho * d.valor) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </section>
  );
}
