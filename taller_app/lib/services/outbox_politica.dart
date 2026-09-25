/// Qué hacer con un elemento de la cola después de intentar enviarlo.
///
/// Está aquí fuera, y no dentro de `flushOutbox`, porque es la parte que se
/// puede equivocar en silencio y la única manera de fijarla es probarla. Ya
/// pasó dos veces: la cola descartaba en un error del servidor, y leía el
/// `jobId` antes de mirar el tipo.
enum AccionCola {
  /// Enviado (o irrecuperable): fuera de la cola.
  quitar,

  /// Se conserva y se reintenta en la siguiente pasada.
  conservar,

  /// Sin red: se para la pasada entera, el resto tampoco va a salir.
  parar,
}

/// Decisión a partir del código de respuesta del servidor.
///
/// Para una recepción de patio un 5xx NO descarta: el operario cree que la ha
/// enviado, y tirarla en silencio delante del cliente es pérdida de datos. Un
/// 4xx sí, porque reintentar una petición mal formada no la va a arreglar.
AccionCola accionPorRespuesta({required String tipo, required int codigo}) {
  if (codigo == 200) return AccionCola.quitar;
  if (tipo == 'recepcion' && codigo >= 500) return AccionCola.conservar;
  return AccionCola.quitar;
}

/// Decisión cuando la petición ni siquiera llegó a responder.
AccionCola accionPorExcepcion({required String tipo, required bool esDeRed}) {
  if (esDeRed) return AccionCola.parar;
  if (tipo == 'recepcion') return AccionCola.conservar;
  return AccionCola.quitar;
}

/// ¿Este elemento de la cola va asociado a un trabajo?
///
/// Una recepción no lo está: todavía no hay trabajo. Leer `item['jobId']` para
/// todos los tipos —que es lo que se hacía— rompía el cast y tumbaba la cola
/// entera, dejando sin enviar también los estados y las fotos.
bool llevaJobId(String tipo) => tipo == 'status' || tipo == 'upload_file';
