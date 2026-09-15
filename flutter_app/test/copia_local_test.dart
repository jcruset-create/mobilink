import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:sea_tarragona_operario/services/copia_local.dart';
import 'package:sea_tarragona_operario/services/retencion_copias.dart';

/// path_provider es un plugin y en un test no existe; Hive y la copia local le
/// piden el directorio de documentos. Se intercepta su canal y se le da uno
/// temporal de verdad, para probar contra disco real y no contra una
/// imitación que podría no comportarse igual.
void _plantarPathProvider(Directory dir) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/path_provider'),
    (call) async => dir.path,
  );
}

const int _dia = 24 * 60 * 60 * 1000;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('copias_test');
    _plantarPathProvider(dir);
    Hive.init(dir.path);
    await CopiaLocal.init();
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    await Hive.close();
    if (await dir.exists()) await dir.delete(recursive: true);
  });

  /// Una foto de mentira, con bytes de verdad para que ocupe algo.
  Future<File> foto(String nombre, {int bytes = 1024}) async {
    final f = File('${dir.path}/$nombre');
    await f.writeAsBytes(List.filled(bytes, 7));
    return f;
  }

  test('guardar deja el fichero y lo apunta sin marcar como subido', () async {
    final ruta = await CopiaLocal.guardar(await foto('a.jpg', bytes: 2048),
        assistanceId: 137, kind: 'foto_averia');

    expect(await File(ruta).exists(), isTrue);
    final copias = CopiaLocal.todas();
    expect(copias, hasLength(1));
    expect(copias.single.assistanceId, 137);
    expect(copias.single.kind, 'foto_averia');
    expect(copias.single.bytes, 2048);
    expect(copias.single.subida, isFalse,
        reason: 'recién hecha no puede constar como subida');
  });

  test('el original se copia, no se mueve', () async {
    // El fichero que llega es el de la cámara y lo usa quien nos llamó: si se
    // moviera, la subida en curso se quedaría sin fichero que enviar.
    final original = await foto('b.jpg');
    await CopiaLocal.guardar(original, assistanceId: 1, kind: 'foto_extra');
    expect(await original.exists(), isTrue);
  });

  test('marcarSubida cambia solo esa copia', () async {
    final r1 = await CopiaLocal.guardar(await foto('c.jpg'),
        assistanceId: 1, kind: 'foto_averia');
    await CopiaLocal.guardar(await foto('d.jpg'),
        assistanceId: 1, kind: 'foto_extra');

    await CopiaLocal.marcarSubida(r1);

    final copias = CopiaLocal.todas();
    expect(copias.firstWhere((c) => c.ruta == r1).subida, isTrue);
    expect(copias.firstWhere((c) => c.ruta != r1).subida, isFalse);
  });

  test('deAsistencia filtra y ordena de la más reciente a la más antigua', () async {
    await CopiaLocal.guardar(await foto('e.jpg'), assistanceId: 1, kind: 'foto_averia');
    await CopiaLocal.guardar(await foto('f.jpg'), assistanceId: 2, kind: 'foto_averia');
    await CopiaLocal.guardar(await foto('g.jpg'), assistanceId: 1, kind: 'foto_extra');

    final dela1 = CopiaLocal.deAsistencia(1);
    expect(dela1, hasLength(2));
    expect(dela1.first.ts >= dela1.last.ts, isTrue);
  });

  test('limpiar borra la subida caducada y deja la que no ha subido', () async {
    final vieja = await CopiaLocal.guardar(await foto('h.jpg'),
        assistanceId: 1, kind: 'foto_averia');
    final sinSubir = await CopiaLocal.guardar(await foto('i.jpg'),
        assistanceId: 1, kind: 'foto_extra');
    await CopiaLocal.marcarSubida(vieja);

    // Se mira desde muy adelante en el tiempo: las dos están «caducadas» por
    // edad, y aun así la que no ha subido tiene que seguir ahí.
    await CopiaLocal.limpiar(
        ahora: DateTime.now().add(const Duration(days: kDiasRetencion + 5)));

    expect(await File(vieja).exists(), isFalse);
    expect(await File(sinSubir).exists(), isTrue,
        reason: 'sin subir, la copia local es el único original que queda');
    expect(CopiaLocal.todas().map((c) => c.ruta), [sinSubir]);
  });

  test('limpiar no toca nada recién hecho', () async {
    final r = await CopiaLocal.guardar(await foto('j.jpg'),
        assistanceId: 1, kind: 'foto_averia');
    await CopiaLocal.marcarSubida(r);
    await CopiaLocal.limpiar();
    expect(await File(r).exists(), isTrue);
    expect(CopiaLocal.todas(), hasLength(1));
  });

  test('borrar el fichero por fuera no deja una entrada fantasma', () async {
    // Android limpia directorios por su cuenta y el operario puede borrar
    // desde la Galería. La pantalla no puede ofrecer «Reenviar» sobre un hueco.
    final r = await CopiaLocal.guardar(await foto('k.jpg'),
        assistanceId: 1, kind: 'foto_averia');
    await File(r).delete();

    await CopiaLocal.depurarFantasmas();

    expect(CopiaLocal.todas(), isEmpty);
  });

  test('bytesOcupados suma lo que hay', () async {
    await CopiaLocal.guardar(await foto('l.jpg', bytes: 1000), assistanceId: 1, kind: 'a');
    await CopiaLocal.guardar(await foto('m.jpg', bytes: 2000), assistanceId: 1, kind: 'b');
    expect(CopiaLocal.bytesOcupados(), 3000);
  });

  test('el índice sobrevive a cerrar y volver a abrir', () async {
    // Es el caso de todos los días: se hace la foto, se cierra la app y al
    // volver la copia tiene que seguir estando y sabiendo de quién era.
    final r = await CopiaLocal.guardar(await foto('n.jpg'),
        assistanceId: 4210, kind: 'matricula_camion');
    await CopiaLocal.marcarSubida(r);

    await Hive.close();
    Hive.init(dir.path);
    await CopiaLocal.init();

    final copias = CopiaLocal.todas();
    expect(copias, hasLength(1));
    expect(copias.single.assistanceId, 4210);
    expect(copias.single.kind, 'matricula_camion');
    expect(copias.single.subida, isTrue);
  });

  test('sin acceso a la Galería la copia privada se guarda igual', () async {
    // En el test el plugin `gal` no existe, así que su canal lanza
    // MissingPluginException: exactamente lo mismo que un permiso denegado en
    // el terminal. La foto tiene que quedarse guardada de todas formas — un
    // permiso que el operario no da no puede costar una copia.
    final ruta = await CopiaLocal.guardar(await foto('o.jpg'),
        assistanceId: 9, kind: 'foto_averia');
    expect(await File(ruta).exists(), isTrue);
    expect(CopiaLocal.todas(), hasLength(1));
  });

  test('la marca de lleno se actualiza al limpiar', () async {
    final r = await CopiaLocal.guardar(await foto('p.jpg', bytes: 4096),
        assistanceId: 1, kind: 'foto_averia');
    await CopiaLocal.marcarSubida(r);
    await CopiaLocal.limpiar();
    expect(CopiaLocal.llena.value, isFalse);
  });
}
