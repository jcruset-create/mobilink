import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../services/biometria.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'home_screen.dart';

class ProfileScreen extends StatefulWidget {
  final bool embedded;
  const ProfileScreen({super.key, this.embedded = false});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _perfil;
  String _version = '';
  bool _bioDisponible = false;
  bool _bioActivada = false;
  String _bioNombre = 'Face ID';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final perfil = await TyreControlApi.obtenerMiPerfil();
    final info = await PackageInfo.fromPlatform();
    final disponible = await Biometria.disponible();
    final activada = await Biometria.activada();
    final nombre = await Biometria.nombre();
    if (!mounted) return;
    setState(() {
      _perfil = perfil;
      _version = '${info.version}+${info.buildNumber}';
      _bioDisponible = disponible;
      _bioActivada = activada;
      _bioNombre = nombre;
    });
  }

  /// Activar exige identificarse en el momento: si el sensor falla, es mejor
  /// saberlo aquí que en la pantalla de candado del próximo arranque.
  /// Desactivar no pide nada: pedir la cara para dejar de usarla es absurdo.
  Future<void> _cambiarBiometria(bool valor) async {
    if (valor && !await Biometria.autenticar('Activa el acceso con $_bioNombre')) {
      return;
    }
    await Biometria.activar(valor);
    if (!mounted) return;
    setState(() => _bioActivada = valor);
  }

  @override
  Widget build(BuildContext context) {
    final empresa = _perfil?['empresa'] is Map ? (_perfil!['empresa'] as Map)['nombre'] : null;
    // Con scroll: la pantalla se escribió mirando una tablet, donde todo cabe.
    // En un móvil no cabe, y una Column pelada no se puede arrastrar: lo de
    // abajo simplemente no se ve.
    final body = SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!widget.embedded) ...[
            Text('Perfil', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Dato('Nombre', _perfil?['nombre']),
                  _Dato('Empresa', empresa),
                  _Dato('Email', _perfil?['email']),
                  _Dato('Versión', _version),
                ],
              ),
            ),
          ),
          // Solo si el dispositivo tiene sensor y algo dado de alta: un
          // interruptor que no puede funcionar solo confunde.
          if (_bioDisponible) ...[
            const SizedBox(height: 12),
            Card(
              child: SwitchListTile(
                key: const Key('interruptor-biometria'),
                secondary: Icon(Icons.fingerprint,
                    color: _bioActivada ? AppColors.success : AppColors.textSecondary),
                title: Text('Entrar con $_bioNombre'),
                subtitle: Text(_bioActivada
                    ? 'Al abrir la app se pide $_bioNombre en vez del nombre y el PIN'
                    : 'Evita escribir el nombre y el PIN en cada acceso'),
                value: _bioActivada,
                onChanged: _cambiarBiometria,
              ),
            ),
          ],
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => doLogout(context),
            icon: const Icon(Icons.logout, color: AppColors.danger),
            label: const Text('Cerrar sesión', style: TextStyle(color: AppColors.danger)),
            style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (widget.embedded) return body;
    return Scaffold(appBar: AppBar(title: const Text('Perfil')), body: body);
  }
}

class _Dato extends StatelessWidget {
  final String label;
  final String? value;
  const _Dato(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          Text(value ?? '—', style: const TextStyle(fontSize: 16)),
        ],
      ),
    );
  }
}
