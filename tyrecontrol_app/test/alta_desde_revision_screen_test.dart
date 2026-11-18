// Que la pantalla «¿Es esta matrícula?» del alta desde Nueva revisión monta y
// decide bien cuándo deja seguir. Sin red: solo el primer paso, que no llama a
// nada. La lógica de formato y dudas vive en `matricula_test.dart`.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/screens/alta_desde_revision_screen.dart';

void main() {
  Future<void> montar(WidgetTester tester, Widget pantalla) async {
    tester.view.physicalSize = const Size(1200, 1900);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: pantalla));
    await tester.pump();
  }

  testWidgets('una lectura buena deja confirmar la matrícula', (tester) async {
    await montar(tester, const AltaDesdeRevisionScreen(matricula: '4721LMN'));
    expect(find.text('Matrícula leída'), findsOneWidget);
    expect(find.text('Sí, es esta'), findsOneWidget);
    expect(find.text('Repetir foto'), findsOneWidget);
    expect(find.textContaining('Leída con seguridad'), findsOneWidget);
  });

  testWidgets('con un carácter dudoso solo deja repetir la foto', (tester) async {
    await montar(tester, const AltaDesdeRevisionScreen(matricula: '4721LMN', dudososIa: [5]));
    expect(find.text('Sí, es esta'), findsNothing);
    expect(find.text('Repetir foto'), findsOneWidget);
    expect(find.textContaining('un carácter dudoso'), findsOneWidget);
  });

  testWidgets('sin formato de matrícula tampoco deja seguir', (tester) async {
    await montar(tester, const AltaDesdeRevisionScreen(matricula: 'ABCDEFG'));
    expect(find.text('Sí, es esta'), findsNothing);
    expect(find.textContaining('No tiene formato'), findsOneWidget);
  });

  testWidgets('Repetir foto devuelve RepetirFoto a quien la abrió', (tester) async {
    SalidaAltaDesdeRevision? salida;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () async {
            salida = await Navigator.of(context).push<SalidaAltaDesdeRevision>(MaterialPageRoute(
                builder: (_) => const AltaDesdeRevisionScreen(matricula: '4721LMN')));
          },
          child: const Text('abrir'),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Repetir foto'));
    await tester.pumpAndSettle();
    expect(salida, isA<RepetirFoto>());
  });
}
