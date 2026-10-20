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
      if (state.generation != currentGen) return;

      state = state.copyWith(
        status: ImportStatus.preview,
        draft: draft,
        clearError: true,
      );
    } catch (e) {
      if (state.generation != currentGen) return;
      state = state.copyWith(
        status: ImportStatus.error,
        errorMessage: e is AppFailure ? e.message : e.toString(),
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
      if (state.generation != currentGen) return;

      state = state.copyWith(
        status: ImportStatus.preview,
        draft: draft,
        clearError: true,
      );
    } catch (e) {
      if (state.generation != currentGen) return;
      state = state.copyWith(
        status: ImportStatus.error,
        errorMessage: e is AppFailure ? e.message : e.toString(),
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
    if (draft == null) return null;

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
      if (state.generation != currentGen) return created;

      state = state.copyWith(
        status: ImportStatus.saved,
        savedChord: created,
        clearError: true,
      );
      return created;
    } catch (e) {
      if (state.generation != currentGen) return null;
      state = state.copyWith(
        status: ImportStatus.preview,
        errorMessage: e is AppFailure ? e.message : e.toString(),
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
      if (state.generation != currentGen) return true;

      state = state.copyWith(
        status: ImportStatus.success,
        clearLinkError: true,
      );
      return true;
    } catch (e) {
      if (state.generation != currentGen) return false;
      // Partial success safety: chord is saved, only relation failed
      state = state.copyWith(
        status: ImportStatus.saved,
        linkError: e is AppFailure ? e.message : e.toString(),
      );
      return false;
    }
  }
}
