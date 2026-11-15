import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/screens/otf_trabajo_screens.dart';
import 'package:sea_tarragona_operario/services/api_service.dart';

Map<String, dynamic> _trabajo({List<Map<String, dynamic>> fotos = const []}) => {
      'id': 5,
      'plate': 'R8535BBY',
      'tipoVehiculo': 'Remolque',
      'trabajo': 'Cambiar 2 neumáticos 385/65R22.5',
      'status': 'pendiente',
      'fotos': fotos,
    };

FilledButton _boton(WidgetTester tester) => tester.widget<FilledButton>(
      find.ancestor(of: find.text('Empezar trabajo'), matching: find.byType(FilledButton)),
    );

void main() {
  final api = ApiService(techName: 'David', code: '0000');

  // Una tablet alta: el botón está al final de la lista y, si no cabe, la
  // lista ni lo construye.
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });
  Future<void> pantallaAlta(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(600, 1800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
  }

  testWidgets('sin foto de la matrícula no se puede empezar', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfInicioTrabajoScreen(api: api, trabajo: _trabajo(), numero: 1, total: 3),
    ));
    expect(find.text('Trabajo 1 de 3'), findsOneWidget);
    expect(find.text('OBLIGATORIA'), findsOneWidget);
    expect(_boton(tester).onPressed, isNull);
    expect(find.text('Se activa al hacer la foto de la matrícula'), findsOneWidget);
  });

  testWidgets('si ya tiene la foto de la matrícula (alta en campo), se puede empezar', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfInicioTrabajoScreen(
        api: api,
        trabajo: _trabajo(fotos: [{'kind': 'matricula', 'url': 'https://x/y.jpg'}]),
        numero: 2,
        total: 3,
      ),
    ));
    expect(_boton(tester).onPressed, isNotNull);
  });

  test('los motivos de «no realizado» incluyen «Otro»', () {
    expect(motivosNoRealizado.last, 'Otro');
    expect(motivosNoRealizado, contains('El vehículo no está en la base'));
  });

  testWidgets('antes de empezar, sin foto, ya se puede decir que no se puede realizar', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfInicioTrabajoScreen(api: api, trabajo: _trabajo(), numero: 1, total: 3),
    ));
    final b = tester.widget<OutlinedButton>(
      find.ancestor(of: find.text('No se puede realizar…'), matching: find.byType(OutlinedButton)),
    );
    expect(b.onPressed, isNotNull);
  });

  testWidgets('no realizado: hace falta motivo y explicación', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfNoRealizadoScreen(api: api, trabajo: _trabajo(), numero: 3, total: 3),
    ));
    FilledButton marcar() => tester.widget<FilledButton>(
          find.ancestor(of: find.text('Marcar como no realizado'), matching: find.byType(FilledButton)),
        );
    expect(find.text('OBLIGATORIO'), findsOneWidget);
    expect(marcar().onPressed, isNull);
    await tester.tap(find.text('Falta material'));
    await tester.pump();
    expect(marcar().onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'corto');
    await tester.pump();
    expect(find.text('Un poco más de detalle, para que la oficina lo entienda.'), findsOneWidget);
    expect(marcar().onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'Solo llevo 2 neumáticos, hacen falta 4');
    await tester.pump();
    expect(marcar().onPressed, isNotNull);
  });

  testWidgets('corregir un no realizado viene relleno', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfNoRealizadoScreen(
        api: api,
        trabajo: {
          ..._trabajo(fotos: [{'kind': 'no_realizado', 'url': 'https://x/y.jpg'}]),
          'status': 'no_realizado',
          'motivoNoRealizado': 'Falta material',
          'explicacionNoRealizado': 'Solo llevo 2 neumáticos, hacen falta 4',
        },
        numero: 3,
        total: 3,
      ),
    ));
    expect(find.text('Solo llevo 2 neumáticos, hacen falta 4'), findsOneWidget);
    expect(find.text('Ya tiene 1 foto(s) de antes'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Falta material')).selected, isTrue);
  });

  testWidgets('en curso: la lista de comprobación de la plantilla y el material ya montado', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfTrabajoEnCursoScreen(
        api: api,
        trabajo: {
          ..._trabajo(),
          'status': 'en_proceso',
          'iniciadoAtMs': DateTime.now().millisecondsSinceEpoch,
          'checklistPlantilla': ['Presiones', 'Par de apriete'],
          'material': [
            {'id': 3, 'texto': '2 × 385/65R22.5 Continental (nuevo)'},
          ],
        },
        numero: 1,
        total: 3,
      ),
    ));
    expect(find.text('Comprobar al terminar'), findsOneWidget);
    expect(find.text('Presiones'), findsOneWidget);
    expect(find.text('Par de apriete'), findsOneWidget);
    expect(find.text('2 × 385/65R22.5 Continental (nuevo)'), findsOneWidget);
    await tester.tap(find.byType(Checkbox).first);
    await tester.pump();
    expect(tester.widget<Checkbox>(find.byType(Checkbox).first).value, isTrue);
    // El reloj de la pantalla: se para antes de acabar la prueba.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('cambio de neumáticos: el plano con las ruedas a cambiar, antes de empezar', (tester) async {
    await pantallaAlta(tester);
    await tester.pumpWidget(MaterialApp(
      home: OtfInicioTrabajoScreen(
        api: api,
        trabajo: {
          ..._trabajo(),
          'posicionesTexto': 'Eje 2: izq. ext., izq. int.',
          'neumaticosTexto': '2 × Continental HD3 315/70R22.5 (nuevo)',
          'neumaticos': {
            'imagenUrl': null,
            'seleccion': ['E2_IZQ_EXT', 'E2_IZQ_INT'],
            'posiciones': [
              {'id': 'a', 'codigo': 'E1_IZQ', 'eje': 1, 'lado': 'izq', 'x': 7, 'y': 10, 'w': 14, 'h': 14},
              {'id': 'b', 'codigo': 'E1_DER', 'eje': 1, 'lado': 'der', 'x': 79, 'y': 10, 'w': 14, 'h': 14},
              {'id': 'c', 'codigo': 'E2_IZQ_EXT', 'eje': 2, 'lado': 'izq', 'interiorExterior': 'ext', 'x': 0, 'y': 76, 'w': 14, 'h': 14},
              {'id': 'd', 'codigo': 'E2_IZQ_INT', 'eje': 2, 'lado': 'izq', 'interiorExterior': 'int', 'x': 14, 'y': 76, 'w': 14, 'h': 14},
            ],
          },
        },
        numero: 1,
        total: 1,
      ),
    ));
    expect(find.text('Ruedas a cambiar'), findsOneWidget);
    expect(find.text('E2 IZQ EXT'), findsOneWidget);
    expect(find.text('E1 DER'), findsOneWidget);
    expect(find.text('Eje 2: izq. ext., izq. int.'), findsOneWidget);
    expect(find.text('2 × Continental HD3 315/70R22.5 (nuevo)'), findsOneWidget);
  });
}
