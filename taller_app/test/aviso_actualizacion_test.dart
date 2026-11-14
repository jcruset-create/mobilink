// MISMO FICHERO en las cuatro apps que llevan lib/widgets/aviso_actualizacion.dart
// (solo cambia el nombre del paquete en el import).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:taller_app/widgets/aviso_actualizacion.dart';

void main() {
  group('compararVersiones', () {
    test('el nombre manda', () {
      expect(compararVersiones('1.2.8+279', '1.2.7+400'), greaterThan(0));
      expect(compararVersiones('1.10.0', '1.9.9'), greaterThan(0));
      expect(compararVersiones('1.2.7+278', '1.3.0+1'), lessThan(0));
    });
    test('con el mismo nombre decide el build, si los dos lo traen', () {
      expect(compararVersiones('1.2.7+279', '1.2.7+278'), greaterThan(0));
      expect(compararVersiones('1.2.7', '1.2.7+278'), 0);
      expect(compararVersiones('1.2.7+278', '1.2.7+278'), 0);
    });
    test('en iPhone el build no cuenta', () {
      expect(compararVersiones('1.2.7+278', '1.2.7+290', conBuild: false), 0);
      expect(compararVersiones('1.2.7+300', '1.2.7+290', conBuild: false), 0);
    });
  });

  Widget app({
    required String instalada,
    required String? ultima,
    bool ios = false,
    List<Uri>? abiertos,
  }) =>
      MaterialApp(
        builder: (context, child) => AvisoActualizacion(
          app: 'tyrecontrol',
          versionInstalada: () async => instalada,
          ultimaVersion: () async => ultima,
          esIos: ios,
          abrir: (u) async => abiertos?.add(u),
          child: child!,
        ),
        home: const Scaffold(body: Text('PANTALLA')),
      );

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Android: con versión nueva sale la franja y descarga la APK', (t) async {
    final abiertos = <Uri>[];
    await t.pumpWidget(app(instalada: '1.2.7+278', ultima: '1.2.8+279', abiertos: abiertos));
    await t.pumpAndSettle();
    expect(find.text('Hay una versión nueva (1.2.8)'), findsOneWidget);
    expect(find.text('PANTALLA'), findsOneWidget);
    await t.tap(find.byKey(const Key('aviso-actualizacion-actualizar')));
    expect(abiertos.single.toString(), 'https://sea-tarragona.onrender.com/apps/tyrecontrol');
  });

  testWidgets('al día, o sin red, no sale nada', (t) async {
    await t.pumpWidget(app(instalada: '1.2.8+279', ultima: '1.2.8+279'));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('aviso-actualizacion')), findsNothing);

    await t.pumpWidget(app(instalada: '1.2.7+278', ultima: null));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('aviso-actualizacion')), findsNothing);
  });

  testWidgets('«Más tarde» la esconde', (t) async {
    await t.pumpWidget(app(instalada: '1.2.7+278', ultima: '1.2.8+279'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('aviso-actualizacion-mas-tarde')));
    await t.pump();
    expect(find.byKey(const Key('aviso-actualizacion')), findsNothing);
  });

  testWidgets('iPhone: la primera vez que se ve la versión, todavía no avisa', (t) async {
    await t.pumpWidget(app(instalada: '1.2.7+290', ultima: '1.2.8+279', ios: true));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('aviso-actualizacion')), findsNothing);
  });

  testWidgets('iPhone: pasada una hora, avisa y abre TestFlight', (t) async {
    final haceDosHoras = DateTime.now().subtract(const Duration(hours: 2)).millisecondsSinceEpoch;
    SharedPreferences.setMockInitialValues({'aviso_actualizacion_visto_1.2.8+279': haceDosHoras});
    final abiertos = <Uri>[];
    await t.pumpWidget(app(instalada: '1.2.7+290', ultima: '1.2.8+279', ios: true, abiertos: abiertos));
    await t.pumpAndSettle();
    expect(find.text('Hay una versión nueva (1.2.8) en TestFlight'), findsOneWidget);
    await t.tap(find.byKey(const Key('aviso-actualizacion-actualizar')));
    expect(abiertos.single.toString(), 'itms-beta://');
  });
}
