import 'package:flutter_test/flutter_test.dart';
import 'package:taller_app/services/offline_store.dart';

/// La clave de idempotencia es lo que impide que un reintento de la cola
/// offline suba la misma foto dos veces. Si dejara de ser única, el servidor
/// descartaría operaciones distintas creyéndolas repetidas — que es peor que el
/// problema original.
void main() {
  group('OfflineStore.nuevaClave', () {
    test('no repite ni generándolas seguidas', () {
      final claves = List.generate(500, (_) => OfflineStore.nuevaClave('up-1'));

      expect(claves.toSet().length, claves.length);
    });

    test('lleva el prefijo, que es lo que la hace legible en la cola', () {
      expect(OfflineStore.nuevaClave('st-42'), startsWith('st-42-'));
      expect(OfflineStore.nuevaClave('up-7'), startsWith('up-7-'));
    });

    test('dos trabajos distintos no comparten clave', () {
      final a = OfflineStore.nuevaClave('up-1');
      final b = OfflineStore.nuevaClave('up-2');

      expect(a, isNot(equals(b)));
    });
  });
}
