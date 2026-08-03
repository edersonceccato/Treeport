import { describe, it, expect } from 'vitest';
import type { ReportParameter } from '@treeport/schema';
import { validateParameters, ParameterValidationError } from '../src/index.js';

const p = (over: Partial<ReportParameter> & Pick<ReportParameter, 'name' | 'type'>): ReportParameter => ({
  nullable: false,
  ...over,
});

describe('validateParameters', () => {
  it('converte string vinda de query string HTTP para o tipo declarado', () => {
    const result = validateParameters(
      [p({ name: 'id', type: 'int' }), p({ name: 'valor', type: 'decimal' })],
      { id: '42', valor: '19.90' },
    );

    expect(result).toEqual({ id: 42, valor: 19.9 });
  });

  it('aplica defaultValue quando o valor não é informado', () => {
    const result = validateParameters([p({ name: 'ativo', type: 'boolean', defaultValue: true })], {});
    expect(result['ativo']).toBe(true);
  });

  it('aceita null quando nullable', () => {
    const result = validateParameters([p({ name: 'obs', type: 'string', nullable: true })], {});
    expect(result['obs']).toBeNull();
  });

  it('rejeita obrigatório ausente', () => {
    expect(() => validateParameters([p({ name: 'id', type: 'int' })], {})).toThrow(
      ParameterValidationError,
    );
  });

  it('rejeita int não-inteiro', () => {
    expect(() => validateParameters([p({ name: 'id', type: 'int' })], { id: '1.5' })).toThrow(
      /deveria ser do tipo int/,
    );
  });

  it('rejeita valor não numérico em decimal', () => {
    expect(() =>
      validateParameters([p({ name: 'v', type: 'decimal' })], { v: 'abc' }),
    ).toThrow(/deveria ser do tipo decimal/);
  });

  it('converte data de string e rejeita data inválida', () => {
    const ok = validateParameters([p({ name: 'd', type: 'date' })], { d: '2026-08-03' });
    expect(ok['d']).toBeInstanceOf(Date);

    expect(() => validateParameters([p({ name: 'd', type: 'date' })], { d: 'ontem' })).toThrow(
      /deveria ser do tipo date/,
    );
  });

  it('entende booleano em português e numérico', () => {
    const result = validateParameters(
      [
        p({ name: 'a', type: 'boolean' }),
        p({ name: 'b', type: 'boolean' }),
        p({ name: 'c', type: 'boolean' }),
      ],
      { a: 'sim', b: 0, c: 'false' },
    );

    expect(result).toEqual({ a: true, b: false, c: false });
  });

  it('respeita o tamanho máximo de string', () => {
    expect(() =>
      validateParameters([p({ name: 'nome', type: 'string', size: 3 })], { nome: 'Ederson' }),
    ).toThrow(/excede o tamanho máximo/);
  });

  it('rejeita parâmetro não declarado (pega typo)', () => {
    expect(() =>
      validateParameters([p({ name: 'proposalId', type: 'int' })], { propostaId: 1 }),
    ).toThrow(/não está declarado/);
  });

  it('acumula todos os problemas numa mensagem só', () => {
    try {
      validateParameters([p({ name: 'a', type: 'int' }), p({ name: 'b', type: 'date' })], {
        b: 'xx',
      });
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ParameterValidationError);
      expect((err as ParameterValidationError).issues).toHaveLength(2);
    }
  });

  it('trata string vazia como ausente', () => {
    // formulário HTML manda "" quando o campo não é preenchido
    const result = validateParameters([p({ name: 'obs', type: 'string', nullable: true })], {
      obs: '',
    });
    expect(result['obs']).toBeNull();
  });
});
