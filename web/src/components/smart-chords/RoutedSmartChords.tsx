import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { SmartChordsWorkspace, SmartChordsWorkspaceProps } from '../SmartChordsWorkspace';

export function RoutedSmartChords(props: SmartChordsWorkspaceProps) {
  const [dirty, setDirty] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const bypass = useRef(false);
  const blocker = useBlocker(() => {
    if (bypass.current) { bypass.current = false; return false; }
    if (!dirty) return false;
    if (!window.confirm('Descartar alterações não salvas?')) return true;
    window.dispatchEvent(new Event('smart-chord-discard'));
    return false;
  });
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset(); }, [blocker]);
  const onNavigate = useCallback((path: string, replace = false) => {
    bypass.current = replace;
    navigate(path, { replace });
  }, [navigate]);
  return <SmartChordsWorkspace {...props} routePath={location.pathname} onNavigate={onNavigate} onDirtyChange={setDirty} />;
}
