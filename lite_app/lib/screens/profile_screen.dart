import 'dart:io';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/push.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';
import 'login_screen.dart';

/// Perfil, permisos del dispositivo, estado de la cola offline y cierre de
/// sesión. Es también la pantalla donde el operario ve por qué algo no
/// funciona (GPS denegado, operaciones sin enviar…).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.session});
  final Session session;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final Api _api = Api(widget.session.token);
  String _gps = 'comprobando…';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _permisos();
  }

  Future<void> _permisos() async {
    final gps = await Tracker.ensurePermission();
    if (!mounted) return;
    setState(() => _gps = gps);
    // El estado de permisos se comparte con la central: si un operario no
    // tiene GPS, Central lo ve antes de asignarle un servicio.
    _api.registerDevice({
      'gpsPermission': gps,
      'notifPermission': Push.permiso,
      'fcmToken': Push.token,
      'platform': Platform.operatingSystem,
      'osVersion': Platform.operatingSystemVersion,
      'appVersion': kAppVersion,
    }).catchError((_) {});
  }

  Future<void> _sincronizar() async {
    setState(() => _busy = true);
    try {
      final res = await OfflineQueue.flush(_api);
      await FileQueue.flush(_api);
      final conflictos = res.where((r) => r['status'] == 'conflict').length;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(conflictos > 0
            ? 'Sincronizado con $conflictos conflicto(s): revisa las asistencias afectadas.'
            : 'Todo sincronizado.'),
      ));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo sincronizar; sigue sin conexión.')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _salir() async {
    final pendientes = OfflineQueue.pendingCount;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Cerrar sesión?'),
        content: Text(pendientes > 0
            ? 'Tienes $pendientes operación(es) sin enviar. Si cierras sesión '
                'ahora se perderán. ¿Seguro?'
            : 'Tendrás que volver a introducir el código de taller, el usuario y el PIN.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cerrar sesión')),
        ],
      ),
    );
    if (ok != true) return;
    try { await _api.logout(); } catch (_) {}
    await Session.clear();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }

  String _gpsTexto(String v) => switch (v) {
        'always' => 'Concedido siempre',
        // Con el servicio en primer plano basta este permiso: el seguimiento
        // arranca con la app abierta y sigue con la pantalla bloqueada.
        'while_in_use' => 'Mientras se usa la app (suficiente para el seguimiento)',
        'denied' => 'Denegado: no podrás compartir tu ubicación',
        'denied_forever' => 'Denegado permanentemente: actívalo en los ajustes del móvil',
        'service_disabled' => 'La ubicación del dispositivo está apagada',
        _ => v,
      };

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    // Las evidencias cuentan igual que las operaciones: para el operario "me
    // falta por enviar" es una sola idea, no dos colas.
    final pendientes = OfflineQueue.pendingCount + FileQueue.pendingCount;
    final fallidas = FileQueue.failedCount;
    final conflictos = OfflineQueue.conflicts();
    final gpsOk = _gps == 'always' || _gps == 'while_in_use';

    return Scaffold(
      appBar: AppBar(title: const Text('Perfil y ajustes')),
      body: ListView(children: [
        ListTile(
          leading: const Icon(Icons.person, size: 32),
          title: Text(s.userName, style: const TextStyle(fontSize: 18)),
          subtitle: Text(s.isAdmin ? 'Administrador del taller' : 'Operario'),
        ),
        ListTile(
          leading: const Icon(Icons.store),
          title: Text(s.workshopName),
          subtitle: const Text('Taller colaborador'),
        ),
        const Divider(),
        ListTile(
          leading: Icon(gpsOk ? Icons.gps_fixed : Icons.gps_off,
              color: gpsOk ? AppColors.ok : AppColors.danger),
          title: const Text('Permiso de ubicación'),
          subtitle: Text(_gpsTexto(_gps)),
          trailing: TextButton(onPressed: _permisos, child: const Text('Revisar')),
        ),
        ListTile(
          leading: Icon(
            Push.disponible && Push.permiso == 'granted'
                ? Icons.notifications_active
                : Icons.notifications_off,
            color: Push.disponible && Push.permiso == 'granted'
                ? AppColors.ok
                : AppColors.warn,
          ),
          title: const Text('Avisos de la central'),
          subtitle: Text(!Push.disponible
              ? 'Sin avisos automáticos: la bandeja se actualiza sola cada 25 s '
                  'mientras la app esté abierta'
              : Push.permiso == 'granted'
                  ? 'Activados: llega aviso al asignarte una asistencia'
                  : 'Bloqueados en el móvil: actívalos en los ajustes del sistema '
                      'o no verás las asistencias nuevas con la app cerrada'),
        ),
        ListTile(
          leading: Icon(pendientes > 0 || conflictos.isNotEmpty
              ? Icons.cloud_upload : Icons.cloud_done,
              color: conflictos.isNotEmpty ? AppColors.danger : AppColors.ok),
          title: const Text('Sincronización'),
          subtitle: Text(conflictos.isNotEmpty
              ? '${conflictos.length} conflicto(s) de estado: la central ya había '
                  'cambiado la asistencia'
              : fallidas > 0
                  ? '$fallidas evidencia(s) que la central ha rechazado: '
                      'revísalas en la asistencia'
                  : pendientes > 0
                      ? '$pendientes pendiente(s) de enviar '
                          '(${FileQueue.pendingCount} evidencia(s))'
                      : 'Todo enviado'),
          trailing: TextButton(
            onPressed: _busy ? null : _sincronizar,
            child: const Text('Enviar'),
          ),
        ),
        if (conflictos.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              onPressed: () async {
                await OfflineQueue.clearConflicts();
                setState(() {});
              },
              icon: const Icon(Icons.done_all),
              label: const Text('He revisado los conflictos, descartarlos'),
            ),
          ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.privacy_tip),
          title: const Text('Privacidad y ubicación'),
          subtitle: const Text(
            'Tu ubicación solo se comparte durante una asistencia activa '
            '(en camino, en punto, trabajando y vuelta al taller). Nunca fuera '
            'de un servicio. Mientras se comparte verás un aviso permanente en '
            'la barra de notificaciones.',
          ),
        ),
        ListTile(
          leading: const Icon(Icons.description),
          title: const Text('Política de privacidad'),
          trailing: const Icon(Icons.open_in_new, size: 18),
          onTap: () => launchUrl(
            Uri.parse('$kBackendUrl/privacidad'),
            mode: LaunchMode.externalApplication,
          ),
        ),
        ListTile(
          leading: const Icon(Icons.info_outline),
          title: const Text('Versión'),
          subtitle: const Text('Mobilink Assist Lite $kAppVersion'),
        ),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: OutlinedButton.icon(
            onPressed: _salir,
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
            icon: const Icon(Icons.logout),
            label: const Text('Cerrar sesión'),
          ),
        ),
        const SizedBox(height: 32),
      ]),
    );
  }
}
