import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Chords before and after the tapped one on the same line.
typedef ChordNeighbours = ({String? previous, String? next});

ChordNeighbours lineNeighbours(List<String> chords, int index) => (
  previous: index > 0 && index <= chords.length ? chords[index - 1] : null,
  next: index >= 0 && index + 1 < chords.length ? chords[index + 1] : null,
);

/// Minimum side of the touch area around a chord, in logical pixels.
const double kChordTargetSize = 44;

/// A tappable chord: keyboard focus, screen reader label and direct tap.
///
/// It takes exactly the size of [child], so the chord sheet never moves. The
/// 44 dp touch area comes from an ancestor [ChordHitSlopScope], because
/// Flutter cannot hit test outside the bounds of the parent.
class ChordTapTarget extends StatefulWidget {
  final String chord;
  final VoidCallback onActivate;
  final Widget child;

  const ChordTapTarget({
    super.key,
    required this.chord,
    required this.onActivate,
    required this.child,
  });

  @override
  State<ChordTapTarget> createState() => _ChordTapTargetState();
}

class _ChordTapTargetState extends State<ChordTapTarget> {
  _ChordHitSlopScopeState? _scope;
  bool _showFocus = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scope = context.findAncestorStateOfType<_ChordHitSlopScopeState>();
    if (scope != _scope) {
      _scope?._targets.remove(this);
      _scope = scope?.._targets.add(this);
    }
  }

  @override
  void dispose() {
    _scope?._targets.remove(this);
    super.dispose();
  }

  Rect? get _globalRect {
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return null;
    return MatrixUtils.transformRect(
        box.getTransformTo(null), Offset.zero & box.size);
  }

  /// False when a scroll view has moved the chord out of sight.
  bool _isOnScreen(Offset center) {
    var scrollable = Scrollable.maybeOf(context);
    while (scrollable != null) {
      final viewport = scrollable.context.findRenderObject();
      if (viewport is RenderBox &&
          !MatrixUtils.transformRect(viewport.getTransformTo(null),
                  Offset.zero & viewport.size)
              .contains(center)) {
        return false;
      }
      scrollable = Scrollable.maybeOf(scrollable.context);
    }
    return true;
  }

  void _activate() => widget.onActivate();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: 'Ver diagrama do acorde ${widget.chord}',
      onTap: _activate,
      child: FocusableActionDetector(
        mouseCursor: SystemMouseCursors.click,
        actions: <Type, Action<Intent>>{
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            _activate();
            return null;
          }),
        },
        onShowFocusHighlight: (value) => setState(() => _showFocus = value),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          excludeFromSemantics: true,
          onTap: _activate,
          child: DecoratedBox(
            position: DecorationPosition.foreground,
            decoration: BoxDecoration(
              border: _showFocus
                  ? Border.all(
                      color: Theme.of(context).colorScheme.primary, width: 2)
                  : null,
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

/// Gives every [ChordTapTarget] below it a touch area of at least 44x44 dp
/// without changing layout. A near miss activates the closest chord.
///
/// It only listens to raw pointers, so scrolling and text selection keep
/// winning the gesture arena as before. Place it *inside* the scroll view: a
/// touch that stops a fling then never reaches it.
class ChordHitSlopScope extends StatefulWidget {
  final Widget child;

  const ChordHitSlopScope({super.key, required this.child});

  @override
  State<ChordHitSlopScope> createState() => _ChordHitSlopScopeState();
}

class _ChordHitSlopScopeState extends State<ChordHitSlopScope> {
  final Set<_ChordTapTargetState> _targets = {};
  int? _pointer;
  Offset _downPosition = Offset.zero;
  Timer? _longPress;
  _ChordTapTargetState? _candidate;

  /// The closest target whose enlarged area holds [position]; null when the
  /// touch lands on a chord itself, which handles its own tap.
  _ChordTapTargetState? _nearMiss(Offset position) {
    _ChordTapTargetState? best;
    var bestDistance = double.infinity;
    for (final target in _targets) {
      final rect = target._globalRect;
      if (rect == null || !target._isOnScreen(rect.center)) continue;
      if (rect.contains(position)) return null;
      final area = Rect.fromCenter(
        center: rect.center,
        width: math.max(rect.width, kChordTargetSize),
        height: math.max(rect.height, kChordTargetSize),
      );
      final distance = (rect.center - position).distanceSquared;
      if (area.contains(position) && distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  void _onPointerDown(PointerDownEvent event) {
    // A second finger means this is not a tap.
    if (_pointer != null) {
      _candidate = null;
      return;
    }
    _pointer = event.pointer;
    _downPosition = event.position;
    // Chosen now: auto-scroll may move the sheet before the finger lifts.
    _candidate = _nearMiss(event.position);
    // Holding is not a tap: it belongs to text selection.
    _longPress?.cancel();
    _longPress = Timer(kLongPressTimeout, () => _candidate = null);
  }

  void _onPointerMove(PointerMoveEvent event) {
    // Same slop as the scroll views, which is the device's (about 8 dp).
    if (event.pointer == _pointer &&
        (event.position - _downPosition).distance >
            computeHitSlop(
                event.kind, MediaQuery.maybeGestureSettingsOf(context))) {
      _candidate = null;
    }
  }

  void _onPointerEnd(PointerEvent event) {
    if (event.pointer != _pointer) return;
    final target = _candidate;
    _pointer = null;
    _candidate = null;
    _longPress?.cancel();
    if (event is PointerUpEvent && target != null && target.mounted) {
      target._activate();
    }
  }

  @override
  void dispose() {
    _longPress?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: _onPointerDown,
        onPointerMove: _onPointerMove,
        onPointerUp: _onPointerEnd,
        onPointerCancel: _onPointerEnd,
        child: widget.child,
      );
}
