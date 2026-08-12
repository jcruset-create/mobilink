import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme.dart';

/// Botón de pausa del técnico.
///
/// Registra las mismas pausas que la pantalla `/operario/taller`, contra el
/// mismo endpoint y la misma tabla: el tiempo real del trabajo sale igual se
/// marque desde la tablet o desde el kiosko de la pared.
///
/// Ojo con no confundirlo con fichar: esto es tiempo productivo (una parada
/// dentro de la jornada), no la jornada laboral, que vive en el módulo
/// Presencia. Mezclarlos haría que un café descuadre las nóminas.
class BotonPausa extends StatefulWidget {
  final ApiService api;
  const BotonPausa({super.key, required this.api});

  @override
  State<BotonPausa> createState() => _BotonPausaState();
}

class _BotonPausaState extends State<BotonPausa> {
  Map<String, dynamic>? _pausa;
  bool _ocupado = false;

  @override
  void initState() {
    super.initState();
    _refrescar();
  }

  Future<void> _refrescar() async {
    final actual = await widget.api.pausaActual();
    if (!mounted) return;
    setState(() => _pausa = actual);
  }

  Future<void> _abrirMenu() async {
    if (_pausa != null) {
      await _terminar();
      return;
    }

    final tipo = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(
                'Empezar pausa',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
            ),
            for (final entrada in ApiService.tiposPausa.entries)
              ListTile(
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 6),
                leading: Icon(_icono(entrada.key), color: AppColors.primary),
                title: Text(entrada.value, style: const TextStyle(fontSize: 18)),
                onTap: () => Navigator.pop(context, entrada.key),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );

    if (tipo == null) return;
    await _iniciar(tipo);
  }

  IconData _icono(String tipo) {
    switch (tipo) {
      case 'cigarro':
        return Icons.smoking_rooms;
      case 'cafe':
        return Icons.local_cafe;
      case 'descanso':
        return Icons.chair;
      default:
        return Icons.more_horiz;
    }
  }

  Future<void> _iniciar(String tipo) async {
    setState(() => _ocupado = true);
    try {
      await widget.api.iniciarPausa(tipo);
      await _refrescar();
    } catch (e) {
      _aviso(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _terminar() async {
    setState(() => _ocupado = true);
    try {
      final minutos = await widget.api.terminarPausa();
      await _refrescar();
      _aviso('Pausa cerrada · $minutos min');
    } catch (e) {
      _aviso(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  void _aviso(String texto) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  @override
  Widget build(BuildContext context) {
    final enPausa = _pausa != null;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: TextButton.icon(
        onPressed: _ocupado ? null : _abrirMenu,
        icon: Icon(
          enPausa ? Icons.play_circle_fill : Icons.pause_circle_outline,
          color: enPausa ? const Color(0xFFF59E0B) : Colors.white,
        ),
        label: Text(
          enPausa ? 'Volver' : 'Pausa',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: enPausa ? const Color(0xFFF59E0B) : Colors.white,
          ),
        ),
      ),
    );
  }
}
