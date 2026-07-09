import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'sonda_screen.dart';

/// Herramientas Bluetooth de campo. La sonda Transense TLGX3 (profundidad,
/// presión y RFID) ya está operativa; el resto se irá conectando.
class ToolsScreen extends StatelessWidget {
  final bool embedded;
  const ToolsScreen({super.key, this.embedded = false});

  @override
  Widget build(BuildContext context) {
    final body = ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (!embedded) ...[
          Text('Herramientas', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
        ],
        _ToolCard(
          nombre: 'Transense TLGX3',
          estado: 'Sonda Bluetooth · profundidad, presión y RFID',
          disponible: true,
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SondaScreen())),
        ),
        _ToolCard(nombre: 'Medidor de profundidad', estado: 'No disponible en esta versión'),
        _ToolCard(nombre: 'Manómetro', estado: 'No disponible en esta versión'),
        _ToolCard(nombre: 'Lector RFID', estado: 'No disponible en esta versión'),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Apoya la sonda TLGX3 en cada neumático para medir. El resto de mediciones '
            'se introducen a mano en la ficha de cada neumático.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
        ),
      ],
    );
    if (embedded) return body;
    return Scaffold(appBar: AppBar(title: const Text('Herramientas')), body: body);
  }
}

class _ToolCard extends StatelessWidget {
  final String nombre;
  final String estado;
  final bool disponible;
  final VoidCallback? onTap;
  const _ToolCard({required this.nombre, required this.estado, this.disponible = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(disponible ? Icons.bluetooth : Icons.bluetooth_disabled,
            color: disponible ? AppColors.primary : AppColors.textSecondary),
        title: Text(nombre),
        subtitle: Text(estado, style: const TextStyle(color: AppColors.textSecondary)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
        onTap: onTap,
      ),
    );
  }
}
