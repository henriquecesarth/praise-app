import 'package:flutter/material.dart';
import '../../domain/vocal_exercise.dart';

class PianoKeyboard extends StatefulWidget {
  final int? activeNote;
  final int minMidi;
  final int maxMidi;
  final int initialFocusMidi;

  const PianoKeyboard({
    super.key,
    required this.activeNote,
    this.minMidi = supportedPianoMinMidi,
    this.maxMidi = supportedPianoMaxMidi,
    this.initialFocusMidi = 60,
  });

  @override
  State<PianoKeyboard> createState() => _PianoKeyboardState();
}

class _PianoKeyboardState extends State<PianoKeyboard> {
  final ScrollController _scrollController = ScrollController();
  static const double _whiteKeyWidth = 42.0;
  static const double _whiteKeyHeight = 148.0;
  static const double _blackKeyWidth = 26.0;
  static const double _blackKeyHeight = 92.0;

  static bool _isBlackKey(int midi) {
    final pc = midi % 12;
    return pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10;
  }

  List<int> get _whiteKeys => [
    for (var m = widget.minMidi; m <= widget.maxMidi; m++)
      if (!_isBlackKey(m)) m,
  ];

  double _xOffsetForMidi(int midi) {
    final whites = _whiteKeys;
    if (!_isBlackKey(midi)) {
      final idx = whites.indexOf(midi);
      return (idx < 0 ? 0 : idx) * _whiteKeyWidth;
    }
    final precedingWhiteIndex = whites.indexOf(midi - 1);
    if (precedingWhiteIndex < 0) return 0;
    return (precedingWhiteIndex + 1) * _whiteKeyWidth - (_blackKeyWidth / 2);
  }

  void _scrollToMidi(int midi, {bool animated = true}) {
    if (!_scrollController.hasClients) return;
    final viewport = _scrollController.position.viewportDimension;
    final maxScroll = _scrollController.position.maxScrollExtent;
    if (viewport <= 0 || maxScroll <= 0) return;

    final keyX = _xOffsetForMidi(midi);
    final keyW = _isBlackKey(midi) ? _blackKeyWidth : _whiteKeyWidth;
    final currentOffset = _scrollController.offset;
    final margin = 52.0;

    if (keyX >= currentOffset + margin &&
        keyX + keyW <= currentOffset + viewport - margin) {
      return;
    }
    final target = (keyX - (viewport / 2) + (keyW / 2)).clamp(0.0, maxScroll);
    if (animated) {
      _scrollController.animateTo(
        target,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
      );
    } else {
      _scrollController.jumpTo(target);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _scrollToMidi(widget.activeNote ?? widget.initialFocusMidi, animated: false);
    });
  }

  @override
  void didUpdateWidget(covariant PianoKeyboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextNote = widget.activeNote;
    if (nextNote != null &&
        nextNote >= widget.minMidi &&
        nextNote <= widget.maxMidi &&
        nextNote != oldWidget.activeNote) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _scrollToMidi(nextNote, animated: true);
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final whites = _whiteKeys;
    final totalWidth = whites.length * _whiteKeyWidth;
    final active = widget.activeNote != null &&
            widget.activeNote! >= widget.minMidi &&
            widget.activeNote! <= widget.maxMidi
        ? widget.activeNote
        : null;

    return Container(
      key: const ValueKey('vocal_piano_keyboard'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark
            ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.45)
            : theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.dividerColor.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'TECLADO DE REFERÊNCIA (${midiLabel(widget.minMidi)} – ${midiLabel(widget.maxMidi)})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              Container(
                key: const ValueKey('vocal_piano_active_note_badge'),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: active != null
                      ? theme.colorScheme.primary.withValues(alpha: 0.16)
                      : theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  active != null
                      ? 'Tocando: ${midiLabel(active)}'
                      : 'Aguardando nota',
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: active != null
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            controller: _scrollController,
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: totalWidth,
              height: _whiteKeyHeight,
              child: Stack(
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final midi in whites)
                        _buildWhiteKey(
                          context,
                          midi: midi,
                          isActive: active == midi,
                        ),
                    ],
                  ),
                  for (var midi = widget.minMidi; midi <= widget.maxMidi; midi++)
                    if (_isBlackKey(midi))
                      Positioned(
                        left: _xOffsetForMidi(midi),
                        top: 0,
                        width: _blackKeyWidth,
                        height: _blackKeyHeight,
                        child: _buildBlackKey(
                          context,
                          midi: midi,
                          isActive: active == midi,
                        ),
                      ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWhiteKey(
    BuildContext context, {
    required int midi,
    required bool isActive,
  }) {
    final theme = Theme.of(context);
    final label = midiLabel(midi);
    final isC = midi % 12 == 0;

    return Semantics(
      label: 'Tecla $label${isActive ? ", ativa" : ""}',
      selected: isActive,
      child: Container(
        key: ValueKey('piano_key_$midi'),
        width: _whiteKeyWidth,
        height: _whiteKeyHeight,
        padding: const EdgeInsets.only(bottom: 8),
        alignment: Alignment.bottomCenter,
        decoration: BoxDecoration(
          color: isActive ? theme.colorScheme.primary : Colors.white,
          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(6)),
          border: Border.all(
            color: isActive
                ? theme.colorScheme.primary
                : Colors.blueGrey.shade200,
            width: isActive ? 2 : 1,
          ),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: theme.colorScheme.primary.withValues(alpha: 0.35),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10,
            fontWeight: isActive || isC ? FontWeight.w800 : FontWeight.w500,
            color: isActive
                ? theme.colorScheme.onPrimary
                : (isC ? Colors.black87 : Colors.blueGrey.shade600),
          ),
        ),
      ),
    );
  }

  Widget _buildBlackKey(
    BuildContext context, {
    required int midi,
    required bool isActive,
  }) {
    final theme = Theme.of(context);
    final label = midiLabel(midi);

    return Semantics(
      label: 'Tecla $label${isActive ? ", ativa" : ""}',
      selected: isActive,
      child: Container(
        key: ValueKey('piano_key_$midi'),
        padding: const EdgeInsets.only(bottom: 6),
        alignment: Alignment.bottomCenter,
        decoration: BoxDecoration(
          color: isActive ? theme.colorScheme.tertiary : const Color(0xFF1E293B),
          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(5)),
          border: Border.all(
            color: isActive ? theme.colorScheme.tertiary : Colors.black87,
            width: isActive ? 1.5 : 1,
          ),
          boxShadow: const [
            BoxShadow(
              color: Colors.black38,
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Text(
          label.replaceAll(RegExp(r'\d+$'), ''),
          style: TextStyle(
            fontSize: 8.5,
            fontWeight: FontWeight.w700,
            color: isActive
                ? theme.colorScheme.onTertiary
                : Colors.blueGrey.shade100,
          ),
        ),
      ),
    );
  }
}
