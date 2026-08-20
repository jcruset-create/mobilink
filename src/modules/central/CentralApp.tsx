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
import { Building2, CalendarDays, Network } from "lucide-react";
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
