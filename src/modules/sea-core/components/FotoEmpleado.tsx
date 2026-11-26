import { useState } from "react";
import { apiFetch } from "../../apiFetch";
import CamaraSelfie from "./CamaraSelfie";

/**
 * La foto del empleado en la ficha de Core: verla, hacerla, subirla o quitarla.
 *
 * Lo que se suba pasa por la misma normalización que la del enlace de alta
 * (cuadrada, mismo tamaño, cara centrada). Si la comprobación dice que no se
 * ve una cara, aquí —y solo aquí— el administrador puede usarla igualmente.
 */
export default function FotoEmpleado({
  employeeId,
  nombre,
  url,
  onCambio,
  tamano = 96,
  enColumna = false,
}: {
  employeeId: string;
  nombre: string;
  /** Dirección firmada de la foto actual, si tiene. */
  url: string | null;
  /** La foto ha cambiado: la nueva dirección, o null si se ha quitado. */
  onCambio: (url: string | null) => void;
  tamano?: number;
  /** Los botones debajo de la foto (cabecera de la ficha) en vez de al lado. */
  enColumna?: boolean;
}) {
  const [camara, setCamara] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  /** La foto que la comprobación no ha dado por buena, por si se quiere usar igual. */
  const [rechazada, setRechazada] = useState<Blob | null>(null);

  async function subir(foto: Blob, forzar = false) {
    setCamara(false);
    setTrabajando(true);
    setMensaje(null);
    setRechazada(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append("foto", foto, "foto.jpg");
      if (forzar) cuerpo.append("forzar", "1");
      const r = await apiFetch(`/api/core/empleados/${employeeId}/foto`, { method: "POST", body: cuerpo });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d?.code === "FOTO_NO_VALE") setRechazada(foto);
        setMensaje({ ok: false, texto: d?.error ?? "No se ha podido guardar la foto." });
        return;
      }
      onCambio(d.url ?? null);
      setMensaje({ ok: true, texto: d.aviso ? `Guardada. ${d.aviso}` : "Foto guardada." });
    } catch {
      setMensaje({ ok: false, texto: "No se ha podido guardar la foto." });
    } finally {
      setTrabajando(false);
    }
  }

  async function quitar() {
    if (!confirm(`¿Quitar la foto de ${nombre}?`)) return;
    setTrabajando(true);
    setMensaje(null);
    setRechazada(null);
    try {
      const r = await apiFetch(`/api/core/empleados/${employeeId}/foto`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onCambio(null);
    } catch {
      setMensaje({ ok: false, texto: "No se ha podido quitar la foto." });
    } finally {
      setTrabajando(false);
    }
  }

  const boton = "rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700/50 disabled:opacity-50";

  return (
    <div className={enColumna ? "flex w-28 shrink-0 flex-col items-start gap-2" : "flex items-start gap-3"}>
      {url ? (
        <img src={url} alt={`Foto de ${nombre}`} width={tamano} height={tamano}
          className="shrink-0 rounded-xl bg-slate-700 object-cover" style={{ width: tamano, height: tamano }} />
      ) : (
        <div className="flex shrink-0 items-center justify-center rounded-xl bg-slate-700 font-bold text-slate-300"
          style={{ width: tamano, height: tamano, fontSize: tamano * 0.4 }}>
          {nombre.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={trabajando} onClick={() => setCamara(true)} className={boton}>Hacer foto</button>
          <label className={`${boton} cursor-pointer ${trabajando ? "pointer-events-none opacity-50" : ""}`}>
            Subir archivo
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void subir(f);
              }} />
          </label>
          {url && <button type="button" disabled={trabajando} onClick={() => void quitar()} className={boton}>Quitar</button>}
        </div>
        {trabajando && <p className="text-xs text-slate-400">Guardando la foto…</p>}
        {mensaje && <p className={`text-xs ${mensaje.ok ? "text-green-300" : "text-amber-300"}`}>{mensaje.texto}</p>}
        {rechazada && (
          <button type="button" onClick={() => void subir(rechazada, true)} className={boton}>Usarla igualmente</button>
        )}
        {!url && !mensaje && !trabajando && (
          <p className="text-xs text-slate-500">Sin foto. Se recorta y se centra sola al guardarla.</p>
        )}
      </div>
      {camara && <CamaraSelfie onFoto={(f) => void subir(f)} onCancelar={() => setCamara(false)} />}
    </div>
  );
}
