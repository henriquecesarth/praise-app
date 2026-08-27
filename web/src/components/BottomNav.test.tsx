import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BottomNav } from './BottomNav';

describe('BottomNav', () => {
  it('keeps all five product areas available with an explicit active state', async () => {
    const onSelectModule = vi.fn();
    const user = userEvent.setup();
    render(<BottomNav currentModule="cifrador" onSelectModule={onSelectModule} />);

    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Cifras Inteligentes' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Ministério' }));
    expect(onSelectModule).toHaveBeenCalledWith('ministry');
  });
});
