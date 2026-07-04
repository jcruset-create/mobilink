import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Estructura preparada para futuras herramientas Bluetooth (medidor de
/// profundidad, manometro, Transense TLGX3, lectores RFID...). En el
/// MVP no hay hardware conectado todavia: se deja la pantalla y el
/// modelo de datos listos para que anadir un adaptador nuevo sea solo
/// implementar `ToolAdapter`, sin tocar esta pantalla.
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
        _ToolCard(nombre: 'Medidor de profundidad', estado: 'No disponible en esta versión'),
        _ToolCard(nombre: 'Manómetro', estado: 'No disponible en esta versión'),
        _ToolCard(nombre: 'Transense TLGX3', estado: 'No disponible en esta versión'),
        _ToolCard(nombre: 'Lector RFID', estado: 'No disponible en esta versión'),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Por ahora las mediciones se introducen a mano en la ficha de cada neumático. '
            'La conexión con herramientas Bluetooth llegará en una próxima versión.',
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
  const _ToolCard({required this.nombre, required this.estado});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.bluetooth_disabled, color: AppColors.textSecondary),
        title: Text(nombre),
        subtitle: Text(estado, style: const TextStyle(color: AppColors.textSecondary)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
      ),
    );
  }
}
