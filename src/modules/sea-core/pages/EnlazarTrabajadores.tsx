import { useEffect, useMemo, useState } from "react";
import CoreLayout from "../layouts/CoreLayout";
import { apiFetch } from "../../apiFetch";

/**
 * Core → Enlazar trabajadores.
 *
 * Cada módulo tiene sus propios usuarios u operarios. Aquí se dice, uno por
 * uno, qué persona de Core es cada uno, buscándola por su número de
 * trabajador. Se guarda solo el enlace (`employee_id`); el número y el nombre
 * siguen viviendo en Core.
 */

type Empleado = {
  id: string;
  nombre: string;
  numeroTrabajador: string | null;
  companyId: string | null;
  empresa: string | null;
};

type Fila = {
  id: string;
  etiqueta: string;
  detalle: string | null;
  empleado: Empleado | null;
  sugerencia: { employeeId: string; nombre: string; numeroTrabajador: string | null } | null;
};

type Modulo = {
  clave: string;
  nombre: string;
  estado: "ok" | "no_instalado" | "sin_migrar";
  migracion: string;
  filas: Fila[];
};

/** Igual que en el servidor: sin espacios y en mayúsculas. */
const normalizar = (v: string) => v.replace(/\s+/g, "").toUpperCase();

export default function EnlazarTrabajadores() {
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [activo, setActivo] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(true);

  useEffect(() => { void cargar(); }, []);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const r = await apiFetch("/api/core/enlaces");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? "No se han podido leer los módulos.");
      setModulos(d.modulos ?? []);
      setEmpleados(d.empleados ?? []);
      setActivo((a) => a || d.modulos?.find((m: Modulo) => m.estado === "ok")?.clave || d.modulos?.[0]?.clave || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido leer los módulos.");
    } finally {
      setCargando(false);
    }
  }

  /** Cambia una fila en memoria tras guardar, sin recargar toda la pantalla. */
  function actualizarFila(clave: string, filaId: string, empleado: Empleado | null) {
    setModulos((ms) =>
      ms.map((m) =>
        m.clave !== clave
          ? m
          : { ...m, filas: m.filas.map((f) => (f.id === filaId ? { ...f, empleado, sugerencia: null } : f)) }
      )
    );
  }

  const modulo = modulos.find((m) => m.clave === activo);
  const filas = (modulo?.filas ?? []).filter((f) => !soloPendientes || !f.empleado);
  const sinNumero = empleados.filter((e) => !e.numeroTrabajador).length;

  return (
    <CoreLayout>
      <div>
        <h1 className="text-2xl font-bold">Enlazar trabajadores</h1>
        <p className="text-sm text-slate-400">
          Di qué persona de Core es cada usuario de los módulos, por su número de trabajador. Solo se guarda
          el enlace: el nombre y el número siguen estando en Core.
        </p>
      </div>

      {sinNumero > 0 && (
        <p className="rounded-lg border border-amber-700 bg-amber-500/10 p-3 text-sm text-amber-200">
          Hay {sinNumero} empleado{sinNumero === 1 ? "" : "s"} activo{sinNumero === 1 ? "" : "s"} sin número de
          trabajador. No se pueden buscar por número hasta que lo tengan (Core → Empleados → «Sin número»).
        </p>
      )}
      {error && <p className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700">
            <div className="flex overflow-x-auto">
              {modulos.map((m) => {
                const pendientes = m.filas.filter((f) => !f.empleado).length;
                return (
                  <button key={m.clave} onClick={() => setActivo(m.clave)}
                    className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${
                      activo === m.clave ? "border-sky-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
                    }`}>
                    {m.nombre}
                    {m.estado === "ok" ? (
                      <span className={`ml-2 rounded-full px-1.5 text-[11px] ${pendientes ? "bg-amber-500/20 text-amber-300" : "bg-green-500/20 text-green-300"}`}>
                        {pendientes || "✓"}
                      </span>
                    ) : (
                      <span className="ml-2 text-[11px] text-slate-500">—</span>
                    )}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
              <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              Solo sin enlazar
            </label>
          </div>

          {modulo?.estado === "sin_migrar" && (
            <p className="rounded-lg border border-amber-700 bg-amber-500/10 p-3 text-sm text-amber-200">
              Para enlazar {modulo.nombre} falta ejecutar <code>supabase/migrations/{modulo.migracion}</code> en Supabase.
            </p>
          )}
          {modulo?.estado === "no_instalado" && (
            <p className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-400">
              {modulo.nombre} no está instalado en esta base: no hay nada que enlazar.
            </p>
          )}

          {modulo?.estado === "ok" && (
            filas.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                {soloPendientes ? `Todos los usuarios de ${modulo.nombre} están enlazados.` : "No hay usuarios activos."}
              </p>
            ) : (
              <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-slate-300">
                    <tr>
                      <th className="p-3">Usuario en {modulo.nombre}</th>
                      <th className="p-3">Persona de Core</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <FilaEnlace key={f.id} modulo={modulo} fila={f} empleados={empleados}
                        alGuardar={(e) => actualizarFila(modulo.clave, f.id, e)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </CoreLayout>
  );
}

function FilaEnlace({
  modulo, fila, empleados, alGuardar,
}: {
  modulo: Modulo;
  fila: Fila;
  empleados: Empleado[];
  alGuardar: (e: Empleado | null) => void;
}) {
  const [numero, setNumero] = useState("");
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  /** Quién tiene ese número. Puede ser más de uno si son de empresas distintas. */
  const candidatos = useMemo(() => {
    const n = normalizar(numero);
    return n ? empleados.filter((e) => e.numeroTrabajador === n) : [];
  }, [numero, empleados]);

  const destino = candidatos.length === 1 ? candidatos[0] : candidatos.find((c) => c.id === elegido);

  async function guardar(employee: Empleado | null) {
    if (employee === null && !confirm(`¿Quitar el enlace de «${fila.etiqueta}» con ${fila.empleado?.nombre}?`)) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const r = await apiFetch(`/api/core/enlaces/${modulo.clave}/${encodeURIComponent(fila.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employee?.id ?? null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMensaje({ ok: false, texto: d?.error ?? "No se ha podido guardar." });
        return;
      }
      setNumero("");
      setElegido("");
      alGuardar(employee);
    } catch {
      setMensaje({ ok: false, texto: "No se ha podido guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr className="border-t border-slate-700 align-top">
      <td className="p-3">
        <div className="font-medium">{fila.etiqueta}</div>
        {fila.detalle && <div className="text-xs text-slate-500">{fila.detalle}</div>}
      </td>
      <td className="p-3">
        {fila.empleado ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs text-slate-300">
              Nº {fila.empleado.numeroTrabajador ?? "—"}
            </span>
            <span className="font-medium text-green-300">{fila.empleado.nombre}</span>
            {fila.empleado.empresa && <span className="text-xs text-slate-500">{fila.empleado.empresa}</span>}
            <button onClick={() => void guardar(null)} disabled={guardando}
              className="ml-auto rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700/50 disabled:opacity-50">
              Quitar enlace
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={numero} onChange={(e) => { setNumero(e.target.value); setElegido(""); setMensaje(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && destino) void guardar(destino); }}
                placeholder="Nº trabajador" maxLength={20}
                className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-sm" />
              {numero.trim() && candidatos.length === 0 && (
                <span className="text-sm text-amber-300">Nadie tiene ese número.</span>
              )}
              {candidatos.length > 1 && (
                <select value={elegido} onChange={(e) => setElegido(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm">
                  <option value="">Ese número está en varias empresas: elige…</option>
                  {candidatos.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre} · {c.empresa ?? "sin empresa"}</option>
                  ))}
                </select>
              )}
              {destino && (
                <>
                  <span className="text-sm">
                    → <b>{destino.nombre}</b>
                    {destino.empresa && <span className="text-xs text-slate-400"> · {destino.empresa}</span>}
                  </span>
                  <button onClick={() => void guardar(destino)} disabled={guardando}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                    {guardando ? "Enlazando…" : "Enlazar"}
                  </button>
                </>
              )}
            </div>
            {fila.sugerencia && !numero && (
              <div className="text-xs text-slate-400">
                Por nombre — revisar: <span className="text-slate-200">{fila.sugerencia.nombre}</span>
                {fila.sugerencia.numeroTrabajador ? (
                  <button onClick={() => setNumero(fila.sugerencia!.numeroTrabajador!)}
                    className="ml-2 rounded border border-slate-600 px-1.5 py-0.5 text-slate-200 hover:bg-slate-700/50">
                    Usar Nº {fila.sugerencia.numeroTrabajador}
                  </button>
                ) : (
                  <span className="ml-2 text-amber-300">(no tiene número)</span>
                )}
              </div>
            )}
          </div>
        )}
        {mensaje && <p className={`mt-1 text-sm ${mensaje.ok ? "text-green-300" : "text-red-300"}`}>{mensaje.texto}</p>}
      </td>
    </tr>
  );
}
