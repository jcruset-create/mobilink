// Que el paso «Uso» del alta monta y no deja seguir sin elegir. Sin red: la
// carga falla (no hay Supabase en las pruebas) y la pantalla tiene que seguir
// pintando el paso con el aviso arriba, no quedarse girando.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/screens/alta_ejes_screen.dart';

void main() {
  testWidgets('el uso se elige con un toque y entonces deja continuar', (tester) async {
    tester.view.physicalSize = const Size(1200, 2000);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(
      home: AltaEjesScreen(vehiculoId: 'v', matricula: '4721LMN', tipoVehiculoId: 't'),
    ));
    await tester.pumpAndSettle();

    expect(find.text('¿Para qué se usa?'), findsOneWidget);
    expect(find.text('Paso 3 de 5 · uso'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);

    FilledButton continuar() =>
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Continuar'));
    expect(continuar().onPressed, isNull);

    await tester.tap(find.text('Regional'));
    await tester.pump();
    expect(continuar().onPressed, isNotNull);

    await tester.tap(find.widgetWithText(FilledButton, 'Continuar'));
    await tester.pumpAndSettle();
    expect(find.text('Paso 4 de 5 · ejes'), findsOneWidget);
  });
}
