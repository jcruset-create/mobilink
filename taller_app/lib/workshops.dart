/// Talleres Mobilink (mismos IDs que el panel web).
const List<Map<String, String>> kWorkshops = [
  {'id': 'sea-tarragona', 'label': 'Tarragona'},
  {'id': 'sea-reus', 'label': 'Reus'},
];

String workshopLabel(String? id) {
  for (final w in kWorkshops) {
    if (w['id'] == id) return w['label']!;
  }
  return '—';
}
