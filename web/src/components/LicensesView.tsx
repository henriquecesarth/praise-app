import { ArrowLeft } from 'lucide-react';
import catalog from '../../../shared/fixtures/guitar-voicings-v2.json';

/** Public page: the MIT licence requires its notice in distributed copies. */
export function LicensesView({ onNavigateHome }: { onNavigateHome: () => void }) {
  return (
    <main
      className="min-h-screen w-full max-w-3xl mx-auto px-4 text-[var(--text-primary)]"
      style={{ paddingTop: 'max(20px, var(--safe-area-top))', paddingBottom: 'max(32px, var(--safe-area-bottom))' }}
    >
      <button
        type="button"
        onClick={onNavigateHome}
        className="action-icon-btn flex items-center justify-center rounded-lg text-[var(--text-secondary)]"
        style={{ width: '44px', height: '44px' }}
        aria-label="Voltar para a página inicial"
      >
        <ArrowLeft size={20} />
      </button>
      <h1>Licenças de terceiros</h1>
      <h2>chords-db</h2>
      <p>
        Parte dos diagramas de violão deriva do projeto{' '}
        <a href="https://github.com/tombatossals/chords-db" target="_blank" rel="noreferrer">chords-db</a>, usado sob a licença MIT.
      </p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8rem' }}>{catalog.provenance.notice}</pre>
    </main>
  );
}
