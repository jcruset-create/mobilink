// Que la pantalla «Vehículos en bases» monta.
//
// Es una prueba de humo, no de la lógica: esa vive en
// `presencia_vista_test.dart`, sobre funciones puras. Aquí se comprueba lo que
// allí no se ve —que el árbol de widgets se construye sin reventar— y el único
// camino que no necesita ni red ni sesión de Supabase: sin cliente elegido, la
// pantalla tiene que decir qué hacer en vez de quedarse girando o caerse.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/screens/vehiculos_en_bases_screen.dart';
import 'package:tyrecontrol_app/services/supabase_service.dart';

void main() {
  setUp(() => TyreControlApi.clienteActivo.value = null);

  testWidgets('sin cliente elegido explica qué hacer y ofrece reintentar', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: VehiculosEnBasesScreen()));
    await tester.pumpAndSettle();

    expect(find.textContaining('Elige primero un cliente'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
    // Y no se queda girando: un indicador eterno parece una red lenta.
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('fuera del Scaffold de Inicio trae su propia barra con el título', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: VehiculosEnBasesScreen()));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Vehículos en bases'), findsOneWidget);
  });

  testWidgets('embebida no pinta barra propia: la pone quien la embebe', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: VehiculosEnBasesScreen(embedded: true))),
    );
    await tester.pumpAndSettle();
    expect(find.byType(AppBar), findsNothing);
    expect(find.textContaining('Elige primero un cliente'), findsOneWidget);
  });

  tearDown(() => TyreControlApi.clienteActivo.value = null);
}
