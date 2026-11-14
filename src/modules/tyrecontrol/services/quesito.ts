/**
 * La geometría de un quesito, fuera del componente para poder probarla.
 *
 * Dibujar seis porciones es aritmética con dos trampas, y las dos salen mal
 * en silencio —el gráfico aparece, solo que miente—, así que viven aquí con
 * sus pruebas en vez de dentro de un JSX que nadie puede comprobar.
 *
 * ── Trampa 1 · la porción del 100 % ─────────────────────────────────────────
 *
 * Un arco de 360° empieza y acaba en el MISMO punto, así que el trazo
 * desaparece: el quesito sale vacío justo cuando una sola categoría se lo
 * lleva todo, que es el caso en el que más importa verlo. Se dibuja como
 * círculo, con dos arcos de media vuelta.
 *
 * ── Trampa 2 · el arco mayor ────────────────────────────────────────────────
 *
 * SVG no sabe por qué lado ir de un punto a otro: con `large-arc-flag` a 0,
 * una porción del 70 % se dibuja como la del 30 %. Hay que levantarlo en
 * cuanto el ángulo pasa de media vuelta.
 */

export interface PorcionQuesito {
  etiqueta: string;
  valor: number;
}

export interface ArcoQuesito {
  /** El atributo `d` del `<path>`. */
  d: string;
  /** Qué porción es, para el color y la leyenda. */
  indice: number;
  /** Fracción del total, de 0 a 1. */
  fraccion: number;
}

/** Centro y radio del dibujo, en el `viewBox` de 120×120 que usa la pantalla. */
const CX = 60;
const CY = 60;
const R = 55;

/** Un punto del borde, medido desde arriba y en el sentido del reloj. */
function punto(angulo: number): [number, number] {
  return [CX + R * Math.sin(angulo), CY - R * Math.cos(angulo)];
}

const n2 = (x: number) => Number(x.toFixed(2));

/**
 * Los arcos de un quesito, en el orden en que se pasan.
 *
 * Las porciones con valor 0 se saltan: un `<path>` sin superficie no se ve
 * pero sí se puede pulsar, y además ensucia el SVG con basura invisible.
 *
 * Sin total —todas a cero, o la lista vacía— no se devuelve nada: un quesito
 * de nada no es un círculo entero de la primera categoría.
 */
export function arcosDeQuesito(porciones: PorcionQuesito[]): ArcoQuesito[] {
  const total = porciones.reduce((a, p) => a + Math.max(0, p.valor), 0);
  if (total <= 0) return [];

  const arcos: ArcoQuesito[] = [];
  let acumulado = 0;

  porciones.forEach((p, indice) => {
    const valor = Math.max(0, p.valor);
    if (valor === 0) return;

    const desde = (acumulado / total) * 2 * Math.PI;
    acumulado += valor;
    const hasta = (acumulado / total) * 2 * Math.PI;
    const fraccion = valor / total;

    if (valor === total) {
      // El círculo entero, en dos medias vueltas.
      arcos.push({
        indice,
        fraccion: 1,
        d: `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R} Z`,
      });
      return;
    }

    const [x1, y1] = punto(desde);
    const [x2, y2] = punto(hasta);
    const mayor = hasta - desde > Math.PI ? 1 : 0;
    arcos.push({
      indice,
      fraccion,
      d: `M ${CX} ${CY} L ${n2(x1)} ${n2(y1)} A ${R} ${R} 0 ${mayor} 1 ${n2(x2)} ${n2(y2)} Z`,
    });
  });

  return arcos;
}
