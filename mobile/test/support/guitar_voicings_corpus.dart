import 'dart:convert';
import 'dart:io';

// Test data only: do not package the fixture JSON as a Flutter asset.
Map<String, dynamic> loadGuitarVoicingsCorpus() {
  for (final path in [
    '../shared/fixtures/guitar-voicings-v1.json',
    'shared/fixtures/guitar-voicings-v1.json',
  ]) {
    final file = File(path);
    if (file.existsSync()) {
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError(
    'Shared guitar-voicings-v1.json not found from repository or mobile directory',
  );
}
