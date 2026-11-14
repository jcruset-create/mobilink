import { CalendarClock, CheckCircle2, Clock3, FileText, Plus } from "lucide-react";

/*
 * La sección «OTF» del menú lateral, igual que la de asistencias: Nueva OTF,
 * Programadas, Activas, Últimas cerradas e Historial. Va debajo de las
 * asistencias y antes de Herramientas, en los tres menús laterales que hay
 * (AssistSidebar, RoadsideAssistanceView y RoadsideAssistanceAdminView): por
 * eso es un componente y no tres copias.
 *
 * Qué entra en cada pestaña lo decide `OtfPage` (`otfDeLaPestana`).
 */

export type PestanaOtf = "nueva" | "programadas" | "activas" | "cerradas" | "historial";

const claseItem = (activo: boolean) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium transition-colors ${
    activo ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-800"
  }`;

export default function MenuOtf({ activa }: { activa?: PestanaOtf | null }) {
  return (
    <>
      <div className="my-2 border-t border-slate-800" />
      <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">OTF</div>
      <a href="/otf?tab=nueva" className={claseItem(activa === "nueva")}>
        <Plus className="h-4 w-4 shrink-0" /> Nueva OTF
      </a>
      <a href="/otf?tab=programadas" className={claseItem(activa === "programadas")}>
        <CalendarClock className="h-4 w-4 shrink-0" /> Programadas
      </a>
      <a href="/otf?tab=activas" className={claseItem(activa === "activas")}>
        <Clock3 className="h-4 w-4 shrink-0" /> Activas
      </a>
      <a href="/otf?tab=cerradas" className={claseItem(activa === "cerradas")}>
        <CheckCircle2 className="h-4 w-4 shrink-0" /> Últimas cerradas
      </a>
      <a href="/otf/historial" className={claseItem(activa === "historial")}>
        <FileText className="h-4 w-4 shrink-0" /> Historial
      </a>
    </>
  );
}
