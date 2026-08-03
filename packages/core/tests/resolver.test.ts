import { describe, it, expect } from 'vitest';
import type { DataSourceTree } from '@treeport/schema';
import {
  MemoryExecutor,
  resolveDataSourceTree,
  validateTreeShape,
  findNode,
  DataSourceTreeError,
  ParameterValidationError,
} from '../src/index.js';

/**
 * Fixture de 3 níveis inspirado no Anexo D do brief:
 *   Proposal (master)
 *     └─ Offer (por proposalId)
 *          ├─ OfferFee    (por offerId)
 *          └─ OfferPackage (por offerId)
 */

const SQL_PROPOSAL = 'SELECT * FROM proposal WHERE id = :proposalId';
const SQL_OFFER = 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)';
const SQL_FEE = 'SELECT * FROM offer_fee WHERE offer_id IN (:parentValues)';
const SQL_PACKAGE = 'SELECT * FROM offer_package WHERE offer_id IN (:parentValues)';

const PROPOSALS = [{ id: 1, customer: 'Acme Ltda', number: 'P-001' }];

const OFFERS = [
  { id: 10, proposalId: 1, route: 'Santos -> Roterdã' },
  { id: 11, proposalId: 1, route: 'Santos -> Hamburgo' },
];

const FEES = [
  { id: 100, offerId: 10, name: 'Frete', amount: 1500 },
  { id: 101, offerId: 10, name: 'THC', amount: 300 },
  { id: 102, offerId: 11, name: 'Frete', amount: 1800 },
];

const PACKAGES = [{ id: 200, offerId: 10, kind: 'Container 20’', qty: 2 }];

function buildTree(): DataSourceTree {
  return {
    id: 'proposal-tree',
    name: 'Proposta comercial',
    parameters: [{ name: 'proposalId', type: 'int', nullable: false, testValue: 1 }],
    root: {
      id: 'PROPOSAL',
      name: 'Proposta',
      sql: SQL_PROPOSAL,
      children: [
        {
          id: 'OFFER',
          name: 'Oferta de frete',
          sql: SQL_OFFER,
          linkFields: { parentField: 'id', childField: 'proposalId' },
          children: [
            {
              id: 'OFFER_FEE',
              name: 'Taxas',
              sql: SQL_FEE,
              linkFields: { parentField: 'id', childField: 'offerId' },
            },
            {
              id: 'OFFER_PACKAGE',
              name: 'Embalagens',
              sql: SQL_PACKAGE,
              linkFields: { parentField: 'id', childField: 'offerId' },
            },
          ],
        },
      ],
    },
  };
}

/** Executor fake que filtra os arrays acima como o banco faria. */
function buildExecutor(): MemoryExecutor {
  const inList = (params: Record<string, unknown>): unknown[] =>
    (params['parentValues'] as unknown[]) ?? [params['parentValue']];

  return new MemoryExecutor()
    .on(SQL_PROPOSAL, (p) => PROPOSALS.filter((r) => r.id === p['proposalId']))
    .on(SQL_OFFER, (p) => {
      const ids = inList(p).map(String);
      return OFFERS.filter((r) => ids.includes(String(r.proposalId)));
    })
    .on(SQL_FEE, (p) => {
      const ids = inList(p).map(String);
      return FEES.filter((r) => ids.includes(String(r.offerId)));
    })
    .on(SQL_PACKAGE, (p) => {
      const ids = inList(p).map(String);
      return PACKAGES.filter((r) => ids.includes(String(r.offerId)));
    });
}

