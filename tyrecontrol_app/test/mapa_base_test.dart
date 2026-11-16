// El mapa de una base: qué autobuses entran, cómo se agrupan y la pantalla.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:tyrecontrol_app/models/mapa_base.dart';
import 'package:tyrecontrol_app/models/presencia_vista.dart';
import 'package:tyrecontrol_app/screens/mapa_base_screen.dart';

// La base de Reus, más o menos.
const _lat = 41.1561;
const _lng = 1.1069;

VehiculoPresencia bus(
  String id,
  String matricula, {
  String estado = enBase,
  String base = 'reus',
  double? lat = _lat,
  double? lng = _lng,
  int? antiguedadMin = 5,
}) =>
    VehiculoPresencia(
      vehiculoId: id,
      matricula: matricula,
      estado: estado,
      delegacionId: base,
      delegacionNombre: 'Reus',
      lat: lat,
      lng: lng,
      antiguedadMin: antiguedadMin,
      distanciaM: 40,
    );

RevisionEstado rev(String id, String estado, {int? dias}) =>
    RevisionEstado(vehiculoId: id, estado: estado, diasVencido: dias);

void main() {
  group('pinesDeLaBase', () {
    final vehiculos = [
      bus('a', '1111AAA'),
      bus('b', '2222BBB'),
      bus('c', '3333CCC'),
      bus('d', '4444DDD', base: 'vilanova'),
      bus('e', '5555EEE', estado: 'IN_ROUTE'),
      bus('f', '6666FFF', lat: 0, lng: 0),
      bus('g', '7777GGG', lat: null, lng: null),
      bus('h', '8888HHH', estado: posicionAntigua, antiguedadMin: 300),
      bus('i', '9999III', antiguedadMin: 90),
    ];
    final revisiones = {
      'a': rev('a', 'vencida', dias: 3),
      'b': rev('b', 'sin_revision'),
      'c': rev('c', 'al_dia'),
      'd': rev('d', 'sin_revision'),
      'e': rev('e', 'sin_revision'),
      'f': rev('f', 'sin_revision'),
      'g': rev('g', 'sin_revision'),
      'h': rev('h', 'vencida', dias: 40),
      'i': rev('i', 'proxima'),
    };
    final pines = pinesDeLaBase('reus', vehiculos, revisiones);

    test('solo los pendientes de ESA base, dentro y con una posición que valga', () {
      expect(pines.map((p) => p.v.matricula), ['2222BBB', '8888HHH', '1111AAA', '9999III']);
    });

    test('van por urgencia: sin revisión, luego la más vencida, luego la próxima', () {
      expect(pines.map((p) => p.rev.estado), ['sin_revision', 'vencida', 'vencida', 'proxima']);
    });

    test('la posición antigua o de hace más de una hora queda marcada', () {
      final vieja = {for (final p in pines) p.v.matricula: p.vieja};
      expect(vieja, {'2222BBB': false, '8888HHH': true, '1111AAA': false, '9999III': true});
    });

    test('la leyenda cuenta por estado', () {
      expect(cuentaPorEstado(pines), {'sin_revision': 1, 'vencida': 2, 'proxima': 1});
    });

    test('sin estado de revisión no entra: no se sabe si está pendiente', () {
      expect(pinesDeLaBase('reus', [bus('z', '0000ZZZ')], const {}), isEmpty);
    });
  });

  group('agruparPines', () {
    // Dos autobuses a ~3 m y otro a ~150 m.
    final juntos = [
      PinDeMapa(v: bus('a', '1111AAA'), rev: rev('a', 'vencida'), vieja: false),
      PinDeMapa(v: bus('b', '2222BBB', lat: _lat + 0.00003), rev: rev('b', 'sin_revision'), vieja: false),
      PinDeMapa(v: bus('c', '3333CCC', lng: _lng + 0.0018), rev: rev('c', 'vencida'), vieja: false),
    ];

    test('con el mapa alejado, los que se pisan van en un grupo', () {
      final g = agruparPines(juntos, 16);
      expect(g.map((x) => x.pines.length), [2, 1]);
      expect(g.first.esUno, isFalse);
    });

    test('el grupo toma el color del más urgente', () {
      expect(agruparPines(juntos, 16).first.estadoMasUrgente, 'sin_revision');
    });

    test('con el mapa muy alejado van todos juntos', () {
      expect(agruparPines(juntos, 12).map((x) => x.pines.length), [3]);
    });

    test('al zoom máximo no se agrupa: ahí ya no se puede acercar más', () {
      expect(agruparPines(juntos, 19).map((x) => x.pines.length), [1, 1, 1]);
    });

    test('el grupo se coloca en el centro de los suyos', () {
      final g = agruparPines(juntos, 16).first;
      expect(g.lat, closeTo(_lat + 0.000015, 1e-9));
      expect(g.lng, closeTo(_lng, 1e-9));
    });

    test('sin pines no hay grupos', () {
      expect(agruparPines(const [], 16), isEmpty);
    });
  });

  group('MapaBaseScreen', () {
    const base = BaseGeo(id: 'reus', nombre: 'Reus', lat: _lat, lng: _lng, radioM: 300);
    // Separados unos 80 m entre sí, para que no se agrupen.
    final pines = [
      PinDeMapa(v: bus('a', '7524NNB', lat: _lat + 0.0008), rev: rev('a', 'sin_revision'), vieja: false),
      PinDeMapa(v: bus('b', '0683MNS', lat: _lat - 0.0008), rev: rev('b', 'vencida', dias: 12), vieja: false),
      PinDeMapa(
        v: bus('c', '1761LWP', lng: _lng + 0.0012, antiguedadMin: 200),
        rev: rev('c', 'sin_revision'),
        vieja: true,
      ),
    ];

    Future<List<String>> montar(WidgetTester t, List<PinDeMapa> ps, {Size tamano = const Size(768, 1024)}) async {
      final revisados = <String>[];
      t.view.physicalSize = tamano;
      t.view.devicePixelRatio = 1.0;
      addTearDown(t.view.reset);
      await t.pumpWidget(MaterialApp(
        home: MapaBaseScreen(
          base: base,
          pines: ps,
          nombreDeBase: const {'reus': 'Reus'},
          onRevisar: (v) async => revisados.add(v.matricula),
          sinMosaicos: true,
          miPosicion: () async => const LatLng(_lat - 0.0004, _lng - 0.0015),
        ),
      ));
      await t.pumpAndSettle();
      return revisados;
    }

    testWidgets('pinta una etiqueta por autobús, la leyenda y la tablet', (t) async {
      await montar(t, pines);
      expect(find.text('Reus'), findsOneWidget);
      expect(find.text('3 con revisión pendiente dentro de la base'), findsOneWidget);
      for (final m in ['7524NNB', '0683MNS', '1761LWP']) {
        expect(find.byKey(Key('pin-$m')), findsOneWidget);
      }
      expect(find.text('Sin revisión · 2'), findsOneWidget);
      expect(find.text('Revisión vencida · 1'), findsOneWidget);
      expect(find.text('Posición de hace más de 1 h'), findsOneWidget);
      expect(find.byKey(const Key('mapa-mi-posicion')), findsOneWidget);
    });

    testWidgets('al tocar una etiqueta sale su ficha, y desde ella se inicia la revisión', (t) async {
      final revisados = await montar(t, pines);
      expect(find.text('Iniciar revisión'), findsNothing);
      await t.tap(find.byKey(const Key('pin-7524NNB')));
      await t.pumpAndSettle();
      expect(find.text('Iniciar revisión'), findsOneWidget);
      expect(find.byKey(const Key('como-llegar')), findsOneWidget);
      await t.tap(find.text('Iniciar revisión'));
      await t.pumpAndSettle();
      expect(revisados, ['7524NNB']);
    });

    testWidgets('la ficha se cierra con su aspa', (t) async {
      await montar(t, pines);
      await t.tap(find.byKey(const Key('pin-0683MNS')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('mapa-cerrar-ficha')));
      await t.pumpAndSettle();
      expect(find.text('Iniciar revisión'), findsNothing);
    });

    testWidgets('sin pendientes lo dice, en vez de un mapa vacío sin explicación', (t) async {
      await montar(t, const []);
      expect(find.text('Ningún autobús pendiente dentro de la base'), findsOneWidget);
      expect(find.textContaining('no hay ningún autobús con la revisión pendiente'), findsOneWidget);
    });

    testWidgets('cabe en un móvil sin desbordar, con la ficha abierta', (t) async {
      await montar(t, pines, tamano: const Size(360, 740));
      await t.tap(find.byKey(const Key('pin-7524NNB')));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
    });
  });
}
