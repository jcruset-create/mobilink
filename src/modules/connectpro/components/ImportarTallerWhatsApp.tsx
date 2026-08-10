/**
 * Alta de taller a partir de un WhatsApp.
 *
 * Reúne las tres piezas del flujo -captura, talleres detectados y ventana de
 * confirmación- para que las dos pantallas que dan de alta talleres (la ficha
 * de empresa y el listado de la red) compartan exactamente el mismo
 * comportamiento y no se separen con el tiempo.
 *
 * No crea nada: devuelve los campos confirmados para que la página los deje en
 * su formulario. El taller solo existe cuando el operador pulsa Añadir.
 */

import { useState } from "react";
import { Card, Badge, Button } from "./ui";
import CapturaWhatsApp, { type ImportacionTalleres, type TallerPropuesto } from "./CapturaWhatsApp";
import ConfirmarImportacionIA, { type PropuestaIA } from "./ConfirmarImportacionIA";

/** Campos del alta que la importación sabe rellenar, con su etiqueta. */
export const CAMPOS_IMPORTABLES = [
  { key: "name", label: "Nombre del taller" },
  { key: "commercialNetwork", label: "Red comercial" },
  { key: "address", label: "Dirección" },
  { key: "postalCode", label: "Código postal" },
  { key: "city", label: "Municipio" },
  { key: "province", label: "Provincia" },
  { key: "latitude", label: "Latitud" },
  { key: "longitude", label: "Longitud" },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Email" },
  { key: "openingHours", label: "Horario" },
  { key: "services", label: "Servicios (códigos)" },
] as const;

export type CampoImportable = (typeof CAMPOS_IMPORTABLES)[number]["key"];

export type ImportacionConfirmada = {
  /** Solo los campos que el operador ha marcado, como texto de formulario. */
  campos: Partial<Record<CampoImportable, string>>;
  /** Empresa reconocida por nombre, si la página no la tenía ya fijada. */
  providerCompanyId: number | null;
  /** Nombre de empresa leído que NO existe en Central (para avisar). */
  empresaDesconocida: string | null;
  /** Datos sueltos aceptados, ya formateados para las observaciones. */
  observaciones: string;
};

const ESTILO_CONFIANZA: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-red-500/40 bg-red-500/10 text-red-300",
};
const TEXTO_CONFIANZA: Record<string, string> = { high: "alta", medium: "media", low: "baja" };

/** Valor propuesto para un campo, ya como texto del formulario. */
function valorPropuesto(t: TallerPropuesto, key: CampoImportable): string {
  if (key === "services") return t.campos.services.join(", ");
  const v = (t.campos as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}

export default function ImportarTallerWhatsApp({ empresas, empresaFijada, valoresActuales, onImportar }: {
  /** Empresas de Central, para reconocer por nombre la que lea la IA. */
  empresas?: Array<{ id: number; name: string }>;
  /** Si la página ya sabe de qué empresa es el taller, no hay nada que resolver. */
  empresaFijada?: boolean;
  /** Lo que ya hay escrito en el formulario, para avisar de lo que se pisaría. */
  valoresActuales?: Partial<Record<CampoImportable, string>>;
  onImportar: (resultado: ImportacionConfirmada) => void;
}) {
  const [importacion, setImportacion] = useState<ImportacionTalleres | null>(null);
  const [revisando, setRevisando] = useState<TallerPropuesto | null>(null);

  const propuestasDe = (t: TallerPropuesto): PropuestaIA[] =>
    CAMPOS_IMPORTABLES
      .map(({ key, label }) => ({
        key, label,
        valor: valorPropuesto(t, key),
        actual: valoresActuales?.[key] ?? "",
      }))
      .filter((p) => p.valor !== "");

  const confirmar = (campos: Record<string, string>, extras: Array<{ campo: string; valor: string }>) => {
    const leida = revisando?.campos.companyName ?? null;
    const empresa = leida && !empresaFijada
      ? empresas?.find((e) => e.name.trim().toLowerCase() === leida.trim().toLowerCase())
      : undefined;

    onImportar({
      campos: campos as Partial<Record<CampoImportable, string>>,
      providerCompanyId: empresa?.id ?? null,
      empresaDesconocida: leida && !empresaFijada && !empresa ? leida : null,
      observaciones: extras.map((x) => `${x.campo}: ${x.valor}`).join("\n"),
    });
    setRevisando(null);
  };

  return (
    <>
      <CapturaWhatsApp
        purpose="workshop"
        onTalleres={(r) => { setImportacion(r); if (r.data.length === 1) setRevisando(r.data[0]); }}
      />

      {importacion && (importacion.data.length > 0 || importacion.avisos.length > 0) && (
        <Card className="mb-4 border-cyan-500/30 p-4">
          <h2 className="mb-2 text-sm font-semibold text-cyan-300">
            Talleres detectados en el WhatsApp ({importacion.data.length})
          </h2>
          {importacion.resumen && <p className="mb-2 text-[13px] text-slate-400">{importacion.resumen}</p>}

          {importacion.avisos.map((a, i) => (
            <p key={i} className="mb-1 text-[13px] text-amber-300">⚠ {a}</p>
          ))}

          <div className="mt-2 flex flex-col gap-2">
            {importacion.data.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-100">{t.campos.name ?? "(sin nombre)"}</div>
                  <div className="text-[12px] text-slate-500">
                    {[t.campos.city, t.campos.province, t.campos.phone].filter(Boolean).join(" · ")
                      || "Sin ubicación ni teléfono"}
                  </div>
                  {t.duplicados.length > 0 && (
                    <div className="text-[12px] text-amber-300">
                      Posible duplicado de {t.duplicados.map((d) => `${d.name} (${d.motivos.join(", ")})`).join("; ")}
                    </div>
                  )}
                </div>
                {t.confidence && (
                  <Badge className={ESTILO_CONFIANZA[t.confidence]}>
                    Confianza: {TEXTO_CONFIANZA[t.confidence]}
                  </Badge>
                )}
                <Button onClick={() => setRevisando(t)}>Revisar</Button>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Button variant="ghost" onClick={() => setImportacion(null)}>Descartar la importación</Button>
          </div>
        </Card>
      )}

      {revisando && (
        <ConfirmarImportacionIA
          origen={`WhatsApp · ${revisando.campos.name ?? "taller sin nombre"}`}
          propuestas={propuestasDe(revisando)}
          extras={revisando.datosDetectados}
          resumen={
            revisando.duplicados.length
              ? `Ojo: se parece a ${revisando.duplicados.map((d) => `${d.name} (${d.motivos.join(", ")})`).join("; ")}.`
              : importacion?.resumen ?? null
          }
          confianza={revisando.confidence}
          onCancelar={() => setRevisando(null)}
          onConfirmar={confirmar}
        />
      )}
    </>
  );
}
