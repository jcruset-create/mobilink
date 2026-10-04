/**
 * Usuarios y cajas: el taller de cada usuario y, dentro de su taller, sus cajas.
 *
 * La regla (ver `server/cash/asignaciones.ts`):
 *
 *  · Todos se limitan a su taller si lo tienen. Sin taller = toda la empresa.
 *  · Cajero y consulta, además, solo a sus cajas asignadas —cuando la empresa
 *    lo enciende—. Responsable y admin supervisan: todas las de su taller.
 *
 * El interruptor viene apagado: si se encendiera antes de asignar, nadie del
 * mostrador podría abrir su caja. Por eso la pantalla cuenta a los que siguen
 * sin caja y el servidor no deja encenderlo mientras haya alguno (salvo que se
 * fuerce a sabiendas).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, ShieldOff } from "lucide-react";
import { Aviso, ErrorBox, TableWrap, thCls, tdCls, inputCls, btnPrimary, btnSecondary, btnMini } from "./ui";
import type { Accesos, AccesoUsuario } from "../types";
import * as api from "../services/api";

const ROL: Record<string, string> = {
  admin: "Admin",
  responsable: "Responsable",
  cajero: "Cajero",
  consulta: "Consulta",
};

type Borrador = { centroId: string | null; cajas: number[] };

const mismo = (a: Borrador, u: AccesoUsuario) =>
  a.centroId === u.centroId &&
  a.cajas.length === u.cajas.length &&
  [...a.cajas].sort((x, y) => x - y).every((c, i) => c === [...u.cajas].sort((x, y) => x - y)[i]);

export default function AccesoCajas() {
  const [datos, setDatos] = useState<Accesos | null>(null);
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [forzable, setForzable] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.accesos());
      setBorradores({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los usuarios");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const nombreTaller = useMemo(
    () => new Map((datos?.talleres ?? []).map((t) => [t.id, t.nombre])),
    [datos]
  );

  if (!datos) {
    return error ? <ErrorBox>{error}</ErrorBox> : null;
  }

  const borradorDe = (u: AccesoUsuario): Borrador =>
    borradores[u.userId] ?? { centroId: u.centroId, cajas: u.cajas };

  function cambiar(u: AccesoUsuario, b: Borrador) {
    setBorradores((prev) => ({ ...prev, [u.userId]: b }));
  }

  async function guardar(u: AccesoUsuario) {
    const b = borradorDe(u);
    setOcupado(u.userId);
    setError("");
    try {
      await api.fijarAcceso(u.userId, b.centroId, b.cajas);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setOcupado("");
    }
  }

  async function interruptor(exigir: boolean, forzar = false) {
    setOcupado("interruptor");
    setError("");
    setForzable(false);
    try {
      await api.fijarExigirAsignacion(exigir, forzar);
      await cargar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se ha podido cambiar";
      setError(msg);
      // El servidor se para si hay cajeros sin caja: se ofrece forzarlo.
      if (exigir && !forzar && /sin ninguna caja/i.test(msg)) setForzable(true);
    } finally {
      setOcupado("");
    }
  }

  const limitado = datos.ambitoCentroId != null;
  const cajasActivas = datos.cajas.filter((c) => c.activa);

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Usuarios y cajas</h2>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3">
        {datos.exigirAsignacion ? (
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <ShieldOff className="h-5 w-5 shrink-0 text-slate-500" />
        )}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-slate-100">
            Cajeros y consulta: solo sus cajas —{" "}
            {datos.exigirAsignacion ? (
              <span className="text-emerald-300">encendido</span>
            ) : (
              <span className="text-slate-400">apagado</span>
            )}
          </div>
          <div className="text-[12px] text-slate-400">
            {datos.exigirAsignacion
              ? "Un cajero o un usuario de consulta solo ve y toca las cajas que tiene marcadas. Responsables y admins, todas las de su taller."
              : "Ahora cada usuario ve todas las cajas de su taller (o de la empresa si no tiene taller). Asigna las cajas y después enciéndelo."}
          </div>
        </div>
        {!limitado && (
          <div className="flex gap-2">
            {datos.exigirAsignacion ? (
              <button
                className={btnSecondary}
                disabled={ocupado !== ""}
                onClick={() => void interruptor(false)}
              >
                Apagar
              </button>
            ) : (
              <button
                className={btnPrimary}
                disabled={ocupado !== ""}
                onClick={() => void interruptor(true)}
              >
                Encender
              </button>
            )}
            {forzable && (
              <button
                className={btnSecondary}
                disabled={ocupado !== ""}
                onClick={() => {
                  if (
                    window.confirm(
                      "Los usuarios sin caja no podrán trabajar hasta que se la asignes. ¿Encenderlo igualmente?"
                    )
                  ) {
                    void interruptor(true, true);
                  }
                }}
              >
                Encender igualmente
              </button>
            )}
          </div>
        )}
      </div>

      {datos.sinCaja > 0 && (
        <Aviso tono="aviso">
          {datos.sinCaja === 1
            ? "Hay 1 usuario (cajero o consulta) sin ninguna caja asignada."
            : `Hay ${datos.sinCaja} usuarios (cajero o consulta) sin ninguna caja asignada.`}{" "}
          {datos.exigirAsignacion
            ? "Ahora mismo no puede trabajar: asígnale su caja."
            : "Asígnasela antes de encender la regla."}
        </Aviso>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Usuario</th>
            <th className={thCls}>Rol</th>
            <th className={thCls}>Taller</th>
            <th className={thCls}>Cajas</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {datos.usuarios.length === 0 && (
            <tr>
              <td className={tdCls} colSpan={5}>
                Nadie tiene acceso a Mobilink Cash todavía. Se da desde Administración → Usuarios.
              </td>
            </tr>
          )}
          {datos.usuarios.map((u) => {
            const b = borradorDe(u);
            const cajasDelTaller = cajasActivas.filter((c) => !b.centroId || c.centroId === b.centroId);
            const sucio = !mismo(b, u);
            const sinCaja = u.limitadoPorCaja && b.cajas.length === 0;
            return (
              <tr key={u.userId} className={u.activo ? "" : "opacity-50"}>
                <td className={tdCls}>
                  <div className="font-medium text-slate-100">{u.nombre}</div>
                  <div className="text-[11px] text-slate-500">
                    @{u.username}
                    {!u.activo && " · dado de baja"}
                  </div>
                </td>
                <td className={tdCls}>{ROL[u.rol ?? ""] ?? u.rol ?? "—"}</td>
                <td className={tdCls}>
                  <select
                    value={b.centroId ?? ""}
                    disabled={limitado || ocupado !== ""}
                    onChange={(e) => {
                      const centroId = e.target.value || null;
                      // Las cajas que no son del taller nuevo se caen: un
                      // usuario tiene un taller, y sus cajas dentro de él.
                      const validas = new Set(
                        datos.cajas.filter((c) => !centroId || c.centroId === centroId).map((c) => c.id)
                      );
                      cambiar(u, { centroId, cajas: b.cajas.filter((c) => validas.has(c)) });
                    }}
                    className={inputCls}
                  >
                    {!limitado && <option value="">Toda la empresa</option>}
                    {datos.talleres
                      .filter((t) => t.activo || t.id === b.centroId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                        </option>
                      ))}
                  </select>
                </td>
                <td className={tdCls}>
                  {u.limitadoPorCaja ? (
                    <div className="flex flex-wrap gap-1.5">
                      {cajasDelTaller.length === 0 && (
                        <span className="text-[12px] text-slate-500">Este taller no tiene cajas.</span>
                      )}
                      {cajasDelTaller.map((c) => {
                        const marcada = b.cajas.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={ocupado !== ""}
                            onClick={() =>
                              cambiar(u, {
                                ...b,
                                cajas: marcada ? b.cajas.filter((x) => x !== c.id) : [...b.cajas, c.id],
                              })
                            }
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] ${
                              marcada
                                ? "border-sky-500 bg-sky-500/20 text-sky-100"
                                : "border-slate-600 text-slate-400 hover:border-slate-400"
                            }`}
                          >
                            {marcada && <Check className="h-3 w-3" />}
                            {c.nombre}
                            {!b.centroId && c.centroId && (
                              <span className="text-slate-500">· {nombreTaller.get(c.centroId) ?? ""}</span>
                            )}
                          </button>
                        );
                      })}
                      {sinCaja && (
                        <span className="self-center text-[11px] text-amber-300">Sin caja</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[12px] text-slate-400">
                      {b.centroId
                        ? `Todas las de ${nombreTaller.get(b.centroId) ?? "su taller"}`
                        : "Todas las de la empresa"}
                    </span>
                  )}
                </td>
                <td className={tdCls}>
                  {sucio && (
                    <div className="flex gap-1">
                      <button
                        className={btnMini}
                        disabled={ocupado !== ""}
                        onClick={() => void guardar(u)}
                      >
                        {ocupado === u.userId ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        className={btnMini}
                        disabled={ocupado !== ""}
                        onClick={() =>
                          setBorradores((prev) => {
                            const { [u.userId]: _, ...resto } = prev;
                            return resto;
                          })
                        }
                      >
                        Deshacer
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <p className="text-[11px] text-slate-500">
        Quién entra en Mobilink Cash y con qué rol se decide en Administración → Usuarios. Aquí, dónde
        trabaja cada uno.
      </p>
    </section>
  );
}
