import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_theme.dart';
import '../../../app/providers.dart';

enum AuthMode { login, signup }

/// Polished, accessible native authentication screen supporting both
/// Firebase native login and backend-provisioned registration.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();

  AuthMode _mode = AuthMode.login;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  String? _errorMessage;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _switchMode(AuthMode mode) {
    if (_mode == mode) return;
    setState(() {
      _mode = mode;
      _errorMessage = null;
      _formKey.currentState?.reset();
    });
  }

  Future<void> _submit() async {
    setState(() => _errorMessage = null);

    if (!_formKey.currentState!.validate()) {
      return;
    }

    final authNotifier = ref.read(authNotifierProvider.notifier);

    try {
      if (_mode == AuthMode.login) {
        await authNotifier.login(
          email: _emailController.text,
          password: _passwordController.text,
        );
      } else {
        await authNotifier.signup(
          name: _nameController.text,
          email: _emailController.text,
          password: _passwordController.text,
        );
      }
    } catch (_) {
      final authState = ref.read(authNotifierProvider);
      if (mounted && authState.hasError) {
        setState(() {
          _errorMessage = authState.failure?.message ??
              'Falha na autenticação. Verifique os dados.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final authState = ref.watch(authNotifierProvider);
    final isLoading = authState.isAuthenticating;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding:
                const EdgeInsets.symmetric(horizontal: 28.0, vertical: 24.0),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Brand Header
                    Center(
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: const BoxDecoration(
                          color: AppColors.green,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.queue_music,
                          size: 40,
                          color: AppColors.cream,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'LouvAIO',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.green,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _mode == AuthMode.login
                          ? 'Acesse seu ministério de louvor'
                          : 'Crie sua conta no LouvAIO',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color:
                            theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Mode Toggle (Login / Signup)
                    Container(
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      padding: const EdgeInsets.all(4),
                      child: Row(
                        children: [
                          Expanded(
                            child: _ModeButton(
                              label: 'Entrar',
                              isSelected: _mode == AuthMode.login,
                              onTap: isLoading
                                  ? null
                                  : () => _switchMode(AuthMode.login),
                            ),
                          ),
                          Expanded(
                            child: _ModeButton(
                              label: 'Cadastrar',
                              isSelected: _mode == AuthMode.signup,
                              onTap: isLoading
                                  ? null
                                  : () => _switchMode(AuthMode.signup),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Error Banner
                    if (_errorMessage != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: AppColors.error.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.error_outline,
                              color: AppColors.error,
                              size: 20,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _errorMessage!,
                                style: const TextStyle(
                                  color: AppColors.error,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Name Field (Signup only)
                    if (_mode == AuthMode.signup) ...[
                      TextFormField(
                        controller: _nameController,
                        enabled: !isLoading,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.name],
                        decoration: const InputDecoration(
                          labelText: 'Nome completo',
                          prefixIcon: Icon(Icons.person_outline),
                          border: OutlineInputBorder(),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Informe seu nome';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Email Field
                    TextFormField(
                      controller: _emailController,
                      enabled: !isLoading,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        prefixIcon: Icon(Icons.email_outlined),
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'Informe seu e-mail';
                        }
                        if (!value.contains('@') || !value.contains('.')) {
                          return 'Informe um e-mail válido';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),

                    // Password Field
                    TextFormField(
                      controller: _passwordController,
                      enabled: !isLoading,
                      obscureText: _obscurePassword,
                      textInputAction: _mode == AuthMode.signup
                          ? TextInputAction.next
                          : TextInputAction.done,
                      autofillHints: const [AutofillHints.password],
                      onFieldSubmitted: (_) {
                        if (_mode == AuthMode.login) _submit();
                      },
                      decoration: InputDecoration(
                        labelText: 'Senha',
                        prefixIcon: const Icon(Icons.lock_outline),
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_off
                                : Icons.visibility,
                          ),
                          onPressed: () {
                            setState(
                                () => _obscurePassword = !_obscurePassword);
                          },
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Informe sua senha';
                        }
                        if (_mode == AuthMode.signup && value.length < 6) {
                          return 'A senha deve ter pelo menos 6 caracteres';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),

                    // Confirm Password Field (Signup only)
                    if (_mode == AuthMode.signup) ...[
                      TextFormField(
                        controller: _confirmPasswordController,
                        enabled: !isLoading,
                        obscureText: _obscureConfirmPassword,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Confirmar senha',
                          prefixIcon: const Icon(Icons.lock_clock_outlined),
                          border: const OutlineInputBorder(),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscureConfirmPassword
                                  ? Icons.visibility_off
                                  : Icons.visibility,
                            ),
                            onPressed: () {
                              setState(() => _obscureConfirmPassword =
                                  !_obscureConfirmPassword);
                            },
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return 'Confirme sua senha';
                          }
                          if (value != _passwordController.text) {
                            return 'As senhas não coincidem';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                    ],

                    const SizedBox(height: 12),

                    // Submit Button
                    ElevatedButton(
                      onPressed: isLoading ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.green,
                        foregroundColor: AppColors.cream,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      child: isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                    AppColors.cream),
                              ),
                            )
                          : Text(
                              _mode == AuthMode.login ? 'Entrar' : 'Cadastrar',
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback? onTap;

  const _ModeButton({
    required this.label,
    required this.isSelected,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            color: isSelected ? AppColors.green : Colors.grey.shade700,
          ),
        ),
      ),
    );
  }
}
