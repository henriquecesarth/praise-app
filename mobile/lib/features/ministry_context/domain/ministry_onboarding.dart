import 'package:flutter/foundation.dart';
import 'ministry.dart';

/// Domain model representing an invitation code for a ministry.
/// Matching backend POST /api/v1/ministries/:ministryId/invites.
@immutable
class MinistryInvite {
  final String id;
  final String ministryId;
  final String code;
  final String? createdBy;
  final int? maxUses;
  final int usesCount;
  final DateTime? expiresAt;
  final DateTime? createdAt;

  const MinistryInvite({
    required this.id,
    required this.ministryId,
    required this.code,
    this.createdBy,
    this.maxUses,
    this.usesCount = 0,
    this.expiresAt,
    this.createdAt,
  });

  factory MinistryInvite.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic value) {
      if (value == null) return null;
      if (value is String && value.isNotEmpty) {
        return DateTime.tryParse(value);
      }
      return null;
    }

    return MinistryInvite(
      id: json['id'] as String? ?? '',
      ministryId: (json['ministry_id'] ?? json['ministryId']) as String? ?? '',
      code: json['code'] as String? ?? '',
      createdBy: (json['created_by'] ?? json['createdBy']) as String?,
      maxUses: (json['max_uses'] ?? json['maxUses']) as int?,
      usesCount: (json['uses_count'] ?? json['usesCount']) as int? ?? 0,
      expiresAt: parseDate(json['expires_at'] ?? json['expiresAt']),
      createdAt: parseDate(json['created_at'] ?? json['createdAt']),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ministry_id': ministryId,
        'code': code,
        if (createdBy != null) 'created_by': createdBy,
        if (maxUses != null) 'max_uses': maxUses,
        'uses_count': usesCount,
        if (expiresAt != null) 'expires_at': expiresAt!.toIso8601String(),
        if (createdAt != null) 'created_at': createdAt!.toIso8601String(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MinistryInvite &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          code == other.code;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode ^ code.hashCode;

  @override
  String toString() => 'MinistryInvite(id: $id, ministryId: $ministryId)';
}

/// Domain model representing the result of joining a ministry via invite code.
/// Matching backend POST /api/v1/ministries/join.
@immutable
class JoinMinistryResult {
  final String message;
  final Ministry ministry;
  final String role;

  const JoinMinistryResult({
    required this.message,
    required this.ministry,
    required this.role,
  });

  factory JoinMinistryResult.fromJson(Map<String, dynamic> json) {
    final ministryData = json['ministry'] is Map
        ? json['ministry'] as Map
        : json['group'] is Map
            ? json['group'] as Map
            : json;

    return JoinMinistryResult(
      message: json['message'] as String? ??
          'Você ingressou no ministério com sucesso!',
      ministry: Ministry.fromJson(
        Map<String, dynamic>.from(ministryData),
      ),
      role: json['role'] as String? ?? 'member',
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is JoinMinistryResult &&
          runtimeType == other.runtimeType &&
          message == other.message &&
          ministry == other.ministry &&
          role == other.role;

  @override
  int get hashCode => message.hashCode ^ ministry.hashCode ^ role.hashCode;
}

/// Outcome enum for onboarding mutations.
enum OnboardingMutationOutcome {
  success,
  failure,
  discarded,
}

/// Typed result of an onboarding mutation.
@immutable
class OnboardingMutationResult<T> {
  final OnboardingMutationOutcome outcome;
  final T? data;
  final String? errorMessage;
  final bool isRefreshFailure;

  const OnboardingMutationResult._({
    required this.outcome,
    this.data,
    this.errorMessage,
    this.isRefreshFailure = false,
  });

  const OnboardingMutationResult.success([T? data])
      : this._(outcome: OnboardingMutationOutcome.success, data: data);

  const OnboardingMutationResult.failure(
    String? errorMessage, {
    bool isRefreshFailure = false,
    T? partialData,
  }) : this._(
          outcome: OnboardingMutationOutcome.failure,
          errorMessage: errorMessage,
          isRefreshFailure: isRefreshFailure,
          data: partialData,
        );

  const OnboardingMutationResult.discarded()
      : this._(outcome: OnboardingMutationOutcome.discarded);

  bool get isSuccess => outcome == OnboardingMutationOutcome.success;
  bool get isFailure => outcome == OnboardingMutationOutcome.failure;
  bool get isDiscarded => outcome == OnboardingMutationOutcome.discarded;
}
