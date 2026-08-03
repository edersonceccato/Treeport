/**
 * Fixture do Anexo D do brief, compartilhado pelos testes de subreport.
 *
 *   Proposal (master)
 *     └─ Offer
 *          ├─ OfferFee
 *          └─ OfferPackage
 *
 * Generalizado de propósito (nada de schema proprietário), mas com a mesma
 * forma do caso real: proposta → ofertas de frete → taxas e embalagens.
 */

import type { DataSourceTree, ResolvedDataSet, ResolvedRow } from '@treeport/schema';
import { MemoryExecutor } from '../../src/index.js';

export const SQL_PROPOSAL = 'SELECT * FROM proposal WHERE id = :proposalId';
export const SQL_OFFER = 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)';
export const SQL_FEE = 'SELECT * FROM offer_fee WHERE offer_id IN (:parentValues)';
export const SQL_PACKAGE = 'SELECT * FROM offer_package WHERE offer_id IN (:parentValues)';

export const PROPOSALS = [
  { id: 1, customer: 'Acme Ltda', number: 'P-001', issuedAt: '2026-08-03' },
];

export const OFFERS = [
  { id: 10, proposalId: 1, route: 'Santos > Roterda', modal: 'Maritimo' },
  { id: 11, proposalId: 1, route: 'Santos > Hamburgo', modal: 'Maritimo' },
];

export const FEES = [
  { id: 100, offerId: 10, name: 'Frete internacional', amount: 1500 },
  { id: 101, offerId: 10, name: 'THC', amount: 300 },
  { id: 102, offerId: 10, name: 'Armazenagem', amount: 220 },
  { id: 103, offerId: 11, name: 'Frete internacional', amount: 1800 },
];

export const PACKAGES = [
  { id: 200, offerId: 10, kind: 'Container 20', qty: 2 },
  { id: 201, offerId: 11, kind: 'Container 40', qty: 1 },
];

export function proposalTree(): DataSourceTree {
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

const inList = (params: Record<string, unknown>): string[] => {
  const values = (params['parentValues'] as unknown[]) ?? [params['parentValue']];
  return values.map(String);
};

export function proposalExecutor(): MemoryExecutor {
  return new MemoryExecutor()
    .on(SQL_PROPOSAL, (p) => PROPOSALS.filter((r) => r.id === p['proposalId']))
    .on(SQL_OFFER, (p) => OFFERS.filter((r) => inList(p).includes(String(r.proposalId))))
    .on(SQL_FEE, (p) => FEES.filter((r) => inList(p).includes(String(r.offerId))))
    .on(SQL_PACKAGE, (p) => PACKAGES.filter((r) => inList(p).includes(String(r.offerId))));
}

/** Monta um ResolvedDataSet à mão, sem passar pelo resolver. */
export function buildDataSet(
  spec: {
    data: Record<string, unknown>;
    children?: Record<string, ResolvedRow[]>;
  }[],
  nodeId = 'PROPOSAL',
): ResolvedDataSet {
  return {
    nodeId,
    rows: spec.map((s) => ({ data: s.data, children: s.children ?? {} })),
  };
}

/** Atalho para montar uma linha resolvida. */
export function row(
  data: Record<string, unknown>,
  children: Record<string, ResolvedRow[]> = {},
): ResolvedRow {
  return { data, children };
}
