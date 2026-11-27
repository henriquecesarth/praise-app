import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/music/theory.dart';

void main() {
  var file = File('../shared/fixtures/harmony-analysis-v2.json');
  if (!file.existsSync()) {
    file = File('shared/fixtures/harmony-analysis-v2.json');
  }
  final corpus = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;

  group('harmony v2 readings', () {
    for (final vector in (corpus['cases'] as List).cast<Map<String, dynamic>>()) {
      final input = vector['input'] as Map<String, dynamic>;
      test('${vector['id']} ${input['chord']} in ${input['key']}', () {
        final result = analyzeHarmony(
          input['chord'] as String,
          key: input['key'] as String?,
          previous: input['previous'] as String?,
          next: input['next'] as String?,
        );
        expect(result.toJson(), vector['expected']);
      });
    }
  });
}
