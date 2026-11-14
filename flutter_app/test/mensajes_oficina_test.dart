import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/services/api_service.dart';
import 'package:sea_tarragona_operario/services/avisador_mensajes.dart';
import 'package:sea_tarragona_operario/services/mensajes_oficina.dart';
import 'package:sea_tarragona_operario/widgets/aviso_mensajes.dart';

class _Avisador implements Avisador {
  final sonados = <int>[];
  final quitados = <int>[];
  final otfSonadas = <int>[];
  @override
  Future<void> sonarOtf(Map<String, dynamic> otf) async => otfSonadas.add(otf['id'] as int);
  @override
  Future<void> quitarOtf(int otfId) async {}
  @override
  Future<void> preparar() async {}
  @override
  Future<void> sonar(Map<String, dynamic> m) async => sonados.add(m['id'] as int);
  @override
  Future<void> quitar(int id) async => quitados.add(id);
  @override
  Future<void> quitarTodos() async {}
}

class _Api extends ApiService {
  _Api() : super(techName: 'Iván', code: '0000');
  List<Map<String, dynamic>>? pendientes = [];
  List<Map<String, dynamic>> otfNuevas = [];
  final leidos = <int>[];
  final respuestas = <String>[];
  final otfVistas = <int>[];

  @override
  Future<
      ({
        List<Map<String, dynamic>> mensajes,
        List<String> respuestasRapidas,
        List<Map<String, dynamic>> otfNuevas,
      })?> getMensajesPendientes() async => pendientes == null
      ? null
      : (mensajes: pendientes!, respuestasRapidas: const ['Voy', 'Llamo ahora', 'Necesito ayuda'], otfNuevas: otfNuevas);
  @override
  Future<void> marcarOtfVista(int otfId) async => otfVistas.add(otfId);
  @override
  Future<bool> enviarMensajeOtf(int otfId, String texto) async {
    respuestas.add('otf$otfId:$texto');
    return true;
  }
  @override
  Future<bool> marcarMensajeLeido(int id) async {
    leidos.add(id);
    return true;
  }
  @override
  Future<bool> enviarMensajeOperario(int assistanceId, String texto) async {
    respuestas.add('$assistanceId:$texto');
    return true;
  }
}

Map<String, dynamic> _msg(int id, {bool repetir = false, int asistencia = 191, bool urgente = false}) => {
      'id': id,
      'assistanceId': asistencia,
      'texto': 'Llevar también una llanta de 22,5.',
      'autor': 'Oficina',
      'urgente': urgente,
      'escalado': false,
      'repetirSonido': repetir,
      'creadoAtMs': 0,
    };

