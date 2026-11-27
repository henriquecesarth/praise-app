import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LicensesView } from './LicensesView';
import { parseAppRoute } from '../routing';

describe('LicensesView', () => {
  it('shows the full chords-db MIT notice', () => {
    render(<LicensesView onNavigateHome={vi.fn()} />);
    expect(screen.getByText(/Copyright \(c\) 2016 David Rubert/)).toBeInTheDocument();
    expect(screen.getByText(/Permission is hereby granted/)).toBeInTheDocument();
    expect(screen.getByText(/WITHOUT WARRANTY OF ANY KIND/)).toBeInTheDocument();
  });

  it('is reachable at /licencas', () => {
    expect(parseAppRoute('/licencas')).toMatchObject({ isLicenses: true, isKnown: true });
  });
});
