import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../config.dart';

/// Una foto para el parte. Normalmente, la cámara. Con [kFotosDesdeArchivo]
/// pregunta si se hace ahora o se coge de un archivo (para probar desde el
/// PC, donde no hay cámara). Devuelve un [XFile] y no un `File` porque en la
/// versión web no hay ficheros: se sube con sus bytes.
Future<XFile?> elegirFoto(BuildContext context, {int calidad = 85}) async {
  var origen = ImageSource.camera;
  if (kFotosDesdeArchivo) {
    final elegido = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Hacer la foto ahora'),
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.folder_open_outlined),
            title: const Text('Elegir de un archivo'),
            subtitle: const Text('Provisional, para pruebas desde el PC'),
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
        ]),
      ),
    );
    if (elegido == null) return null;
    origen = elegido;
  }
  // Con tope de tamaño: un iPhone saca fotos de 12 a 48 megapíxeles, de 10 a
  // 15 MB cada una, y subir eso con dos rayas de cobertura tarda tanto que
  // parece que la app se ha quedado colgada. A 2000 px un número de serie y
  // un DOT se leen igual de bien, y pesa alrededor de 1 MB.
  return ImagePicker().pickImage(
      source: origen, imageQuality: calidad, maxWidth: 2000, maxHeight: 2000);
}

/// La extensión con la que se guarda en el bucket. En la web el `path` es una
/// URL `blob:` sin extensión; el nombre sí la trae.
String extensionDe(XFile f) {
  for (final s in [f.name, f.path]) {
    final i = s.lastIndexOf('.');
    if (i > 0 && s.length - i <= 5) return s.substring(i + 1).toLowerCase();
  }
  return 'jpg';
}

String mimeDe(XFile f) {
  if (f.mimeType != null && f.mimeType!.isNotEmpty) return f.mimeType!;
  switch (extensionDe(f)) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    default: return 'image/jpeg';
  }
}
