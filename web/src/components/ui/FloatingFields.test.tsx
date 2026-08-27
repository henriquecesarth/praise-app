import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloatingInput } from './FloatingInput';
import { FloatingSelect } from './FloatingSelect';
import { FloatingTextarea } from './FloatingTextarea';

describe('floating field labels', () => {
  it('keeps labels above empty, defaulted, date, select and textarea controls', () => {
    render(
      <>
        <FloatingInput label="Nome" defaultValue="" />
        <FloatingInput label="Data" type="date" defaultValue="2026-08-27" />
        <FloatingSelect label="Função" defaultValue="">
          <option value="">Selecione</option>
        </FloatingSelect>
        <FloatingTextarea label="Observações" defaultValue="Texto" />
      </>,
    );

    for (const label of ['Nome', 'Data', 'Função', 'Observações']) {
      expect(screen.getByText(label)).toHaveClass('top-0');
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
