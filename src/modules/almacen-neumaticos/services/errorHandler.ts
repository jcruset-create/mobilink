type ErrorConMensaje = {
  message?: string;
};

export function obtenerMensajeError(error: unknown, fallback = "Error inesperado") {
  if (!error) return fallback;

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "object" && "message" in error) {
    const mensaje = (error as ErrorConMensaje).message;

    if (mensaje) return mensaje;
  }

  return fallback;
}

export function formatearError(error: unknown, contexto = "Error") {
  return `${contexto}: ${obtenerMensajeError(error)}`;
}