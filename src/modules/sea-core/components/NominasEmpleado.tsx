import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../apiFetch";

/**
 * La pestaña «Nóminas» de la ficha: las nóminas guardadas de esta persona.
 *
 * Solo se monta para el superadministrador, y el servidor solo se las da a
 * él: aquí no se decide quién puede verlas, solo se pintan.
 *
 * En la lista no hay ningún importe (el servidor no los guarda): periodo, días
 * y quién la subió. El PDF se pide al servidor con la sesión delante cada vez
 * que se abre —no hay una dirección que se pueda copiar—, y cada apertura
 * queda apuntada.
 */

type Nomina = {
  id: string;
  anio: number;
  mes: number;
  periodo: string;
  dias: number | null;
  subidaAt: string;
  subidaNombre: string | null;
  vistaAt: string | null;
  vistaNombre: string | null;
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES") : "");
const diaYHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** «Del 01 al 30 de Noviembre de 2.026» → «Del 01 al 30»: el mes ya va en grande. */
const tramo = (periodo: string) => periodo.replace(/\s+de\s+\p{L}+\s+de\s+[\d.]+\s*$/u, "");

export default function NominasEmpleado({ employeeId, nombre }: { employeeId: string; nombre: string }) {
  const [nominas, setNominas] = useState<Nomina[]>([]);
  const [disponible, setDisponible] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ocupada, setOcupada] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const r = await apiFetch(`/api/core/empleados/${employeeId}/nominas`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? "No se han podido leer las nóminas.");
      setDisponible(d.disponible !== false);
      setNominas(d.nominas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido leer las nóminas.");
    } finally {
      setCargando(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function pedirPdf(n: Nomina): Promise<Blob> {
    const r = await apiFetch(`/api/core/empleados/${employeeId}/nominas/${n.id}/pdf`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error ?? "No se ha podido abrir la nómina.");
    }
    return r.blob();
  }

  async function ver(n: Nomina) {
    // La pestaña se abre ANTES de pedir el PDF: si se abriera después, el
    // navegador la tomaría por una ventana emergente y la bloquearía.
    const pestana = window.open("", "_blank");
    setOcupada(n.id);
    setError("");
    try {
      const url = URL.createObjectURL(await pedirPdf(n));
      if (pestana) pestana.location.href = url;
      else window.location.href = url;
      // La dirección solo vale en este navegador; se suelta al rato.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
      void cargar();
    } catch (e) {
      pestana?.close();
      setError(e instanceof Error ? e.message : "No se ha podido abrir la nómina.");
    } finally {
      setOcupada("");
    }
  }

  async function descargar(n: Nomina) {
    setOcupada(n.id);
    setError("");
    try {
      const url = URL.createObjectURL(await pedirPdf(n));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Nomina_${n.anio}-${String(n.mes).padStart(2, "0")}_${nombre.trim().replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido descargar la nómina.");
    } finally {
      setOcupada("");
    }
  }

  async function borrar(n: Nomina) {
    if (!confirm(`¿Borrar la nómina de ${MESES[n.mes - 1]} de ${n.anio} (${tramo(n.periodo)}) de ${nombre}?\n\nSe borra el PDF de la ficha. Se puede volver a subir importando otra vez las nóminas de ese mes.`)) return;
    setOcupada(n.id);
    setError("");
    try {
      const r = await apiFetch(`/api/core/empleados/${employeeId}/nominas/${n.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "No se ha podido borrar.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido borrar.");
    } finally {
      setOcupada("");
    }
  }

  const boton = "rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700/50 disabled:opacity-50";

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-slate-200">Nóminas</h2>
        <p className="text-xs text-slate-400">
          Solo las ve el superadministrador, y queda apuntado quién abre cada una. Se guardan al importar el PDF del mes
          desde Empleados → «Importar de nóminas».
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : !disponible ? (
        <p className="text-sm text-amber-300">
          Falta ejecutar en Supabase la migración <code>core_nominas_empleado.sql</code>.
        </p>
      ) : nominas.length === 0 ? (
        <p className="text-sm text-slate-500">No hay ninguna nómina guardada de {nombre}.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="p-2 font-medium">Periodo</th>
                <th className="p-2 font-medium">Días</th>
                <th className="p-2 font-medium">Subida</th>
                <th className="p-2 font-medium">Última vez vista</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {nominas.map((n) => (
                <tr key={n.id} className="border-t border-slate-700">
                  <td className="p-2">
                    <div className="font-semibold">{MESES[n.mes - 1]} {n.anio}</div>
                    <div className="text-xs text-slate-400">{tramo(n.periodo)}</div>
                  </td>
                  <td className="p-2 text-slate-300">{n.dias ?? "—"}</td>
                  <td className="p-2 text-xs text-slate-400">{dia(n.subidaAt)}{n.subidaNombre ? ` · ${n.subidaNombre}` : ""}</td>
                  <td className="p-2 text-xs text-slate-400">
                    {n.vistaAt ? `${diaYHora(n.vistaAt)}${n.vistaNombre ? ` · ${n.vistaNombre}` : ""}` : "Nadie la ha abierto"}
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1.5">
                      <button className={boton} disabled={ocupada !== ""} onClick={() => void ver(n)}>Ver</button>
                      <button className={boton} disabled={ocupada !== ""} onClick={() => void descargar(n)}>Descargar</button>
                      <button className={`${boton} text-rose-300`} disabled={ocupada !== ""} onClick={() => void borrar(n)}>Borrar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