void main() {
  late _Api api;
  late _Avisador avisador;
  late MensajesOficina servicio;
  final t0 = DateTime(2026, 11, 14, 13, 40);

  setUp(() async {
    api = _Api();
    avisador = _Avisador();
    servicio = MensajesOficina(avisador: avisador);
    // Sin `iniciar` (arrancaría un Timer real): se le da la api a mano.
    await servicio.iniciarParaPruebas(api);
  });

  test('un mensaje nuevo suena una vez y queda pendiente', () async {
    api.pendientes = [_msg(1)];
    await servicio.consultar(ahora: t0);
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 30)));
    expect(avisador.sonados, [1]);
    expect(servicio.pendientes.map((m) => m['id']), [1]);
  });

  test('urgente (o normal pasados 3 min): vuelve a sonar cada 15 s', () async {
    api.pendientes = [_msg(1, repetir: true)];
    await servicio.consultar(ahora: t0);
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 5)));
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 30)));
    expect(avisador.sonados, [1, 1, 1]);
  });

  test('sin red no desaparece el aviso de la pantalla', () async {
    api.pendientes = [_msg(1)];
    await servicio.consultar(ahora: t0);
    api.pendientes = null;
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
    expect(servicio.pendientes, hasLength(1));
  });

  test('«Entendido» lo quita y lo marca leído en el servidor', () async {
    api.pendientes = [_msg(1), _msg(2)];
    await servicio.consultar(ahora: t0);
    await servicio.entendido(1);
    expect(api.leidos, [1]);
    expect(servicio.pendientes.map((m) => m['id']), [2]);
    expect(avisador.quitados, contains(1));
  });

  test('contestar quita todos los de esa asistencia', () async {
    api.pendientes = [_msg(1), _msg(2), _msg(3, asistencia: 200)];
    await servicio.consultar(ahora: t0);
    expect(await servicio.responder(assistanceId: 191, texto: 'Voy'), isTrue);
    expect(api.respuestas, ['191:Voy']);
    expect(servicio.pendientes.map((m) => m['id']), [3]);
  });

  test('si el servidor ya no lo da (leído en otro sitio), se quita el aviso', () async {
    api.pendientes = [_msg(1)];
    await servicio.consultar(ahora: t0);
    api.pendientes = [];
    await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
    expect(servicio.pendientes, isEmpty);
    expect(avisador.quitados, [1]);
  });

  testWidgets('el aviso sale a pantalla completa y «Entendido» lo cierra', (tester) async {
    api.pendientes = [_msg(1, urgente: true)];
    await servicio.consultar(ahora: t0);
    await tester.pumpWidget(MaterialApp(
      builder: (context, child) => AvisoMensajes(mensajes: servicio, child: child!),
      home: const Scaffold(body: Text('Asistencias')),
    ));
    expect(find.text('Has recibido un mensaje nuevo'), findsOneWidget);
    expect(find.text('URGENTE · OFICINA'), findsOneWidget);
    expect(find.text('Llevar también una llanta de 22,5.'), findsOneWidget);
    expect(find.text('Voy'), findsOneWidget);

    await tester.tap(find.text('Entendido'));
    await tester.pump();
    expect(find.text('Has recibido un mensaje nuevo'), findsNothing);
    expect(api.leidos, [1]);
  });

  group('OTF', () {
    Map<String, dynamic> otf(int id) => {'id': id, 'clientName': 'Conti 360', 'baseName': 'Riu Clar', 'numTrabajos': 3};

    test('una OTF nueva suena una sola vez y cuenta en la pestaña', () async {
      api.otfNuevas = [otf(7)];
      await servicio.consultar(ahora: t0);
      await servicio.consultar(ahora: t0.add(const Duration(seconds: 15)));
      expect(avisador.otfSonadas, [7]);
      expect(servicio.otfNuevas, hasLength(1));
      expect(servicio.otfParaAvisar, hasLength(1));
    });

    test('«Más tarde» la quita del aviso pero sigue contando en la pestaña', () async {
      api.otfNuevas = [otf(7)];
      await servicio.consultar(ahora: t0);
      servicio.otfPosponer(7);
      expect(servicio.otfParaAvisar, isEmpty);
      expect(servicio.otfNuevas, hasLength(1));
    });

    test('abrirla la deja vista aquí y en el servidor', () async {
      api.otfNuevas = [otf(7)];
      await servicio.consultar(ahora: t0);
      await servicio.otfVista(7);
      expect(servicio.otfNuevas, isEmpty);
      expect(api.otfVistas, [7]);
    });

    test('contestar un mensaje de una OTF va a la OTF y quita los suyos', () async {
      api.pendientes = [
        {..._msg(1), 'assistanceId': null, 'otfId': 7},
        _msg(2),
      ];
      await servicio.consultar(ahora: t0);
      expect(await servicio.responder(otfId: 7, texto: 'Lo dejo'), isTrue);
      expect(api.respuestas, ['otf7:Lo dejo']);
      expect(servicio.pendientes.map((m) => m['id']), [2]);
    });

    testWidgets('el aviso de OTF nueva sale si no hay mensajes, y «Más tarde» lo cierra', (tester) async {
      api.otfNuevas = [otf(7)];
      await servicio.consultar(ahora: t0);
      await tester.pumpWidget(MaterialApp(
        builder: (context, child) => AvisoMensajes(mensajes: servicio, child: child!),
        home: const Scaffold(body: Text('Asistencias')),
      ));
      expect(find.text('Tienes una OTF nueva'), findsOneWidget);
      expect(find.text('Conti 360'), findsOneWidget);
      await tester.tap(find.text('Más tarde'));
      await tester.pump();
      expect(find.text('Tienes una OTF nueva'), findsNothing);
    });
  });
}
