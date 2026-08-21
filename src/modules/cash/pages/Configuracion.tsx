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
import { MEDIDA_RECOMENDADA, PROPORCION_BOTON } from "../components/PaymentMethodPicker";
import { euros, aCentimos } from "../utils/money";
import type { Centro, Denominacion, FormaPagoConfig, SeccionConfig } from "../types";
import * as api from "../services/api";

type CajaConfig = {
  id: number;
  centro: string;
  /** Taller al que pertenece. `null` = sin asignar; la fila lo avisa. */
  centroId: string | null;
  nombre: string;
  /** Iniciales que abren el número de sus documentos: `TAR1-IB-26-001`. */
  codigo: string;
  /** Fondo fijo del cajón. 0 = sin fondo fijo. */
  fondoObjetivoCentimos: number;
  activa: boolean;
  jornadas: string;
  /*
   * Ojo con el nombre: el servidor lo manda en camelCase. Aquí estaba escrito
   * `jornada_abierta` y por eso siempre valía undefined — el aviso de «tiene
   * una jornada abierta» no salía nunca y los botones de editar y dar de baja
   * se veían habilitados, aunque el servidor los rechazara después.
   */
  jornadaAbierta: number | null;
};

export default function Configuracion() {
  const { puede } = useCash();

  return (
    <div className="space-y-4">
      <Cabecera
        titulo="Configuración"
        descripcion="Cajas físicas, secciones de negocio, formas de cobro y catálogo de denominaciones."
      />
      <Cajas />
      <Secciones />
      <FormasPago />
      {puede("cash.denominations.configure") ? <Denominaciones /> : <DenominacionesSoloLectura />}
    </div>
  );
}

// ── Secciones de negocio ───────────────────────────────────────────────────

/**
 * Secciones de negocio dentro de la misma caja.
 *
 * Existen porque este taller lleva dos negocios —taller y gasolinera— con **un
 * solo cajón**. Partirlo en dos cajas rompería el arqueo, porque no se puede
 * contar dos veces el mismo billete. Lo que se parte es la liquidación: cada
 * cobro se etiqueta con su sección y el desglose sale en la jornada y en el
 * cierre. El dinero sigue siendo uno.
 */
