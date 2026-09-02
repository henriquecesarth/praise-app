import { describe, it, expect } from 'vitest';
import { providerBrlDecimalToCents, centsToProviderBrlDecimal } from './billing-money.utils';

describe('billing-money.utils — Deterministic Money Conversion', () => {
  describe('providerBrlDecimalToCents', () => {
    it('converte valores comerciais padrão sem heurística de magnitude', () => {
      expect(providerBrlDecimalToCents(14.90)).toBe(1490);
      expect(providerBrlDecimalToCents(34.90)).toBe(3490);
      expect(providerBrlDecimalToCents(89.90)).toBe(8990);
      expect(providerBrlDecimalToCents(376.92)).toBe(37692);
      expect(providerBrlDecimalToCents(970.92)).toBe(97092);
      expect(providerBrlDecimalToCents(1119.96)).toBe(111996);
      expect(providerBrlDecimalToCents(2320.92)).toBe(232092);
    });

    it('converte strings decimais do provedor (inclusive com vírgula)', () => {
      expect(providerBrlDecimalToCents('14.90')).toBe(1490);
      expect(providerBrlDecimalToCents('1119.96')).toBe(111996);
      expect(providerBrlDecimalToCents('1119,96')).toBe(111996);
    });

    it('trata valores de borda e imprecisões de ponto flutuante com Math.round', () => {
      // 19.99 * 100 pode resultar em 1998.9999999999998 em floating point IEEE 754
      expect(providerBrlDecimalToCents(19.99)).toBe(1999);
      expect(providerBrlDecimalToCents(0)).toBe(0);
      expect(providerBrlDecimalToCents(null)).toBe(0);
      expect(providerBrlDecimalToCents(undefined)).toBe(0);
      expect(providerBrlDecimalToCents(NaN)).toBe(0);
      expect(providerBrlDecimalToCents('invalid')).toBe(0);
    });
  });

  describe('centsToProviderBrlDecimal', () => {
    it('converte centavos inteiros para decimal BRL de 2 casas decimais', () => {
      expect(centsToProviderBrlDecimal(1490)).toBe(14.90);
      expect(centsToProviderBrlDecimal(3490)).toBe(34.90);
      expect(centsToProviderBrlDecimal(8990)).toBe(89.90);
      expect(centsToProviderBrlDecimal(37692)).toBe(376.92);
      expect(centsToProviderBrlDecimal(97092)).toBe(970.92);
      expect(centsToProviderBrlDecimal(111996)).toBe(1119.96);
      expect(centsToProviderBrlDecimal(232092)).toBe(2320.92);
    });

    it('trata valores nulos ou zero', () => {
      expect(centsToProviderBrlDecimal(0)).toBe(0);
      expect(centsToProviderBrlDecimal(null)).toBe(0);
      expect(centsToProviderBrlDecimal(undefined)).toBe(0);
      expect(centsToProviderBrlDecimal(NaN)).toBe(0);
    });
  });
});
