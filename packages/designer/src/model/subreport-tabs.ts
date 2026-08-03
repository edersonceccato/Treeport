import type { BandSet, SubreportElement, Template } from '@treeport/schema';
import type { BandName } from './template-editor.js';

/**
 * Navegação entre designs de subreport (sub-fase 9.5 do brief).
 *
 * O Report Builder de origem resolve profundidade arbitrária com abas no
 * rodapé: `Main: Proposal`, `SubReport1: Offer`, `srp_TXS: OfferFee`. Clicar
 * numa aba troca o canvas para o design daquele nó.
 *
 * Isso evita uma árvore lateral complicada e mantém uma verdade importante:
 * cada aba edita um `BandSet` — o do template raiz ou o de um
 * `SubreportElement` aninhado. O caminho até ele é o que este módulo modela.
 */

/**
 * Caminho até um design: a sequência de ids de `SubreportElement` a percorrer
 * a partir da raiz. Vazio = o template principal.
 */
export type DesignPath = string[];

export interface DesignTab {
  /** Caminho até este design. */
  path: DesignPath;
  /** Rótulo da aba ("Principal", "Ofertas"...). */
  label: string;
  /** Nó da árvore de dados que alimenta este design. */
  dataSourceNodeId: string;
  /** Profundidade, para indentar a exibição. */
  depth: number;
}

/** Erro ao navegar para um caminho que não existe. */
export class DesignPathError extends Error {
  constructor(path: DesignPath, reason: string) {
    super(`Caminho de design inválido [${path.join(' > ') || '(raiz)'}]: ${reason}`);
    this.name = 'DesignPathError';
  }
}

/**
 * O conjunto de bandas naquele caminho.
 *
 * Devolve a referência viva dentro do template — mutá-la altera o template,
 * que é o que o editor precisa para aplicar mudanças em subreports aninhados.
 */
export function resolveDesign(template: Template, path: DesignPath): BandSet {
  let bands: BandSet = template.bands;

  for (const elementId of path) {
    const element = findSubreport(bands, elementId);
    if (!element) {
      throw new DesignPathError(path, `subreport "${elementId}" não encontrado`);
    }
    bands = element.template;
  }

  return bands;
}

/** O elemento de subreport no fim do caminho (undefined para a raiz). */
export function resolveSubreportElement(
  template: Template,
  path: DesignPath,
): SubreportElement | undefined {
  if (path.length === 0) return undefined;

  const parentBands = resolveDesign(template, path.slice(0, -1));
  return findSubreport(parentBands, path[path.length - 1]!);
}

/** Procura um subreport pelo id nas três bandas de um design. */
function findSubreport(bands: BandSet, elementId: string): SubreportElement | undefined {
  for (const name of ['header', 'details', 'footer'] as BandName[]) {
    const band = bands[name];
    if (!band) continue;

    for (const element of band.elements) {
      if (element.type === 'subreport' && element.id === elementId) return element;
    }
  }
  return undefined;
}

/**
 * Todas as abas do template, em pré-ordem.
 *
 * A primeira é sempre o design principal; as demais, um subreport cada,
 * incluindo os aninhados em qualquer profundidade.
 */
export function listDesignTabs(template: Template): DesignTab[] {
  const tabs: DesignTab[] = [
    {
      path: [],
      label: 'Principal',
      dataSourceNodeId: template.boundDataSourceNodeId,
      depth: 0,
    },
  ];

  const walk = (bands: BandSet, path: DesignPath, depth: number): void => {
    for (const name of ['header', 'details', 'footer'] as BandName[]) {
      const band = bands[name];
      if (!band) continue;

      for (const element of band.elements) {
        if (element.type !== 'subreport') continue;

        const childPath = [...path, element.id];
        tabs.push({
          path: childPath,
          label: element.dataSourceNodeId || element.id,
          dataSourceNodeId: element.dataSourceNodeId,
          depth: depth + 1,
        });
        walk(element.template, childPath, depth + 1);
      }
    }
  };

  walk(template.bands, [], 0);
  return tabs;
}

/** Dois caminhos apontam para o mesmo design? */
export function samePath(a: DesignPath, b: DesignPath): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Representação estável do caminho, para usar como chave. */
export function pathKey(path: DesignPath): string {
  return path.join('/');
}

/**
 * O caminho continua válido depois de uma edição?
 *
 * Se o usuário apagar um subreport enquanto estava editando o design dele, a
 * aba precisa voltar para um ancestral que ainda exista, em vez de quebrar.
 */
export function nearestValidPath(template: Template, path: DesignPath): DesignPath {
  for (let i = path.length; i >= 0; i -= 1) {
    const candidate = path.slice(0, i);
    try {
      resolveDesign(template, candidate);
      return candidate;
    } catch {
      // tenta um nível acima
    }
  }
  return [];
}
