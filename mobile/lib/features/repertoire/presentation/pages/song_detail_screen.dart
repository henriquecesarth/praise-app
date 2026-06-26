import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/entities/entities.dart';
import '../widgets/widgets.dart';
import 'song_form_screen.dart';

/// Song Detail Screen — Shows full info for a single song
class SongDetailScreen extends StatefulWidget {
  final Song song;

  const SongDetailScreen({super.key, required this.song});

  @override
  State<SongDetailScreen> createState() => _SongDetailScreenState();
}

class _SongDetailScreenState extends State<SongDetailScreen> {
  late Song _song;

  @override
  void initState() {
    super.initState();
    _song = widget.song;
  }

  Future<void> _launchUrl(String url) async {
    var formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://$formattedUrl';
    }
    
    final uri = Uri.parse(formattedUrl);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível abrir o link. Verifique se ele é válido.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // ─── App Bar with gradient ────────────────────────
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            backgroundColor: AppColors.background,
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryDark, AppColors.background],
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                  ),
                ),
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 60, 24, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(
                          _song.title,
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: Colors.white,
                              ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _song.artistName ?? 'Artista desconhecido',
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                color: Colors.white70,
                              ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          // ─── Content ──────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Technical info chips
                  _buildTechChips(context),
                  const SizedBox(height: 24),

                  // External links
                  if (_song.hasLinks) ...[
                    _buildLinksSection(context),
                    const SizedBox(height: 24),
                  ],

                  // Lyrics
                  if (_song.lyrics != null && _song.lyrics!.isNotEmpty) ...[
                    _buildLyricsSection(context),
                  ],

                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ],
      ),

      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final updatedSong = await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => SongFormScreen(song: _song),
            ),
          );
          if (updatedSong != null && updatedSong is Song) {
            setState(() {
              _song = updatedSong;
            });
          }
        },
        child: const Icon(Icons.edit),
      ),
    );
  }

  Widget _buildTechChips(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        if (_song.classificationName != null)
          ClassificationBadge(
            name: _song.classificationName!,
            color: _song.classificationColor,
          ),
        if (_song.originalKey != null)
          _InfoChip(
            icon: Icons.music_note_rounded,
            label: 'Tom: ${_song.originalKey}',
          ),
        if (_song.bpm != null)
          _InfoChip(
            icon: Icons.speed_rounded,
            label: '${_song.bpm!.toInt()} BPM',
          ),
        if (_song.duration != null && _song.duration!.isNotEmpty)
          _InfoChip(
            icon: Icons.timer_rounded,
            label: _song.duration!,
          ),
      ],
    );
  }

  Widget _buildLinksSection(BuildContext context) {
    final extLinks = _song.externalLinks ?? {};
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Links & Recursos', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        if (_song.chordSheetUrl != null && _song.chordSheetUrl!.isNotEmpty)
          Builder(builder: (context) {
            final url = _song.chordSheetUrl!.toLowerCase();
            String? svg;
            IconData? icon = Icons.description_rounded;
            Color color = AppColors.success;
            String title = 'Cifra';

            if (url.contains('cifraclub.com.br')) {
              svg = 'assets/icons/cifraclub.png';
              icon = null;
              color = const Color(0xFFFF6600);
              title = 'Cifra Club';
            } else if (url.contains('drive.google.com')) {
              svg = 'assets/icons/googledrive.svg';
              icon = null;
              color = const Color(0xFF4285F4);
              title = 'Cifra (Google Drive)';
            }

            return _LinkTile(
              icon: icon,
              imagePath: svg,
              title: title,
              subtitle: 'Abrir arquivo de cifra',
              color: color,
              onTap: () => _launchUrl(_song.chordSheetUrl!),
            );
          }),
        if (extLinks['letras'] != null && extLinks['letras']!.isNotEmpty)
          Builder(builder: (context) {
            final url = extLinks['letras']!.toLowerCase();
            String? svg;
            IconData? icon = Icons.lyrics_rounded;
            Color color = AppColors.primary;
            String title = 'Letra';

            if (url.contains('letras.mus.br')) {
              svg = 'assets/icons/letras.png';
              icon = null;
              color = const Color(0xFFF58A07);
              title = 'Letras.mus.br';
            } else if (url.contains('drive.google.com')) {
              svg = 'assets/icons/googledrive.svg';
              icon = null;
              color = const Color(0xFF4285F4);
              title = 'Letra (Google Drive)';
            }

            return _LinkTile(
              icon: icon,
              imagePath: svg,
              title: title,
              subtitle: 'Ver letra completa',
              color: color,
              onTap: () => _launchUrl(extLinks['letras']!),
            );
          }),
        if (_song.youtubeUrl != null && _song.youtubeUrl!.isNotEmpty)
          _LinkTile(
            icon: Icons.video_library_rounded,
            title: 'Vídeo',
            subtitle: 'Assistir vídeo de referência',
            color: AppColors.error,
            onTap: () => _launchUrl(_song.youtubeUrl!),
          ),
        if (_song.audioUrl != null && _song.audioUrl!.isNotEmpty)
          _LinkTile(
            icon: Icons.headphones_rounded,
            title: 'Áudio',
            subtitle: 'Ouvir áudio de referência',
            color: AppColors.secondary,
            onTap: () => _launchUrl(_song.audioUrl!),
          ),
        if (extLinks['spotify'] != null && extLinks['spotify']!.isNotEmpty)
          _LinkTile(
            imagePath: 'assets/icons/spotify.svg',
            title: 'Spotify',
            subtitle: 'Ouvir no Spotify',
            color: const Color(0xFF1DB954),
            onTap: () => _launchUrl(extLinks['spotify']!),
          ),
        if (extLinks['deezer'] != null && extLinks['deezer']!.isNotEmpty)
          _LinkTile(
            imagePath: 'assets/icons/deezer.svg',
            title: 'Deezer',
            subtitle: 'Ouvir no Deezer',
            color: const Color(0xFFFEAA2D),
            onTap: () => _launchUrl(extLinks['deezer']!),
          ),
        if (extLinks['apple_music'] != null && extLinks['apple_music']!.isNotEmpty)
          _LinkTile(
            imagePath: 'assets/icons/applemusic.svg',
            title: 'Apple Music',
            subtitle: 'Ouvir no Apple Music',
            color: const Color(0xFFFA243C),
            onTap: () => _launchUrl(extLinks['apple_music']!),
          ),
        if (extLinks['amazon_music'] != null && extLinks['amazon_music']!.isNotEmpty)
          _LinkTile(
            icon: Icons.music_note,
            title: 'Amazon Music',
            subtitle: 'Ouvir no Amazon Music',
            color: const Color(0xFF00A8E1),
            onTap: () => _launchUrl(extLinks['amazon_music']!),
          ),
        if (extLinks['youtube_music'] != null && extLinks['youtube_music']!.isNotEmpty)
          _LinkTile(
            imagePath: 'assets/icons/youtubemusic.svg',
            title: 'YouTube Music',
            subtitle: 'Ouvir no YouTube Music',
            color: const Color(0xFFFF0000),
            onTap: () => _launchUrl(extLinks['youtube_music']!),
          ),
      ],
    );
  }

  Widget _buildLyricsSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Letra', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: SelectableText(
            _song.lyrics!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  height: 1.8,
                  letterSpacing: 0.3,
                ),
          ),
        ),
      ],
    );
  }
}

/// Info chip for technical details
class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _LinkTile extends StatelessWidget {
  final IconData? icon;
  final String? imagePath;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _LinkTile({
    this.icon,
    this.imagePath,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: color.withOpacity(0.2)),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: imagePath != null
                      ? Padding(
                          padding: const EdgeInsets.all(10.0),
                          child: imagePath!.toLowerCase().endsWith('.png')
                              ? Image.asset(
                                  imagePath!,
                                  width: 20,
                                  height: 20,
                                  fit: BoxFit.contain,
                                )
                              : SvgPicture.asset(
                                  imagePath!,
                                  width: 20,
                                  height: 20,
                                  fit: BoxFit.contain,
                                  colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
                                ),
                        )
                      : Icon(icon, color: color, size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.open_in_new_rounded,
                  size: 16,
                  color: color.withOpacity(0.7),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
