import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';

// ============================================================
// EVENTS
// ============================================================
abstract class ClassificationListEvent extends Equatable {
  const ClassificationListEvent();
  @override
  List<Object?> get props => [];
}

class LoadClassifications extends ClassificationListEvent {
  const LoadClassifications();
}

// ============================================================
// STATES
// ============================================================
abstract class ClassificationListState extends Equatable {
  const ClassificationListState();
  @override
  List<Object?> get props => [];
}

class ClassificationListInitial extends ClassificationListState {
  const ClassificationListInitial();
}

class ClassificationListLoading extends ClassificationListState {
  const ClassificationListLoading();
}

class ClassificationListLoaded extends ClassificationListState {
  final List<Classification> classifications;
  const ClassificationListLoaded({required this.classifications});
  @override
  List<Object?> get props => [classifications];
}

class ClassificationListError extends ClassificationListState {
  final String message;
  const ClassificationListError(this.message);
  @override
  List<Object?> get props => [message];
}

// ============================================================
// BLOC
// ============================================================
class ClassificationListBloc
    extends Bloc<ClassificationListEvent, ClassificationListState> {
  final ClassificationRepository _classificationRepository;
  final String _ministryId;

  ClassificationListBloc({
    required ClassificationRepository classificationRepository,
    required String ministryId,
  })  : _classificationRepository = classificationRepository,
        _ministryId = ministryId,
        super(const ClassificationListInitial()) {
    on<LoadClassifications>(_onLoadClassifications);
  }

  Future<void> _onLoadClassifications(
    LoadClassifications event,
    Emitter<ClassificationListState> emit,
  ) async {
    emit(const ClassificationListLoading());
    final result = await _classificationRepository.getClassifications(_ministryId);
    result.fold(
      (failure) => emit(ClassificationListError(failure.message)),
      (classifications) => emit(ClassificationListLoaded(classifications: classifications)),
    );
  }
}
