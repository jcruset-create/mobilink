/**
 * El punto rojo que parpadea al lado de un trabajo en cola.
 *
 * Un vehículo en cola es un cliente esperando a que alguien lo coja. Un
 * texto en una lista no lo dice; un punto que late, sí, y se ve desde la
 * otra punta del taller.
 */
export default function PuntoEnCola({ title = "En cola: pendiente de asignar" }: { title?: string }) {
  return (
    <span className="relative mr-1.5 inline-flex h-2.5 w-2.5 shrink-0 align-middle" title={title} aria-label={title}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600" />
    </span>
  );
}
