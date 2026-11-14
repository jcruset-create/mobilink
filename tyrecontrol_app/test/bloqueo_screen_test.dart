import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/screens/bloqueo_screen.dart';

/// El candado de Face ID: pide la cara sola al abrir, deja pasar si el sistema
/// la da por buena y, si no, NO vuelve a pedirla en bucle.
void main() {
  Widget app({required Future<bool> Function(String) autenticar}) => MaterialApp(
        home: BloqueoScreen(
          destino: (_) => const Scaffold(body: Text('DENTRO')),
          autenticar: autenticar,
          nombre: () async => 'Face ID',
        ),
      );

  testWidgets('se identifica a la primera y entra', (t) async {
    var veces = 0;
    await t.pumpWidget(app(autenticar: (_) async {
      veces++;
      return true;
    }));
    await t.pumpAndSettle();
    expect(find.text('DENTRO'), findsOneWidget);
    expect(veces, 1);
  });

  testWidgets('si falla no reintenta solo; el botón sí', (t) async {
    var veces = 0;
    var respuesta = false;
    await t.pumpWidget(app(autenticar: (_) async {
      veces++;
      return respuesta;
    }));
    await t.pumpAndSettle();
    expect(veces, 1);
    expect(find.textContaining('No se ha podido identificar con Face ID'), findsOneWidget);
    expect(find.text('Entrar con Face ID'), findsOneWidget);

    respuesta = true;
    await t.tap(find.byKey(const Key('entrar-biometria')));
    await t.pumpAndSettle();
    expect(veces, 2);
    expect(find.text('DENTRO'), findsOneWidget);
  });

  testWidgets('se puede entrar con nombre y PIN', (t) async {
    await t.pumpWidget(app(autenticar: (_) async => false));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('entrar-con-pin')));
    await t.pumpAndSettle();
    expect(find.text('PIN de acceso (4 dígitos)'), findsOneWidget);
  });
}
