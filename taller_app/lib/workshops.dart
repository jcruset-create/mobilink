/// Talleres Mobilink (mismos IDs que el panel web).
const List<Map<String, String>> kWorkshops = [
  {'id': 'sea-tarragona', 'label': 'Tarragona'},
  {'id': 'sea-reus', 'label': 'Reus'},
  {'id': 'plana-reus', 'label': 'Plana Reus'},
  {'id': 'plana-vilanova', 'label': 'Plana Vilanova'},
];

String workshopLabel(String? id) {
  for (final w in kWorkshops) {
    if (w['id'] == id) return w['label']!;
  }
  return '—';
}
