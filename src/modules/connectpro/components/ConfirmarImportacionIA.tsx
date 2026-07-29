/**
 * Connect Pro — ventana de confirmación de la importación por IA.
 *
 * La IA nunca escribe sola en el formulario: propone, y el operador decide
 * campo a campo qué entra, pudiendo corregir el valor antes de aceptarlo.
 * Mismo criterio que la revisión de sugerencias de Mobilink Assist.
 */

import { useMemo, useState } from "react";
import { Card, Badge, Button, Input } from "./ui";

export type PropuestaIA = {
  /** Clave del formulario a la que corresponde. */
  key: string;
  label: string;
  /** Valor propuesto por la IA, ya normalizado a texto. */
  valor: string;
  /** Lo que ya hay escrito en el formulario (si hay algo). */
  actual: string;
};

export type ExtraIA = { campo: string; valor: string };

export default function ConfirmarImportacionIA({
  origen, propuestas, extras, resumen, confianza, onCancelar, onConfirmar,
}: {
  /** De dónde viene lo analizado, para que el operador sepa qué está revisando. */
  origen: string;
  propuestas: PropuestaIA[];
  extras: ExtraIA[];
  resumen?: string | null;
  confianza?: "high" | "medium" | "low" | null;
  onCancelar: () => void;
  /** Devuelve los campos aceptados (ya editados) y los extras marcados. */
  onConfirmar: (campos: Record<string, string>, extras: ExtraIA[]) => void;
}) {
  // Por defecto entra todo lo que no pisa un dato ya escrito por el operador
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(propuestas.filter((p) => !p.actual).map((p) => p.key)),
  );
  const [valores, setValores] = useState<Record<string, string>>(
    () => Object.fromEntries(propuestas.map((p) => [p.key, p.valor])),
  );
  const [extrasMarcados, setExtrasMarcados] = useState<Set<number>>(
    () => new Set(extras.map((_, i) => i)),
  );

  const conflictos = useMemo(() => propuestas.filter((p) => p.actual).length, [propuestas]);
  const total = marcados.size + extrasMarcados.size;

  const alternar = (key: string) =>
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });

  const confirmar = () => {
    const campos: Record<string, string> = {};
    for (const p of propuestas) {
      if (marcados.has(p.key)) campos[p.key] = valores[p.key] ?? p.valor;
    }
    onConfirmar(campos, extras.filter((_, i) => extrasMarcados.has(i)));
  };

  const vacio = propuestas.length === 0 && extras.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <Card className="flex max-h-[85vh] w-full max-w-3xl flex-col p-0">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Revisar datos detectados</h2>
            <p className="text-[12px] text-slate-400">
              {origen} · Marca lo que quieras importar. Nada se escribe hasta que confirmes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {confianza && (
              <Badge className={
                confianza === "high" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : confianza === "medium" ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-red-500/40 bg-red-500/10 text-red-300"
              }>
                Confianza: {confianza === "high" ? "alta" : confianza === "medium" ? "media" : "baja"}
              </Badge>
            )}
            <button onClick={onCancelar} className="rounded-full px-2 text-slate-500 hover:text-slate-200" aria-label="Cerrar">✕</button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-4">
          {resumen && (
            <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-[13px] text-cyan-200">
              {resumen}
            </div>
          )}

          {vacio ? (
            <p className="py-8 text-center text-sm text-slate-500">
              La IA no ha encontrado datos aprovechables.
            </p>
          ) : (
            <>
              {conflictos > 0 && (
                <p className="mb-2 text-[12px] text-amber-300">
                  {conflictos} campo{conflictos !== 1 ? "s" : ""} ya {conflictos !== 1 ? "tienen" : "tiene"} valor en el
                  formulario: vienen desmarcados para no pisar lo que has escrito.
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                {propuestas.map((p) => {
                  const marcado = marcados.has(p.key);
                  return (
                    <div
                      key={p.key}
                      className={`rounded-lg border px-3 py-2 ${marcado ? "border-cyan-600/40 bg-slate-900/60" : "border-slate-700 bg-slate-900/20"}`}
                    >
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternar(p.key)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">{p.label}</div>
                          <Input
                            value={valores[p.key] ?? ""}
                            onChange={(e) => setValores((v) => ({ ...v, [p.key]: e.target.value }))}
                            className="mt-1 w-full"
                            disabled={!marcado}
                          />
                          {p.actual && (
                            <div className="mt-1 text-[11px] text-amber-300">
                              Sustituiría a: <span className="text-slate-300">{p.actual}</span>
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>

              {extras.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-1.5 text-[13px] font-semibold text-slate-300">
                    Otros datos leídos ({extras.length})
                  </h3>
                  <p className="mb-2 text-[12px] text-slate-500">
                    No encajan en ningún campo del formulario; se añadirán a las observaciones internas.
                  </p>
                  <div className="flex flex-col gap-1">
                    {extras.map((x, i) => (
                      <label key={i} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-[13px]">
                        <input
                          type="checkbox"
                          checked={extrasMarcados.has(i)}
                          onChange={() => setExtrasMarcados((prev) => {
                            const s = new Set(prev);
                            if (s.has(i)) s.delete(i); else s.add(i);
                            return s;
                          })}
                        />
                        <span className="text-slate-300"><b className="text-slate-100">{x.campo}:</b> {x.valor}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-700 p-4">
          <div className="flex gap-2">
            {propuestas.length > 0 && (
              <>
                <Button variant="ghost" onClick={() => setMarcados(new Set(propuestas.map((p) => p.key)))}>
                  Marcar todo
                </Button>
                <Button variant="ghost" onClick={() => setMarcados(new Set())}>Desmarcar todo</Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
            <Button onClick={confirmar} disabled={total === 0}>
              Importar {total > 0 ? `${total} dato${total !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