describe('resolveDataSourceTree', () => {
  it('resolve 3 níveis aninhando os filhos em cada linha', async () => {
    const result = await resolveDataSourceTree(buildTree(), buildExecutor(), {
      parameters: { proposalId: 1 },
    });

    expect(result.nodeId).toBe('PROPOSAL');
    expect(result.rows).toHaveLength(1);

    const proposal = result.rows[0]!;
    expect(proposal.data['customer']).toBe('Acme Ltda');

    const offers = proposal.children['OFFER']!;
    expect(offers).toHaveLength(2);

    // a primeira oferta tem 2 taxas e 1 embalagem
    expect(offers[0]!.children['OFFER_FEE']).toHaveLength(2);
    expect(offers[0]!.children['OFFER_PACKAGE']).toHaveLength(1);

    // a segunda tem 1 taxa e nenhuma embalagem
    expect(offers[1]!.children['OFFER_FEE']).toHaveLength(1);
    expect(offers[1]!.children['OFFER_PACKAGE']).toEqual([]);

    const fee = offers[0]!.children['OFFER_FEE']![0]!;
    expect(fee.data['name']).toBe('Frete');
    expect(fee.children).toEqual({});
  });

  it('estratégia batched roda uma query por NÓ, não por linha', async () => {
    const executor = buildExecutor();
    await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 1 },
      strategy: 'batched',
    });

    // 1 proposta + 1 oferta + 1 taxa + 1 embalagem = 4 queries,
    // mesmo havendo 2 ofertas (é justamente o ganho do batched)
    expect(executor.calls).toHaveLength(4);
    expect(executor.calls.filter((c) => c.sql === SQL_FEE)).toHaveLength(1);
  });

  it('estratégia per-row roda uma query por linha do pai', async () => {
    const executor = buildExecutor();
    await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 1 },
      strategy: 'per-row',
    });

    // 1 proposta + 1 oferta + (2 ofertas x 2 filhos) = 6 queries
    expect(executor.calls).toHaveLength(6);
    expect(executor.calls.filter((c) => c.sql === SQL_FEE)).toHaveLength(2);
  });

  it('as duas estratégias produzem exatamente o mesmo resultado', async () => {
    const batched = await resolveDataSourceTree(buildTree(), buildExecutor(), {
      parameters: { proposalId: 1 },
      strategy: 'batched',
    });
    const perRow = await resolveDataSourceTree(buildTree(), buildExecutor(), {
      parameters: { proposalId: 1 },
      strategy: 'per-row',
    });

    expect(batched).toEqual(perRow);
  });

  it('permite forçar a estratégia por nó', async () => {
    const executor = buildExecutor();
    await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 1 },
      strategy: 'batched',
      strategyByNode: { OFFER_FEE: 'per-row' },
    });

    // só as taxas viraram N+1 (2 chamadas); o resto continua batched
    expect(executor.calls.filter((c) => c.sql === SQL_FEE)).toHaveLength(2);
    expect(executor.calls.filter((c) => c.sql === SQL_PACKAGE)).toHaveLength(1);
  });

  it('nó filho sem linhas devolve array vazio e não quebra o relatório', async () => {
    const executor = buildExecutor().on(SQL_FEE, []);
    const result = await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 1 },
    });

    const offers = result.rows[0]!.children['OFFER']!;
    expect(offers[0]!.children['OFFER_FEE']).toEqual([]);
    // as embalagens continuam resolvendo normalmente
    expect(offers[0]!.children['OFFER_PACKAGE']).toHaveLength(1);
  });

  it('master sem linhas devolve rows vazio', async () => {
    const executor = buildExecutor().on(SQL_PROPOSAL, []);
    const result = await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 999 },
    });

    expect(result.rows).toEqual([]);
    // não adianta consultar filhos se não há pai
    expect(executor.calls).toHaveLength(1);
  });

  it('casa a ligação mesmo quando o driver devolve id como string', async () => {
    // o pg devolve BIGINT como string; a ligação não pode quebrar por causa disso
    const executor = buildExecutor()
      .on(SQL_PROPOSAL, [{ id: '1', customer: 'Acme Ltda' }])
      .on(SQL_OFFER, [{ id: 10, proposalId: 1, route: 'Santos -> Roterdã' }]);

    const result = await resolveDataSourceTree(buildTree(), executor, {
      parameters: { proposalId: 1 },
    });

    expect(result.rows[0]!.children['OFFER']).toHaveLength(1);
  });

  it('aplica orderBy em memória, inclusive DESC', async () => {
    const tree = buildTree();
    tree.root.children![0]!.children![0]!.orderBy = 'amount DESC';

    const result = await resolveDataSourceTree(tree, buildExecutor(), {
      parameters: { proposalId: 1 },
    });

    const fees = result.rows[0]!.children['OFFER']![0]!.children['OFFER_FEE']!;
    expect(fees.map((f) => f.data['amount'])).toEqual([1500, 300]);
  });

  it('usa testValue quando useTestValues está ligado', async () => {
    const executor = buildExecutor();
    const result = await resolveDataSourceTree(buildTree(), executor, {
      useTestValues: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(executor.calls[0]!.params['proposalId']).toBe(1);
  });

  it('não deixa o motor mutar os dados devolvidos pelo executor', async () => {
    const result = await resolveDataSourceTree(buildTree(), buildExecutor(), {
      parameters: { proposalId: 1 },
    });

    result.rows[0]!.data['customer'] = 'ALTERADO';
    expect(PROPOSALS[0]!.customer).toBe('Acme Ltda');
  });

  it('rejeita parâmetro obrigatório ausente antes de rodar qualquer query', async () => {
    const executor = buildExecutor();
    await expect(
      resolveDataSourceTree(buildTree(), executor, { parameters: {} }),
    ).rejects.toBeInstanceOf(ParameterValidationError);

    expect(executor.calls).toHaveLength(0);
  });
});

describe('validateTreeShape', () => {
  it('aceita uma árvore bem formada', () => {
    expect(() => validateTreeShape(buildTree().root)).not.toThrow();
  });

  it('recusa nó filho sem linkFields', () => {
    const tree = buildTree();
    delete tree.root.children![0]!.linkFields;

    expect(() => validateTreeShape(tree.root)).toThrow(DataSourceTreeError);
    expect(() => validateTreeShape(tree.root)).toThrow(/precisa declarar linkFields/);
  });

  it('recusa ids duplicados', () => {
    const tree = buildTree();
    tree.root.children![0]!.children![1]!.id = 'OFFER_FEE';

    expect(() => validateTreeShape(tree.root)).toThrow(/duplicado/);
  });

  it('recusa raiz com linkFields', () => {
    const tree = buildTree();
    tree.root.linkFields = { parentField: 'a', childField: 'b' };

    expect(() => validateTreeShape(tree.root)).toThrow(/não pode ter linkFields/);
  });

  it('valida a forma antes de rodar qualquer query', async () => {
    const tree = buildTree();
    delete tree.root.children![0]!.linkFields;
    const executor = buildExecutor();

    await expect(
      resolveDataSourceTree(tree, executor, { parameters: { proposalId: 1 } }),
    ).rejects.toBeInstanceOf(DataSourceTreeError);
    expect(executor.calls).toHaveLength(0);
  });
});

describe('findNode', () => {
  it('acha nó em qualquer profundidade', () => {
    const root = buildTree().root;
    expect(findNode(root, 'OFFER_FEE')?.name).toBe('Taxas');
    expect(findNode(root, 'PROPOSAL')?.name).toBe('Proposta');
    expect(findNode(root, 'INEXISTENTE')).toBeUndefined();
  });
});
