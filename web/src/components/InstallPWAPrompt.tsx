import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, WifiOff, X, Sparkles } from 'lucide-react';
import { PWA_OFFLINE_READY_EVENT, PWA_UPDATE_EVENT } from '../pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const InstallPWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [notice, setNotice] = useState<'update' | 'offline' | null>(null);
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

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

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ updateSW: (reloadPage?: boolean) => Promise<void> }>;
      setUpdateSW(() => customEvent.detail.updateSW);
      setNotice('update');
    };
    const handleOfflineReady = () => setNotice('offline');

    window.addEventListener(PWA_UPDATE_EVENT, handleUpdate);
    window.addEventListener(PWA_OFFLINE_READY_EVENT, handleOfflineReady);
    return () => {
      window.removeEventListener(PWA_UPDATE_EVENT, handleUpdate);
      window.removeEventListener(PWA_OFFLINE_READY_EVENT, handleOfflineReady);
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

  const showInstall = isVisible && deferredPrompt;
  if (!showInstall && !notice) return null;

  const handlePrimaryAction = async () => {
    if (notice === 'update' && updateSW) {
      await updateSW(true);
      return;
    }
    if (notice === 'offline') {
      setNotice(null);
      return;
    }
    await handleInstallClick();
  };

  const title = notice === 'update'
    ? 'Nova versão disponível'
    : notice === 'offline'
      ? 'Fallback offline preparado'
      : 'Instalar o LouvAIO';
  const description = notice === 'update'
    ? 'Atualize quando estiver pronto. O app não recarrega formulários automaticamente.'
    : notice === 'offline'
      ? 'Sem conexão, uma tela segura será exibida sem dados privados do ministério.'
      : 'Instale o app para acesso rápido e prático ao LouvAIO.';

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">
          {notice === 'update' ? <RefreshCw size={20} /> : notice === 'offline' ? <WifiOff size={20} /> : <Sparkles size={20} />}
        </div>
        <div className="pwa-install-text">
          <div className="pwa-install-title">{title}</div>
          <div className="pwa-install-desc">{description}</div>
        </div>
      </div>
      <div className="pwa-install-actions">
        <button className="btn btn-primary pwa-install-btn" onClick={handlePrimaryAction}>
          {notice === 'update' ? <RefreshCw size={15} /> : notice === 'offline' ? <WifiOff size={15} /> : <Download size={15} />}
          {notice === 'update' ? 'Atualizar' : notice === 'offline' ? 'Entendi' : 'Instalar'}
        </button>
        <button
          type="button"
          className="action-icon-btn pwa-dismiss-btn"
          onClick={notice ? () => setNotice(null) : handleDismiss}
          title="Fechar"
          aria-label="Fechar aviso do aplicativo"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
