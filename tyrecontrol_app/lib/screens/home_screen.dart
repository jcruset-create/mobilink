import 'package:flutter/material.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/status_bar.dart';
import 'identify_vehicle_screen.dart';
import 'login_screen.dart';
import 'planificacion_screen.dart';
import 'revisions_screen.dart';
import 'tools_screen.dart';
import 'sync_screen.dart';
import 'profile_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  final _tabs = const [
    _InicioTab(),
    RevisionsScreen(embedded: true),
    ToolsScreen(embedded: true),
    SyncScreen(embedded: true),
    ProfileScreen(embedded: true),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const TopStatusBar(),
      body: SafeArea(child: IndexedStack(index: _tab, children: _tabs)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Inicio'),
          NavigationDestination(icon: Icon(Icons.fact_check_outlined), selectedIcon: Icon(Icons.fact_check), label: 'Revisiones'),
          NavigationDestination(icon: Icon(Icons.build_outlined), selectedIcon: Icon(Icons.build), label: 'Herramientas'),
          NavigationDestination(icon: Icon(Icons.sync_outlined), selectedIcon: Icon(Icons.sync), label: 'Sincronización'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
        ],
      ),
    );
  }
}

class _InicioTab extends StatelessWidget {
  const _InicioTab();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          _BigTile(
            icon: Icons.add_circle,
            label: 'Nueva revisión',
            primary: true,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const IdentifyVehicleScreen())),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: ValueListenableBuilder<int>(
                  valueListenable: OfflineStore.pendingCount,
                  builder: (_, n, __) => _BigTile(
                    icon: Icons.fact_check,
                    label: n > 0 ? 'Revisiones pendientes ($n)' : 'Revisiones pendientes',
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RevisionsScreen())),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _BigTile(
            icon: Icons.event_note,
            label: 'Planificación de revisiones',
            small: true,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PlanificacionScreen())),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _BigTile(
                  icon: Icons.build,
                  label: 'Herramientas',
                  small: true,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ToolsScreen())),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _BigTile(
                  icon: Icons.sync,
                  label: 'Sincronizar',
                  small: true,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SyncScreen())),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BigTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool primary;
  final bool small;
  final VoidCallback onTap;

  const _BigTile({required this.icon, required this.label, required this.onTap, this.primary = false, this.small = false});

  @override
  Widget build(BuildContext context) {
    final bg = primary ? AppColors.primary : AppColors.surface;
    final fg = primary ? AppColors.onPrimary : AppColors.textPrimary;
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          height: small ? 96 : (primary ? 140 : 88),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: primary ? null : Border.all(color: AppColors.cardBorder),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: fg, size: primary ? 38 : 30),
              const SizedBox(height: 8),
              Text(label, textAlign: TextAlign.center, style: TextStyle(color: fg, fontSize: primary ? 20 : 16, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

// Reexport util para logout desde ProfileScreen
Future<void> doLogout(BuildContext context) async {
  await TyreControlApi.signOut();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
}
