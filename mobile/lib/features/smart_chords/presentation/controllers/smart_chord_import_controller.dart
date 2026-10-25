import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_import.dart';

enum ImportStatus {
  initial,
  extracting,
  preview,
  saving,
  saved,
  linking,
  success,
  error,
}

class SmartChordImportState {
  final ImportStatus status;
  final SmartChordImportDraft? draft;
  final SmartChord? savedChord;
  final String? errorMessage;
  final String? linkError;
  final int generation;

  const SmartChordImportState({
    this.status = ImportStatus.initial,
    this.draft,
    this.savedChord,
    this.errorMessage,
    this.linkError,
    this.generation = 0,
  });

  SmartChordImportState copyWith({
    ImportStatus? status,
    SmartChordImportDraft? draft,
    SmartChord? savedChord,
    String? errorMessage,
    String? linkError,
    int? generation,
    bool clearError = false,
    bool clearLinkError = false,
  }) {
    return SmartChordImportState(
      status: status ?? this.status,
      draft: draft ?? this.draft,
      savedChord: savedChord ?? this.savedChord,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      linkError: clearLinkError ? null : (linkError ?? this.linkError),
      generation: generation ?? this.generation,
    );
  }
}

class SmartChordImportNotifier extends StateNotifier<SmartChordImportState> {
  final SmartChordRepository _repository;
  final SmartChordRepertoireLinkRepository _linkRepository;

  SmartChordImportNotifier({
    required SmartChordRepository repository,
    required SmartChordRepertoireLinkRepository linkRepository,
  })  : _repository = repository,
        _linkRepository = linkRepository,
        super(const SmartChordImportState());

  bool _isCurrent(int generation) => mounted && state.generation == generation;

  String _message(Object error) {
    if (error is AppFailure) {
      if (error.statusCode == 401 || error.code == 'SESSION_CHANGED') {
        return 'Sessão expirada ou alterada. Faça login novamente.';
      }
      if (error.code == 'NETWORK_ERROR') return 'Falha de conexão. Verifique sua internet e tente novamente.';
      if (error.statusCode == 400 || error.statusCode == 413) return error.message;
    }
    return 'Não foi possível concluir a operação. Tente novamente.';
  }

  void reset() {
    state = SmartChordImportState(generation: state.generation + 1);
  }

  Future<void> importPdf(List<int> bytes, String filename) async {
    final currentGen = state.generation + 1;
    state = state.copyWith(
      status: ImportStatus.extracting,
      clearError: true,
      generation: currentGen,
    );

    try {
      final draft = await _repository.importPdfDraft(bytes, filename);
      if (!_isCurrent(currentGen)) return;

      state = state.copyWith(
        status: ImportStatus.preview,
        draft: draft,
        clearError: true,
      );
    } catch (e) {
      if (!_isCurrent(currentGen)) return;
      state = state.copyWith(
        status: ImportStatus.error,
        errorMessage: _message(e),
      );
    }
  }

  Future<void> importText(String text) async {
    final currentGen = state.generation + 1;
    state = state.copyWith(
      status: ImportStatus.extracting,
      clearError: true,
      generation: currentGen,
    );

    try {
      final draft = await _repository.importTextDraft(text);
      if (!_isCurrent(currentGen)) return;

      state = state.copyWith(
        status: ImportStatus.preview,
        draft: draft,
        clearError: true,
      );
    } catch (e) {
      if (!_isCurrent(currentGen)) return;
      state = state.copyWith(
        status: ImportStatus.error,
        errorMessage: _message(e),
      );
    }
  }

  void updateDraft({
    String? title,
    String? artistName,
    String? originalKey,
    String? content,
  }) {
    if (state.draft == null) return;
    state = state.copyWith(
      draft: state.draft!.copyWith(
        title: title,
        artistName: artistName,
        originalKey: originalKey,
        content: content,
      ),
    );
  }

  Future<SmartChord?> saveChord() async {
    final draft = state.draft;
    if (draft == null || state.status == ImportStatus.saving ||
        state.status == ImportStatus.linking || state.savedChord != null) {
      return null;
    }

    final title = draft.title.trim();
    final content = draft.content.trim();

    if (title.isEmpty) {
      state = state.copyWith(errorMessage: 'O título da cifra é obrigatório.');
      return null;
    }
    if (content.isEmpty) {
      state = state.copyWith(errorMessage: 'O conteúdo da cifra não pode ser vazio.');
      return null;
    }

    final currentGen = state.generation + 1;
    state = state.copyWith(
      status: ImportStatus.saving,
      clearError: true,
      generation: currentGen,
    );

    try {
      final payload = {
        'title': title,
        'artist_name': draft.artistName?.trim().isNotEmpty == true ? draft.artistName!.trim() : null,
        'original_key': draft.originalKey?.trim().isNotEmpty == true ? draft.originalKey!.trim() : 'C',
        'content': content,
      };

      final created = await _repository.createSmartChord(payload);
      // The remote write may have succeeded. Discard only its local continuation.
      if (!_isCurrent(currentGen)) return null;

      state = state.copyWith(
        status: ImportStatus.saved,
        savedChord: created,
        clearError: true,
      );
      return created;
    } catch (e) {
      if (!_isCurrent(currentGen)) return null;
      state = state.copyWith(
        status: ImportStatus.preview,
        errorMessage: _message(e),
      );
      return null;
    }
  }

  Future<bool> linkToRepertoire({
    required String ministryId,
    required String songId,
  }) async {
    final chord = state.savedChord;
    if (chord == null) return false;

    final currentGen = state.generation + 1;
    state = state.copyWith(
      status: ImportStatus.linking,
      clearLinkError: true,
      generation: currentGen,
    );

    try {
      await _linkRepository.setRepertoireLink(
        ministryId: ministryId,
        chordId: chord.id,
        songId: songId,
      );
      if (!_isCurrent(currentGen)) return false;

      state = state.copyWith(
        status: ImportStatus.success,
        clearLinkError: true,
      );
      return true;
    } catch (e) {
      if (!_isCurrent(currentGen)) return false;
      // Partial success safety: chord is saved, only relation failed
      state = state.copyWith(
        status: ImportStatus.saved,
        linkError: _message(e),
      );
      return false;
    }
  }
}
