/**
 * Qué versión del agente hay publicada, y dónde está.
 *
 * Lo que el agente pregunta en cada latido para saber si le toca actualizarse.
 * Aquí no se decide si se actualiza —eso lo decide el agente, que es quien sabe
 * qué versión lleva— y esa separación es a propósito: el servidor **informa**,
 * el agente **manda sobre su propia máquina**.
 *
 * ## La URL se CONSTRUYE, no se pregunta
 *
 * Es la misma decisión que ya está tomada para las APK en `server/index.ts`, y
 * por el mismo motivo, que allí costó un incidente: consultar la API de GitHub
 * en cada visita agota el cupo de 60 peticiones por hora **por IP**, y en Render
 * la IP es compartida. Con veinte agentes latiendo cada pocos minutos el cupo se
 * quemaría el primer día, y lo que enseñaría la bandeja sería «no se ha podido
 * comprobar» para siempre.
 *
 * No hace falta preguntar. La CI publica siempre con el mismo patrón:
 *
 *     etiqueta  =  autoscan-v          + versión    autoscan-v1.0.3
 *     fichero   =  mobilink-autoscan-  + versión    mobilink-autoscan-1.0.3.zip
 *
 * Así que basta la versión del `package.json` del agente, que viaja en el propio
 * repositorio. Cero peticiones, cero cupo, cero token.
 *
 * ## El invariante del que esto depende
 *
 * La CI guarda el número **después** de publicar la release. Si el número está
 * en el repositorio, su release existe. Quien suba la versión a mano sin
 * publicar dejará a los agentes descargando un 404 — el actualizador lo trata
 * como un fallo y deja el agente donde estaba, pero el aviso de la bandeja no se
 * irá hasta que la release aparezca.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** `server/cash/autoscan/` → la raíz del repositorio. */
const RAIZ = path.join(AQUI, "..", "..", "..");

const GH_REPO = process.env.GITHUB_REPO || "jcruset-create/mobilink";

export type AgentePublicado = { version: string; url: string };

/**
 * La versión que declara el agente en el repositorio, o `null`.
 *
 * `null` no es un error que haya que gritar: significa «no hay nada que
 * ofrecer», y el latido sigue contestando igual. Un despliegue sin la carpeta
 * del agente es raro pero no debe tumbar el latido de veinte mostradores, que
 * es lo único que mantiene viva la cola de subida.
 */
export function versionPublicada(): string | null {
  try {
    const txt = fs.readFileSync(path.join(RAIZ, "autoscan_agent", "package.json"), "utf8");
    const v = (JSON.parse(txt) as { version?: unknown }).version;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Dónde cuelga la CI el paquete de esa versión. */
export function urlDelAgente(version: string): string {
  const etiqueta = encodeURIComponent(`autoscan-v${version}`);
  const fichero = encodeURIComponent(`mobilink-autoscan-${version}.zip`);
  return `https://github.com/${GH_REPO}/releases/download/${etiqueta}/${fichero}`;
}

/** Lo que viaja en la respuesta del latido. `null` = no hay nada que ofrecer. */
export function agentePublicado(): AgentePublicado | null {
  const version = versionPublicada();
  return version ? { version, url: urlDelAgente(version) } : null;
}
