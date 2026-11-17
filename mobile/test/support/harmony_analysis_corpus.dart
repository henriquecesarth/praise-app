import 'dart:convert';
import 'dart:io';

// Test data only: do not package the corpus as an application asset.
Map<String, dynamic> loadHarmonyAnalysisCorpus() {
  for (final path in [
    '../shared/fixtures/harmony-analysis-v1.json',
    'shared/fixtures/harmony-analysis-v1.json',
  ]) {
    final file = File(path);
    if (file.existsSync()) {
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError(
    'Shared harmony-analysis-v1.json not found from repository or mobile directory',
  );
}
