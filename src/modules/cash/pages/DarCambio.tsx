/**
 * Dar cambio en el mostrador.
 *
 * Alguien trae un billete de 20 € y se lleva 10 + 5 + 5 € en monedas; o al
 * revés, trae un puñado de monedas y se lleva el billete. La caja no gana ni
 * pierde un céntimo —el neto es CERO— pero su composición sí cambia, y eso es
 * exactamente lo que registra la operación: qué piezas entraron y qué piezas
 * salieron, con su número propio y su hueco en el histórico.
 *
 * No es un movimiento de entrada ni de salida —por eso no vive en la pantalla
 * de Movimientos, donde cada tipo o entra o sale— y no es un cobro: no hay
 * factura ni cliente que deba nada.
 */

import { useState } from "react";
import { Repeat, Wand2 } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import { Aviso, AvisoCartuchos, BotonAccion, Cabecera, ErrorBox } from "../components/ui";
import { euros, totalLineas } from "../utils/money";
import type { AperturaCartucho } from "../types";
import * as api from "../services/api";

export default function DarCambio() {
  const { jornada, denominaciones, refrescar, puede } = useCash();

  const [recibido, setRecibido] = useState<CantidadesPorValor>({});
  const [entregado, setEntregado] = useState<CantidadesPorValor>({});
  /** Envases que la propuesta avisa que habrá que abrir. */
  const [aperturas, setAperturas] = useState<AperturaCartucho[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ultimo, setUltimo] = useState<{ numero: string; aperturas: AperturaCartucho[] } | null>(
    null
  );

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }
  if (!puede("cash.movement.create")) {
    return <Aviso tono="aviso">No tienes permiso para dar cambio.</Aviso>;
  }

  const lineasRecibido = lineasDesde(recibido);
  const lineasEntregado = lineasDesde(entregado);
  const totalRecibido = totalLineas(lineasRecibido);
  const totalEntregado = totalLineas(lineasEntregado);
  const cuadra = totalRecibido > 0 && totalRecibido === totalEntregado;

  // Piezas disponibles por valor, envases incluidos: si hay que abrir un
  // cartucho o una bolsa para llegar, el motor lo abre y lo dice.
  const disponible = Object.fromEntries(jornada.stock.map((l) => [l.valor, l.cantidad]));

  /**
   * Rellena la salida con la propuesta del motor de cambio.
   *
   * Se excluyen las denominaciones que entran: nadie cambia una pieza para
   * recibir de vuelta esa misma pieza. Con eso, el motor —que da siempre la
   * pieza más grande— resuelve solo los dos sentidos: por un billete de 20 €
   * propone 10 + 5 + monedas, y por 20 € en monedas propone el billete.
   */
  async function proponer() {
    setError("");
    try {
      const r = await api.proponerCambio(
        jornada!.sesion.id,
        totalRecibido,
        lineasRecibido.map((l) => l.valor)
      );
      if (r.ok === false) {
        setError(r.mensaje || "No se puede componer ese importe con lo que hay en caja.");
        return;
      }
      setEntregado(cantidadesDesde(r.lineas));
      setAperturas(r.aperturas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido calcular la propuesta");
    }
  }

  async function confirmar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.darCambio({
        sessionId: jornada!.sesion.id,
        importeCentimos: totalRecibido,
        recibido: lineasRecibido,
        entregado: lineasEntregado,
      });
      setUltimo({ numero: r.numero, aperturas: r.aperturas });
      setRecibido({});
      setEntregado({});
      setAperturas([]);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar el cambio");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Dar cambio"
        descripcion="Entra dinero y sale el mismo importe en otras piezas. La caja no cambia de total, solo de composición."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {ultimo && (
        <Aviso tono="bien">
          Cambio registrado como <strong>{ultimo.numero}</strong>. El stock de la caja ya refleja
          las piezas nuevas.
        </Aviso>
      )}
      {ultimo && <AvisoCartuchos aperturas={ultimo.aperturas} />}

      <div className="grid gap-3 lg:grid-cols-2">
        <DenominationGrid
          titulo="Entrega el cliente"
          denominaciones={denominaciones}
          cantidades={recibido}
          onChange={(c) => {
            setRecibido(c);
            setUltimo(null);
          }}
          deshabilitado={guardando}
        />

        <div className="space-y-2">
          <DenominationGrid
            titulo="Se le devuelve"
            denominaciones={denominaciones}
            cantidades={entregado}
            onChange={(c) => {
              setEntregado(c);
              setAperturas([]);
            }}
            disponible={disponible}
            mostrarDisponible
            objetivoCentimos={totalRecibido > 0 ? totalRecibido : null}
            deshabilitado={guardando}
          />

          <button
            onClick={() => void proponer()}
            disabled={totalRecibido <= 0 || guardando}
            className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-[12px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" /> Proponer con qué devolver {totalRecibido > 0 ? euros(totalRecibido) : ""}
          </button>

          <AvisoCartuchos aperturas={aperturas} />
        </div>
      </div>

      {totalRecibido > 0 && totalEntregado > 0 && !cuadra && (
        <Aviso tono="aviso">
          Entran {euros(totalRecibido)} y salen {euros(totalEntregado)}: en un cambio las dos
          cifras tienen que ser iguales.
        </Aviso>
      )}

      <BotonAccion
        tono="cobro"
        icono={<Repeat className="h-5 w-5" />}
        onClick={() => void confirmar()}
        disabled={!cuadra || guardando}
      >
        {guardando
          ? "Registrando…"
          : cuadra
            ? `Registrar cambio de ${euros(totalRecibido)}`
            : "Registrar cambio"}
      </BotonAccion>

      <p className="text-[11px] text-slate-500">
        Funciona en los dos sentidos: un billete por monedas, o monedas por un billete. Lo que se
        devuelve sale del cajón —no de lo que el cliente acaba de dar— y si para juntarlo hay que
        abrir un cartucho o una bolsa, se abre solo y queda avisado.
      </p>
    </div>
  );
}
