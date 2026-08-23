/**
 * Trae los datos del informe del anexo II que emite la extranet de VDO.
 *
 * El técnico ya tiene ese impreso: o el PDF descargado, o una foto. Copiar a
 * mano la matrícula, el bastidor y el nº de serie es donde se cuelan las
 * erratas que acaban en un certificado firmado.
 *
 * Lo leído **no se aplica solo**. Se enseña primero, con el aviso de lo que no
 * se ha encontrado, y el técnico decide. En documentación legal, un dato mal
 * leído en silencio es peor que teclearlo.
 */

import { useRef, useState } from "react";
import { AlertTriangle, Check, FileUp, ScanLine } from "lucide-react";
import * as api from "../services/api";
import type { DatosExpediente, Importacion } from "../types";

type Props = { onAplicar: (datos: Partial<DatosExpediente>) => void };

/** Qué se enseña de lo leído, en el orden en que se mira. */
const RESUMEN: Array<[keyof DatosExpediente, string]> = [
  ["numInforme", "Nº informe"],
  ["tipo", "Tipo"],
  ["matricula", "Matrícula"],
  ["bastidor", "Bastidor"],
  ["empresaCliente", "Empresa"],
  ["tacMarca", "Marca"],
  ["tacModelo", "Modelo"],
  ["tacSerie", "Nº serie"],
  ["fechaInforme", "Fecha informe"],
  ["tecnico", "Técnico"],
  ["fechaTransferencia", "Fecha transferencia"],
  ["fechaEnvio", "Fecha envío"],
];

const ETIQUETA_TIPO: Record<string, string> = {
  transferencia: "Transferencia correcta",
  intransferibilidad: "Intransferibilidad",
};

function valorLegible(clave: keyof DatosExpediente, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (clave === "tipo") return ETIQUETA_TIPO[String(v)] ?? String(v);
  if (String(clave).startsWith("fecha")) return String(v).split("-").reverse().join("/");
  return String(v);
}

export default function ImportarInforme({ onAplicar }: Props) {
  const entrada = useRef<HTMLInputElement | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [r, setR] = useState<Importacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subir(fichero: File) {
    setLeyendo(true);
    setError(null);
    setR(null);
    try {
      setR(await api.importarInforme(fichero));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido leer el informe");
    } finally {
      setLeyendo(false);
      // Se limpia para poder volver a subir el mismo fichero tras corregirlo.
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-sky-800/60">
      <h2 className="flex items-center gap-2 bg-sky-900/40 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-sky-200">
        <ScanLine className="h-4 w-4" /> Importar el informe de la extranet
      </h2>
      <div className="p-3">
        <p className="mb-3 text-[12px] text-slate-400">
          Sube el PDF del anexo II descargado de VDO, o una foto del impreso. Se rellenan doce
          campos del expediente; lo revisas antes de guardar.
        </p>

        <input
          ref={entrada}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
        <button
          onClick={() => entrada.current?.click()}
          disabled={leyendo}
          className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <FileUp className="h-4 w-4" />
          {leyendo ? "Leyendo el informe…" : "Elegir PDF o foto"}
        </button>

        {error && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
            {error}
          </p>
        )}

        {r && (
          <div className="mt-3 rounded-lg border border-slate-700 p-3">
            <p className="mb-2 flex items-center gap-2 text-[12px] text-slate-400">
              <Check className="h-4 w-4 text-emerald-400" />
              {r.origen === "pdf_texto"
                ? "Leído del texto del PDF, sin interpretar nada."
                : "Leído de la imagen: repásalo con más cuidado."}
              <span className="text-slate-500">
                {r.encontradas} de {r.total} campos del impreso
              </span>
            </p>

            <dl className="mb-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
              {RESUMEN.map(([clave, etiqueta]) => (
                <div key={String(clave)} className="flex gap-2">
                  <dt className="min-w-[8.5rem] text-slate-400">{etiqueta}</dt>
                  <dd
                    className={
                      valorLegible(clave, r.datos[clave]) === "—"
                        ? "text-slate-600"
                        : "font-semibold"
                    }
                  >
                    {valorLegible(clave, r.datos[clave])}
                  </dd>
                </div>
              ))}
            </dl>

            {r.avisos.length > 0 && (
              <p className="mb-3 flex items-start gap-2 text-[12px] text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No se han encontrado {r.avisos.length} campos del impreso. Los que estén en
                  blanco arriba, tecléalos.
                </span>
              </p>
            )}

            <button
              onClick={() => {
                onAplicar(r.datos);
                setR(null);
              }}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-emerald-500"
            >
              Rellenar el formulario con estos datos
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
