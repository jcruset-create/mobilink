import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/services/matricula_es.dart';
import 'package:sea_tarragona_operario/widgets/contacto_base.dart';
import 'package:sea_tarragona_operario/widgets/plate_badge.dart';

void main() {
  // Las mismas reglas que el panel (src/modules/matriculaEs.test.ts).
  group('cómo se dibuja una matrícula', () {
    test('española actual: cuatro cifras y tres letras, separadas', () {
      final d = dibujoMatricula(' 6084 frg ');
      expect(d.tipo, TipoMatricula.actual);
      expect(d.partes, ['6084', 'FRG']);
    });

    test('remolque: la R delante', () {
      final d = dibujoMatricula('R8535BBY');
      expect(d.tipo, TipoMatricula.remolque);
      expect(d.partes, ['R', '8535', 'BBY']);
    });

    test('antigua de provincia', () {
      expect(dibujoMatricula('T-1234-AB').partes, ['T', '1234', 'AB']);
      expect(dibujoMatricula('GI0001B').tipo, TipoMatricula.antigua);
    });

    test('lo que no encaja se queda como está escrito', () {
      expect(dibujoMatricula('1234ABC').tipo, TipoMatricula.otra); // con vocales
      expect(dibujoMatricula('XY1234Z').tipo, TipoMatricula.otra); // no es provincia
      expect(dibujoMatricula('ab 123 cd').partes, ['AB 123 CD']);
      expect(dibujoMatricula(null).partes, ['']);
    });
  });

  testWidgets('la placa española lleva la banda con la E y los grupos separados', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Center(child: PlateBadge(plate: '6084FRG')))));
    expect(find.text('6084'), findsOneWidget);
    expect(find.text('FRG'), findsOneWidget);
    expect(find.text('E'), findsOneWidget);
    expect(find.bySemanticsLabel('Matrícula 6084 FRG'), findsOneWidget);
  });

  testWidgets('una extranjera sale tal cual, sin banda', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Center(child: PlateBadge(plate: 'AB123CD')))));
    expect(find.text('AB123CD'), findsOneWidget);
    expect(find.text('E'), findsNothing);
  });

  group('teléfono del contacto', () {
    test('para marcar: solo cifras, con el + si lo traía', () {
      expect(telefonoParaMarcar('600 11 22 33'), '600112233');
      expect(telefonoParaMarcar('+34 600-11-22-33'), '+34600112233');
    });

    test('para WhatsApp: con el 34 si son nueve cifras', () {
      expect(telefonoParaWhatsApp('600 11 22 33'), '34600112233');
      expect(telefonoParaWhatsApp('+34 600 11 22 33'), '34600112233');
      expect(telefonoParaWhatsApp('0033 6 12 34 56 78'), '33612345678');
    });
  });

  testWidgets('la tarjeta del contacto, con Llamar y WhatsApp', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ContactoBase(otf: {
          'contactoNombre': 'Jordi Martí',
          'contactoTelefono': '600 11 22 33',
          'contactoCargo': 'Encargado de la cantera',
        }),
      ),
    ));
    expect(find.text('Jordi Martí'), findsOneWidget);
    expect(find.text('Encargado de la cantera'), findsOneWidget);
    expect(find.text('Llamar'), findsOneWidget);
    expect(find.text('WhatsApp'), findsOneWidget);
  });

  testWidgets('sin contacto no se pinta nada; solo con nombre, sin botones', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ContactoBase(otf: {'clientName': 'X'}))));
    expect(find.text('PERSONA DE CONTACTO EN LA BASE'), findsNothing);
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ContactoBase(otf: {'contactoNombre': 'Jordi'}))));
    expect(find.text('Jordi'), findsOneWidget);
    expect(find.text('Llamar'), findsNothing);
  });

  testWidgets('el botón de las pantallas del trabajo: «Llamar a Jordi»', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: BotonLlamarContacto(trabajo: {'contactoNombre': 'Jordi Martí', 'contactoTelefono': '600112233'}),
      ),
    ));
    expect(find.text('Llamar a Jordi'), findsOneWidget);
  });
}
