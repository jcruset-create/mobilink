import type { ReactNode } from "react";
import { TableWrap, tdCls, thCls } from "../components/ui";

// Manual de uso dentro de la app. Por ahora cubre el módulo Operaciones;
// pensado para ir ampliando con más secciones a medida que crezca.

type PillTone = "amber" | "sky" | "emerald" | "rose" | "slate";
const PILL_CLS: Record<PillTone, string> = {
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  sky: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  rose: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  slate: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};
function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${PILL_CLS[tone]}`}>{children}</span>;
}

function Seccion({ id, n, titulo, children }: { id: string; n: number; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-2 mt-8 flex items-baseline gap-3 text-xl font-bold text-slate-100">
        <span className="rounded-md bg-emerald-500/12 px-2 py-0.5 text-[13px] font-mono font-semibold text-emerald-300 ring-1 ring-emerald-500/30">{n}</span>
        {titulo}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Callout({ tono = "emerald", titulo, children }: { tono?: "emerald" | "amber"; titulo: string; children: ReactNode }) {
  const c = tono === "amber" ? "border-amber-500 bg-amber-500/8" : "border-emerald-500 bg-emerald-500/8";
  return (
    <div className={`my-3 rounded-r-lg border-l-[3px] ${c} px-4 py-2.5 text-sm text-slate-200`}>
      <span className="block font-bold">{titulo}</span>
      {children}
    </div>
  );
}

export default function Ayuda() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">SEA TyreControl · Manual de uso</div>
      <h1 className="text-2xl font-black text-slate-100">Operaciones de neumáticos</h1>
      <p className="mt-2 max-w-2xl text-[15px] text-slate-400">
        Cómo registrar, planificar y controlar todo lo que le pasa a un neumático: montarlo, moverlo, repararlo, retirarlo y dejar traza de cada paso.
      </p>

      {/* Índice */}
      <nav className="mt-5 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {[
            ["que-es", "1", "Qué es y para qué sirve"],
            ["panel", "2", "El panel de Operaciones"],
            ["tipos", "3", "Tipos de operación"],
            ["estados", "4", "Estados y prioridad"],
            ["crear", "5", "Cómo se crean (por origen)"],
            ["pendientes", "6", "Planificar y gestionar pendientes"],
            ["reservas", "7", "Reservas de neumático"],
            ["correcciones", "8", "Correcciones de datos"],
            ["detalle", "9", "Detalle, historial y auditoría"],
            ["anular", "10", "Anular una operación"],
            ["informes", "11", "Informes (Excel)"],
            ["permisos", "12", "Permisos y buenas prácticas"],
          ].map(([id, n, t]) => (
            <a key={id} href={`#${id}`} className="flex gap-2 border-b border-dotted border-slate-700 py-1.5 text-[14px] text-slate-200 hover:text-emerald-300">
              <span className="min-w-[20px] font-mono text-[12px] text-emerald-400">{n}</span>{t}
            </a>
          ))}
        </div>
      </nav>

      <Seccion id="que-es" n={1} titulo="Qué es y para qué sirve">
        <p>Cada acción física sobre un neumático —montarlo en un vehículo, cambiarlo de posición, enviarlo a reparar, darlo de baja— queda registrada como una <strong className="text-slate-100">operación</strong>. El módulo es el registro único y trazable de todo eso: qué neumático, en qué vehículo y posición, cuándo, quién, con qué coste y con qué resultado.</p>
        <p>La mayoría de operaciones <strong className="text-slate-100">se generan solas</strong> cuando trabajas en las pantallas de siempre (el plano del vehículo, la ficha del neumático, las revisiones). El panel de Operaciones es donde las <strong className="text-slate-100">consultas, planificas y controlas</strong>.</p>
      </Seccion>

      <Seccion id="panel" n={2} titulo="El panel de Operaciones">
        <p>Entra por <strong className="text-slate-100">Menú lateral → Operaciones</strong>. Verás una tabla con todas las operaciones (nº correlativo, fecha, empresa, vehículo, tipo, estado, neumático, posición, km, motivo, destino y coste) y una barra de filtros arriba.</p>
        <p className="font-semibold text-slate-200">Filtrar por:</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
          <li><strong className="text-slate-100">Empresa</strong> y <strong className="text-slate-100">vehículo</strong> — para centrarte en una flota o matrícula.</li>
          <li><strong className="text-slate-100">Tipo</strong> — montaje, desmontaje, reparación, etc.</li>
          <li><strong className="text-slate-100">Estado</strong> — por ejemplo solo las <Pill tone="amber">pendiente</Pill> o las <Pill tone="emerald">completada</Pill>.</li>
          <li><strong className="text-slate-100">Fechas</strong> — un rango desde / hasta.</li>
        </ul>
        <p>Arriba a la derecha tienes tres botones: <strong className="text-slate-100">Exportar Excel</strong>, <strong className="text-slate-100">Reservas activas</strong> y <strong className="text-slate-100">+ Nueva operación</strong>.</p>
      </Seccion>

      <Seccion id="tipos" n={3} titulo="Tipos de operación">
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Tipo</th><th className={thCls}>Qué representa</th></tr></thead>
          <tbody>
            {[
              ["Montaje", "Poner un neumático en una posición del vehículo (desde almacén o fuera de almacén)."],
              ["Desmontaje", "Retirar un neumático montado (a almacén, reparación o descarte)."],
              ["Sustitución", "Desmontar el actual y montar otro en la misma posición, en un solo paso."],
              ["Rotación", "Mover un neumático a otra posición del mismo vehículo (arrastrando en el plano)."],
              ["Cambio de posición", "Mover a una posición libre del mismo vehículo, dejando traza propia."],
              ["Intercambio", "Permutar dos neumáticos montados entre sus posiciones."],
              ["Reparación", "Reparación con tipo, resultado, proveedor, coste y fotos."],
              ["Descarte", "Baja definitiva de un neumático."],
              ["Entrada / salida de almacén", "Movimientos entre el vehículo y el stock."],
              ["Revisión de vehículo", "Se registra al completar una revisión (tablet o web)."],
              ["Corrección de posición / de montado", "Arreglar un dato mal registrado, sin movimiento físico real."],
            ].map(([t, d]) => (
              <tr key={t} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold text-slate-200"}>{t}</td>
                <td className={tdCls + " text-slate-400"}>{d}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Seccion>

      <Seccion id="estados" n={4} titulo="Estados y prioridad">
        <p>Cada operación tiene un <strong className="text-slate-100">estado</strong>. Las que registras al hacer el trabajo físico nacen ya como <Pill tone="emerald">completada</Pill>. Las que <em>planificas</em> recorren el ciclo:</p>
        <div className="my-2 flex flex-wrap items-center gap-2 font-mono text-[13px] text-slate-300">
          {["pendiente", "asignada", "en proceso", "completada"].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-2">
              <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1">{s}</span>
              {i < arr.length - 1 && <span className="text-slate-500">→</span>}
            </span>
          ))}
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Estado</th><th className={thCls}>Significado</th></tr></thead>
          <tbody>
            {([
              [<Pill tone="slate">borrador</Pill>, "Creada pero sin confirmar."],
              [<Pill tone="amber">pendiente</Pill>, "Falta hacerla; sin fecha ni técnico asignado."],
              [<Pill tone="sky">planificada</Pill>, "Tiene fecha prevista o técnico."],
              [<Pill tone="sky">asignada</Pill>, "Asignada a un técnico, lista para ejecutar."],
              [<Pill tone="amber">en proceso</Pill>, "Se está realizando."],
              [<Pill tone="amber">pausada</Pill>, "Interrumpida temporalmente."],
              [<Pill tone="emerald">completada</Pill>, "Terminada; el efecto ya está aplicado."],
              [<span className="flex gap-1"><Pill tone="rose">cancelada</Pill><Pill tone="rose">no realizada</Pill></span>, "No se llevó a cabo."],
              [<Pill tone="slate">anulada</Pill>, "Invalidada por un administrador (queda trazada, fuera de cómputos)."],
            ] as [ReactNode, string][]).map(([badge, d], i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls}>{badge}</td>
                <td className={tdCls + " text-slate-400"}>{d}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p>La <strong className="text-slate-100">prioridad</strong> (baja · normal · alta · urgente) ordena el trabajo pendiente; si no es «normal» aparece marcada junto al estado.</p>
      </Seccion>

      <Seccion id="crear" n={5} titulo="Cómo se crean (por origen)">
        <p>No hace falta ir a Operaciones para crear la mayoría: haces el trabajo donde toca y la operación se registra sola.</p>
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Quiero…</th><th className={thCls}>Dónde se hace</th><th className={thCls}>Queda como</th></tr></thead>
          <tbody>
            {([
              ["Montar / desmontar / sustituir", "Ficha del vehículo → plano, seleccionar la posición", <Pill tone="emerald">completada</Pill>],
              ["Rotar / intercambiar", "Ficha del vehículo → arrastrar una rueda a otra posición", <Pill tone="emerald">completada</Pill>],
              ["Registrar una reparación", "Ficha del neumático → «Registrar reparación»", <Pill tone="emerald">completada</Pill>],
              ["Descartar un neumático", "Ficha del neumático → «Descartar»", <Pill tone="emerald">completada</Pill>],
              ["Corregir un dato mal puesto", "Plano del vehículo → clic derecho en la rueda", <Pill tone="emerald">completada</Pill>],
              ["Programar algo para más adelante", "Panel Operaciones → + Nueva operación", <span className="flex gap-1"><Pill tone="amber">pendiente</Pill><Pill tone="sky">planificada</Pill></span>],
            ] as [string, string, ReactNode][]).map(([q, d, r], i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{q}</td>
                <td className={tdCls + " text-slate-400"}>{d}</td>
                <td className={tdCls}>{r}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        <h3 className="mt-4 font-bold text-slate-200">Registrar una reparación (con detalle)</h3>
        <p>Desde la ficha del neumático, «Registrar reparación» pide: <strong className="text-slate-100">tipo</strong> (pinchazo, válvula, equilibrado…), <strong className="text-slate-100">resultado</strong>, <strong className="text-slate-100">proveedor/taller</strong>, <strong className="text-slate-100">coste</strong>, <strong className="text-slate-100">km</strong>, observaciones y <strong className="text-slate-100">fotos</strong>. El estado del neumático se actualiza según el resultado:</p>
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Resultado</th><th className={thCls}>El neumático pasa a…</th></tr></thead>
          <tbody>
            {[
              ["Reparado / Provisional", "Almacén (operativo)"],
              ["Pendiente de seguimiento", "En reparación (en observación)"],
              ["Enviado a proveedor", "En reparación (taller externo)"],
              ["No reparable / Sustituido", "Descartado (baja)"],
            ].map(([a, b]) => (
              <tr key={a} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{a}</td>
                <td className={tdCls + " text-slate-400"}>{b}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Seccion>

      <Seccion id="pendientes" n={6} titulo="Planificar y gestionar pendientes">
        <h3 className="font-bold text-slate-200">Crear una operación planificada</h3>
        <p>En el panel, <strong className="text-slate-100">+ Nueva operación</strong> abre el formulario para programar algo sin ejecutarlo: empresa, tipo, vehículo, <strong className="text-slate-100">fecha prevista</strong>, <strong className="text-slate-100">prioridad</strong>, <strong className="text-slate-100">técnico</strong>, motivo y observaciones. Queda <Pill tone="amber">pendiente</Pill> o <Pill tone="sky">planificada</Pill>.</p>
        <Callout tono="amber" titulo="Importante">
          Una operación planificada no aplica el cambio físico. El efecto real (montar, desmontar, etc.) se registra cuando la marcas como <Pill tone="emerald">completada</Pill> desde la app o el escritorio.
        </Callout>
        <h3 className="font-bold text-slate-200">Avanzarla</h3>
        <p>En la columna <strong className="text-slate-100">Acciones</strong> de cada fila aparecen los botones válidos según su estado: <em>Asignar → Iniciar → Completar</em>, con <em>Pausar</em> / <em>Reanudar</em> y <em>Cancelar</em> cuando corresponde. Cada cambio queda en el historial de estados.</p>
      </Seccion>

      <Seccion id="reservas" n={7} titulo="Reservas de neumático">
        <p>Cuando quieres «apartar» un neumático concreto para una operación futura (que no lo monte nadie más), usas una <strong className="text-slate-100">reserva</strong>. Botón <strong className="text-slate-100">Reservas activas</strong> del panel para verlas y liberarlas.</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
          <li>Un neumático solo puede tener <strong className="text-slate-100">una reserva activa</strong> a la vez. No se puede reservar si está montado o descartado.</li>
          <li>Al <strong className="text-slate-100">completar</strong> la operación asociada, la reserva se consume automáticamente.</li>
          <li>Al <strong className="text-slate-100">cancelar o anular</strong> la operación, la reserva se libera sola.</li>
          <li>También puedes liberar una reserva a mano desde el listado.</li>
        </ul>
      </Seccion>

      <Seccion id="correcciones" n={8} titulo="Correcciones de datos">
        <p>Sirven para arreglar un registro equivocado <strong className="text-slate-100">sin generar un movimiento físico</strong> (no entran en el historial de montajes; quedan marcadas como corrección). Se hacen con <strong className="text-slate-100">clic derecho sobre una rueda</strong> en el plano del vehículo:</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
          <li><strong className="text-slate-100">Corregir posición</strong> — el neumático estaba anotado en otra posición de la que realmente ocupa.</li>
          <li><strong className="text-slate-100">Corregir neumático montado</strong> — en esa posición figuraba un neumático que no es; lo sustituye por el correcto (el mal anotado vuelve a almacén).</li>
        </ul>
        <Callout tono="amber" titulo="Solo administradores">
          Las correcciones son acciones sensibles y están reservadas al perfil administrador.
        </Callout>
      </Seccion>

      <Seccion id="detalle" n={9} titulo="Detalle, historial y auditoría">
        <p>El botón <strong className="text-slate-100">Detalle</strong> de cada fila abre una ventana con todo lo relacionado:</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
          <li><strong className="text-slate-100">Movimientos</strong> — qué neumáticos se movieron y entre qué estados.</li>
          <li><strong className="text-slate-100">Historial de estados</strong> — cada transición con fecha y hora.</li>
          <li><strong className="text-slate-100">Auditoría</strong> — acciones sensibles (anulaciones, correcciones) con su motivo.</li>
          <li><strong className="text-slate-100">Fotos</strong> — las imágenes adjuntas (por ejemplo de una reparación).</li>
        </ul>
      </Seccion>

      <Seccion id="anular" n={10} titulo="Anular una operación">
        <p>Desde <strong className="text-slate-100">Detalle</strong>, un administrador puede <strong className="text-slate-100">anular</strong> la operación indicando un motivo (obligatorio). Queda como <Pill tone="slate">anulada</Pill> y fuera de los cómputos, pero se conserva para la traza; además se liberan sus reservas.</p>
        <Callout tono="amber" titulo="Anular no revierte el cambio físico">
          Anular invalida el registro. Si necesitas deshacer un montaje o corregir dónde está un neumático, usa las correcciones o la operación inversa, no la anulación.
        </Callout>
      </Seccion>

      <Seccion id="informes" n={11} titulo="Informes (Excel)">
        <p>El botón <strong className="text-slate-100">Exportar Excel</strong> descarga el listado <em>tal como lo tienes filtrado</em>: nº, fecha, empresa, vehículo, tipo, estado, prioridad, neumático, motivo, destino, proveedor, coste, si está anulada y observaciones. Filtra primero (empresa, fechas, estado) y luego exporta.</p>
      </Seccion>

      <Seccion id="permisos" n={12} titulo="Permisos y buenas prácticas">
        <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
          <li><strong className="text-slate-100">Técnicos y operadores</strong> crean y ejecutan operaciones de su empresa.</li>
          <li><strong className="text-slate-100">Correcciones y anulaciones</strong> quedan reservadas a administradores.</li>
          <li>Registra la reparación con su <strong className="text-slate-100">resultado</strong> correcto: de él depende que el neumático quede disponible, en observación o de baja.</li>
          <li>Usa <strong className="text-slate-100">planificar + reservar</strong> cuando ya sabes qué neumático vas a montar.</li>
          <li>Ante un error de dato, <strong className="text-slate-100">corrige</strong> (no borres ni anules): mantiene la trazabilidad limpia.</li>
        </ul>
      </Seccion>

      <div className="mt-10 border-t border-slate-700 pt-4 text-[13px] text-slate-500">
        SEA TyreControl · Módulo Operaciones de neumáticos · Los nombres de botones y estados corresponden a la interfaz en producción.
      </div>
    </div>
  );
}
