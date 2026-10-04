/**
 * Conocimiento inicial «TLC – Trasteros-Low Cost» (castellano y catalán).
 *
 * Es CONTENIDO, no lógica: se carga con el botón «Cargar conocimiento inicial
 * TLC» en la empresa (y, si se elige, el centro) que la use, y después se edita
 * desde el panel. Marca, web y calculadora salen de la configuración de la
 * empresa (`call_center.links`), no de aquí. Sólo conocimiento ESTÁTICO: nada
 * de precios, disponibilidad, horarios ni direcciones (eso va por herramientas).
 */

export type EntradaPaquete = {
  key: string;
  category: string;
  priority: number;
  es: { q: string; a: string };
  ca: { q: string; a: string };
};

export const PAQUETE_TLC: readonly EntradaPaquete[] = [
  {
    key: "empresa",
    category: "empresa",
    priority: 50,
    es: {
      q: "¿Qué es {marca}?",
      a: "{marca} es un servicio de trasteros low cost: «+ ESPACIO - PRECIO». Todo se gestiona online en {web}: consultar precios y disponibilidad y contratar.",
    },
    ca: {
      q: "Què és {marca}?",
      a: "{marca} és un servei de trasters low cost: «+ ESPAI - PREU». Tot es gestiona en línia a {web}: consultar preus i disponibilitat i contractar.",
    },
  },
  {
    key: "modelo",
    category: "modelo",
    priority: 50,
    es: {
      q: "¿Cómo funciona el servicio? ¿Por qué es low cost?",
      a: "Funciona con un modelo 100% online: la consulta de precios y disponibilidad y la contratación se hacen en {web}, y hay una calculadora de espacio para elegir el tamaño. Este modelo digital reduce costes operativos y por eso podemos ofrecer un servicio low cost. El teléfono sirve para informar y ayudar.",
    },
    ca: {
      q: "Com funciona el servei? Per què és low cost?",
      a: "Funciona amb un model 100% en línia: la consulta de preus i disponibilitat i la contractació es fan a {web}, i hi ha una calculadora d'espai per triar la mida. Aquest model digital redueix costos operatius i per això podem oferir un servei low cost. El telèfon serveix per informar i ajudar.",
    },
  },
  {
    key: "precio",
    category: "precio",
    priority: 60,
    es: {
      q: "¿Cuánto cuesta un trastero? ¿Qué precio tiene?",
      a: "Los precios dependen del tamaño y de la disponibilidad del momento. Puedes consultar el precio y la disponibilidad actualizados, y contratar online, en {web}.",
    },
    ca: {
      q: "Quant costa un traster? Quin preu té?",
      a: "Els preus depenen de la mida i de la disponibilitat del moment. Pots consultar el preu i la disponibilitat actualitzats, i contractar en línia, a {web}.",
    },
  },
  {
    key: "tamano",
    category: "tamano",
    priority: 55,
    es: {
      q: "No sé qué tamaño de trastero necesito",
      a: "Tenemos una calculadora de espacio online: indicas qué quieres guardar y te orienta sobre el tamaño adecuado. La tienes en {calculadora}.",
    },
    ca: {
      q: "No sé quina mida de traster necessito",
      a: "Tenim una calculadora d'espai en línia: indiques què vols guardar i t'orienta sobre la mida adequada. La tens a {calculadora}.",
    },
  },
  {
    key: "visitas",
    category: "visitas",
    priority: 45,
    es: {
      q: "¿Puedo visitar el trastero o las instalaciones?",
      a: "Funcionamos con un modelo digital. Para conocer las instalaciones hay visita virtual y visita guiada. La visita guiada se solicita y el equipo confirma si hay disponibilidad: no queda confirmada hasta que te la confirmen.",
    },
    ca: {
      q: "Puc visitar el traster o les instal·lacions?",
      a: "Funcionem amb un model digital. Per conèixer les instal·lacions hi ha visita virtual i visita guiada. La visita guiada es sol·licita i l'equip confirma si hi ha disponibilitat: no queda confirmada fins que te la confirmin.",
    },
  },
  {
    key: "personal",
    category: "modelo",
    priority: 45,
    es: {
      q: "¿Hay alguien en las instalaciones? ¿Hay personal?",
      a: "{marca} funciona con un modelo digital y no dispone de personal de atención permanente en las instalaciones. Este sistema nos permite reducir costes operativos y ofrecer un servicio Low Cost. Para conocer previamente las instalaciones disponemos de opciones de visita virtual o guiada.",
    },
    ca: {
      q: "Hi ha algú a les instal·lacions? Hi ha personal?",
      a: "{marca} funciona amb un model digital i no disposa de personal d'atenció permanent a les instal·lacions. Aquest sistema ens permet reduir costos operatius i oferir un servei Low Cost. Per conèixer prèviament les instal·lacions disposem d'opcions de visita virtual o guiada.",
    },
  },
  {
    key: "contratar",
    category: "contratacion",
    priority: 55,
    es: {
      q: "Quiero contratar un trastero",
      a: "La contratación se realiza 100% online desde {web}. Si quieres, te explico los pasos: eliges el tamaño (con la calculadora si tienes dudas), compruebas el precio y la disponibilidad y completas el alta y el pago en la web.",
    },
    ca: {
      q: "Vull contractar un traster",
      a: "La contractació es fa 100% en línia des de {web}. Si vols, t'explico els passos: tries la mida (amb la calculadora si tens dubtes), comproves el preu i la disponibilitat i completes l'alta i el pagament a la web.",
    },
  },
  {
    key: "disponibilidad",
    category: "disponibilidad",
    priority: 40,
    es: {
      q: "¿Hay trasteros disponibles?",
      a: "La disponibilidad cambia en tiempo real: se consulta en el sistema en el momento y se confirma, con el precio, en {web}.",
    },
    ca: {
      q: "Hi ha trasters disponibles?",
      a: "La disponibilitat canvia en temps real: es consulta al sistema en el moment i es confirma, amb el preu, a {web}.",
    },
  },
];

/** Rellena las marcas del texto con la configuración de la empresa. */
export function rellenar(texto: string, v: { marca: string; web: string; calculadora: string }): string {
  return texto.replaceAll("{marca}", v.marca).replaceAll("{web}", v.web).replaceAll("{calculadora}", v.calculadora);
}
