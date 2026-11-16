import 'package:flutter_test/flutter_test.dart';
import 'package:lite_app/services/api.dart';
import 'package:lite_app/services/avisador.dart';
import 'package:lite_app/services/mensajes_central.dart';

/// Un avisador que no toca el sistema: solo anota lo que le han pedido.
class AvisadorFalso implements Avisador {
  final List<int> sonados = [];
  final List<int> quitados = [];
  int quitarTodosLlamado = 0;

  @override
  Future<void> preparar() async {}

  @override
  Future<void> sonar(Map<String, dynamic> mensaje) async {
    sonados.add(mensaje['id'] as int);
  }

  @override
  Future<void> quitar(int id) async => quitados.add(id);

  @override
  Future<void> quitarTodos() async => quitarTodosLlamado++;
}

class ApiFalsa extends Api {
  ApiFalsa() : super('token-de-prueba');

  List<Map<String, dynamic>> pendientes = [];
  List<String> rapidas = const ['Voy', 'Llamo ahora', 'Necesito ayuda'];
  bool sinCobertura = false;

  final List<String> enviados = [];
  final List<String> acuses = [];

  @override
  Future<Map<String, dynamic>> pendingMessages() async {
    if (sinCobertura) throw OfflineError();
    return {'mensajes': pendientes, 'respuestasRapidas': rapidas};
  }

  @override
  Future<Map<String, dynamic>> sendMessage(int id, String body, String actionId) async {
    if (sinCobertura) throw OfflineError();
    enviados.add('$id:$body');
    return {'id': 1};
  }

  @override
  Future<void> markMessagesRead(int id, {int? messageId}) async {
    if (sinCobertura) throw OfflineError();
    acuses.add('$id:${messageId ?? 'todos'}');
  }
}

Map<String, dynamic> mensaje({
  required int id,
  bool repetir = false,
  bool urgente = false,
  int assistanceId = 50,
}) =>
    {
      'id': id,
      'assistanceId': assistanceId,
      'expedientNumber': 'ML-24118',
      'body': 'Llama a la central',
      'byName': 'Marta',
      'createdAtMs': 1700000000000,
      'readAtMs': null,
      'urgent': urgente,
      'escalado': repetir && !urgente,
      'repetirSonido': repetir,
      'sinLeerMin': 0,
    };

