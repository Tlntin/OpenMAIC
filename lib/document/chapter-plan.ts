import type { MarkdownOutline, MarkdownOutlineNode } from './markdown-outline';

export interface ChapterPlanItem {
  id: string;
  title: string;
  headingId?: string;
  level: 1 | 2 | 3;
  pageStart?: number;
  pageEnd?: number;
  sourceTitle?: string;
  order: number;
}

export interface ChapterPlan {
  items: ChapterPlanItem[];
  total: number;
  concurrency: number;
  splitMode: 'headings' | 'fixed' | 'manual';
}

function effectiveRoots(outline: MarkdownOutline): MarkdownOutlineNode[] {
  for (const level of [1, 2, 3] as const) {
    const nodes = outline.headings.filter((node) => node.level === level);
    const numbered = nodes.filter((node) => /^\d+(?:\.\d+)+\b/.test(node.title));
    const named = nodes.filter((node) => /^(summary|review|assessment|conclusion|练习|总结|复习|测验)/i.test(node.title));
    if (numbered.length >= 2) return [...numbered, ...named.filter((node) => !numbered.includes(node))];
    if (nodes.length > 0) return nodes;
  }
  return [];
}

export function buildDefaultChapterPlan(outline: MarkdownOutline, concurrency = 1): ChapterPlan {
  const roots = effectiveRoots(outline);
  const items = roots.map((node, index) => ({
    id: `chapter_${index + 1}_${node.id}`,
    headingId: node.id,
    title: node.title,
    level: node.level,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    sourceTitle: node.title,
    order: index + 1,
  }));
  return {
    items,
    total: items.length,
    concurrency: Math.max(1, Math.floor(concurrency || 1)),
    splitMode: items.length > 0 ? 'headings' : 'manual',
  };
}

export function normalizeChapterPlan(plan: Partial<ChapterPlan> | undefined): ChapterPlan | undefined {
  if (!plan?.items) return undefined;
  const items = plan.items
    .filter((item): item is ChapterPlanItem => Boolean(item && item.title?.trim()))
    .map((item, index) => ({
      ...item,
      id: item.id || `chapter_${index + 1}`,
      title: item.title.trim(),
      order: index + 1,
      level: (item.level === 1 || item.level === 3 ? item.level : 2) as 1 | 2 | 3,
    }));
  return {
    items,
    total: items.length,
    concurrency: Math.max(1, Math.floor(plan.concurrency || 1)),
    splitMode: plan.splitMode === 'fixed' || plan.splitMode === 'manual' ? plan.splitMode : 'headings',
  };
}
