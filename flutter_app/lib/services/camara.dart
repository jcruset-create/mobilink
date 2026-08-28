/// Hacer una foto, con el permiso pedido antes y los fallos explicados.
///
/// El problema que arregla: la app DECLARA `android.permission.CAMERA` en su
/// manifiesto, y en cuanto una app declara ese permiso Android exige tenerlo
/// concedido para que la cámara del sistema haga la foto en su nombre.
/// `image_picker` no lo pide por su cuenta, así que la captura fallaba sin
/// decir nada: el usuario pulsaba, se abría (o no) la cámara y no pasaba nada.
/// En los terminales industriales chinos, además, la propia cámara del sistema
/// saca su aviso en inglés —"Go to system setting to empower permissions"—, que
/// parece un fallo de nuestra app y no lo es.
///
/// Y cuando el permiso está denegado PARA SIEMPRE no se puede volver a pedir:
/// la única salida es abrir los ajustes de la aplicación, así que se ofrece el
/// botón en vez de dejar al operario delante de una pantalla que no responde.
library;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

class Camara {
  static final ImagePicker _picker = ImagePicker();

  /// Foto de la cámara, o null si no se pudo (ya avisado por pantalla).
  static Future<XFile?> hacerFoto(BuildContext context, {int calidad = 90, double? maxWidth}) =>
      _tomar(context, ImageSource.camera, calidad, maxWidth);

  /// Imagen de la galería. También necesita permiso en Android 13 o superior.
  static Future<XFile?> elegirDeGaleria(BuildContext context, {int calidad = 90, double? maxWidth}) =>
      _tomar(context, ImageSource.gallery, calidad, maxWidth);

  static Future<XFile?> _tomar(
      BuildContext context, ImageSource origen, int calidad, double? maxWidth) async {
    if (origen == ImageSource.camera && !await _permisoDeCamara(context)) return null;
    try {
      return await _picker.pickImage(
          source: origen, imageQuality: calidad, maxWidth: maxWidth);
    } catch (e) {
      // Un fallo aquí es casi siempre la cámara del sistema rechazando la
      // petición. Se dice lo que pasa y qué hacer, en vez de no hacer nada.
      _avisar(context,
          'No se ha podido abrir la cámara. Comprueba en los ajustes del '
          'teléfono que Mobilink Assist tiene permiso de Cámara.');
      debugPrint('[Camara] $e');
      return null;
    }
  }

  static Future<bool> _permisoDeCamara(BuildContext context) async {
    var estado = await Permission.camera.status;
    if (estado.isGranted) return true;

    if (estado.isDenied) estado = await Permission.camera.request();
    if (estado.isGranted) return true;

    if (!context.mounted) return false;

    if (estado.isPermanentlyDenied || estado.isRestricted) {
      final abrir = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Permiso de cámara'),
          content: const Text(
            'La aplicación no tiene permiso para usar la cámara y el teléfono '
            'ya no vuelve a preguntarlo.\n\n'
            'Ábrelo en Ajustes → Permisos → Cámara → Permitir.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Ahora no')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Abrir ajustes')),
          ],
        ),
      );
      if (abrir == true) await openAppSettings();
      return false;
    }

    _avisar(context, 'Sin permiso de cámara no se pueden hacer fotografías.');
    return false;
  }

  static void _avisar(BuildContext context, String mensaje) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }
}
