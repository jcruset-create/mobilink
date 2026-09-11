import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:sea_tarragona_operario/services/offline_store.dart';

/// Hive necesita un directorio, y `initFlutter` se lo pide a path_provider,
/// que es un plugin y en un test no existe. Se intercepta su canal y se le da
/// uno temporal de verdad: así la cola se prueba contra Hive real, no contra
/// una imitación que podría no comportarse igual.
void _plantarPathProvider(Directory dir) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/path_provider'),
    (call) async => dir.path,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('outbox_test');
    _plantarPathProvider(dir);
    await OfflineStore.init();
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    await dir.delete(recursive: true);
  });

  group('qué fotos faltan por subir', () {
    test('sin nada en la cola, no falta nada', () async {
      expect(OfflineStore.obligatoriasPendientesDe(1), isEmpty);
    });

    test('encuentra la avería encolada, que es la que se pierde', () async {
      // El caso real: la matrícula subió bloqueante y la avería se quedó aquí.
      await OfflineStore.enqueueUpload(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/a.jpg');

      expect(OfflineStore.obligatoriasPendientesDe(133), ['foto_averia']);
    });

    test('no mezcla asistencias', () async {
      // Cerrar la 133 no puede quedar bloqueado por una foto de la 99.
      await OfflineStore.enqueueUpload(
          assistanceId: 99, kind: 'foto_averia', localPath: '/tmp/a.jpg');

      expect(OfflineStore.obligatoriasPendientesDe(133), isEmpty);
      expect(OfflineStore.obligatoriasPendientesDe(99), ['foto_averia']);
    });

    test('las fotos extra NO retienen el cierre', () async {
      // Son voluntarias: avisar por ellas sería dar la lata y enseñar a la
      // gente a ignorar el aviso, que es como se pierden las obligatorias.
      await OfflineStore.enqueueUpload(
          assistanceId: 133, kind: 'foto_extra', localPath: '/tmp/e.jpg');

      expect(OfflineStore.subidasPendientesDe(133), ['foto_extra']);
      expect(OfflineStore.obligatoriasPendientesDe(133), isEmpty);
    });

    test('no repite el mismo tipo aunque haya varias en cola', () async {
      await OfflineStore.enqueueUpload(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/1.jpg');
      await OfflineStore.enqueueUpload(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/2.jpg');

      expect(OfflineStore.obligatoriasPendientesDe(133), ['foto_averia']);
    });

    test('los cambios de estado en cola no cuentan como fotos', () async {
      await OfflineStore.enqueueStatus(
          assistanceId: 133, type: 'status', status: 'inicio_reparacion');

      expect(OfflineStore.subidasPendientesDe(133), isEmpty);
    });
  });

  group('evidencias perdidas', () {
    test('al principio no hay ninguna', () {
      expect(OfflineStore.perdidas(), isEmpty);
      expect(OfflineStore.perdidasCount.value, 0);
    });

    test('una pérdida queda registrada, no desaparece sin más', () async {
      await OfflineStore.registrarPerdida(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/ida.jpg');

      final todas = OfflineStore.perdidas();
      expect(todas.length, 1);
      expect(todas.first['kind'], 'foto_averia');
      expect(todas.first['assistanceId'], 133);
      expect(OfflineStore.perdidasCount.value, 1);
    });

    test('se pueden consultar por asistencia', () async {
      await OfflineStore.registrarPerdida(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/a.jpg');
      await OfflineStore.registrarPerdida(
          assistanceId: 99, kind: 'matricula_camion', localPath: '/tmp/b.jpg');

      expect(OfflineStore.perdidasDe(133).length, 1);
      expect(OfflineStore.perdidasDe(99).length, 1);
      expect(OfflineStore.perdidasDe(1), isEmpty);
    });

    test('sobreviven al reinicio de la app', () async {
      // Si se perdieran al cerrar la app, el aviso no llegaría nunca a quien
      // tiene que verlo: el registro sólo sirve si persiste.
      await OfflineStore.registrarPerdida(
          assistanceId: 133, kind: 'foto_averia', localPath: '/tmp/a.jpg');

      await Hive.close();
      await OfflineStore.init();

      expect(OfflineStore.perdidas().length, 1);
      expect(OfflineStore.perdidasCount.value, 1);
    });
  });
}
