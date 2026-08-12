/**
 * Notificaciones push (Firebase Cloud Messaging v1) compartidas por todo el
 * ecosistema Mobilink: APK de operarios, Taller, ToolControl, Safety y
 * Mobilink Assist Lite.
 *
 * Credenciales: FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio).
 * El proyecto se toma de FIREBASE_PROJECT_ID o del propio JSON.
 * Si no hay credenciales configuradas, las funciones no hacen nada: el envío
 * de avisos nunca debe tumbar una operación de negocio.
 */

let cachedToken: { value: string; expiresAtMs: number } | null = null;

export async function getFcmAccessToken(): Promise<string | null> {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) return null;
    if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) return cachedToken.value;

    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      credentials: JSON.parse(serviceAccountJson),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) return null;
    // Los tokens de Google duran 1 h; se renueva con margen
    cachedToken = { value: tokenResponse.token, expiresAtMs: Date.now() + 50 * 60_000 };
    return tokenResponse.token;
  } catch (error) {
    console.error("getFcmAccessToken error:", (error as any)?.message ?? error);
    return null;
  }
}

function fcmProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}").project_id || "sea-tarragona";
  } catch {
    return "sea-tarragona";
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** Datos para el enrutado en la app (solo identificadores, nunca datos personales). */
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  invalidTokens: string[];
}

/**
 * Envía a una lista de tokens. Devuelve los tokens que FCM ha rechazado como
 * inválidos para que el llamante los limpie de su tabla de dispositivos.
 */
export async function sendPushToTokens(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const unique = [...new Set(tokens.filter((t) => typeof t === "string" && t.trim().length > 0))];
  const result: PushResult = { sent: 0, invalidTokens: [] };
  if (unique.length === 0) return result;

  const accessToken = await getFcmAccessToken();
  if (!accessToken) return result;
  const url = `https://fcm.googleapis.com/v1/projects/${fcmProjectId()}/messages:send`;

  for (const token of unique) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data,
            android: { priority: "high" },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      });
      if (res.ok) {
        result.sent++;
      } else if (res.status === 404 || res.status === 400) {
        // UNREGISTERED / INVALID_ARGUMENT: el token ya no sirve
        result.invalidTokens.push(token);
      }
    } catch (error) {
      // Solo el mensaje: el objeto de error de `fetch` arrastra la petición
      // entera, y ahí va el token del dispositivo.
      console.error("sendPushToTokens error:", (error as any)?.message ?? error);
    }
  }
  return result;
}
