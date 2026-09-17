// Editor de "accesos por módulo" (módulo + rol + pantallas + empresa).
//
// Vive aquí y no dentro de UsuariosApp porque ahora lo usan DOS pantallas: la
// de Usuarios de Administración y la ficha del empleado de Core, desde la que
// se da el acceso directamente. Duplicarlo significaría que añadir un módulo
// al catálogo arreglaría una pantalla y dejaría la otra con la lista vieja.
import { MODULOS_APP } from "../config/modulosApp";
import { type AccesoEdit } from "./accesosModulosHelpers";

export default function AccesosModulos({ accesos, empresas, onChange }: {
  accesos: Record<string, AccesoEdit>;
  empresas: { id: string; nombre: string }[];
  onChange: (accesos: Record<string, AccesoEdit>) => void;
}) {
  function setAcceso(modulo: string, patch: Partial<AccesoEdit>) {
    onChange({ ...accesos, [modulo]: { ...accesos[modulo], ...patch } });
  }

  function togglePantalla(modulo: string, pantalla: string) {
    setAcceso(modulo, {
      marcadas: { ...accesos[modulo].marcadas, [pantalla]: !accesos[modulo].marcadas[pantalla] },
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {MODULOS_APP.map((m) => {
        const a = accesos[m.key];
        if (!a) return null;
        return (
          <div
            key={m.key}
            className={`rounded-xl border p-3 ${a.activo ? "border-sky-500/60 bg-sky-500/5" : "border-slate-700"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.activo}
                  onChange={(e) => setAcceso(m.key, { activo: e.target.checked })}
                  className="h-4 w-4 accent-sky-500"
                />
                <span className={`text-sm font-bold ${a.activo ? "text-slate-100" : "text-slate-500"}`}>{m.label}</span>
              </label>
              {a.activo && (
                <div className="flex items-center gap-2">
                  <select
                    value={a.rol}
                    onChange={(e) => setAcceso(m.key, { rol: e.target.value })}
                    aria-label={`Rol en ${m.label}`}
                    className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[12px] text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {m.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  {m.conEmpresa && a.rol === "cliente" && (
                    <select
                      value={a.empresa_id}
                      onChange={(e) => setAcceso(m.key, { empresa_id: e.target.value })}
                      aria-label={`Empresa en ${m.label}`}
                      className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[12px] text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="">Empresa…</option>
                      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>

            {a.activo && m.pantallas.length > 0 && (
              <div className="mt-2 grid gap-1 sm:grid-cols-3">
                {m.pantallas.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={a.marcadas[p.key]}
                      onChange={() => togglePantalla(m.key, p.key)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
