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
  return ImagePicker().pickImage(source: origen, imageQuality: calidad);
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