function Secciones() {
  const { recargarConfiguracion, puede } = useCash();
  const [secciones, setSecciones] = useState<SeccionConfig[]>([]);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const editable = puede("cash.configure");

  const cargar = useCallback(async () => {
    try {
      const r = await api.listarSecciones();
      setSecciones(r.secciones);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las secciones");
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
      // El selector de la pantalla de cobros sale del arranque.
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Secciones de negocio
      </h2>

      <p className="text-[11px] text-slate-400">
        Para repartir la liquidación entre varios negocios que comparten el mismo cajón. El arqueo
        y el cierre de Mobilink siguen siendo{" "}
        <strong className="text-slate-300">uno solo</strong>: el dinero no se separa, solo se sabe
        cuánto ha aportado cada uno. Marca «caja propia en la ERP» en las que además cierran por
        su cuenta en Genes: el informe saca entonces una hoja de arqueo para cada una.
      </p>

      {error && <ErrorBox>{error}</ErrorBox>}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Nueva sección
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nombre.trim()) {
                  void accion(async () => {
                    await api.crearSeccion({ nombre: nombre.trim() });
                    setNombre("");
                  });
                }
              }}
              className={inputCls}
              placeholder="Lavadero"
            />
          </label>
          <button
            onClick={() =>
              void accion(async () => {
                await api.crearSeccion({ nombre: nombre.trim() });
                setNombre("");
              })
            }
            disabled={ocupado || !nombre.trim()}
            className="flex h-[38px] items-center gap-1 rounded-lg bg-sky-600 px-3 text-[12px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Sección</th>
            <th className={`${thCls} text-right`}>Operaciones</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Caja propia en la ERP</th>
            <th className={`${thCls} text-right`}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {secciones.length === 0 && <EmptyRow cols={5} text="Todavía no hay secciones." />}
          {secciones.map((sec) => (
            <tr key={sec.id} className={sec.activa ? "" : "opacity-60"}>
              <td className={tdCls}>
                <div className="font-medium text-slate-100">{sec.nombre}</div>
                <div className="text-[10px] text-slate-500">{sec.codigo}</div>
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{sec.usos}</td>
              <td className={tdCls}>
                {sec.porDefecto ? (
                  <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                    Por defecto
                  </span>
                ) : sec.activa ? (
                  <span className="text-[11px] text-slate-400">Activa</span>
                ) : (
                  <span className="text-[11px] text-slate-500">De baja</span>
                )}
              </td>
              {/*
                La sección por defecto se queda con el fondo del cajón, así que
                ES la caja principal en la ERP: no puede arquearse aparte de sí
                misma. De ahí que ahí no haya casilla, sino una explicación.
              */}
              <td className={tdCls}>
                {sec.porDefecto ? (
                  <span className="text-[10px] text-slate-500">
                    Caja principal · se queda con el fondo
                  </span>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sec.arqueaAparte}
                      onChange={(e) =>
                        void accion(() =>
                          api.actualizarSeccion(sec.id, { arqueaAparte: e.target.checked })
                        )
                      }
                      disabled={!editable || ocupado}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-sky-500"
                    />
                    <span className="text-[11px] text-slate-400">
                      {sec.arqueaAparte ? "Se arquea aparte" : "Va en la caja principal"}
                    </span>
                  </label>
                )}
              </td>
              <td className={tdCls}>
                <div className="flex justify-end gap-1">
                  {!sec.porDefecto && sec.activa && (
                    <button
                      onClick={() => void accion(() => api.actualizarSeccion(sec.id, { porDefecto: true }))}
                      disabled={!editable || ocupado}
                      className={btnMini}
                      title="Marcarla como predeterminada: es la que se propone al cobrar y con la que se guardan los pagos"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => void accion(() => api.actualizarSeccion(sec.id, { activa: !sec.activa }))}
                    disabled={!editable || ocupado || sec.porDefecto}
                    className={btnMini}
                    title={
                      sec.porDefecto
                        ? "La sección por defecto no se puede dar de baja: marca antes otra"
                        : sec.activa
                          ? "Dar de baja"
                          : "Reactivar"
                    }
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
        Dar de baja una sección no toca el histórico: los cobros ya registrados con ella siguen
        ahí, solo deja de poder elegirse. Los pagos y salidas no preguntan la sección y se guardan
        con la predeterminada.
      </p>

      <p className="text-[11px] text-slate-500">
        «Caja propia en la ERP» es para cuando dos negocios comparten cajón pero cierran por
        separado en Genes. El informe saca una hoja de arqueo por caja: el importe de cada una es
        exacto —sale del libro mayor— y el reparto de piezas es una propuesta, porque el cajón es
        uno solo y ese dinero no está separado físicamente.
      </p>
    </section>
  );
}

// ── Cajas ──────────────────────────────────────────────────────────────────

function Cajas() {
  const { recargarConfiguracion } = useCash();
  const [cajas, setCajas] = useState<CajaConfig[]>([]);
  const [nombre, setNombre] = useState("");
  const [centro, setCentro] = useState("");
  const [centroId, setCentroId] = useState("");
  const [centros, setCentros] = useState<Centro[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState<{
    nombre: string;
    centro: string;
    centroId?: string;
    codigo: string;
  }>({ nombre: "", centro: "", codigo: "" });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [r, j] = await Promise.all([api.listarCajas(), api.jerarquia()]);
      setCajas(r.cajas);
      setCentros(j.centros.filter((c) => c.activo));
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
                  await api.crearCaja(nombre.trim(), centro.trim(), centroId || null);
                  setNombre("");
                  setCentro("");
                  setCentroId("");
                });
              }
            }}
            placeholder="Mostrador principal"
            className={inputCls}
          />
        </label>
        {/*
          * El taller se ELIGE cuando los hay dados de alta, y solo se teclea
          * cuando no hay ninguno. Escribirlo a mano era lo que producía
          * «Tarragona» y «tarragona» como dos talleres distintos, y con eso
          * ningún informe consolidado cuadra.
          */}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Taller
          </span>
          {centros.length > 0 ? (
            <select
              value={centroId}
              onChange={(e) => setCentroId(e.target.value)}
              className={inputCls}
            >
              <option value="">Sin asignar</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={centro}
              onChange={(e) => setCentro(e.target.value)}
              placeholder="tarragona"
              className={inputCls}
            />
          )}
        </label>
        <button
          onClick={() =>
            void accion(async () => {
              await api.crearCaja(nombre.trim(), centro.trim(), centroId || null);
              setNombre("");
              setCentro("");
              setCentroId("");
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
            <th className={thCls}>Código</th>
            <th className={`${thCls} text-right`}>Fondo fijo</th>
            <th className={`${thCls} text-right`}>Jornadas</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {sinCajas && <EmptyRow cols={7} text="Todavía no hay ninguna caja." />}
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
                  {enEdicion && centros.length > 0 ? (
                    <select
                      value={borrador.centroId ?? ""}
                      onChange={(e) => setBorrador({ ...borrador, centroId: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">Sin asignar</option>
                      {centros.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                        </option>
                      ))}
                    </select>
                  ) : enEdicion ? (
                    <input
                      value={borrador.centro}
                      onChange={(e) => setBorrador({ ...borrador, centro: e.target.value })}
                      className={inputCls}
                    />
                  ) : c.centroId ? (
                    c.centro
                  ) : (
                    /*
                     * Sin taller la caja funciona igual, pero no entra en
                     * ningún recuento por taller. Se dice aquí y no en una
                     * nota al pie: si no se ve al lado de la caja, nadie lo
                     * arregla.
                     */
                    <span className="text-amber-400" title="Sin taller asignado: esta caja no se puede agrupar por taller">
                      {c.centro || "—"} · sin asignar
                    </span>
                  )}
                </td>
                {/*
                  El código abre el número de todos los documentos de la caja
                  (TAR1-IB-26-001) y es lo que se coteja contra el extracto del
                  banco. Cambiarlo no renumera lo ya emitido: los documentos
                  nuevos salen con el nuevo y el histórico conserva el suyo.
                */}
                <td className={tdCls}>
                  {enEdicion ? (
                    <input
                      value={borrador.codigo}
                      onChange={(e) => setBorrador({ ...borrador, codigo: e.target.value })}
                      maxLength={6}
                      placeholder="TAR1"
                      className={`${inputCls} w-20 uppercase`}
                    />
                  ) : c.codigo ? (
                    <span className="font-mono text-[12px] font-bold text-sky-300">{c.codigo}</span>
                  ) : (
                    <span
                      className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                      title="Sin código, sus documentos numeran con MC y no se distinguen en el banco"
                    >
                      sin código
                    </span>
                  )}
                </td>
                <td className={`${tdCls} text-right`}>
                  <FondoFijo
                    centimos={c.fondoObjetivoCentimos}
                    deshabilitado={ocupado}
                    onGuardar={(v) => void accion(() => api.actualizarCaja(c.id, { fondoObjetivoCentimos: v }))}
                  />
                </td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>{c.jornadas}</td>
                <td className={tdCls}>
                  {c.jornadaAbierta ? (
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
                              /*
                               * El vacío del desplegable es «sin asignar», y
                               * eso viaja como null explícito: una cadena
                               * vacía se interpretaría como un id de taller y
                               * el servidor la rechazaría con un 404 que no
                               * dice nada.
                               */
                              await api.actualizarCaja(c.id, {
                                ...borrador,
                                centroId: borrador.centroId ? borrador.centroId : null,
                              });
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
                            setBorrador({
                              nombre: c.nombre,
                              centro: c.centro,
                              centroId: c.centroId ?? "",
                              codigo: c.codigo,
                            });
                          }}
                          disabled={ocupado || Boolean(c.jornadaAbierta)}
                          className={btnMini}
                          title={
                            c.jornadaAbierta
                              ? "No se puede modificar con la jornada abierta"
                              : "Renombrar"
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void accion(() => api.actualizarCaja(c.id, { activa: !c.activa }))}
                          disabled={ocupado || Boolean(c.jornadaAbierta)}
                          className={btnMini}
                          title={
                            c.jornadaAbierta
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

      {editable && (
        <p className="text-[11px] text-slate-400">
          La imagen ocupa el botón entero. Súbela apaisada en proporción{" "}
          <strong className="text-slate-300">{PROPORCION_BOTON}</strong> —lo ideal,{" "}
          <strong className="text-slate-300">{MEDIDA_RECOMENDADA}</strong>— y encajará sin
          recortarse. Con otra proporción se recorta por el lado que sobre, y la miniatura de
          aquí al lado te enseña exactamente cómo quedará.
        </p>
      )}

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
                      // 48×32 es 3:2, la proporción exacta del botón, y
                      // `object-cover` recorta igual que él: la vista previa
                      // tiene que enseñar lo que se verá al cobrar, recorte
                      // incluido.
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
                          title={`Subir la imagen del botón (${PROPORCION_BOTON}, ${MEDIDA_RECOMENDADA})`}
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

      <BotonMixto editable={editable} />
    </section>
  );
}

/**
 * Imagen del botón «Mixto».
 *
 * Va en su propio bloque y no como una fila más de la tabla porque Mixto no es
 * una forma de cobro: es un reparto entre varias. No se puede dar de baja, ni
 * reordenar, ni exigirle referencia —no significan nada para él—, y meterlo en
 * la tabla obligaría a apagar media fila de controles. Lo único suyo que se
 * configura es la imagen.
 */
function BotonMixto({ editable }: { editable: boolean }) {
  const { ajustes, recargarConfiguracion } = useCash();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Botón «Mixto»
      </h3>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {ajustes.mixtoImagenUrl ? (
          <img
            src={ajustes.mixtoImagenUrl}
            alt=""
            className="h-8 w-12 rounded border border-slate-700 bg-slate-900 object-cover"
          />
        ) : (
          <span className="flex h-8 w-12 items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-500">
            icono
          </span>
        )}

        <p className="min-w-0 flex-1 text-[11px] text-slate-400">
          Es el botón que reparte un cobro entre varias formas. Sin imagen sale con su icono y el
          texto «Mixto»; con imagen se ve igual que los demás botones, así que conviene subirla en{" "}
          <strong className="text-slate-300">{PROPORCION_BOTON}</strong> ({MEDIDA_RECOMENDADA}).
        </p>

        {editable && (
          <div className="flex shrink-0 gap-1">
            <label className={`${btnMini} cursor-pointer`} title="Subir la imagen del botón Mixto">
              <ImagePlus className="h-3.5 w-3.5" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={ocupado}
                onChange={(e) => {
                  const fichero = e.target.files?.[0];
                  e.target.value = "";
                  if (!fichero) return;
                  if (fichero.size > MAXIMO_IMAGEN) {
                    setError(
                      `La imagen pesa ${(fichero.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`
                    );
                    return;
                  }
                  void accion(() => api.subirImagenMixto(fichero));
                }}
              />
            </label>
            {ajustes.mixtoImagenUrl && (
              <button
                onClick={() => void accion(() => api.quitarImagenMixto())}
                disabled={ocupado}
                className={btnMini}
                title="Quitar la imagen y dejar el icono"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Fondo fijo de una caja, en euros.
 *
 * Se escribe como se dice —«350»— y viaja en céntimos. Se guarda al salir del
 * campo, igual que las piezas por cartucho: es un número que se toca una vez y
 * no merece un botón de guardar propio.
 */
function FondoFijo({
  centimos,
  deshabilitado,
  onGuardar,
}: {
  centimos: number;
  deshabilitado: boolean;
  onGuardar: (centimos: number) => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={centimos > 0 ? euros(centimos).replace(" €", "") : ""}
      placeholder="sin fondo"
      disabled={deshabilitado}
      onBlur={(e) => {
        const nuevo = e.target.value.trim() === "" ? 0 : (aCentimos(e.target.value) ?? centimos);
        if (nuevo !== centimos) onGuardar(nuevo);
      }}
      className="h-8 w-24 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm tabular-nums text-slate-100 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-sky-500"
    />
  );
}

/** El servidor corta en 8 MB; avisar aquí ahorra subir la foto para nada. */
const MAXIMO_IMAGEN = 8 * 1024 * 1024;

// ── Denominaciones ─────────────────────────────────────────────────────────

function Denominaciones() {
  const { recargarConfiguracion } = useCash();
  const [denominaciones, setDenominaciones] = useState<Denominacion[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);
  /**
   * Cuenta de refrescos, que va en la `key` de los campos.
   *
   * Los campos son no controlados —se guardan al salir— así que se quedan con
   * lo que uno tecleó aunque el servidor lo haya rechazado. Con eso, una bolsa
   * que no se ha guardado seguía enseñando su número como si sí, y la pantalla
   * mentía. Al cambiar la `key`, React los vuelve a montar con el valor que hay
   * de verdad en la base.
   */
  const [refresco, setRefresco] = useState(0);

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

  async function guardar(
    id: number,
    datos: {
      activa?: boolean;
      piezasPorCartucho?: number | null;
      piezasPorBolsa?: number | null;
    }
  ) {
    await accion(id, () => api.actualizarDenominacion(id, datos));
  }

  /** Todo lo que toca el catálogo pasa por aquí: recarga y errores en un sitio. */
  async function accion(id: number, hacer: () => Promise<unknown>) {
    setOcupado(id);
    setError("");
    try {
      await hacer();
      await cargar();
      await recargarConfiguracion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
      // Que los campos vuelvan a lo que está guardado: lo tecleado no cuajó.
      setRefresco((n) => n + 1);
    } finally {
      setOcupado(null);
    }
  }

  function subirImagen(id: number, fichero: File | undefined) {
    if (!fichero) return;
    if (fichero.size > MAXIMO_IMAGEN) {
      setError(`La imagen pesa ${(fichero.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`);
      return;
    }
    void accion(id, () => api.subirImagenDenominacion(id, fichero));
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Denominaciones, cartuchos y bolsas
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
            <th className={thCls}>Imagen</th>
            <th className={thCls}>Tipo</th>
            <th className={`${thCls} text-right`}>Piezas por cartucho</th>
            <th className={`${thCls} text-right`}>Monedas por bolsa</th>
            <th className={`${thCls} text-right`}>Valor cartucho / bolsa</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {denominaciones.length === 0 && <EmptyRow cols={8} text="Cargando el catálogo…" />}
          {denominaciones.map((d) => (
            <tr key={d.id} className={`border-t border-slate-700 ${d.activa ? "" : "opacity-50"}`}>
              <td className={`${tdCls} font-bold tabular-nums`}>{d.etiqueta}</td>
              <td className={tdCls}>
                <div className="flex items-center gap-1">
                  {d.imagenUrl ? (
                    <img
                      src={d.imagenUrl}
                      alt={d.etiqueta}
                      className="h-8 w-12 rounded object-contain"
                    />
                  ) : (
                    <span className="flex h-8 w-12 items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-500">
                      sin foto
                    </span>
                  )}
                  <label
                    className={`${btnMini} cursor-pointer`}
                    title={`Subir la foto de ${d.etiqueta}`}
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={ocupado === d.id}
                      onChange={(e) => {
                        const fichero = e.target.files?.[0];
                        e.target.value = "";
                        subirImagen(d.id, fichero);
                      }}
                    />
                  </label>
                  {d.imagenUrl && (
                    <button
                      onClick={() => void accion(d.id, () => api.quitarImagenDenominacion(d.id))}
                      disabled={ocupado === d.id}
                      className={btnMini}
                      title="Quitar la foto"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </td>
              <td className={`${tdCls} text-[11px] text-slate-400`}>
                {d.tipo === "BILLETE" ? "Billete" : "Moneda"}
              </td>
              <td className={`${tdCls} text-right`}>
                {d.tipo === "MONEDA" ? (
                  <CampoPiezas
                    key={`cartucho-${refresco}`}
                    valor={d.piezasPorCartucho}
                    marcador="sin cartucho"
                    deshabilitado={ocupado === d.id}
                    onGuardar={(v) => void guardar(d.id, { piezasPorCartucho: v })}
                  />
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className={`${tdCls} text-right`}>
                {d.tipo === "MONEDA" ? (
                  <CampoPiezas
                    key={`bolsa-${refresco}`}
                    valor={d.piezasPorBolsa}
                    marcador="sin bolsa"
                    deshabilitado={ocupado === d.id}
                    onGuardar={(v) => void guardar(d.id, { piezasPorBolsa: v })}
                  />
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                <div>{d.piezasPorCartucho ? euros(d.piezasPorCartucho * d.valor) : "—"}</div>
                <div className="text-[10px] text-slate-500">
                  {d.piezasPorBolsa ? euros(d.piezasPorBolsa * d.valor) : "—"}
                </div>
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
        Los números se guardan al salir del campo. La <strong>bolsa</strong> es el precinto con el
        que llegan las monedas del banco, a granel; puede traer más o menos monedas que un cartucho,
        da igual. Si una moneda no viene en bolsa, se deja vacío. Cuando haga falta romper un
        precinto, se abre <strong>siempre la bolsa antes que el cartucho</strong>: el cartucho es lo
        que se guarda ordenado para el cajón. No se puede desactivar una denominación que todavía
        tenga piezas en una caja abierta.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* El 0 marca «toda la tabla ocupada»: los ids de verdad empiezan en 1. */}
        <button
          onClick={() => void accion(0, api.recortarImagenesDenominaciones)}
          disabled={ocupado !== null}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          {ocupado === 0 ? "Recortando…" : "Recortar el fondo de las monedas"}
        </button>
        <span className="text-[11px] text-slate-500">
          Solo las monedas: a un billete no le sobra fondo, así que su foto se guarda tal cual se
          sube. Las monedas que se suban a partir de ahora ya salen recortadas; el botón es para las
          que subiste antes, que llevan el blanco del JPG dentro.
        </span>
      </div>

      <p className="text-[11px] text-slate-500">
        Las fotos son del catálogo, o sea de toda la instalación: un billete de 20 € es el mismo en
        todas las empresas. De momento solo se ven aquí; están para poder enseñarlas en otras
        pantallas más adelante.
      </p>
    </section>
  );
}

/**
 * Campo de piezas por envase.
 *
 * Cartucho y bolsa se teclean igual —un entero o vacío, guardado al salir del
 * campo— así que comparten componente en lugar de duplicar el `onBlur` con su
 * limpieza de caracteres y su comparación con el valor anterior.
 */
function CampoPiezas({
  valor,
  marcador,
  deshabilitado,
  onGuardar,
}: {
  valor: number | null;
  marcador: string;
  deshabilitado: boolean;
  onGuardar: (valor: number | null) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      defaultValue={valor ?? ""}
      placeholder={marcador}
      disabled={deshabilitado}
      onBlur={(e) => {
        const texto = e.target.value.replace(/\D/g, "");
        const nuevo = texto === "" ? null : Number(texto);
        if (nuevo !== valor) onGuardar(nuevo);
      }}
      className="h-8 w-24 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm tabular-nums text-slate-100 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-sky-500"
    />
  );
}

/** Misma tabla sin controles, para quien no es administrador. */
function DenominacionesSoloLectura() {
  const { denominaciones } = useCash();

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Denominaciones, cartuchos y bolsas
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
            <th className={`${thCls} text-right`}>Monedas por bolsa</th>
            <th className={`${thCls} text-right`}>Valor cartucho / bolsa</th>
          </tr>
        </thead>
        <tbody>
          {denominaciones.length === 0 && <EmptyRow cols={5} text="Sin denominaciones activas." />}
          {denominaciones.map((d) => (
            <tr key={d.id} className="border-t border-slate-700">
              <td className={`${tdCls} font-bold tabular-nums`}>{d.etiqueta}</td>
              <td className={`${tdCls} text-[11px] text-slate-400`}>
                {d.tipo === "BILLETE" ? "Billete" : "Moneda"}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{d.piezasPorCartucho ?? "—"}</td>
              <td className={`${tdCls} text-right tabular-nums`}>{d.piezasPorBolsa ?? "—"}</td>
              <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                <div>{d.piezasPorCartucho ? euros(d.piezasPorCartucho * d.valor) : "—"}</div>
                <div className="text-[10px] text-slate-500">
                  {d.piezasPorBolsa ? euros(d.piezasPorBolsa * d.valor) : "—"}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </section>
  );
}
