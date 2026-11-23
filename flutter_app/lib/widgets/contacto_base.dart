import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/app_theme.dart';

// La persona de contacto de la base de una OTF: a quién llama el operario si
// no encuentra el vehículo, la puerta está cerrada o falta una autorización.

/// El número listo para marcar: solo cifras y el «+» inicial.
String telefonoParaMarcar(String telefono) {
  final t = telefono.trim();
  final cifras = t.replaceAll(RegExp(r'\D'), '');
  return t.startsWith('+') ? '+$cifras' : cifras;
}

/// El número para wa.me: con prefijo de país y sin «+». Un móvil o fijo
/// español escrito con nueve cifras lleva el 34 delante.
String telefonoParaWhatsApp(String telefono) {
  var cifras = telefono.replaceAll(RegExp(r'\D'), '');
  if (cifras.startsWith('00')) cifras = cifras.substring(2);
  if (cifras.length == 9) cifras = '34$cifras';
  return cifras;
}

Future<void> _abrir(BuildContext context, Uri uri, String queFalla) async {
  var ok = false;
  try {
    ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    ok = false;
  }
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(queFalla), backgroundColor: Colors.red));
  }
}

Future<void> llamarContacto(BuildContext context, String telefono) =>
    _abrir(context, Uri.parse('tel:${telefonoParaMarcar(telefono)}'), 'Esta tablet no puede hacer llamadas: marca $telefono');

Future<void> whatsappContacto(BuildContext context, String telefono) =>
    _abrir(context, Uri.parse('https://wa.me/${telefonoParaWhatsApp(telefono)}'), 'No se ha podido abrir WhatsApp');

String _texto(Object? v) => (v ?? '').toString().trim();

/// La tarjeta de la pantalla de la OTF. No pinta nada si no hay contacto.
class ContactoBase extends StatelessWidget {
  /// La OTF (o cualquier mapa con contactoNombre, contactoTelefono, contactoCargo).
  final Map<String, dynamic> otf;
  const ContactoBase({super.key, required this.otf});

  @override
  Widget build(BuildContext context) {
    final nombre = _texto(otf['contactoNombre']);
    final telefono = _texto(otf['contactoTelefono']);
    final cargo = _texto(otf['contactoCargo']);
    if (nombre.isEmpty && telefono.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.success.withValues(alpha: 0.6)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('PERSONA DE CONTACTO EN LA BASE',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1.2)),
        const SizedBox(height: 10),
        Row(children: [
          const CircleAvatar(
            radius: 24,
            backgroundColor: AppColors.secondary,
            child: Icon(Icons.person_outline, color: AppColors.onSecondary, size: 26),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (nombre.isNotEmpty)
                Text(nombre, style: const TextStyle(color: AppColors.textPrimary, fontSize: 19, fontWeight: FontWeight.w900)),
              if (cargo.isNotEmpty) Text(cargo, style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
              if (telefono.isNotEmpty)
                Text(telefono, style: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
            ]),
          ),
        ]),
        if (telefono.isNotEmpty) ...[
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: SizedBox(
                height: 54,
                child: FilledButton.icon(
                  onPressed: () => llamarContacto(context, telefono),
                  icon: const Icon(Icons.call),
                  label: const Text('Llamar', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                  style: FilledButton.styleFrom(backgroundColor: AppColors.success, foregroundColor: AppColors.onPrimary),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SizedBox(
                height: 54,
                child: OutlinedButton.icon(
                  onPressed: () => whatsappContacto(context, telefono),
                  icon: const Icon(Icons.chat_outlined),
                  label: const Text('WhatsApp', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.success,
                    side: const BorderSide(color: AppColors.success, width: 2),
                  ),
                ),
              ),
            ),
          ]),
        ],
      ]),
    );
  }
}

/// El botón de la barra de las pantallas de un trabajo: «Llamar a Jordi».
/// No pinta nada si el trabajo no trae teléfono de contacto.
class BotonLlamarContacto extends StatelessWidget {
  final Map<String, dynamic> trabajo;
  const BotonLlamarContacto({super.key, required this.trabajo});

  @override
  Widget build(BuildContext context) {
    final telefono = _texto(trabajo['contactoTelefono']);
    if (telefono.isEmpty) return const SizedBox.shrink();
    final nombre = _texto(trabajo['contactoNombre']).split(' ').first;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: TextButton.icon(
        onPressed: () => llamarContacto(context, telefono),
        icon: const Icon(Icons.call, color: AppColors.success),
        label: Text(nombre.isEmpty ? 'Llamar' : 'Llamar a $nombre',
            style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w800)),
      ),
    );
  }
}
