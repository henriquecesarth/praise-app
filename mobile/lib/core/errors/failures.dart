import 'package:equatable/equatable.dart';

/// Base failure class for error handling across layers
abstract class Failure extends Equatable {
  final String message;
  final dynamic details;

  const Failure({required this.message, this.details});

  @override
  List<Object?> get props => [message, details];
}

/// Server/API failure
class ServerFailure extends Failure {
  const ServerFailure({required super.message, super.details});
}

/// Network connectivity failure
class NetworkFailure extends Failure {
  const NetworkFailure({
    super.message = 'Sem conexão com a internet. Verifique sua rede.',
  });
}

/// Cache/local storage failure
class CacheFailure extends Failure {
  const CacheFailure({
    super.message = 'Erro ao acessar dados locais.',
  });
}

/// Not found failure
class NotFoundFailure extends Failure {
  const NotFoundFailure({
    super.message = 'Recurso não encontrado.',
  });
}

/// Validation failure
class ValidationFailure extends Failure {
  const ValidationFailure({required super.message, super.details});
}
