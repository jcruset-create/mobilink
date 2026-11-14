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

  test('los motivos de «no realizado» incluyen «Otro», que pide escribirlo', () {
    expect(motivosNoRealizado.last, 'Otro');
    expect(motivosNoRealizado, contains('El vehículo no está en la base'));
  });
}
