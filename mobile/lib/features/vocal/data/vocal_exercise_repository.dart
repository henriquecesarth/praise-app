import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/vocal_exercise.dart';

class CustomVocalExerciseDraft {
  final String title;
  final String description;
  final List<int> notes;
  final List<double> noteDurations;
  final int minTranspose;
  final int maxTranspose;
  final MelodicCategory category;

  const CustomVocalExerciseDraft({
    required this.title,
    this.description = '',
    required this.notes,
    required this.noteDurations,
    this.minTranspose = -12,
    this.maxTranspose = 12,
    required this.category,
  });

  Map<String, dynamic> toJson() {
    final trimmedTitle = title.trim();
    final trimmedDesc = description.trim();
    return {
      'title': trimmedTitle,
      if (trimmedDesc.isNotEmpty) 'description': trimmedDesc,
      'notes': notes,
      'noteDurations': noteDurations,
      'minTranspose': minTranspose,
      'maxTranspose': maxTranspose,
      'category': category.value,
    };
  }
}

class CustomVocalExercisePatch {
  final String? title;
  final String? description;
  final List<int>? notes;
  final List<double>? noteDurations;
  final int? minTranspose;
  final int? maxTranspose;
  final MelodicCategory? category;

  const CustomVocalExercisePatch({
    this.title,
    this.description,
    this.notes,
    this.noteDurations,
    this.minTranspose,
    this.maxTranspose,
    this.category,
  });

  Map<String, dynamic> toJson() {
    return {
      if (title != null) 'title': title!.trim(),
      if (description != null) 'description': description!.trim(),
      if (notes != null) 'notes': notes,
      if (noteDurations != null) 'noteDurations': noteDurations,
      if (minTranspose != null) 'minTranspose': minTranspose,
      if (maxTranspose != null) 'maxTranspose': maxTranspose,
      if (category != null) 'category': category!.value,
    };
  }
}

abstract class VocalExerciseRepository {
  Future<List<VocalExercise>> listCustomExercises();
  Future<VocalExercise> getCustomExerciseById(String id);
  Future<VocalExercise> createCustomExercise(CustomVocalExerciseDraft draft);
  Future<VocalExercise> updateCustomExercise(
    String id,
    CustomVocalExercisePatch patch,
  );
  Future<void> deleteCustomExercise(String id);
}

class ApiVocalExerciseRepository implements VocalExerciseRepository {
  final ApiClient _apiClient;

  const ApiVocalExerciseRepository(this._apiClient);

  static void validateDraft({
    required String title,
    required String description,
    required List<int> notes,
    required List<double> noteDurations,
  }) {
    final trimmedTitle = title.trim();
    if (trimmedTitle.isEmpty) {
      throw const AppFailure(
        message: 'Informe um nome para o exercício.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    if (trimmedTitle.length > 120) {
      throw const AppFailure(
        message: 'O título deve ter no máximo 120 caracteres.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    if (description.trim().length > 500) {
      throw const AppFailure(
        message: 'A descrição deve ter no máximo 500 caracteres.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    if (notes.isEmpty || notes.length > 64) {
      throw const AppFailure(
        message: 'O exercício deve ter entre 1 e 64 notas.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    if (notes.length != noteDurations.length) {
      throw const AppFailure(
        message: 'Cada nota deve ter uma duração correspondente.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    for (final note in notes) {
      if (note < supportedPianoMinMidi || note > supportedPianoMaxMidi) {
        throw const AppFailure(
          message: 'Notas fora do intervalo suportado pelo piano (Dó3 a Mi6).',
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        );
      }
    }
    for (final duration in noteDurations) {
      if (!duration.isFinite || duration < 0.25 || duration > 16) {
        throw const AppFailure(
          message: 'Duração das notas deve estar entre 0.25 e 16 tempos.',
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        );
      }
    }
  }

  @override
  Future<List<VocalExercise>> listCustomExercises() async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/vocal-exercises/custom',
      );
      final rawList = response.data?['exercises'];
      if (rawList is! List) return const [];
      return rawList
          .whereType<Map>()
          .map(
            (item) => VocalExercise.fromJson(
              Map<String, dynamic>.from(item),
              isCustomFallback: true,
            ),
          )
          .toList(growable: false);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    }
  }

  @override
  Future<VocalExercise> getCustomExerciseById(String id) async {
    final trimmedId = id.trim();
    if (trimmedId.isEmpty) {
      throw const AppFailure(
        message: 'Identificador do exercício inválido.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/vocal-exercises/custom/${Uri.encodeComponent(trimmedId)}',
      );
      final rawExercise = response.data?['exercise'];
      if (rawExercise is! Map) {
        throw const AppFailure(
          message: 'Resposta inválida ao carregar exercício personalizado.',
          statusCode: 500,
        );
      }
      return VocalExercise.fromJson(
        Map<String, dynamic>.from(rawExercise),
        isCustomFallback: true,
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    }
  }

  @override
  Future<VocalExercise> createCustomExercise(
    CustomVocalExerciseDraft draft,
  ) async {
    validateDraft(
      title: draft.title,
      description: draft.description,
      notes: draft.notes,
      noteDurations: draft.noteDurations,
    );
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/vocal-exercises/custom',
        data: draft.toJson(),
      );
      final rawExercise = response.data?['exercise'];
      if (rawExercise is! Map) {
        throw const AppFailure(
          message: 'Resposta inválida ao criar exercício personalizado.',
          statusCode: 500,
        );
      }
      return VocalExercise.fromJson(
        Map<String, dynamic>.from(rawExercise),
        isCustomFallback: true,
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    }
  }

  @override
  Future<VocalExercise> updateCustomExercise(
    String id,
    CustomVocalExercisePatch patch,
  ) async {
    final trimmedId = id.trim();
    if (trimmedId.isEmpty) {
      throw const AppFailure(
        message: 'Identificador do exercício inválido.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    if (patch.title != null ||
        patch.notes != null ||
        patch.noteDurations != null) {
      validateDraft(
        title: patch.title ?? 'Exercício',
        description: patch.description ?? '',
        notes: patch.notes ?? const [60],
        noteDurations: patch.noteDurations ?? const [1.0],
      );
    }
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/vocal-exercises/custom/${Uri.encodeComponent(trimmedId)}',
        data: patch.toJson(),
      );
      final rawExercise = response.data?['exercise'];
      if (rawExercise is! Map) {
        throw const AppFailure(
          message: 'Resposta inválida ao atualizar exercício personalizado.',
          statusCode: 500,
        );
      }
      return VocalExercise.fromJson(
        Map<String, dynamic>.from(rawExercise),
        isCustomFallback: true,
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    }
  }

  @override
  Future<void> deleteCustomExercise(String id) async {
    final trimmedId = id.trim();
    if (trimmedId.isEmpty) {
      throw const AppFailure(
        message: 'Identificador do exercício inválido.',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      );
    }
    try {
      await _apiClient.dio.delete<Map<String, dynamic>>(
        '/vocal-exercises/custom/${Uri.encodeComponent(trimmedId)}',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    }
  }
}
