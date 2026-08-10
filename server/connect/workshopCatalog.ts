/**
 * Catálogo de talleres de la red que se dan de alta solos, sin pasar por el
 * panel. Separado de la lógica de alta (`seedWorkshops.ts`) para que sea puro
 * dato: así se puede revisar con Vitest sin base de datos delante.
 */

export interface SeedWorkshop {
  /** Empresa proveedora a la que pertenece (se crea si no existe). */
  company: string;
  name: string;
  /** Red comercial o franquicia (Confortauto, Euromaster…). */
  commercialNetwork?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  /**
   * Coordenadas. Si el catálogo no las trae, se geocodifica la dirección al
   * dar de alta el taller: `connect_workshops` las exige y no se inventan.
   */
  latitude?: number;
  longitude?: number;
  phone?: string | null;
  email?: string | null;
  /** Códigos de `connect_service_types`: tyres, mechanical, tow_truck… */
  services: string[];
  openingHours?: string | null;
  /** assist (FULL) | lite (LITE) | external (EXTERNAL). */
  integrationType: "assist" | "lite" | "external";
  radiusKm?: number;
  connectStatus?: "active" | "observation" | "blocked";
  /** Observaciones internas (de dónde salen los datos, por ejemplo). */
  notes?: string | null;
}

export const NETWORK_WORKSHOPS: SeedWorkshop[] = [
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Polinyà",
    commercialNetwork: "Confortauto",
    address: "Ctra. Santa Perpetua a Sentmenat, Km 1,4 Nave 5",
    postalCode: "08213",
    city: "Polinyà",
    province: "Barcelona",
    latitude: 41.5569,
    longitude: 2.1528,
    phone: "937133317",
    email: "tallerpolinya@gruposoledad.net",
    services: ["tyres", "mechanical"],
    openingHours: "L-V 08:30-13:30|15:00-18:30; Sáb 09:00-13:00",
    // Taller de red sin Mobilink Assist contratado: la central lleva los
    // estados a mano hasta que se le active Lite o Assist completo.
    integrationType: "external",
    connectStatus: "active",
  },

  // Red Neumáticos Soledad (Confortauto). Lista verificada aportada por
  // Jordi en hoja de cálculo; sin coordenadas, se geocodifican al darlos de
  // alta. Dos no traen código postal y su posición saldrá menos precisa.
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Getafe",
    commercialNetwork: "Confortauto",
    address: "Pol. Ind. San Marcos. Calle Diesel, 9",
    postalCode: "28906",
    city: "Getafe",
    province: "Madrid",
    phone: "911093273",
    email: "tallergetafe@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/madrid-confortauto-neumaticos-soledad-getafe",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Valladolid",
    commercialNetwork: "Confortauto",
    address: "Calle Pilar Miró, 11 - Polígono Industrial Argales",
    postalCode: "47008",
    city: "Valladolid",
    province: "Valladolid",
    phone: "966919888",
    email: null,
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/talleres-mecanicos-neumaticos/valladolid/confortauto-neumaticos-soledad-valladolid?id=2443",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad León",
    commercialNetwork: "Confortauto",
    address: "Calle 3, Nº191 - Polígono Industrial Villadangos del Páramo",
    postalCode: "24392",
    city: "Villadangos del Páramo",
    province: "León",
    phone: "916831331",
    email: "tiffany.leonato@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/leon-confortauto-neumaticos-soledad-leon",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Talavera",
    commercialNetwork: "Confortauto",
    address: "Avda. Francisco Aguirre, 438",
    postalCode: "45600",
    city: "Talavera de la Reina",
    province: "Toledo",
    phone: "925809465",
    email: "tallertalavera@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/toledo-confortauto-neumaticos-soledad-talavera",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Zaragoza",
    commercialNetwork: "Confortauto",
    address: "C/ Juan de la Cierva, 15",
    postalCode: "50014",
    city: "Zaragoza",
    province: "Zaragoza",
    phone: "976470190",
    email: "tallerzaragoza@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/zaragoza-confortauto-neumaticos-soledad-zaragoza-1",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Zaragoza Plaza",
    commercialNetwork: "Confortauto",
    address: "Polígono Industrial Plaza, C/ Celsa, 23",
    postalCode: "50197",
    city: "Zaragoza",
    province: "Zaragoza",
    phone: "876269005",
    email: "tallerzaragozaplaza@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/zaragoza-confortauto-neumaticos-soledad-zaragoza",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Granada",
    commercialNetwork: "Confortauto",
    address: "P.I. Juncaril, Calle Lanjarón, 18",
    postalCode: "18220",
    city: "Albolote",
    province: "Granada",
    phone: "958491710",
    email: "tallergranada@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/granada-confortauto-neumaticos-soledad-granada",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Málaga",
    commercialNetwork: "Confortauto",
    address: "Avenida de los Vegas 54, 56",
    postalCode: "29004",
    city: "Málaga",
    province: "Málaga",
    phone: "952356696",
    email: "tallermalaga@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/malaga-confortauto-neumaticos-soledad-malaga",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Antequera",
    commercialNetwork: "Confortauto",
    address: "Pol. Ind. Antequera, C/ San Cristóbal, 3",
    postalCode: "29200",
    city: "Antequera",
    province: "Málaga",
    phone: "951761160",
    email: "tallerantequera@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/malaga-confortauto-neumaticos-soledad-antequera",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Sevilla",
    commercialNetwork: "Confortauto",
    address: "Polígono Industrial La Red. Autovía Sevilla-Málaga km 4,8",
    postalCode: "41500",
    city: "Alcalá de Guadaíra",
    province: "Sevilla",
    phone: "955631469",
    email: "tallersevilla@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/sevilla-confortauto-neumaticos-soledad-sevilla",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Arteixo",
    commercialNetwork: "Confortauto",
    address: "Polígono Industrial Sabón. Avda. Do Embalse, 103",
    postalCode: "15142",
    city: "Arteixo",
    province: "A Coruña",
    phone: "981641675",
    email: "tallerarteixo@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/a-coruna-confortauto-neumaticos-soledad-arteixo",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Río do Pozo",
    commercialNetwork: "Confortauto",
    address: "Pol. Industrial Río do Pozo, C/ Gonzalo Navarro, 58-59",
    postalCode: "15540",
    city: "Narón",
    province: "A Coruña",
    phone: "981116054",
    email: "tallerriodopozo@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/a-coruna-confortauto-neumaticos-soledad-sl",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Pocomaco",
    commercialNetwork: "Confortauto",
    address: "Polígono Industrial Pocomaco, Parc. C4, Nave 1, Mesoiro",
    postalCode: null,
    city: "A Coruña",
    province: "A Coruña",
    phone: "981244878",
    email: null,
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/talleres-mecanicos-neumaticos/a-coruna",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Narón",
    commercialNetwork: "Confortauto",
    address: "Polígono de A Gándara, C/ Luis Seoane, Parcela 147",
    postalCode: null,
    city: "Narón",
    province: "A Coruña",
    phone: "981397721",
    email: null,
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/talleres-mecanicos-neumaticos/a-coruna",
  },
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Soledad Vigo",
    commercialNetwork: "Confortauto",
    address: "Carretera de Camposancos, 103",
    postalCode: "36213",
    city: "Vigo",
    province: "Pontevedra",
    phone: "986245559",
    email: "tallervigo@gruposoledad.net",
    services: ["tyres", "mechanical"],
    integrationType: "external",
    notes: "Ficha de la red: https://www.confortauto.com/pages/talleres-mecanicos-neumaticos/pontevedra-confortauto-neumaticos-soledad-vigo",
  },
];
