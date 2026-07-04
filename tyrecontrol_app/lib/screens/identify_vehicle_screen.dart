import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/models.dart';
import '../services/ocr_service.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'confirm_vehicle_screen.dart';

/// Pantalla 3: identificar vehiculo. Cuatro metodos, priorizando el
/// mas rapido (foto) sin esconder los demas.
class IdentifyVehicleScreen extends StatefulWidget {
  const IdentifyVehicleScreen({super.key});

  @override
  State<IdentifyVehicleScreen> createState() => _IdentifyVehicleScreenState();
}

class _IdentifyVehicleScreenState extends State<IdentifyVehicleScreen> {
  final _searchController = TextEditingController();
  List<Vehiculo> _resultados = [];
  Timer? _debounce;
  bool _buscando = false;
  bool _escaneando = false;
  String? _error;

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _buscar(value));
  }

  Future<void> _buscar(String texto) async {
    if (texto.trim().length < 2) {
      setState(() => _resultados = []);
      return;
    }
    setState(() => _buscando = true);
    try {
      final res = await TyreControlApi.buscarVehiculos(texto);
      if (!mounted) return;
      setState(() => _resultados = res);
    } catch (e) {
      if (mounted) setState(() => _error = 'Sin conexión: busca por matrícula exacta o elige un vehículo reciente');
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Future<void> _escanearMatricula() async {
    final picker = ImagePicker();
    final foto = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
    if (foto == null) return;
    setState(() {
      _escaneando = true;
      _error = null;
    });
    try {
      final plate = await OcrService.reconocerMatricula(File(foto.path));
      if (plate == null) {
        setState(() => _error = 'No se ha podido leer la matrícula. Prueba de nuevo o escríbela a mano.');
        return;
      }
      final res = await TyreControlApi.buscarVehiculos(plate);
      if (res.length == 1) {
        _irAConfirmar(res.first);
      } else {
        _searchController.text = plate;
        setState(() => _resultados = res);
        if (res.isEmpty) setState(() => _error = 'Matrícula leída: $plate. No se encontró ningún vehículo con ella.');
      }
    } catch (e) {
      setState(() => _error = 'No se pudo escanear (¿sin conexión?). Escribe la matrícula a mano.');
    } finally {
      if (mounted) setState(() => _escaneando = false);
    }
  }

  void _irAConfirmar(Vehiculo v) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ConfirmVehicleScreen(vehiculo: v)));
  }

  @override
  Widget build(BuildContext context) {
    final recientes = OfflineStore.vehiculosRecientes();
    return Scaffold(
      appBar: AppBar(title: const Text('Identificar vehículo')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Metodo 1: foto + IA (el mas rapido)
            ElevatedButton.icon(
              onPressed: _escaneando ? null : _escanearMatricula,
              icon: _escaneando
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onPrimary))
                  : const Icon(Icons.camera_alt),
              label: Text(_escaneando ? 'Leyendo matrícula…' : 'Escanear matrícula con la cámara'),
            ),
            const SizedBox(height: 16),

            // Metodo 2: manual
            TextField(
              controller: _searchController,
              textCapitalization: TextCapitalization.characters,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                labelText: 'Matrícula o nº de unidad',
                prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
                suffixIcon: _buscando ? const Padding(padding: EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2)) : null,
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: AppColors.warning, fontSize: 13)),
            ],

            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                children: [
                  if (_resultados.isNotEmpty) ...[
                    const _SeccionTitulo('Resultados'),
                    for (final v in _resultados) _VehiculoTile(v: v, onTap: () => _irAConfirmar(v)),
                  ],
                  if (_resultados.isEmpty && _searchController.text.isEmpty && recientes.isNotEmpty) ...[
                    const _SeccionTitulo('Vehículos recientes'),
                    for (final j in recientes)
                      _VehiculoTile(
                        v: Vehiculo.fromJson(j),
                        onTap: () async {
                          final v = await TyreControlApi.obtenerVehiculo(j['id'] as String);
                          if (v != null) _irAConfirmar(v);
                        },
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeccionTitulo extends StatelessWidget {
  final String texto;
  const _SeccionTitulo(this.texto);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(texto.toUpperCase(), style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
      );
}

class _VehiculoTile extends StatelessWidget {
  final Vehiculo v;
  final VoidCallback onTap;
  const _VehiculoTile({required this.v, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.directions_car, color: AppColors.primary),
        title: Text(v.matricula, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
        subtitle: Text([if (v.numeroUnidad != null) 'Unidad ${v.numeroUnidad}', v.empresa?.nombre ?? ''].where((e) => e.isNotEmpty).join(' · ')),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
