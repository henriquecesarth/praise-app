import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../app/providers.dart';
import '../../../../core/logging/app_logger.dart';
import '../../domain/shared_import_payload.dart';
import '../../services/share_intent_service.dart';
import '../views/smart_chord_import_screen.dart';

class ShareIntentRouter {
  final dynamic _ref;
  final GlobalKey<NavigatorState> navigatorKey;
  final ShareIntentService _service;
  final AppLogger _logger;

  SharedImportPayload? _pendingPayload;
  StreamSubscription<SharedImportPayload>? _subscription;
  bool _isInitialized = false;
  bool _isNavigating = false;

  ShareIntentRouter({
    required dynamic ref,
    required this.navigatorKey,
    required ShareIntentService service,
    required AppLogger logger,
  })  : _ref = ref,
        _service = service,
        _logger = logger;

  SharedImportPayload? get pendingPayload => _pendingPayload;

  void clearPendingPayload() {
    _pendingPayload = null;
  }

  void initialize() {
    if (_isInitialized) return;
    _isInitialized = true;

    _subscription = _service.onShareReceived.listen((payload) {
      _logger.debug('Warm start share intent received: ${payload.type}');
      handlePayload(payload);
    });

    checkInitialShare();
  }

  Future<void> checkInitialShare() async {
    try {
      final payload = await _service.getInitialShare();
      if (payload != null) {
        _logger.debug('Cold start share intent retrieved: ${payload.type}');
        await handlePayload(payload);
      }
    } catch (e) {
      _logger.error('Failed to retrieve initial share intent: $e');
    }
  }

  Future<void> handlePayload(SharedImportPayload payload, [BuildContext? context]) async {
    final authState = _ref.read(authNotifierProvider);

    // 1. Session verification: If not authenticated, store payload pending login.
    if (!authState.isAuthenticated) {
      _logger.debug('User unauthenticated; holding share intent payload pending login.');
      _pendingPayload = payload;
      return;
    }

    final ministryState = _ref.read(ministryContextNotifierProvider);

    // 2. Ministry context verification: If ministry context is not yet ready, hold payload.
    if (!ministryState.isReady) {
      _logger.debug('Ministry context not ready; holding share intent payload.');
      _pendingPayload = payload;
      return;
    }

    // 3. Authenticated & Ready: Navigate safely to the Smart Chords Import Hub
    _navigateToImportScreen(payload, context);
  }

  void _navigateToImportScreen(SharedImportPayload payload, [BuildContext? context]) {
    final ctx = context ?? navigatorKey.currentContext;
    final nav = navigatorKey.currentState ?? (ctx != null ? Navigator.of(ctx) : null);

    if (nav == null) {
      _logger.warning('Cannot navigate to import hub: NavigatorState is null.');
      _pendingPayload = payload;
      return;
    }

    if (_isNavigating) {
      _logger.debug('Navigation already in progress, skipping duplicate.');
      return;
    }

    _isNavigating = true;
    try {
      // Pop open modal sheets/dialogs back to shell before navigating
      nav.popUntil((route) => route.isFirst);

      nav.push(
        MaterialPageRoute(
          builder: (_) => SmartChordImportScreen(
            initialPayload: payload,
          ),
        ),
      );
    } catch (e) {
      _logger.error('Failed to navigate to SmartChordImportScreen: $e');
    } finally {
      _isNavigating = false;
    }
  }

  Future<void> dispatchPendingIfReady([BuildContext? context]) async {
    if (_pendingPayload == null) return;

    final authState = _ref.read(authNotifierProvider);
    final ministryState = _ref.read(ministryContextNotifierProvider);

    if (authState.isAuthenticated && ministryState.isReady) {
      _logger.debug('Dispatching pending share intent payload after authentication: $_pendingPayload');
      final payload = _pendingPayload!;
      _pendingPayload = null;
      await handlePayload(payload, context);
    }
  }

  void dispose() {
    _subscription?.cancel();
    _service.dispose();
  }
}
