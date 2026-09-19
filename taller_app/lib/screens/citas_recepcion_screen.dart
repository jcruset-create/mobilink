import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../theme.dart';
import '../workshops.dart';
import 'recepcion_screen.dart';

/// Paso previo a recibir un vehículo: elegir su cita del día.
///
/// La mayoría de los vehículos que entran al patio tienen cita, y el operario
/// ya tiene delante la matrícula y el cliente. Partir de la cita evita
/// teclearlos y, sobre todo, evita que el mismo vehículo acabe con dos
/// trabajos: al convertir la recepción, la cita queda cerrada.
///
/// Recibir SIN cita sigue estando a un botón, porque el patio no siempre
/// avisa.
class CitasRecepcionScreen extends StatefulWidget {
  final ApiService api;
  const CitasRecepcionScreen({super.key, required this.api});

  @override
  State<CitasRecepcionScreen> createState() => _CitasRecepcionScreenState();
}

class _CitasRecepcionScreenState extends State<CitasRecepcionScreen> {
  List<Map<String, dynamic>> _citas = [];
  bool _cargando = true;
  String? _error;
  String _workshopId = kWorkshops.first['id']!;

  /// Fecha LOCAL del dispositivo. El servidor puede estar en otra zona
  /// horaria, y a las once de la noche eso son dos días distintos.
  String get _hoy {
    final d = DateTime.now();
    String dos(int n) => n.toString().padLeft(2, '0');
    return '${d.year}-${dos(d.month)}-${dos(d.day)}';
  }

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final c = await widget.api.getCitasDelDia(_hoy, workshopId: _workshopId);
      if (!mounted) return;
      setState(() {
        _citas = c;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _cargando = false;
        // Que fallen las citas no impide recibir: se dice y se sigue.
        _error = 'No se han podido cargar las citas. Puedes recibir sin cita.';
      });
    }
  }

  Future<void> _abrirFormulario({Map<String, dynamic>? cita}) async {
    final hecho = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RecepcionScreen(
          api: widget.api,
          cita: cita,
          workshopId: _workshopId,
        ),
      ),
    );
    if (hecho == true && mounted) {
      // La cita recibida ya no debería salir; se vuelve a pedir la lista.
      await _cargar();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Citas de hoy'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _cargar),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: DropdownButtonFormField<String>(
              initialValue: _workshopId,
              decoration: const InputDecoration(labelText: 'Taller'),
              items: kWorkshops
                  .map((w) => DropdownMenuItem(
                        value: w['id'],
                        child: Text(w['name'] ?? w['id']!),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() => _workshopId = v);
                _cargar();
              },
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
            ),
          Expanded(
            child: _cargando
                ? const Center(child: CircularProgressIndicator())
                : _citas.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Text(
                            'No quedan citas por recibir hoy.\n'
                            'Si el vehículo ha venido sin cita, usa el botón de abajo.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppColors.textMuted),
                          ),
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _citas.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final c = _citas[i];
                          final matricula = (c['plate'] ?? '').toString();
                          final cliente = (c['customerName'] ?? '').toString();
                          final operacion = (c['templateLabel'] ?? '').toString();
                          return Card(
                            color: AppColors.surface,
                            child: ListTile(
                              leading: Text(
                                (c['startTime'] ?? '').toString(),
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primary,
                                ),
                              ),
                              title: Text(
                                matricula.isEmpty ? '(sin matrícula)' : matricula,
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                              subtitle: Text(
                                [
                                  if (cliente.isNotEmpty) cliente,
                                  if (operacion.isNotEmpty) operacion,
                                ].join(' · '),
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => _abrirFormulario(cita: c),
                            ),
                          );
                        },
                      ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: OutlinedButton.icon(
                icon: const Icon(Icons.add),
                label: const Text('Recibir un vehículo sin cita'),
                onPressed: () => _abrirFormulario(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
