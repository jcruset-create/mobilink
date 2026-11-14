import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Abre la navegación (Google Maps, o la app de mapas que tenga la tablet)
/// hasta un punto: con coordenadas si las hay, si no con la dirección.
Future<void> navegarA(
  BuildContext context, {
  Object? lat,
  Object? lng,
  String? direccion,
}) async {
  Uri? uri;
  if (lat != null && lng != null) {
    uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving');
  } else if ((direccion ?? '').trim().isNotEmpty) {
    uri = Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(direccion!.trim())}&travelmode=driving');
  }
  if (uri == null) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Esta OTF no tiene la ubicación de la base. Pídela a la oficina.'),
    ));
    return;
  }
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('No se ha podido abrir el mapa'),
      backgroundColor: Colors.red,
    ));
  }
}
