import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  final ApiService api;
  final String nombre;

  const HomeScreen({super.key, required this.api, required this.nombre});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _hoy;
  List<Map<String, dynamic>> _historial = [];
  bool _cargando = true;
  bool _fichando = false;
  String? _error;
  late Timer _reloj;
  DateTime _ahora = DateTime.now();

  @override
  void initState() {
    super.initState();
    _reloj = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _ahora = DateTime.now());
    });
    _cargar();
  }

  @override
  void dispose() {
    _reloj.cancel();
    super.dispose();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final resultados = await Future.wait([widget.api.hoy(), widget.api.historial()]);
      if (!mounted) return;
      setState(() {
        _hoy = resultados[0] as Map<String, dynamic>?;
        _historial = resultados[1] as List<Map<String, dynamic>>;
        _cargando = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _cargando = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _fichar(String accion) async {
    setState(() {
      _fichando = true;
      _error = null;
    });
    try {
      await widget.api.fichar(accion);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.green,
        content: Text(
          accion == 'entrada' ? 'Entrada registrada ✔' : 'Salida registrada ✔',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ));
      await _cargar();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _fichando = false);
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('employeeId');
    await prefs.remove('pin');
    await prefs.remove('nombre');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  String _hora(String? ts) {
    if (ts == null) return '—';
    final d = DateTime.tryParse(ts)?.toLocal();
    if (d == null) return '—';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _duracion(String? entrada, String? salida) {
    final e = entrada != null ? DateTime.tryParse(entrada) : null;
    final s = salida != null ? DateTime.tryParse(salida) : null;
    if (e == null) return '';
    final fin = s ?? DateTime.now();
    final mins = fin.difference(e).inMinutes;
    return '${mins ~/ 60}h ${(mins % 60).toString().padLeft(2, '0')}m';
  }

  @override
  Widget build(BuildContext context) {
    final entrada = _hoy?['hora_entrada'] as String?;
    final salida = _hoy?['hora_salida'] as String?;
    final presente = entrada != null && salida == null;
    final jornadaCompleta = entrada != null && salida != null;

    final horaTxt =
        '${_ahora.hour.toString().padLeft(2, '0')}:${_ahora.minute.toString().padLeft(2, '0')}:${_ahora.second.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Mobilink Presencia',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Text(widget.nombre,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _cargar,
            icon: const Icon(Icons.refresh),
            tooltip: 'Actualizar',
          ),
          IconButton(
            onPressed: _logout,
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _cargar,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Reloj
            Center(
              child: Column(
                children: [
                  Text(horaTxt,
                      style: const TextStyle(
                          fontSize: 52,
                          fontWeight: FontWeight.w900,
                          fontFeatures: [FontFeature.tabularFigures()])),
                  Text(
                    '${_ahora.day.toString().padLeft(2, '0')}/${_ahora.month.toString().padLeft(2, '0')}/${_ahora.year}',
                    style: const TextStyle(color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Estado de hoy
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surfaceDeep,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _statCol('Entrada', _hora(entrada),
                      entrada != null ? AppColors.green : AppColors.textMuted),
                  Container(width: 1, height: 40, color: AppColors.border),
                  _statCol('Salida', _hora(salida),
                      salida != null ? AppColors.red : AppColors.textMuted),
                  Container(width: 1, height: 40, color: AppColors.border),
                  _statCol(
                      presente ? 'Llevas' : 'Jornada',
                      entrada == null ? '—' : _duracion(entrada, salida),
                      AppColors.primary),
                ],
              ),
            ),
            const SizedBox(height: 20),

            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.red.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_error!, style: const TextStyle(color: AppColors.red)),
              ),
              const SizedBox(height: 12),
            ],

            // Botón grande de fichar
            if (_cargando)
              const Center(
                  child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(color: AppColors.primary),
              ))
            else if (jornadaCompleta)
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.green.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.green.withValues(alpha: 0.4)),
                ),
                child: const Column(
                  children: [
                    Icon(Icons.check_circle, color: AppColors.green, size: 40),
                    SizedBox(height: 8),
                    Text('Jornada completada. ¡Hasta mañana!',
                        style: TextStyle(
                            color: AppColors.green, fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            else
              SizedBox(
                height: 90,
                child: ElevatedButton(
                  onPressed:
                      _fichando ? null : () => _fichar(presente ? 'salida' : 'entrada'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: presente ? AppColors.red : AppColors.green,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                  ),
                  child: _fichando
                      ? const CircularProgressIndicator(color: Colors.white)
                      : Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(presente ? Icons.logout : Icons.login, size: 32),
                            const SizedBox(width: 12),
                            Text(
                              presente ? 'FICHAR SALIDA' : 'FICHAR ENTRADA',
                              style: const TextStyle(
                                  fontSize: 22, fontWeight: FontWeight.w900),
                            ),
                          ],
                        ),
                ),
              ),
            const SizedBox(height: 28),

            // Historial
            const Text('Últimos 14 días',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 10),
            if (_historial.isEmpty && !_cargando)
              const Text('Sin fichajes registrados.',
                  style: TextStyle(color: AppColors.textMuted))
            else
              ..._historial.map((r) {
                final f = DateTime.tryParse('${r['fecha']}T12:00:00');
                final fechaTxt = f == null
                    ? '${r['fecha']}'
                    : '${f.day.toString().padLeft(2, '0')}/${f.month.toString().padLeft(2, '0')}';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceDeep,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      SizedBox(
                          width: 48,
                          child: Text(fechaTxt,
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold))),
                      Expanded(
                        child: Text(
                          '${_hora(r['hora_entrada'] as String?)} → ${_hora(r['hora_salida'] as String?)}',
                          style: const TextStyle(color: AppColors.textMuted),
                        ),
                      ),
                      Text(
                        _duracion(r['hora_entrada'] as String?,
                            r['hora_salida'] as String?),
                        style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold),
                      ),
                      if (r['validado'] == true) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.verified,
                            size: 16, color: AppColors.green),
                      ],
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _statCol(String label, String valor, Color color) {
    return Column(
      children: [
        Text(label,
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        const SizedBox(height: 4),
        Text(valor,
            style: TextStyle(
                fontSize: 20, fontWeight: FontWeight.w800, color: color)),
      ],
    );
  }
}
