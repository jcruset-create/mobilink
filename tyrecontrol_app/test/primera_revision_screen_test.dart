// La primera revisión de un vehículo sin tipo: el aviso dice qué falta y
// «Empezar» y «Ahora no» hacen lo suyo. Sin red.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/screens/primera_revision_screen.dart';

void main() {
  testWidgets('el aviso enseña los cuatro pasos y los km, y empieza', (tester) async {
    tester.view.physicalSize = const Size(1200, 2000);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    var empezado = 0;
    var cancelado = 0;
    await tester.pumpWidget(MaterialApp(
      home: AvisoPrimeraRevision(
        matricula: '2135MGJ',
        numeroUnidad: '1764',
        empresa: 'Plana',
        km: 412380,
        onEmpezar: () => empezado++,
        onAhoraNo: () => cancelado++,
      ),
    ));
    expect(find.text('Primera revisión'), findsOneWidget);
    expect(find.textContaining('no tiene tipo ni neumáticos'), findsOneWidget);
    expect(find.text('Qué vehículo es (tipo)'), findsOneWidget);
    expect(find.text('Las ruedas que lleva ahora'), findsOneWidget);
    expect(find.text('Km de hoy: 412380'), findsOneWidget);

    await tester.tap(find.byKey(const Key('empezar-primera-revision')));
    await tester.tap(find.text('Ahora no'));
    expect(empezado, 1);
    expect(cancelado, 1);
  });
}
