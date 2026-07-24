import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/job.dart';
import '../services/api_service.dart';
import '../services/offline_store.dart';
import '../theme.dart';
import 'login_screen.dart';
import 'task_detail_screen.dart';
import 'create_task_screen.dart';

class HomeScreen extends StatefulWidget {
  final ApiService api;
  final bool esSupervisor;
  const HomeScreen({super.key, required this.api, required this.esSupervisor});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Job> _jobs = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final jobs = await widget.api.getJobs();
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('techName');
    await prefs.remove('code');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  List<Job> get _misTareas => _jobs
      .where((j) => j.assignedNames.contains(widget.api.techName) && !j.isClosed)
      .toList();

  @override
  Widget build(BuildContext context) {
    final tabs = <Tab>[
      const Tab(text: 'Mis tareas'),
      if (widget.esSupervisor) const Tab(text: 'Gestión'),
    ];

    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Mobilink Taller'),
          actions: [
            IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
            IconButton(icon: const Icon(Icons.logout), onPressed: _logout),
          ],
          bottom: TabBar(
            tabs: tabs,
            indicatorColor: AppColors.primary,
            labelColor: Colors.white,
            unselectedLabelColor: AppColors.textMuted,
          ),
        ),
        floatingActionButton: widget.esSupervisor
            ? FloatingActionButton.extended(
                backgroundColor: AppColors.primary,
                icon: const Icon(Icons.add),
                label: const Text('Crear tarea'),
                onPressed: () async {
                  final created = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => CreateTaskScreen(api: widget.api),
                    ),
                  );
                  if (created == true) _load();
                },
              )
            : null,
        body: Column(
          children: [
            _OfflineBanner(),
            Expanded(
              child: TabBarView(
                children: [
                  _buildList(_misTareas, 'No tienes tareas asignadas.'),
                  if (widget.esSupervisor)
                    _buildList(_jobs, 'No hay trabajos activos.'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(List<Job> jobs, String emptyMsg) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return _CenteredMessage(text: _error!, onRetry: _load);
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: jobs.isEmpty
          ? ListView(children: [
              const SizedBox(height: 120),
              _CenteredMessage(text: emptyMsg),
            ])
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: jobs.length,
              itemBuilder: (_, i) => _JobCard(
                job: jobs[i],
                onTap: () async {
                  final changed = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => TaskDetailScreen(
                        api: widget.api,
                        job: jobs[i],
                        esSupervisor: widget.esSupervisor,
                      ),
                    ),
                  );
                  if (changed == true) _load();
                },
              ),
            ),
    );
  }
}

class _JobCard extends StatelessWidget {
  final Job job;
  final VoidCallback onTap;
  const _JobCard({required this.job, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    job.plate.isEmpty ? 'Sin matrícula' : job.plate,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(width: 8),
                  if (job.urgent) _pill('Urgente', AppColors.primary),
                  const Spacer(),
                  _pill(statusLabel(job.status), statusColor(job.status)),
                ],
              ),
              const SizedBox(height: 6),
              Text('${job.area} · ${job.reason}',
                  style: const TextStyle(color: AppColors.textMuted)),
              if (job.assignedNames.isNotEmpty) ...[
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.person, size: 15, color: AppColors.textMuted),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(job.assignedNames.join(', '),
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.textMuted)),
                  ),
                ]),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: color.withOpacity(0.18),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text,
            style: TextStyle(
                fontSize: 11, fontWeight: FontWeight.bold, color: color)),
      );
}

class _OfflineBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: OfflineStore.offline,
      builder: (_, offline, __) {
        return ValueListenableBuilder<int>(
          valueListenable: OfflineStore.pendingCount,
          builder: (_, pending, __) {
            if (!offline && pending == 0) return const SizedBox.shrink();
            final msg = offline
                ? 'Sin conexión${pending > 0 ? ' · $pending cambio(s) pendiente(s)' : ''}'
                : '$pending cambio(s) pendiente(s) de enviar';
            return Container(
              width: double.infinity,
              color: const Color(0xFFF59E0B),
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
              child: Row(
                children: [
                  const Icon(Icons.cloud_off, size: 16, color: Colors.black87),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(msg,
                        style: const TextStyle(
                            color: Colors.black87, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  final String text;
  final VoidCallback? onRetry;
  const _CenteredMessage({required this.text, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(text,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textMuted)),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            TextButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ],
      ),
    );
  }
}
