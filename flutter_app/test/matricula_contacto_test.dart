import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/services/matricula_es.dart';
import 'package:sea_tarragona_operario/widgets/contacto_base.dart';
import 'package:sea_tarragona_operario/widgets/plate_badge.dart';

void main() {
  // Las mismas comprobaciones que el panel (src/modules/matriculaEs.test.ts):
  // la regla es una sola.
  group('matrículas españolas', () {
    test('actual: cuatro cifras y tres letras, con la E', () {
      final d = dibujoMatricula(' 6084 frg ');
      expect(d.tipo, TipoMatricula.actual);
      expect(d.partes, ['6084', 'FRG']);
      expect(d.pais, 'E');
      expect(d.banda, isTrue);
    });

    test('remolque: la R delante, en rojo', () {
      final d = dibujoMatricula('R8535BBY');
      expect(d.tipo, TipoMatricula.remolque);
      expect(d.partes, ['R', '8535', 'BBY']);
      expect(d.fondo, FondoMatricula.rojo);
    });

    test('vehículo especial: la E delante, letras rojas', () {
      final d = dibujoMatricula('E4843BJJ');
      expect(d.tipo, TipoMatricula.especial);
      expect(d.letrasRojas, isTrue);
    });

    test('antigua de provincia: sin banda', () {
      final d = dibujoMatricula('T-1234-AB');
      expect(d.partes, ['T', '1234', 'AB']);
      expect(d.banda, isFalse);
      expect(dibujoMatricula('GI0001B').tipo, TipoMatricula.antigua);
    });
  });

  group('otros países, cuando la forma no deja dudas', () {
    test('Portugal, Rumanía y Polonia', () {
      final p = dibujoMatricula('45-TX-89');
      expect(p.pais, 'P');
      expect(p.partes, ['45', 'TX', '89']);
      expect(p.separador, '·');
      expect(dibujoMatricula('B123ABC').pais, 'RO');
      expect(dibujoMatricula('CJ 12 ABC').partes, ['CJ', '12', 'ABC']);
      expect(dibujoMatricula('WX 1234A').pais, 'PL');
    });
  });

  group('cuando la forma no basta, no se adivina el país', () {
    test('Francia e Italia comparten patrón: placa UE sin letra', () {
      final d = dibujoMatricula('AB-123-CD');
      expect(d.tipo, TipoMatricula.ue);
      expect(d.pais, '');
      expect(d.banda, isTrue);
      expect(d.partes, ['AB 123 CD']);
    });

    test('una británica no sale como rumana', () {
      expect(dibujoMatricula('XY12CDE').pais, '');
    });

    test('lo que no parece una placa, liso y tal cual', () {
      final d = dibujoMatricula('P109470123456');
      expect(d.tipo, TipoMatricula.otra);
      expect(d.fondo, FondoMatricula.liso);
      expect(dibujoMatricula('SIN PLACA').tipo, TipoMatricula.otra);
      expect(dibujoMatricula(null).partes, ['']);
    });
  });

  group('con el país indicado', () {
    test('Francia con guiones, Italia con espacios', () {
      final f = dibujoMatricula('AB123CD', 'F');
      expect(f.pais, 'F');
      expect(f.partes, ['AB', '123', 'CD']);
      expect(f.separador, '-');
      expect(dibujoMatricula('AB123CD', 'I').separador, ' ');
    });

    test('Países Bajos en amarillo; fuera de la UE, liso', () {
      expect(dibujoMatricula('12-ABC-3', 'NL').fondo, FondoMatricula.amarillo);
      final x = dibujoMatricula('6084FRG', fueraUe);
      expect(x.tipo, TipoMatricula.otra);
      expect(x.banda, isFalse);
    });

    test('un país que no existe es como no indicarlo', () {
      expect(dibujoMatricula('6084FRG', 'ZZ').tipo, TipoMatricula.actual);
      expect(paisMatriculaValido(' f '), 'F');
      expect(paisMatriculaValido(''), isNull);
    });
  });

  testWidgets('la placa española lleva la banda con la E y los grupos separados', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Center(child: PlateBadge(plate: '6084FRG')))));
    expect(find.text('6084'), findsOneWidget);
    expect(find.text('FRG'), findsOneWidget);
    expect(find.text('E'), findsOneWidget);
    expect(find.bySemanticsLabel('Matrícula 6084 FRG'), findsOneWidget);
  });

  testWidgets('sin país claro: banda de la UE sin letra; con el país indicado, su letra', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Center(child: PlateBadge(plate: 'AB123CD')))));
    expect(find.text('AB123CD'), findsOneWidget);
    expect(find.text('F'), findsNothing);
    await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Center(child: PlateBadge(plate: 'AB123CD', pais: 'F', fontSize: 15)))));
    expect(find.text('F'), findsOneWidget);
    expect(find.text('123'), findsOneWidget);
    expect(find.text('-'), findsNWidgets(2));
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
