/**
 * MC Central — supervisión de la red de cajas.
 *
 * Misma forma que `CashApp`: rutas hijas bajo `/central/*` y el lenguaje visual
 * del panel, reutilizando las piezas de Administración en vez de copiarlas.
 *
 * Lo que esta pantalla NO hace, y conviene que se note al leerla: no mueve
 * dinero, no cierra jornadas ajenas y no corrige descuadres. Enseña lo que las
 * cajas cuentan de sí mismas. Cada caja sigue siendo la dueña de su jornada y
 * de su arqueo; Central solo mira, y de eso depende que el módulo de caja siga
 * funcionando aunque esto se caiga.
 */

import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Building2, CalendarDays, Coins, Landmark, Network, Wallet } from "lucide-react";
import {
  Card,
  EmptyRow,
  ErrorBox,
  TableWrap,
  btnPrimary,
  inputCls,
  thCls,
  tdCls,
} from "../administracion/components/ui";
import { euros } from "../cash/utils/money";
import * as api from "./api";

const enlace = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
    isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
  }`;

export default function CentralApp() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="mx-auto max-w-7xl p-4">
        <header className="mb-4">
          <h1 className="text-lg font-bold">MC Central</h1>
          <p className="text-[11px] text-slate-400">
            Supervisión de la red. Las cajas siguen siendo dueñas de su jornada: aquí solo se mira.
          </p>
        </header>

        <nav className="mb-4 flex flex-wrap gap-1">
          <NavLink to="/central/red" className={enlace}>
            <Network size={15} /> Red de cajas
          </NavLink>
          <NavLink to="/central/posicion" className={enlace}>
            <Wallet size={15} /> Posición de efectivo
          </NavLink>
          <NavLink to="/central/ingresos" className={enlace}>
            <Landmark size={15} /> Ingresos
          </NavLink>
          <NavLink to="/central/cambio" className={enlace}>
            <Coins size={15} /> Cambio
          </NavLink>
          <NavLink to="/central/jornadas" className={enlace}>
            <CalendarDays size={15} /> Jornadas
          </NavLink>
          <NavLink to="/central/organizacion" className={enlace}>
            <Building2 size={15} /> Organización
          </NavLink>
        </nav>

        <Routes>
          <Route index element={<Navigate to="red" replace />} />
          <Route path="red" element={<Red />} />
          <Route path="posicion" element={<Posicion />} />
          <Route path="ingresos" element={<Ingresos />} />
          <Route path="cambio" element={<Cambio />} />
          <Route path="jornadas" element={<Jornadas />} />
          <Route path="organizacion" element={<Organizacion />} />
          <Route path="*" element={<Navigate to="red" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// ── Red de cajas ───────────────────────────────────────────────────────────

function Red() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.red>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.red());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la red");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  const r = datos?.resumen;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card title="Cajas" value={String(r?.cajas ?? 0)} />
        <Card title="Jornadas abiertas" value={String(r?.jornadasAbiertas ?? 0)} />
        <Card
          title="Descuadres (30 días)"
          value={String(r?.descuadres ?? 0)}
          hint={euros(r?.descuadreCentimos ?? 0)}
          accent={r?.descuadres ? "text-amber-400" : undefined}
        />
        <Card title="Cobrado hoy" value={euros(r?.cobradoHoyCentimos ?? 0)} />
        {/*
          * Los eventos tardíos no son un error: llegaron y se descartaron por
          * viejos, que es lo correcto. Se enseñan porque un número que crece
          * deprisa sí dice algo — que algo está reintentando mucho.
          */}
        <Card
          title="Eventos tardíos"
          value={String(r?.eventosTardios ?? 0)}
          hint="llegaron fuera de orden"
        />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Taller</th>
            <th className={thCls}>Caja</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Último cierre</th>
            <th className={`${thCls} text-right`}>Ingresado</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.cajas ?? []).length === 0 && (
            <EmptyRow
              cols={5}
              text="Todavía no ha llegado ningún evento. En cuanto una caja abra jornada, aparecerá aquí."
            />
          )}
          {(datos?.cajas ?? []).map((c) => (
            <tr key={c.registerId} className="border-t border-slate-700">
              <td className={tdCls}>
                {c.centroNombre ?? (
                  // Una caja sin taller no se esconde: es justo la que hay que
                  // arreglar en la configuración de la caja.
                  <span className="text-amber-400">sin taller</span>
                )}
              </td>
              <td className={tdCls}>
                {c.nombre ?? `#${c.registerId}`}{" "}
                {c.codigo && <span className="font-mono text-[11px] text-slate-500">{c.codigo}</span>}
              </td>
              <td className={tdCls}>
                {c.jornadaAbiertaId ? (
                  <span className="text-emerald-400">abierta</span>
                ) : (
                  <span className="text-slate-500">cerrada</span>
                )}
              </td>
              <td className={tdCls}>
                {c.ultimaFechaCerrada ?? "—"}
                {c.diasSinCerrar != null && c.diasSinCerrar > 2 && (
                  <span className="ml-2 text-amber-400">{c.diasSinCerrar} días</span>
                )}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(c.ingresadoCentimos)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ── Posición global de efectivo ────────────────────────────────────────────

