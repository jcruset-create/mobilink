/**
 * Dar de alta un bloc.
 *
 * El formulario propone el número y la OR inicial que tocan, y en cuanto se
 * escribe la inicial enseña la final y el «25 OR» calculados. Es lo que pide
 * el encargo y además evita el error más caro del módulo: teclear mal el
 * rango y descubrirlo cuando ya se han escaneado hojas.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import { Cabecera, ErrorBox, TextAreaField, TextField, btnPrimary, btnSecondary } from "../components/ui";

export default function NuevoBloc() {
  const navegar = useNavigate();
  const { config, refrescarIndicadores } = useOrManuales();

  const [numeroBloc, setNumeroBloc] = useState("");
  const [orInicial, setOrInicial] = useState("");
  const [cantidad, setCantidad] = useState(String(config?.orPorBloc ?? 25));
  const [responsable, setResponsable] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { propuesta } = await api.propuestaBloc();
        if (!vivo) return;
        setNumeroBloc(propuesta.numeroBloc);
        setCantidad(String(propuesta.cantidadOr));
        if (propuesta.orInicial !== null) setOrInicial(String(propuesta.orInicial));
      } catch {
        // Sin propuesta se rellena a mano; no es motivo para no dejar crear.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const inicial = Number(orInicial);
  const cuantas = Number(cantidad);
  const rangoValido = Number.isInteger(inicial) && inicial > 0 && Number.isInteger(cuantas) && cuantas > 0;
  const orFinal = rangoValido ? inicial + cuantas - 1 : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!rangoValido) {
      setError("Escribe la OR inicial: el resto del rango se calcula solo.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const ficha = await api.crearBloc({
        numeroBloc: numeroBloc.trim() || undefined,
        orInicial: inicial,
        cantidadOr: cuantas,
        responsableNombre: responsable.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      await refrescarIndicadores();
      navegar(`/or-manuales/blocs/${ficha.bloc.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el bloc");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Cabecera titulo="Nuevo bloc" descripcion="Al guardar se crean solas las OR del rango, todas pendientes.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => navegar("/or-manuales/blocs")}>
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      <form onSubmit={guardar} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Número de bloc" value={numeroBloc} onChange={setNumeroBloc} placeholder="002" />
          <TextField label="OR inicial" value={orInicial} onChange={setOrInicial} placeholder="1026" type="number" />
          <TextField label="OR por bloc" value={cantidad} onChange={setCantidad} type="number" />
          <TextField label="Responsable (opcional)" value={responsable} onChange={setResponsable} placeholder="Quién se lo va a llevar" />
        </div>

        {/* Lo que se va a crear, en grande: es la comprobación antes de guardar. */}
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-3">
          {orFinal === null ? (
            <p className="text-[13px] text-teal-100">Escribe la OR inicial y aquí saldrá el rango que se va a crear.</p>
          ) : (
            <p className="text-[15px] font-bold text-teal-100">
              OR <span className="tabular-nums">{inicial}</span> – <span className="tabular-nums">{orFinal}</span>
              <span className="ml-2 text-[13px] font-normal text-teal-200/80">({cuantas} OR)</span>
            </p>
          )}
        </div>

        <TextAreaField label="Observaciones" value={observaciones} onChange={setObservaciones} rows={3} />

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => navegar("/or-manuales/blocs")}>
            Cancelar
          </button>
          <button type="submit" className={btnPrimary} disabled={guardando || !rangoValido}>
            {guardando ? "Creando…" : "Crear el bloc"}
          </button>
        </div>
      </form>
    </div>
  );
}
