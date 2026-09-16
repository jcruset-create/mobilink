/**
 * Lo que se puede cambiar sin desplegar: la zona donde se busca el número y
 * los umbrales de confianza.
 *
 * La zona se enseña dibujada sobre una hoja: escribir «x 0.55, alto 0.3» no le
 * dice nada a nadie, y ver el recuadro encima de una A4 se entiende sin
 * explicación. Los valores siguen siendo fracciones de 0 a 1 porque las hojas
 * se escanean a tamaños distintos y una caja en milímetros dejaría de valer al
 * cambiar de escáner.
 */

import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import { Aviso, Cabecera, CheckField, ErrorBox, TextField, btnPrimary, btnSecondary } from "../components/ui";
import type { ZonaOcr } from "../types";

const ZONA_POR_DEFECTO: ZonaOcr = { x: 0.55, y: 0, ancho: 0.45, alto: 0.3 };

export default function Configuracion() {
  const { config, fijarConfig } = useOrManuales();

  const [zona, setZona] = useState<ZonaOcr>(config?.zona ?? ZONA_POR_DEFECTO);
  const [automatico, setAutomatico] = useState(String(config?.umbrales.automatico ?? 90));
  const [revision, setRevision] = useState(String(config?.umbrales.revision ?? 70));
  const [orPorBloc, setOrPorBloc] = useState(String(config?.orPorBloc ?? 25));
  const [ocrConIa, setOcrConIa] = useState(config?.ocrConIa ?? true);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (!config) return;
    setZona(config.zona);
    setAutomatico(String(config.umbrales.automatico));
    setRevision(String(config.umbrales.revision));
    setOrPorBloc(String(config.orPorBloc));
    setOcrConIa(config.ocrConIa);
  }, [config]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const r = await api.guardarConfig({
        zona,
        umbralAutomatico: Number(automatico),
        umbralRevision: Number(revision),
        orPorBloc: Number(orPorBloc),
        ocrConIa,
      });
      fijarConfig(r.config);
      setGuardado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar la configuración");
    } finally {
      setGuardando(false);
    }
  }

  const campoZona = (clave: keyof ZonaOcr, rotulo: string) => (
    <TextField
      label={rotulo}
      type="number"
      value={String(zona[clave])}
      onChange={(v) => setZona((z) => ({ ...z, [clave]: Number(v) }))}
    />
  );

  const cruzados = Number(revision) > Number(automatico);

  return (
    <div className="max-w-4xl">
      <Cabecera titulo="Configuración" descripcion="Dónde se busca el número de OR y cuánto hay que fiarse para archivar solo.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => setZona(ZONA_POR_DEFECTO)}>
          <RotateCcw className="h-4 w-4" /> Zona por defecto
        </button>
        <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => void guardar()} disabled={guardando}>
          <Save className="h-4 w-4" /> {guardando ? "Guardando…" : "Guardar"}
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}
      {guardado && !error && (
        <div className="mb-3">
          <Aviso tono="bien">Guardado. Se aplica a los escaneos siguientes; lo ya archivado no se toca.</Aviso>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* La zona, dibujada */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Zona donde está el número</div>
          <p className="mb-3 text-[13px] text-slate-400">
            La parte de la hoja donde el bloc lleva impreso el número de OR. Lo que se lee ahí puntúa más alto que lo que
            aparece en el resto de la página.
          </p>

          <div className="mb-3 flex justify-center">
            {/* Una A4 a escala: 210×297 se dibuja como 180×255 px. */}
            <div className="relative h-[255px] w-[180px] rounded border border-slate-500 bg-slate-100/90">
              <div
                className="absolute rounded border-2 border-teal-500 bg-teal-500/30"
                style={{
                  left: `${zona.x * 100}%`,
                  top: `${zona.y * 100}%`,
                  width: `${zona.ancho * 100}%`,
                  height: `${zona.alto * 100}%`,
                }}
              />
              <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-slate-500">hoja A4</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {campoZona("x", "Desde la izquierda (0–1)")}
            {campoZona("y", "Desde arriba (0–1)")}
            {campoZona("ancho", "Ancho (0–1)")}
            {campoZona("alto", "Alto (0–1)")}
          </div>
        </div>

        {/* Los umbrales */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Confianza</div>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Archiva solo desde (%)" value={automatico} onChange={setAutomatico} type="number" />
              <TextField label="Revisión desde (%)" value={revision} onChange={setRevision} type="number" />
            </div>
            <ul className="mt-3 space-y-1 text-[12px] text-slate-400">
              <li>
                <b className="text-emerald-400">Desde {automatico} %</b>: se archiva sin preguntar.
              </li>
              <li>
                <b className="text-orange-300">
                  De {revision} % a {Math.max(Number(automatico) - 1, 0)} %
                </b>
                : se archiva, pero marcado para que alguien lo confirme.
              </li>
              <li>
                <b className="text-rose-400">Por debajo de {revision} %</b>: no se archiva; va a documentos pendientes.
              </li>
            </ul>
            {cruzados && (
              <div className="mt-2">
                <Aviso tono="aviso">
                  El umbral de revisión está por encima del automático. Se aplicará el más prudente de los dos.
                </Aviso>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lectura y blocs</div>
            <div className="space-y-3">
              <TextField label="OR por bloc" value={orPorBloc} onChange={setOrPorBloc} type="number" />
              <CheckField
                label="Leer con IA las hojas escaneadas sin texto"
                checked={ocrConIa}
                onChange={setOcrConIa}
              />
              <p className="text-[12px] text-slate-400">
                Un PDF con texto se lee siempre de su texto, que es exacto. La IA sólo entra cuando la hoja es una imagen;
                sin ella, un escaneado sin texto acaba siempre en documentos pendientes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