/**
 * Cuánto efectivo hay en la red y dónde está.
 *
 * La pantalla enseña el total **y sus tres partes**, y no solo el total, porque
 * un número de dinero que no se puede comprobar no lo usa nadie. Las tres
 * partes suman exactamente el total: cada euro está en un sitio y en uno solo.
 */
function Posicion() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.posicion>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.posicion());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la posición");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  const p = datos?.posicion;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title="Total en la red" value={euros(p?.totalCentimos ?? 0)} accent="text-sky-400" />
        <Card title="En los cajones" value={euros(p?.enCajonesCentimos ?? 0)} />
        <Card
          title="Fuera del cajón"
          value={euros(p?.enTransitoCentimos ?? 0)}
          hint={`${p?.transitosAbiertos ?? 0} sin cerrar`}
          accent={p?.transitosAbiertos ? "text-amber-400" : undefined}
        />
        <Card
          title="Esperando al banco"
          value={euros(p?.pendienteBancoCentimos ?? 0)}
          hint="apartado en cierres"
        />
      </div>

      <p className="text-[11px] text-slate-500">
        Las tres partes suman el total: el dinero que se fue al banco a cambiar o que lleva alguien
        ya salió del cajón, así que se cuenta una vez y en un solo sitio.
      </p>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Documento</th>
            <th className={thCls}>Quién lo tiene</th>
            <th className={thCls}>Caja</th>
            <th className={`${thCls} text-right`}>Importe</th>
            <th className={`${thCls} text-right`}>Días fuera</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.transitos ?? []).length === 0 && (
            <EmptyRow cols={5} text="No hay dinero fuera del cajón ahora mismo." />
          )}
          {(datos?.transitos ?? []).map((t) => (
            <tr key={`${t.clase}-${t.documentoId}`} className="border-t border-slate-700">
              <td className={tdCls}>
                <span className="font-mono text-[11px]">{t.numero ?? `#${t.documentoId}`}</span>{" "}
                <span className="text-[11px] text-slate-500">
                  {t.clase === "CHANGE_ORDER" ? "cambio al banco" : "entrega"}
                </span>
              </td>
              <td className={tdCls}>{t.responsable ?? "—"}</td>
              <td className={tdCls}>
                {t.caja ?? "—"}
                {t.centro && <span className="ml-2 text-[11px] text-slate-500">{t.centro}</span>}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(t.importeCentimos)}</td>
              <td
                className={`${tdCls} text-right tabular-nums ${
                  (t.dias ?? 0) > 3 ? "text-amber-400" : ""
                }`}
              >
                {t.dias ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ── Ingresos bancarios ─────────────────────────────────────────────────────

/**
 * El ciclo de ingresos: lo que ya está en el banco y lo que sigue en la tienda.
 *
 * Lo pendiente va ARRIBA a propósito. Un listado de ingresos es historia; el
 * dinero que lleva tres semanas esperando en un cajón es lo que hay que mirar
 * hoy, y si estuviera debajo de doscientas filas no lo miraría nadie.
 */
function Ingresos() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.ingresos>> | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.ingresos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los ingresos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  const pendiente = datos?.pendiente ?? [];
  const totalPendiente = pendiente.reduce((a, p) => a + p.centimos, 0);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Pendiente de llevar al banco · {euros(totalPendiente)}
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Taller</th>
              <th className={thCls}>Caja</th>
              <th className={`${thCls} text-right`}>Jornadas</th>
              <th className={thCls}>Desde</th>
              <th className={`${thCls} text-right`}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {pendiente.length === 0 && (
              <EmptyRow cols={5} text="No hay nada esperando: todos los cierres están ingresados." />
            )}
            {pendiente.map((p) => (
              <tr key={p.registerId} className="border-t border-slate-700">
                <td className={tdCls}>
                  {p.centro ?? <span className="text-amber-400">sin taller</span>}
                </td>
                <td className={tdCls}>{p.caja ?? `#${p.registerId}`}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{p.jornadas}</td>
                <td className={tdCls}>
                  {p.desde ?? "—"}
                  {/*
                    * 400 € esperando desde ayer es lo normal. Los mismos 400 €
                    * desde hace tres semanas son dinero en el cajón de una
                    * tienda, y eso ya es otra cosa.
                    */}
                  {(p.dias ?? 0) > 7 && (
                    <span className="ml-2 text-amber-400">{p.dias} días</span>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(p.centimos)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Ingresos registrados
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={thCls}>Fecha</th>
              <th className={thCls}>Caja</th>
              <th className={thCls}>Referencia</th>
              <th className={`${thCls} text-right`}>Importe</th>
              <th className={thCls}>Origen</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.ingresos ?? []).length === 0 && (
              <EmptyRow cols={6} text="Todavía no se ha registrado ningún ingreso." />
            )}
            {(datos?.ingresos ?? []).map((i) => (
              <tr key={i.depositId} className="border-t border-slate-700 align-top">
                <td className={`${tdCls} font-mono text-[11px]`}>
                  {i.numero ?? `#${i.depositId}`}
                  {i.estado === "ANULADO" && (
                    <span className="ml-2 text-rose-400" title={i.anuladoMotivo ?? ""}>
                      anulado
                    </span>
                  )}
                </td>
                <td className={tdCls}>{i.fecha ?? "—"}</td>
                <td className={tdCls}>
                  {i.caja ?? "—"}
                  {i.centro && <span className="ml-2 text-[11px] text-slate-500">{i.centro}</span>}
                </td>
                <td className={`${tdCls} text-[11px]`}>{i.referencia ?? "—"}</td>
                <td
                  className={`${tdCls} text-right tabular-nums ${
                    i.estado === "ANULADO" ? "text-slate-500 line-through" : ""
                  }`}
                >
                  {euros(i.importeCentimos)}
                </td>
                <td className={tdCls}>
                  {/*
                    * El desglose es lo que permite conciliar: cuando el banco
                    * apunta un abono, hay que poder decir de qué días salió.
                    */}
                  <button
                    className="text-[11px] text-sky-400 hover:underline"
                    onClick={() => setAbierto(abierto === i.depositId ? null : i.depositId)}
                  >
                    {i.origen.length} jornada{i.origen.length === 1 ? "" : "s"}
                  </button>
                  {abierto === i.depositId && (
                    <ul className="mt-1 space-y-0.5">
                      {i.origen.map((o) => (
                        <li key={o.sessionId} className="text-[11px] text-slate-400">
                          {o.fecha ?? `#${o.sessionId}`} · {euros(o.importeCentimos)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

// ── Cambio y arqueos ───────────────────────────────────────────────────────

/** Formatea un valor de pieza: 2000 → «20 €», 10 → «10 c». */
const pieza = (centimos: number) =>
  centimos >= 100 ? `${centimos / 100} €` : `${centimos} c`;

/**
 * El cambio de la red, pieza a pieza.
 *
 * La foto sale del último arqueo de cada caja, no del stock teórico. El teórico
 * es correcto por construcción; el arqueo es lo que alguien ha contado con la
 * mano, y para decidir si un taller se está quedando sin monedas la foto buena
 * es la contada.
 */
function Cambio() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cambio>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.cambio());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el cambio");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Cajas con menos calderilla
        </h2>
        <p className="text-[11px] text-slate-500">
          Solo cuenta monedas: lo que se acaba en un mostrador no son los billetes, de esos siempre
          entran, sino lo que hace falta para devolver.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Taller</th>
              <th className={thCls}>Caja</th>
              <th className={`${thCls} text-right`}>En monedas</th>
              <th className={thCls}>Último recuento</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.cajas ?? []).length === 0 && (
              <EmptyRow cols={4} text="Todavía no ha llegado ningún arqueo con detalle por pieza." />
            )}
            {(datos?.cajas ?? []).map((c) => (
              <tr key={c.registerId} className="border-t border-slate-700">
                <td className={tdCls}>
                  {c.centro ?? <span className="text-amber-400">sin taller</span>}
                </td>
                <td className={tdCls}>{c.caja ?? `#${c.registerId}`}</td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {euros(c.calderillaCentimos)}
                </td>
                <td className={`${tdCls} text-[11px] text-slate-500`}>
                  {c.contadoEnMs ? new Date(c.contadoEnMs).toLocaleDateString("es-ES") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Piezas en la red
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Pieza</th>
              <th className={`${thCls} text-right`}>Unidades</th>
              <th className={`${thCls} text-right`}>Importe</th>
              <th className={`${thCls} text-right`}>Cajas a cero</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.piezas ?? []).length === 0 && <EmptyRow cols={4} text="Sin datos todavía." />}
            {(datos?.piezas ?? []).map((p) => (
              <tr key={p.valorCentimos} className="border-t border-slate-700">
                <td className={tdCls}>{pieza(p.valorCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{p.cantidad}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(p.importeCentimos)}</td>
                {/*
                  * El dato que un total de red no puede dar: que haya 400
                  * monedas de 10 c no sirve si están todas en un taller.
                  */}
                <td
                  className={`${tdCls} text-right tabular-nums ${
                    p.cajasSinNinguna > 0 ? "text-amber-400" : "text-slate-500"
                  }`}
                >
                  {p.cajasSinNinguna}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Descuadres por pieza
        </h2>
        <p className="text-[11px] text-slate-500">
          Un descuadre de 20 € puede ser un billete que no está o veinte monedas de un euro mal
          contadas. No son el mismo problema: lo primero se busca, lo segundo se recuenta.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Pieza</th>
              <th className={`${thCls} text-right`}>Diferencia</th>
              <th className={`${thCls} text-right`}>Importe</th>
              <th className={`${thCls} text-right`}>Cajas</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.descuadres ?? []).length === 0 && (
              <EmptyRow cols={4} text="Ninguna caja descuadra en su último arqueo." />
            )}
            {(datos?.descuadres ?? []).map((d) => (
              <tr key={d.valorCentimos} className="border-t border-slate-700">
                <td className={tdCls}>{pieza(d.valorCentimos)}</td>
                <td
                  className={`${tdCls} text-right tabular-nums ${
                    d.diferencia < 0 ? "text-rose-400" : "text-emerald-400"
                  }`}
                >
                  {d.diferencia > 0 ? `+${d.diferencia}` : d.diferencia}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {euros(d.diferencia * d.valorCentimos)}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{d.cajas}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

// ── Jornadas ───────────────────────────────────────────────────────────────

function Jornadas() {
  const [filas, setFilas] = useState<api.JornadaEnRed[]>([]);
  const [soloDescuadres, setSoloDescuadres] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await api.jornadas({ descuadres: soloDescuadres });
      setFilas(r.jornadas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las jornadas");
    }
  }, [soloDescuadres]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={soloDescuadres}
          onChange={(e) => setSoloDescuadres(e.target.checked)}
        />
        Solo jornadas que descuadraron
      </label>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Taller</th>
            <th className={thCls}>Caja</th>
            <th className={thCls}>Estado</th>
            <th className={`${thCls} text-right`}>Cobros</th>
            <th className={`${thCls} text-right`}>Pagos</th>
            <th className={`${thCls} text-right`}>Diferencia</th>
            <th className={`${thCls} text-right`}>Al banco</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <EmptyRow cols={8} text="No hay jornadas que enseñar." />}
          {filas.map((j) => (
            <tr key={j.sessionId} className="border-t border-slate-700">
              <td className={tdCls}>{j.fecha ?? "—"}</td>
              <td className={tdCls}>{j.centro ?? <span className="text-amber-400">sin taller</span>}</td>
              <td className={tdCls}>{j.caja ?? `#${j.registerId}`}</td>
              <td className={tdCls}>
                {j.estado}
                {j.reaperturas > 0 && (
                  <span className="ml-2 text-amber-400" title="Se reabrió">
                    ↻{j.reaperturas}
                  </span>
                )}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(j.cobrosCentimos)}</td>
              <td className={`${tdCls} text-right tabular-nums`}>{euros(j.pagosCentimos)}</td>
              <td
                className={`${tdCls} text-right tabular-nums ${
                  j.diferenciaCentimos ? "text-amber-400" : "text-slate-500"
                }`}
              >
                {j.diferenciaCentimos == null ? "—" : euros(j.diferenciaCentimos)}
              </td>
              <td className={`${tdCls} text-right tabular-nums`}>
                {j.ingresoBancarioCentimos == null ? "—" : euros(j.ingresoBancarioCentimos)}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ── Organización ───────────────────────────────────────────────────────────

function Organizacion() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.red>> | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.red());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la organización");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const puedeConfigurar = datos?.permisos?.includes("central.zones.configure") ?? false;

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBox>{error}</ErrorBox>}

      {puedeConfigurar && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Zona nueva
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cataluña"
              className={inputCls}
            />
          </label>
          <button
            className={btnPrimary}
            disabled={ocupado || !nombre.trim()}
            onClick={() =>
              void accion(async () => {
                await api.crearZona(nombre.trim());
                setNombre("");
              })
            }
          >
            Crear zona
          </button>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Taller</th>
            <th className={thCls}>Zona</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.centros ?? []).length === 0 && (
            <EmptyRow cols={2} text="No hay talleres dados de alta en Administración." />
          )}
          {(datos?.centros ?? []).map((c) => (
            <tr key={c.id} className="border-t border-slate-700">
              <td className={tdCls}>{c.nombre}</td>
              <td className={tdCls}>
                {puedeConfigurar ? (
                  <select
                    value={c.zonaId ?? ""}
                    disabled={ocupado}
                    className={inputCls}
                    onChange={(e) =>
                      void accion(() => api.asignarZona(c.id, e.target.value || null))
                    }
                  >
                    <option value="">Sin zona</option>
                    {(datos?.zonas ?? [])
                      .filter((z) => z.activa)
                      .map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.nombre}
                        </option>
                      ))}
                  </select>
                ) : (
                  ((datos?.zonas ?? []).find((z) => z.id === c.zonaId)?.nombre ?? "—")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
