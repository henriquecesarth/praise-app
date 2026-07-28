import React, { useState, useEffect } from 'react';
import { Download, X, Sparkles } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const InstallPWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const isDismissed = localStorage.getItem('praise_pwa_prompt_dismissed');
    if (isDismissed === 'true') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsVisible(false);
      }
    } catch (err) {
      console.warn('Erro ao disparar instalador PWA:', err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('praise_pwa_prompt_dismissed', 'true');
  };

  if (!isVisible || !deferredPrompt) return null;

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">
          <Sparkles size={20} className="text-purple-400" />
        </div>
        <div className="pwa-install-text">
          <div className="pwa-install-title">Instalar o Praise App</div>
          <div className="pwa-install-desc">
            Acesso rápido, modo offline para cifras e escalas no ensaio!
          </div>
        </div>
      </div>
      <div className="pwa-install-actions">
        <button className="btn btn-primary pwa-install-btn" onClick={handleInstallClick}>
          <Download size={15} />
          Instalar
        </button>
        <button className="action-icon-btn pwa-dismiss-btn" onClick={handleDismiss} title="Fechar">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
