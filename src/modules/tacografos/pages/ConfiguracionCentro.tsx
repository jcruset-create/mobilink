/**
 * Datos del centro técnico: la hoja CONFIGURACIÓN del libro.
 *
 * Se escriben una vez. Los documentos leen de aquí en vez de llevar el nombre
 * del centro y su contraseña incrustados en el texto, que es como estaban en el
 * Excel original y por lo que cambiarlos obligaba a repasar cuatro documentos.
 */

import { useState } from "react";
import { Save } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import type { Centro } from "../types";

const CAMPOS: Array<{ k: keyof Centro; etiqueta: string; ayuda?: string }> = [
  { k: "nombre", etiqueta: "Empresa" },
  { k: "centroTecnico", etiqueta: "Centro técnico" },
  { k: "numCentro", etiqueta: "Contraseña / nº de centro", ayuda: "Aparece en los tres documentos." },
  { k: "direccion1", etiqueta: "Dirección (línea 1)" },
  { k: "direccion2", etiqueta: "Dirección (línea 2)" },
  { k: "ciudad", etiqueta: "Código postal y ciudad" },
  { k: "ciudadFirma", etiqueta: "Ciudad de firma", ayuda: 'Sin código postal: "En Tarragona, a…".' },
  { k: "email", etiqueta: "Email del centro" },
  { k: "responsableTecnico", etiqueta: "Responsable técnico" },
  { k: "destinatarioAdmin", etiqueta: "Destinatario en la administración" },
  { k: "urlTramite", etiqueta: "Trámite Generalitat (petició genèrica)" },
  { k: "urlTramiteOvt", etiqueta: "Trámite Generalitat (formulario OVT)" },
];

const CLASE_ENTRADA =
  "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";

export default function ConfiguracionCentro() {
  const { centro, puede, fijarCentro } = useTacografos();
  /*
   * El borrador sólo existe cuando el usuario ha tocado algo; mientras tanto se
   * pinta lo que hay en el contexto. Así no hace falta un efecto que copie el
   * contexto al estado local y se quede desincronizado cuando aquél cambia.
   */
  const [borrador, setBorrador] = useState<Centro | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const d = borrador ?? centro;
  if (!d) return <p className="text-[13px] text-slate-400">Cargando…</p>;

  const editable = puede("tacografos.config.edit");

  async function guardar() {
    if (!d) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const { centro: nuevo } = await api.guardarCentro(d);
      fijarCentro(nuevo);
      // Se suelta el borrador: a partir de aquí manda lo que devolvió el
      // servidor, que es lo que van a leer los documentos.
      setBorrador(null);
      setGuardado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Centro técnico</h1>
        {editable && (
          <button
            onClick={() => void guardar()}
            disabled={guardando}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {guardando ? "Guardando…" : "Guardar"}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[13px] text-red-200">
          {error}
        </p>
      )}
      {guardado && (
        <p className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-[13px] text-emerald-200">
          Guardado.
        </p>
      )}
      {!editable && (
        <p className="mb-3 rounded-lg border border-slate-600 bg-slate-800/60 p-3 text-[13px] text-slate-300">
          Sólo lectura: no tienes permiso para cambiar la configuración del centro.
        </p>
      )}

      <div className="grid gap-3 rounded-xl border border-slate-800 p-3 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <label key={c.k} className="block text-[12px]">
            <span className="mb-1 block text-slate-400">{c.etiqueta}</span>
            <input
              className={CLASE_ENTRADA}
              value={d[c.k]}
              disabled={!editable}
              onChange={(e) => setBorrador({ ...d, [c.k]: e.target.value })}
            />
            {c.ayuda && <span className="mt-1 block text-[11px] text-slate-500">{c.ayuda}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
