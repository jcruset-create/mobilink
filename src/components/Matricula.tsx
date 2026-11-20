import { dibujoMatricula } from "../modules/matriculaEs";

/**
 * Una matrícula dibujada como la placa: la española actual con su banda azul
 * y la «E», la de remolque en rojo, la antigua de provincia sin banda, y
 * cualquier otra en un recuadro liso tal como está escrita.
 */
export default function Matricula({ plate, grande = false }: { plate: string; grande?: boolean }) {
  const { tipo, partes } = dibujoMatricula(plate);
  const alto = grande ? "h-9 text-xl" : "h-7 text-sm";
  const conBanda = tipo === "actual" || tipo === "remolque";
  return (
    <span
      role="img"
      aria-label={`Matrícula ${partes.join(" ")}`}
      className={`inline-flex shrink-0 items-stretch overflow-hidden rounded border-2 border-black align-middle font-mono font-black leading-none text-black ${alto} ${
        tipo === "remolque" ? "bg-red-600" : tipo === "otra" ? "bg-slate-200" : "bg-white"
      }`}
    >
      {conBanda && (
        <span className={`flex flex-col items-center justify-end bg-[#003399] pb-0.5 font-sans text-white ${grande ? "w-5 text-[10px]" : "w-4 text-[8px]"}`}>
          <span className={`mb-auto mt-0.5 rounded-full border border-dotted border-yellow-400 ${grande ? "h-2.5 w-2.5" : "h-2 w-2"}`} />
          E
        </span>
      )}
      <span className={`flex items-center ${grande ? "gap-2 px-2.5" : "gap-1.5 px-2"} tracking-wide`}>
        {partes.map((p, i) => <span key={i}>{p}</span>)}
      </span>
    </span>
  );
}
