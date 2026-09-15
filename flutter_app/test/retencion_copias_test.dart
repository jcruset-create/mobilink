import 'package:flutter_test/flutter_test.dart';

import 'package:sea_tarragona_operario/services/retencion_copias.dart';

const int _dia = 24 * 60 * 60 * 1000;
const int _ahora = 1800000000000;
const int _mega = 1024 * 1024;

CopiaGuardada _copia({
  String ruta = '/x.jpg',
  int assistanceId = 1,
  String kind = 'foto_averia',
  required int diasDeAntiguedad,
  int bytes = _mega,
  bool subida = true,
}) =>
    CopiaGuardada(
      ruta: ruta,
      assistanceId: assistanceId,
      kind: kind,
      ts: _ahora - diasDeAntiguedad * _dia,
      bytes: bytes,
      subida: subida,
    );

void main() {
  group('caducidad por días', () {
    test('una foto subida de hace más de 30 días se borra', () {
      final plan = planDeLimpieza([_copia(diasDeAntiguedad: 31)], ahoraMs: _ahora);
      expect(plan.aBorrar, hasLength(1));
    });

    test('la de hace 29 se queda', () {
      final plan = planDeLimpieza([_copia(diasDeAntiguedad: 29)], ahoraMs: _ahora);
      expect(plan.aBorrar, isEmpty);
    });

    test('la de hoy se queda', () {
      final plan = planDeLimpieza([_copia(diasDeAntiguedad: 0)], ahoraMs: _ahora);
      expect(plan.aBorrar, isEmpty);
    });
  });

  group('lo que no ha subido no se toca', () {
    /*
     * Esto es lo importante de todo el fichero. Mientras el servidor no tenga
     * la foto, la copia local no es una copia: es el original. Si la caducidad
     * se aplicara a ciegas, esto sería la causa de la pérdida que viene a
     * evitar.
     */
    test('ni con dos años de antigüedad', () {
      final plan = planDeLimpieza(
        [_copia(diasDeAntiguedad: 730, subida: false)],
        ahoraMs: _ahora,
      );
      expect(plan.aBorrar, isEmpty);
    });

    test('ni cuando es lo único que hay y no cabe', () {
      final sinSubir = List.generate(
        5,
        (i) => _copia(
          ruta: '/p$i.jpg',
          diasDeAntiguedad: 100 + i,
          bytes: 300 * _mega,
          subida: false,
        ),
      );
      final plan = planDeLimpieza(sinSubir, ahoraMs: _ahora, maxBytes: 100 * _mega);
      expect(plan.aBorrar, isEmpty);
      // Y como no se puede cumplir el tope sin borrar lo que no se puede
      // borrar, se dice, en vez de callarse o de forzar.
      expect(plan.sigueLlena, isTrue);
      expect(plan.bytesTrasLimpiar, 1500 * _mega);
    });

    test('se borra la subida vieja y se respeta la sin subir aún más vieja', () {
      final plan = planDeLimpieza([
        _copia(ruta: '/vieja_sin_subir.jpg', diasDeAntiguedad: 90, subida: false),
        _copia(ruta: '/vieja_subida.jpg', diasDeAntiguedad: 40),
      ], ahoraMs: _ahora);
      expect(plan.aBorrar.map((c) => c.ruta), ['/vieja_subida.jpg']);
    });
  });

  group('tope de tamaño', () {
    test('recorta por las más antiguas hasta entrar', () {
      final copias = List.generate(
        10,
        (i) => _copia(ruta: '/f$i.jpg', diasDeAntiguedad: 10 - i, bytes: 10 * _mega),
      );
      final plan = planDeLimpieza(copias, ahoraMs: _ahora, maxBytes: 55 * _mega);

      // 100 MB en total, tope 55 → sobran 45, y se van las 5 más viejas.
      expect(plan.aBorrar, hasLength(5));
      expect(plan.bytesTrasLimpiar, 50 * _mega);
      expect(plan.sigueLlena, isFalse);

      // Las más antiguas son las de mayor antigüedad: f0, f1, f2, f3, f4.
      expect(plan.aBorrar.map((c) => c.ruta).toSet(),
          {'/f0.jpg', '/f1.jpg', '/f2.jpg', '/f3.jpg', '/f4.jpg'});
    });

    test('justo en el tope no borra nada', () {
      final copias = List.generate(
        4,
        (i) => _copia(ruta: '/f$i.jpg', diasDeAntiguedad: i, bytes: 25 * _mega),
      );
      final plan = planDeLimpieza(copias, ahoraMs: _ahora, maxBytes: 100 * _mega);
      expect(plan.aBorrar, isEmpty);
      expect(plan.sigueLlena, isFalse);
    });

    test('sin copias no hay nada que hacer', () {
      final plan = planDeLimpieza([], ahoraMs: _ahora);
      expect(plan.aBorrar, isEmpty);
      expect(plan.bytesTrasLimpiar, 0);
      expect(plan.sigueLlena, isFalse);
    });

    test('una copia no se cuenta dos veces al caducar y recortar a la vez', () {
      // La misma foto cumple los dos criterios: vieja Y por encima del tope.
      // Si la política la metiera en la lista dos veces, el borrado intentaría
      // borrar un fichero que ya no está y el recuento de espacio mentiría.
      final copias = [
        _copia(ruta: '/a.jpg', diasDeAntiguedad: 40, bytes: 80 * _mega),
        _copia(ruta: '/b.jpg', diasDeAntiguedad: 1, bytes: 80 * _mega),
      ];
      final plan = planDeLimpieza(copias, ahoraMs: _ahora, maxBytes: 100 * _mega);
      expect(plan.aBorrar.map((c) => c.ruta), ['/a.jpg']);
      expect(plan.bytesTrasLimpiar, 80 * _mega);
    });
  });

  group('qué va a la Galería', () {
    test('las fotos del servicio sí', () {
      for (final k in ['matricula_camion', 'matricula_remolque', 'foto_averia', 'foto_extra']) {
        expect(vaALaGaleria(k), isTrue, reason: k);
      }
    });

    /*
     * La firma es un dato personal del cliente. En la Galería acaba en la copia
     * de Google Fotos del operario y a un toque de irse por WhatsApp. En la
     * copia privada de la app sí está, que es donde hace falta para reenviarla.
     */
    test('la firma del cliente no', () {
      expect(vaALaGaleria('firma'), isFalse);
    });
  });

  group('ida y vuelta por el índice', () {
    test('un mapa guardado se vuelve a leer igual', () {
      final c = _copia(ruta: '/z.jpg', assistanceId: 4210, kind: 'firma', diasDeAntiguedad: 3);
      final vuelta = CopiaGuardada.deMapa(c.aMapa());
      expect(vuelta.ruta, c.ruta);
      expect(vuelta.assistanceId, 4210);
      expect(vuelta.kind, 'firma');
      expect(vuelta.ts, c.ts);
      expect(vuelta.bytes, c.bytes);
      expect(vuelta.subida, isTrue);
    });

    test('un índice viejo sin los campos nuevos no rompe', () {
      // Hive guarda lo que había el día que se escribió. Una fila de una
      // versión anterior no puede hacer que la app deje de arrancar.
      final vuelta = CopiaGuardada.deMapa({'ruta': '/v.jpg', 'assistanceId': 7, 'ts': _ahora});
      expect(vuelta.kind, 'desconocido');
      expect(vuelta.bytes, 0);
      expect(vuelta.subida, isFalse);
    });
  });
}
