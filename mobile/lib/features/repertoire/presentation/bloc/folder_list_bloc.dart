import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';

// ============================================================
// EVENTS
// ============================================================
abstract class FolderListEvent extends Equatable {
  const FolderListEvent();
  @override
  List<Object?> get props => [];
}

class LoadFolders extends FolderListEvent {
  const LoadFolders();
}

class CreateFolderEvent extends FolderListEvent {
  final String name;
  final String? description;
  const CreateFolderEvent(this.name, {this.description});
  @override
  List<Object?> get props => [name, description];
}

class DeleteFolderEvent extends FolderListEvent {
  final String folderId;
  const DeleteFolderEvent(this.folderId);
  @override
  List<Object?> get props => [folderId];
}

// ============================================================
// STATES
// ============================================================
abstract class FolderListState extends Equatable {
  const FolderListState();
  @override
  List<Object?> get props => [];
}

class FolderListInitial extends FolderListState {
  const FolderListInitial();
}

class FolderListLoading extends FolderListState {
  const FolderListLoading();
}

class FolderListLoaded extends FolderListState {
  final List<Folder> folders;
  const FolderListLoaded({required this.folders});
  @override
  List<Object?> get props => [folders];
}

class FolderListError extends FolderListState {
  final String message;
  const FolderListError(this.message);
  @override
  List<Object?> get props => [message];
}

// ============================================================
// BLOC
// ============================================================
class FolderListBloc extends Bloc<FolderListEvent, FolderListState> {
  final FolderRepository _folderRepository;
  final String _ministryId;

  FolderListBloc({
    required FolderRepository folderRepository,
    required String ministryId,
  })  : _folderRepository = folderRepository,
        _ministryId = ministryId,
        super(const FolderListInitial()) {
    on<LoadFolders>(_onLoadFolders);
    on<CreateFolderEvent>(_onCreateFolder);
    on<DeleteFolderEvent>(_onDeleteFolder);
  }

  Future<void> _onLoadFolders(
    LoadFolders event,
    Emitter<FolderListState> emit,
  ) async {
    emit(const FolderListLoading());
    final result = await _folderRepository.getFolders(_ministryId);
    result.fold(
      (dynamic failure) => emit(FolderListError(failure.message)),
      (folders) => emit(FolderListLoaded(folders: folders)),
    );
  }

  Future<void> _onCreateFolder(
    CreateFolderEvent event,
    Emitter<FolderListState> emit,
  ) async {
    final result = await _folderRepository.createFolder(
      _ministryId,
      event.name,
      description: event.description,
    );
    result.fold(
      (dynamic failure) => emit(FolderListError(failure.message)),
      (_) => add(const LoadFolders()),
    );
  }

  Future<void> _onDeleteFolder(
    DeleteFolderEvent event,
    Emitter<FolderListState> emit,
  ) async {
    final result = await _folderRepository.deleteFolder(_ministryId, event.folderId);
    result.fold(
      (dynamic failure) => emit(FolderListError(failure.message)),
      (_) => add(const LoadFolders()),
    );
  }
}
