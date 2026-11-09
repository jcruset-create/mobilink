// La tarjeta de un vehículo en «Vehículos en bases».
//
// Lo que se vigila aquí es el DESBORDE. La tarjeta mete cuatro recuadros de
// datos en una fila, un distintivo con dos líneas de texto al lado de la
// matrícula y un botón a todo lo ancho. En la tablet de 10" cabe de sobra; en
// el iPhone donde también corre esta app va al límite, y un `RenderFlex
// overflowed` se pinta como una banda amarilla a rayas encima de los datos.
//
// En modo test, un desborde lanza excepción, así que montar la tarjeta a 360
// px y comprobar que no hay excepción ES la prueba.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/presencia_vista.dart';
import 'package:tyrecontrol_app/widgets/ficha_vehiculo_en_base.dart';

/// `FilledButton.icon` y `OutlinedButton.icon` devuelven subclases privadas,
/// así que `find.byType` no las encuentra: hay que preguntar por el tipo base.
final botonRelleno = find.byWidgetPredicate((w) => w is FilledButton);
final botonPerfilado = find.byWidgetPredicate((w) => w is OutlinedButton);

/// Monta la tarjeta a un ancho dado. Devuelve lo que se haya pintado.
Future<void> montar(
  WidgetTester tester,
  VehiculoPresencia v, {
  RevisionEstado? rev,
  double ancho = 360,
  Map<String, String> bases = const {},
}) async {
  tester.view.physicalSize = Size(ancho, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: FichaVehiculoEnBase(
              v: v,
              rev: rev,
              nombreDeBase: bases,
              abriendo: false,
              onRevisar: () {},
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final enBaseVencido = VehiculoPresencia(
  vehiculoId: 'v1',
  estado: enBase,
  delegacionId: 'd1',
  delegacionNombre: 'Hospitalet de l\'Infant',
  esSuBase: true,
  distanciaM: 71,
  antiguedadMin: 3,
  entradaBaseAt: '2026-11-07T06:00:00Z',
  matricula: '6137GDT',
);

final circulando = VehiculoPresencia(
  vehiculoId: 'v2',
  estado: fueraDeBases,
  distanciaM: 18400,
  antiguedadMin: 7,
  velocidadKmh: 82.6,
  matricula: '3818KMZ',
);

void main() {
  testWidgets('cabe a 360 px con todo relleno y el peor texto largo', (tester) async {
    await montar(
      tester,
      enBaseVencido,
      rev: const RevisionEstado(
        vehiculoId: 'v1',
        estado: 'vencida',
        diasVencido: 157,
        intervaloDias: 90,
        ultimaRevision: '2026-03-07',
        ultimaRevisionOrigen: 'tecnico',
        ultimaRevisionPor: 'Alejandro Fernández',
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('6137GDT'), findsOneWidget);
    expect(find.text('Vencida · 157 d'), findsOneWidget);
    expect(find.text('Alejandro Fernández'), findsOneWidget);
  });

  testWidgets('también a 1024 px, que es la tablet', (tester) async {
    await montar(tester, enBaseVencido, ancho: 1024);
    expect(tester.takeException(), isNull);
  });

  testWidgets('en base: lleva el botón verde y los datos del patio', (tester) async {
    await montar(tester, enBaseVencido);
    expect(tester.takeException(), isNull);
    expect(find.text('LLEVA EN LA BASE'), findsOneWidget);
    expect(find.text('DISTANCIA AL CENTRO'), findsOneWidget);
    expect(find.text('71 m'), findsOneWidget);
    // Verde y relleno: es lo que se puede hacer ahora.
    expect(botonRelleno, findsOneWidget);
    expect(botonPerfilado, findsNothing);
  });

  testWidgets('circulando: velocidad en vez de tiempo en base, y botón apagado', (tester) async {
    await montar(tester, circulando);
    expect(tester.takeException(), isNull);
    expect(find.text('VELOCIDAD'), findsOneWidget);
    expect(find.text('83 km/h'), findsOneWidget);
    expect(find.text('BASE MÁS CERCANA'), findsOneWidget);
    expect(find.text('18,4 km'), findsOneWidget);
    expect(find.text('LLEVA EN LA BASE'), findsNothing);
    // Sin botón verde: invitaría a bajar al patio a buscar un autobús que está
    // en la AP-7. Pero se puede pulsar, por si el técnico está donde él.
    expect(botonRelleno, findsNothing);
    expect(botonPerfilado, findsOneWidget);
  });

  testWidgets('en una base que no es la suya se dice «de paso»', (tester) async {
    final dePaso = VehiculoPresencia(
      vehiculoId: 'v3',
      estado: enBase,
      delegacionId: 'd1',
      esSuBase: false,
      matricula: '9474KSB',
    );
    await montar(tester, dePaso, bases: {'d1': 'Tarragona'});
    expect(find.text('Tarragona · de paso'), findsOneWidget);
  });

  testWidgets('con posición antigua se dice dónde se le VIO, no dónde está', (tester) async {
    final dormido = VehiculoPresencia(
      vehiculoId: 'v4',
      estado: posicionAntigua,
      delegacionId: 'd1',
      matricula: '1761LWP',
    );
    await montar(tester, dormido, bases: {'d1': 'Reus'});
    expect(find.text('Última vez en Reus'), findsOneWidget);
  });

  testWidgets('sin base conocida se pone el estado, no una raya', (tester) async {
    final perdido = VehiculoPresencia(
      vehiculoId: 'v5',
      estado: sinPosicion,
      matricula: '0232KMP',
    );
    await montar(tester, perdido);
    // «Sin posición» aparece dos veces: bajo la matrícula y en el recuadro
    // de estado. Las dos dicen lo mismo y las dos tienen que estar.
    expect(find.text('Sin posición'), findsNWidgets(2));
  });

  testWidgets('el «al día» sin periodicidad se marca aparte', (tester) async {
    await montar(
      tester,
      enBaseVencido,
      rev: const RevisionEstado(vehiculoId: 'v1', estado: 'al_dia'),
    );
    expect(find.text('Sin periodicidad'), findsOneWidget);
    expect(find.text('Al día'), findsNothing);
  });

  testWidgets('sin estado de revisión no se inventa distintivo', (tester) async {
    await montar(tester, enBaseVencido);
    expect(tester.takeException(), isNull);
    expect(find.textContaining('Últ. '), findsNothing);
  });
}
