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
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import logoCentral from "../../assets/logo-central.png";
import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  Coins,
  FileDown,
  Home,
  Landmark,
  Network,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Card,
  EmptyRow,
  ErrorBox,
  TableWrap,
  btnPrimary,
  btnSecondary,
  inputCls,
  thCls,
  tdCls,
} from "../administracion/components/ui";
// `Aviso` vive en las piezas de la caja, que a su vez reexporta las de
// Administración. Se reutiliza en vez de copiarse: es el mismo lenguaje visual
// y el mismo componente, no uno parecido.
import { Aviso } from "../cash/components/ui";
import { euros } from "../cash/utils/money";
import * as api from "./api";
// El nombre de quien mira sale de la misma tabla que en el hub: es el mismo
// dato y no tiene por qué venir por la API de Central.
import { supabase } from "../administracion/services/supabase";

const enlace = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
    isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
  }`;

export default function CentralApp() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState("");

  /*
   * Quién está mirando. A mejor esfuerzo: si la consulta falla, la cabecera se
   * pinta sin nombre en vez de romperse. Central no deja de servir porque no
   * sepamos cómo se llama quien la abre.
   */
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const id = data.session?.user?.id;
        if (!id) return;
        const { data: u } = await supabase
          .from("app_usuarios")
          .select("username, nombre")
          .eq("id", id)
          .maybeSingle();
        if (activo && u) setUsuario(u.username || u.nombre || "");
      } catch {
        /* sin nombre se vive igual */
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/*
        * La cabecera vive aquí y no en cada pantalla a propósito: es el marco
        * de las diez rutas hijas, así que se pone una vez y sale en todas.
        * Duplicarla por pantalla es como se acaba teniendo diez cabeceras que
        * se parecen pero no son iguales.
        *
        * Misma barra que el resto de módulos: pegajosa, con el logotipo a la
        * izquierda y a la derecha quién eres, qué versión tienes cargada y la
        * salida al menú. Los tres datos que se piden por teléfono cuando algo
        * falla, y la puerta para volver sin tocar la barra del navegador.
        */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        {/* El logotipo ya lleva el nombre dentro: repetirlo al lado sobra. */}
        <img
          src={logoCentral}
          alt="Mobilink Central Cash Pro"
          className="h-7 w-auto shrink-0 md:h-8"
        />

        <div className="flex flex-wrap items-center gap-2">
          {usuario && (
            <span className="text-[12px] font-semibold text-white">👤 {usuario}</span>
          )}

          {/*
            La versión del build que está sirviendo el navegador. Sin ella, un
            "sigue sin funcionar" puede ser un fallo de verdad o una caché
            vieja, y no hay forma de distinguirlo sin mirar el bundle. En
            blanco y no en gris: se lee por teléfono.
          */}
          <span
            title="Versión de la aplicación que tienes cargada"
            className="hidden text-[10px] tabular-nums text-white sm:inline"
          >
            v{__APP_VERSION__}
          </span>

          <button
            onClick={() => navigate("/inicio")}
            title="Volver al inicio"
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700"
          >
            <Home className="h-4 w-4" /> Inicio
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4">
        <p className="mb-4 text-[11px] text-slate-400">
          Supervisión de la red. Las cajas siguen siendo dueñas de su jornada: aquí solo se mira.
        </p>

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
          <NavLink to="/central/prevision" className={enlace}>
            <TrendingUp size={15} /> Previsión
          </NavLink>
          <NavLink to="/central/informes" className={enlace}>
            <FileDown size={15} /> Informes
          </NavLink>
          <NavLink to="/central/estado" className={enlace}>
            <Activity size={15} /> Estado
          </NavLink>
          <NavLink to="/central/incidencias" className={enlace}>
            <Bell size={15} /> Incidencias
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
          <Route path="prevision" element={<Prevision />} />
          <Route path="informes" element={<Informes />} />
          <Route path="estado" element={<Estado />} />
          <Route path="incidencias" element={<Incidencias />} />
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

// ── Previsión, salud y reparto ─────────────────────────────────────────────

/**
 * Lo que va a hacer falta.
 *
 * Tres cosas en una pantalla porque se miran juntas: qué caja se queda sin
 * cambio, cómo de sana está la red, y si algo se puede resolver moviendo dinero
 * entre talleres en vez de yendo al banco.
 */
function Prevision() {
  const [pred, setPred] = useState<Awaited<ReturnType<typeof api.prediccion>> | null>(null);
  const [salud, setSalud] = useState<Awaited<ReturnType<typeof api.puntuacion>> | null>(null);
  const [rep, setRep] = useState<Awaited<ReturnType<typeof api.reparto>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([api.prediccion(7), api.puntuacion(), api.reparto(7)]);
      setPred(p);
      setSalud(s);
      setRep(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la previsión");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;

  const nota = (p: number | null) =>
    p == null ? "text-slate-500" : p >= 80 ? "text-emerald-400" : p >= 50 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <Card
          title="Salud de la red"
          value={salud?.puntos == null ? "—" : String(salud.puntos)}
          accent={nota(salud?.puntos ?? null)}
          hint={`${salud?.conDatos ?? 0} cajas puntuadas${
            (salud?.sinDatos ?? 0) > 0 ? ` · ${salud!.sinDatos} sin datos todavía` : ""
          }`}
        />
        <Card
          title="Se quedan sin cambio"
          value={String((pred?.cajas ?? []).filter((c) => c.irAlBancoAntesDe).length)}
          hint="en los próximos 7 días"
        />
        <Card
          title="Traslados propuestos"
          value={String(rep?.traslados.length ?? 0)}
          hint="entre cajas, sin pasar por el banco"
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Cuándo se queda sin cambio cada caja
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Caja</th>
              <th className={`${thCls} text-right`}>En monedas</th>
              <th className={`${thCls} text-right`}>Aguanta</th>
              <th className={`${thCls} text-right`}>Falta</th>
              <th className={thCls}>Ir al banco antes de</th>
              <th className={thCls}>Por qué</th>
            </tr>
          </thead>
          <tbody>
            {(pred?.cajas ?? []).length === 0 && (
              <EmptyRow cols={6} text="Todavía no hay jornadas suficientes para predecir." />
            )}
            {(pred?.cajas ?? []).map((c) => (
              <tr key={c.registerId} className="border-t border-slate-700">
                <td className={tdCls}>#{c.registerId}</td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {euros(c.calderillaActualCentimos)}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {c.diasDeAutonomia == null ? "—" : `${c.diasDeAutonomia} d`}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {c.faltaCentimos > 0 ? euros(c.faltaCentimos) : "—"}
                </td>
                <td className={`${tdCls} ${c.irAlBancoAntesDe ? "text-amber-400" : "text-slate-500"}`}>
                  {c.irAlBancoAntesDe ?? "no hace falta"}
                </td>
                {/*
                  * La explicación va en la tabla y no escondida en un icono: una
                  * propuesta que no se entiende no se corrige, se ignora.
                  */}
                <td className={`${tdCls} text-[11px] text-slate-500`}>{c.explicacion}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Traslados que ahorrarían un viaje al banco
        </h2>
        <p className="text-[11px] text-slate-500">
          Son propuestas. Moverlo de verdad se hace desde la caja de origen, y queda como un traslado
          con su portador: mientras viaja, el dinero no está en ninguna de las dos.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>De</th>
              <th className={thCls}>A</th>
              <th className={thCls}>Piezas</th>
              <th className={`${thCls} text-right`}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {(rep?.traslados ?? []).length === 0 && (
              <EmptyRow cols={4} text="Nada que mover: lo que falta hay que traerlo del banco." />
            )}
            {(rep?.traslados ?? []).map((t, i) => (
              <tr key={i} className="border-t border-slate-700">
                <td className={tdCls}>#{t.desdeRegisterId}</td>
                <td className={tdCls}>#{t.haciaRegisterId}</td>
                <td className={`${tdCls} text-[11px]`}>
                  {t.piezas.map((p) => `${p.cantidad}×${pieza(p.valor)}`).join(", ")}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(t.importeCentimos)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Las cajas con peor nota
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Caja</th>
              <th className={thCls}>Taller</th>
              <th className={`${thCls} text-right`}>Nota</th>
              <th className={thCls}>Qué le resta</th>
            </tr>
          </thead>
          <tbody>
            {(salud?.peores ?? []).length === 0 && (
              <EmptyRow cols={4} text="Ninguna caja con datos suficientes todavía." />
            )}
            {(salud?.peores ?? []).map((c) => (
              <tr key={c.registerId} className="border-t border-slate-700">
                <td className={tdCls}>{c.caja ?? `#${c.registerId}`}</td>
                <td className={tdCls}>{c.centro ?? "—"}</td>
                <td className={`${tdCls} text-right tabular-nums ${nota(c.puntos)}`}>{c.puntos}</td>
                <td className={`${tdCls} text-[11px] text-slate-400`}>
                  {c.motivos.length === 0
                    ? "nada"
                    : c.motivos.map((m) => `${m.detalle} (−${m.puntos})`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

// ── Informes ───────────────────────────────────────────────────────────────

function Informes() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.kpis>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.kpis(desde, hasta));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los indicadores");
    }
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-5">
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </label>
        {/*
          * Un enlace normal y no un `fetch`: el navegador se encarga de la
          * descarga y del nombre del fichero, y el CSV va firmado por la sesión
          * como cualquier otra petición.
          */}
        <a className={btnSecondary} href={api.urlExportacion(desde, hasta)}>
          Descargar jornadas (CSV)
        </a>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Jornadas cerradas" value={String(datos?.jornadas ?? 0)} />
        <Card title="Efectivo para el banco" value={euros(datos?.efectivoCentimos ?? 0)} />
        {/*
          * El descuadre va en valor absoluto: un día que sobran 20 € y otro que
          * faltan 20 € no son una red que cuadra, son dos días que no cuadraron.
          */}
        <Card
          title="Descuadre acumulado"
          value={euros(datos?.descuadreCentimos ?? 0)}
          accent="text-amber-400"
          hint={`${datos?.jornadasConDescuadre ?? 0} jornadas, sin compensar signos`}
        />
        <Card
          title="Días hasta el banco"
          value={datos?.diasHastaElBanco == null ? "—" : String(datos.diasHastaElBanco)}
          hint="dinero parado en el cajón"
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Por taller</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Taller</th>
              <th className={`${thCls} text-right`}>Jornadas</th>
              <th className={`${thCls} text-right`}>Efectivo</th>
              <th className={`${thCls} text-right`}>Descuadre</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.centros ?? []).length === 0 && (
              <EmptyRow cols={4} text="Sin jornadas cerradas en el periodo." />
            )}
            {(datos?.centros ?? []).map((c) => (
              <tr key={c.centroId ?? "sin"} className="border-t border-slate-700">
                <td className={tdCls}>
                  {c.centro ?? <span className="text-amber-400">sin taller</span>}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{c.jornadas}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(c.efectivoCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(c.descuadreCentimos)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

// ── Estado del sistema ─────────────────────────────────────────────────────

/**
 * El atasco, no el pulso.
 *
 * Las colas fallan en silencio y creciendo: la caja sigue cobrando y las
 * pantallas siguen pintando, y lo único que pasa es que Central se queda atrás.
 */
function Estado() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.salud>> | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.salud());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error consultando el estado");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;

  const color = (e: string) =>
    e === "OK" ? "text-emerald-400" : e === "RETRASO" || e === "DEGRADADO" ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-4">
      <Card
        title="Estado general"
        value={datos?.estado ?? "—"}
        accent={color(datos?.estado ?? "OK")}
        hint={`La base responde en ${datos?.baseDeDatosMs ?? "—"} ms${
          datos?.ultimoEventoRecibidoMs
            ? ` · último evento ${new Date(datos.ultimoEventoRecibidoMs).toLocaleString("es-ES")}`
            : " · todavía no ha llegado ningún evento"
        }`}
      />

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Cola</th>
            <th className={`${thCls} text-right`}>Pendientes</th>
            <th className={`${thCls} text-right`}>En error</th>
            <th className={`${thCls} text-right`}>Lo más viejo</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.colas ?? []).map((c) => (
            <tr key={c.nombre} className="border-t border-slate-700">
              <td className={tdCls}>{c.nombre}</td>
              <td className={`${tdCls} text-right tabular-nums`}>{c.pendientes}</td>
              <td className={`${tdCls} text-right tabular-nums ${c.enError > 0 ? "text-rose-400" : ""}`}>
                {c.enError}
              </td>
              {/*
                * El retraso se mide en TIEMPO y no en filas: cien pendientes de
                * hace treinta segundos es una tarde normal y tres de hace dos
                * días es una integración rota.
                */}
              <td className={`${tdCls} text-right tabular-nums`}>
                {c.retrasoMinutos == null
                  ? "—"
                  : c.retrasoMinutos >= 60
                    ? `${Math.round(c.retrasoMinutos / 60)} h`
                    : `${c.retrasoMinutos} min`}
              </td>
              <td className={`${tdCls} ${color(c.estado)}`}>{c.estado.toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ── Incidencias y reglas ───────────────────────────────────────────────────

const TIPOS: { valor: string; label: string; ayuda: string; unidad: "euros" | "dias" }[] = [
  {
    valor: "DESCUADRE",
    label: "Descuadre de arqueo",
    ayuda: "Salta si el último arqueo descuadra más de este importe, sobre o falte.",
    unidad: "euros",
  },
  {
    valor: "TRANSITO_DIAS",
    label: "Dinero fuera del cajón",
    ayuda: "Días que puede estar fuera un cambio del banco o una entrega antes de avisar.",
    unidad: "dias",
  },
  {
    valor: "SIN_CERRAR_DIAS",
    label: "Caja sin cerrar",
    ayuda: "Días sin cerrar jornada.",
    unidad: "dias",
  },
  {
    valor: "PENDIENTE_BANCO_DIAS",
    label: "Sin llevar al banco",
    ayuda: "Días que puede esperar un cierre sin ingresarse.",
    unidad: "dias",
  },
  {
    valor: "CALDERILLA_MINIMA",
    label: "Poca calderilla",
    ayuda: "Avisa cuando las monedas de la caja bajan de este importe.",
    unidad: "euros",
  },
  {
    valor: "AUTONOMIA_DIAS",
    label: "Se queda sin cambio",
    ayuda:
      "Días de cambio que le quedan según la predicción. Un importe fijo no sabe si esa caja gasta 5 € o 50 € al día; los días sí.",
    unidad: "dias",
  },
  {
    valor: "COLA_ATASCADA_MINUTOS",
    label: "Cola de envío atascada",
    ayuda:
      "Minutos que lleva esperando lo más viejo por enviar. Es la única avería que no se nota: la caja sigue cobrando y Central se queda atrás.",
    unidad: "dias",
  },
];

const etiquetaTipo = (t: string) => TIPOS.find((x) => x.valor === t)?.label ?? t;
const unidadDe = (t: string) => TIPOS.find((x) => x.valor === t)?.unidad ?? "euros";
const valorLegible = (tipo: string, v: number) =>
  unidadDe(tipo) === "euros"
    ? euros(v)
    : tipo === "COLA_ATASCADA_MINUTOS"
      ? `${v} min`
      : `${v} día${v === 1 ? "" : "s"}`;

/**
 * La bandeja, y debajo las reglas que la llenan.
 *
 * Las reglas van DEBAJO a propósito: lo que se abre esta pantalla a mirar es
 * qué está pasando, no cómo está configurado. Se baja a los umbrales el día que
 * un aviso sobra o falta, y ese día no es todos los días.
 */
function Incidencias() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.alertas>> | null>(null);
  const [todas, setTodas] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [tipo, setTipo] = useState(TIPOS[0].valor);
  const [umbral, setUmbral] = useState("20");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.alertas(todas));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las incidencias");
    }
  }, [todas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const puedeGestionar = datos?.permisos?.includes("central.incidents.manage") ?? false;
  const puedeConfigurar = datos?.permisos?.includes("central.rules.configure") ?? false;

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
    <div className="space-y-5">
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
          Ver también las cerradas
        </label>
        <button
          className={btnSecondary}
          disabled={ocupado}
          onClick={() => void accion(api.evaluarAhora)}
        >
          Evaluar ahora
        </button>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Qué pasa</th>
            <th className={thCls}>Caja</th>
            <th className={`${thCls} text-right`}>Valor</th>
            <th className={`${thCls} text-right`}>Umbral</th>
            <th className={thCls}>Desde</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.incidencias ?? []).length === 0 && (
            <EmptyRow cols={6} text="No hay ninguna incidencia abierta." />
          )}
          {(datos?.incidencias ?? []).map((i) => (
            <tr key={i.id} className="border-t border-slate-700">
              <td className={tdCls}>
                {etiquetaTipo(i.tipo)}
                {i.ambitoRegla && i.ambitoRegla !== "EMPRESA" && (
                  <span className="ml-2 text-[11px] text-slate-500">
                    regla de {i.ambitoRegla.toLowerCase()}
                  </span>
                )}
              </td>
              <td className={tdCls}>{i.caja ?? `#${i.registerId}`}</td>
              <td className={`${tdCls} text-right tabular-nums text-amber-400`}>
                {valorLegible(i.tipo, i.valor)}
              </td>
              <td className={`${tdCls} text-right tabular-nums text-slate-500`}>
                {valorLegible(i.tipo, i.umbral)}
              </td>
              <td className={`${tdCls} text-[11px] text-slate-500`}>
                {new Date(i.abiertaEnMs).toLocaleDateString("es-ES")}
              </td>
              <td className={tdCls}>
                {i.estado === "RESUELTA" ? (
                  <span className="text-slate-500">
                    resuelta{i.cerradaMotivo === "AUTO" ? " (sola)" : ""}
                  </span>
                ) : puedeGestionar ? (
                  <span className="flex gap-2">
                    {i.estado === "ABIERTA" && (
                      <button
                        className="text-[11px] text-sky-400 hover:underline"
                        disabled={ocupado}
                        onClick={() => void accion(() => api.cambiarIncidencia(i.id, "RECONOCIDA"))}
                      >
                        vista
                      </button>
                    )}
                    <button
                      className="text-[11px] text-emerald-400 hover:underline"
                      disabled={ocupado}
                      onClick={() => void accion(() => api.cambiarIncidencia(i.id, "RESUELTA"))}
                    >
                      resolver
                    </button>
                  </span>
                ) : (
                  i.estado.toLowerCase()
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <Avisos />

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Reglas de la empresa
        </h2>
        <p className="text-[11px] text-slate-500">
          Cada taller o caja puede tener la suya, y entonces manda la más concreta: la empresa avisa
          a partir de 20 €, pero una gasolinera que mueve diez veces más necesita otro listón o el
          aviso salta cada día y deja de leerse.
        </p>

        {puedeConfigurar && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Qué vigilar
              </span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                {unidadDe(tipo) === "euros"
                  ? "Importe (€)"
                  : tipo === "COLA_ATASCADA_MINUTOS"
                    ? "Minutos"
                    : "Días"}
              </span>
              <input
                value={umbral}
                onChange={(e) => setUmbral(e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
            <button
              className={btnPrimary}
              disabled={ocupado}
              onClick={() =>
                void accion(() =>
                  api.guardarRegla({
                    tipo,
                    ambito: "EMPRESA",
                    umbral:
                      unidadDe(tipo) === "euros"
                        ? Math.round(Number(umbral.replace(",", ".")) * 100)
                        : Math.round(Number(umbral)),
                  })
                )
              }
            >
              Guardar regla
            </button>
            <p className="w-full text-[11px] text-slate-500">
              {TIPOS.find((t) => t.valor === tipo)?.ayuda}
            </p>
          </div>
        )}

        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Qué vigila</th>
              <th className={thCls}>Ámbito</th>
              <th className={`${thCls} text-right`}>Umbral</th>
              <th className={thCls}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.reglas ?? []).length === 0 && (
              <EmptyRow cols={4} text="No hay ninguna regla: sin reglas no hay avisos." />
            )}
            {(datos?.reglas ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-700">
                <td className={tdCls}>{etiquetaTipo(r.tipo)}</td>
                <td className={tdCls}>{r.ambito.toLowerCase()}</td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {valorLegible(r.tipo, r.umbral)}
                </td>
                <td className={tdCls}>
                  {r.activa ? (
                    <span className="text-emerald-400">activa</span>
                  ) : (
                    <span className="text-slate-500">apagada</span>
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

/**
 * A quién se avisa.
 *
 * Va dentro de Incidencias y no en una pantalla propia porque es la misma
 * conversación: qué se vigila, y a quién se le cuenta.
 */
function Avisos() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.canales>> | null>(null);
  const [destino, setDestino] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.canales());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los avisos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pendientes = datos?.cola.find((c) => c.estado === "PENDIENTE")?.total ?? 0;

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        A quién se avisa
      </h2>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/*
        * Sin SMTP los avisos se acumulan esperando. No es un error, pero hay
        * que decirlo: si no, alguien pone destinatarios y se queda esperando
        * correos que no van a salir.
        */}
      {datos && !datos.smtp && (
        <Aviso tono="aviso">
          No hay correo saliente configurado en el servidor, así que los avisos se quedan en cola
          esperando. Se enviarán solos en cuanto se configure; no se pierde ninguno.
        </Aviso>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Correo
          </span>
          <input
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            placeholder="responsable@taller.com"
            className={inputCls}
          />
        </label>
        <button
          className={btnPrimary}
          disabled={ocupado || !destino.includes("@")}
          onClick={() => {
            setOcupado(true);
            void api
              .guardarCanal({ destino: destino.trim() })
              .then(() => {
                setDestino("");
                return cargar();
              })
              .catch((e) => setError(e instanceof Error ? e.message : "No se ha podido guardar"))
              .finally(() => setOcupado(false));
          }}
        >
          Añadir
        </button>
        {pendientes > 0 && (
          <span className="text-[11px] text-slate-400">{pendientes} aviso(s) en cola</span>
        )}
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Correo</th>
            <th className={thCls}>Qué recibe</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {(datos?.canales ?? []).length === 0 && (
            <EmptyRow cols={3} text="Nadie recibe avisos todavía." />
          )}
          {(datos?.canales ?? []).map((c) => (
            <tr key={c.id} className="border-t border-slate-700">
              <td className={tdCls}>{c.destino}</td>
              <td className={tdCls}>
                {c.tipos.length === 0
                  ? "todo"
                  : c.tipos.map((t) => etiquetaTipo(t)).join(", ")}
              </td>
              <td className={tdCls}>
                {c.activo ? (
                  <span className="text-emerald-400">activo</span>
                ) : (
                  <span className="text-slate-500">apagado</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </section>
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

  /*
   * Las cajas sin taller, arriba. Son las que hay que resolver, y en una red
   * con muchas cajas enterrarlas por orden alfabético es esconderlas.
   */
  const cajasOrdenadas = [...(datos?.cajas ?? [])].sort((a, b) => {
    const sinA = a.centroId == null ? 0 : 1;
    const sinB = b.centroId == null ? 0 : 1;
    if (sinA !== sinB) return sinA - sinB;
    return (a.nombre ?? "").localeCompare(b.nombre ?? "");
  });

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

      {/*
        * Y un piso más abajo: qué taller es el de cada caja.
        *
        * Esta tabla existe porque el backfill de la fase 1 no adivina — empareja
        * por nombre exacto y lo que no casa queda sin taller. Hasta ahora la
        * única salida era SQL a mano: la migración remitía a «Configuración» y
        * esa pantalla no estaba construida. Las cajas sin taller salen PRIMERO,
        * que son las que hay que resolver.
        */}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Caja</th>
            <th className={thCls}>Taller</th>
          </tr>
        </thead>
        <tbody>
          {cajasOrdenadas.length === 0 && (
            <EmptyRow cols={2} text="No hay cajas dadas de alta." />
          )}
          {cajasOrdenadas.map((c) => (
            <tr key={c.registerId} className="border-t border-slate-700">
              <td className={tdCls}>
                {c.nombre ?? `Caja ${c.registerId}`}
                {c.codigo && <span className="ml-2 text-[11px] text-slate-500">{c.codigo}</span>}
              </td>
              <td className={tdCls}>
                {puedeConfigurar ? (
                  <select
                    value={c.centroId ?? ""}
                    disabled={ocupado}
                    className={inputCls}
                    onChange={(e) =>
                      void accion(() => api.asignarCentro(c.registerId, e.target.value || null))
                    }
                  >
                    {/* En ámbar como en la red: sin taller no es un estado neutro. */}
                    <option value="">Sin taller</option>
                    {(datos?.centros ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  (c.centroNombre ?? <span className="text-amber-400">sin taller</span>)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
