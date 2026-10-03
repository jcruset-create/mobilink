/**
 * URLs de vuelta de Stripe Checkout. Salen de la configuración del servidor
 * (PUBLIC_APP_URL), nunca de lo que mande el navegador: un parámetro de vuelta
 * controlado por el cliente es una redirección abierta.
 */
export function baseApp(): string {
  return (process.env.PUBLIC_APP_URL || "http://localhost:5173").replace(/\/+$/, "");
}

export function urlsRetorno(ruta: string): { successUrl: string; cancelUrl: string } {
  const base = `${baseApp()}${ruta}`;
  const sep = ruta.includes("?") ? "&" : "?";
  return { successUrl: `${base}${sep}stripe=ok`, cancelUrl: `${base}${sep}stripe=cancelado` };
}
