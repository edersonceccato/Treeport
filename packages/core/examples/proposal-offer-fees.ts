/**
 * Exemplo da Fase 1 — árvore de dados de 3 níveis (Anexo D do brief).
 *
 *   Proposal (master)
 *     └─ Offer (ofertas de frete da proposta)
 *          ├─ OfferFee     (taxas da oferta)
 *          └─ OfferPackage (embalagens da oferta)
 *
 * Roda sem banco nenhum, usando o `MemoryExecutor`. É o mesmo fixture que a
 * Fase 4 vai reaproveitar para montar o layout com subreports.
 *
 * Rodar:  pnpm example:phase1
 */

import type { DataSourceTree } from '@treeport/schema';
import { MemoryExecutor, resolveDataSourceTree } from '../src/index.js';
import type { ResolvedRow } from '@treeport/schema';

// --- 1. As queries (escritas à mão pelo usuário da lib) ---------------------

const SQL_PROPOSAL = 'SELECT * FROM proposal WHERE id = :proposalId';
const SQL_OFFER = 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)';
const SQL_FEE = 'SELECT * FROM offer_fee WHERE offer_id IN (:parentValues)';
const SQL_PACKAGE = 'SELECT * FROM offer_package WHERE offer_id IN (:parentValues)';

// --- 2. A árvore de fonte de dados -----------------------------------------

const tree: DataSourceTree = {
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
        orderBy: 'route',
        children: [
          {
            id: 'OFFER_FEE',
            name: 'Taxas',
            sql: SQL_FEE,
            linkFields: { parentField: 'id', childField: 'offerId' },
            orderBy: 'amount DESC',
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

// --- 3. O "banco" fake ------------------------------------------------------
// Num projeto real, aqui entraria um Executor em cima do pg/mssql/firebird.

const PROPOSALS = [{ id: 1, customer: 'Acme Ltda', number: 'P-001', date: '2026-08-03' }];
const OFFERS = [
  { id: 10, proposalId: 1, route: 'Santos -> Roterdã', modal: 'Marítimo' },
  { id: 11, proposalId: 1, route: 'Santos -> Hamburgo', modal: 'Marítimo' },
];
const FEES = [
  { id: 100, offerId: 10, name: 'Frete internacional', amount: 1500 },
  { id: 101, offerId: 10, name: 'THC', amount: 300 },
  { id: 102, offerId: 11, name: 'Frete internacional', amount: 1800 },
];
const PACKAGES = [
  { id: 200, offerId: 10, kind: 'Container 20 pés', qty: 2 },
  { id: 201, offerId: 11, kind: 'Container 40 pés', qty: 1 },
];

const inList = (params: Record<string, unknown>): string[] => {
  const values = (params['parentValues'] as unknown[]) ?? [params['parentValue']];
  return values.map(String);
};

const executor = new MemoryExecutor()
  .on(SQL_PROPOSAL, (p) => PROPOSALS.filter((r) => r.id === p['proposalId']))
  .on(SQL_OFFER, (p) => OFFERS.filter((r) => inList(p).includes(String(r.proposalId))))
  .on(SQL_FEE, (p) => FEES.filter((r) => inList(p).includes(String(r.offerId))))
  .on(SQL_PACKAGE, (p) => PACKAGES.filter((r) => inList(p).includes(String(r.offerId))));

// --- 4. Resolver e imprimir -------------------------------------------------

const dataSet = await resolveDataSourceTree(tree, executor, {
  parameters: { proposalId: 1 },
  strategy: 'batched',
});

const money = (v: unknown): string =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

for (const proposal of dataSet.rows) {
  console.log(`\nProposta ${proposal.data['number']} — ${proposal.data['customer']}`);

  const offers: ResolvedRow[] = proposal.children['OFFER'] ?? [];
  for (const offer of offers) {
    console.log(`  Oferta #${offer.data['id']} — ${offer.data['route']}`);

    const fees = offer.children['OFFER_FEE'] ?? [];
    const total = fees.reduce((sum, f) => sum + Number(f.data['amount']), 0);
    for (const fee of fees) {
      console.log(`    taxa: ${fee.data['name']} — ${money(fee.data['amount'])}`);
    }
    console.log(`    total de taxas: ${money(total)}`);

    for (const pack of offer.children['OFFER_PACKAGE'] ?? []) {
      console.log(`    embalagem: ${pack.data['qty']}x ${pack.data['kind']}`);
    }
  }
}

console.log(`\nQueries executadas: ${executor.calls.length} (estratégia batched)`);
console.log('Se rodasse com strategy: "per-row", seriam 6 — uma por linha do pai.');