void main() {
  late AvisadorFalso avisador;
  late ApiFalsa api;
  late MensajesCentral servicio;
  final t0 = DateTime(2026, 11, 16, 9, 0, 0);

  setUp(() async {
    avisador = AvisadorFalso();
    api = ApiFalsa();
    servicio = MensajesCentral(avisador: avisador);
    await servicio.iniciarParaPruebas(api);
  });

  group('cuándo suena', () {
    test('CASO 1 · un mensaje normal suena una vez y no vuelve a sonar', () async {
      api.pendientes = [mensaje(id: 1)];
      await servicio.consultar(ahora: t0);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      await servicio.consultar(ahora: t0.add(const Duration(minutes: 2)));
      expect(avisador.sonados, [1]);
    });

    test('CASO 2 · un urgente vuelve a sonar en cada vuelta', () async {
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 30)));
      expect(avisador.sonados, [1, 1, 1]);
    });

    test('CASO 3 · el urgente no suena dos veces en la misma vuelta', () async {
      // El Timer no cae clavado: a los 14 s ya se acepta, pero a los 3 no.
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 3)));
      expect(avisador.sonados, [1]);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 13)));
      expect(avisador.sonados, [1, 1]);
    });

    test('CASO 4 · un normal que escala empieza a repetir sin ser urgente', () async {
      api.pendientes = [mensaje(id: 1)];
      await servicio.consultar(ahora: t0);
      // Tres minutos después el servidor lo devuelve ya escalado.
      api.pendientes = [mensaje(id: 1, repetir: true)];
      await servicio.consultar(ahora: t0.add(const Duration(minutes: 3)));
      await servicio.consultar(ahora: t0.add(const Duration(minutes: 3, seconds: 15)));
      expect(avisador.sonados, [1, 1, 1]);
      expect(servicio.pendientes.first['escalado'], true);
    });

    test('CASO 5 · varios mensajes suenan cada uno por su cuenta', () async {
      api.pendientes = [mensaje(id: 1), mensaje(id: 2, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      expect(avisador.sonados, [1, 2, 2]);
    });
  });

  group('cuándo deja de sonar', () {
    test('CASO 6 · leído en otro sitio: se quita el aviso puesto', () async {
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      api.pendientes = []; // el operario abrió el hilo en la ficha
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      expect(avisador.quitados, [1]);
      expect(servicio.pendientes, isEmpty);
    });

    test('CASO 7 · «Entendido» quita ese mensaje y acusa SOLO ese', () async {
      api.pendientes = [mensaje(id: 1), mensaje(id: 2, assistanceId: 50)];
      await servicio.consultar(ahora: t0);
      await servicio.entendido(1, 50);
      expect(api.acuses, ['50:1']);
      expect(avisador.quitados, [1]);
      // El segundo sigue en pie: el aviso pasa a enseñar ese.
      expect(servicio.pendientes.map((m) => m['id']), [2]);
    });

    test('CASO 8 · contestar cuenta como leído de toda la asistencia', () async {
      api.pendientes = [mensaje(id: 1), mensaje(id: 2), mensaje(id: 3, assistanceId: 77)];
      await servicio.consultar(ahora: t0);
      final ok = await servicio.responder(assistanceId: 50, texto: '  Voy  ');
      expect(ok, true);
      expect(api.enviados, ['50:Voy']);
      expect(api.acuses, ['50:todos']);
      // Los dos de esa asistencia fuera; el de la otra, intacto.
      expect(servicio.pendientes.map((m) => m['id']), [3]);
      expect(avisador.quitados, [1, 2]);
    });

    test('CASO 9 · una respuesta vacía no se envía', () async {
      expect(await servicio.responder(assistanceId: 50, texto: '   '), false);
      expect(api.enviados, isEmpty);
    });

    test('CASO 10 · detener lo deja todo limpio', () async {
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      await servicio.detener();
      expect(servicio.pendientes, isEmpty);
      expect(avisador.quitarTodosLlamado, 1);
      // Y si vuelve a aparecer, suena otra vez: no se recuerda el pasado.
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      expect(avisador.sonados, [1, 1]);
    });
  });

  group('sin cobertura', () {
    test('CASO 11 · el aviso se queda en pantalla', () async {
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      api.sinCobertura = true;
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      // Nada que nadie ha confirmado se borra por perder la señal.
      expect(servicio.pendientes.map((m) => m['id']), [1]);
      expect(avisador.quitados, isEmpty);
    });

    test('CASO 12 · contestar sin cobertura no da el mensaje por enviado', () async {
      api.pendientes = [mensaje(id: 1)];
      await servicio.consultar(ahora: t0);
      api.sinCobertura = true;
      expect(await servicio.responder(assistanceId: 50, texto: 'Voy'), false);
      // Sigue pendiente: dar por contestado algo que no ha salido dejaría al
      // operario creyendo que la central ya lo sabe.
      expect(servicio.pendientes.map((m) => m['id']), [1]);
    });

    test('CASO 13 · si el acuse no sale, el mensaje volverá y sonará otra vez', () async {
      api.pendientes = [mensaje(id: 1, urgente: true, repetir: true)];
      await servicio.consultar(ahora: t0);
      api.sinCobertura = true;
      await servicio.entendido(1, 50);
      expect(servicio.pendientes, isEmpty); // se quita de la pantalla
      api.sinCobertura = false; // vuelve la cobertura y el servidor no lo tenía leído
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 30)));
      expect(servicio.pendientes.map((m) => m['id']), [1]);
      expect(avisador.sonados, [1, 1]);
    });
  });

  test('CASO 14 · las respuestas rápidas las manda el servidor', () async {
    api.rapidas = const ['Voy', 'Llego en 10', 'Aviso al cliente'];
    await servicio.consultar(ahora: t0);
    expect(servicio.respuestasRapidas, ['Voy', 'Llego en 10', 'Aviso al cliente']);
  });

  test('CASO 15 · una lista vacía del servidor no borra las rápidas', () async {
    api.rapidas = const [];
    await servicio.consultar(ahora: t0);
    expect(servicio.respuestasRapidas, ['Voy', 'Llamo ahora', 'Necesito ayuda']);
  });
}
