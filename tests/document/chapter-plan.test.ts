import { describe, expect, it } from 'vitest';
import { buildDefaultChapterPlan, normalizeChapterPlan } from '@/lib/document/chapter-plan';
import { parseMarkdownOutline } from '@/lib/document/markdown-outline';

describe('chapter plan', () => {
  it('falls back to H2 when a document has no H1', () => {
    const plan = buildDefaultChapterPlan(parseMarkdownOutline('## One\ntext\n## Two'));
    expect(plan.items.map((item) => item.title)).toEqual(['One', 'Two']);
    expect(plan.concurrency).toBe(1);
  });

  it('normalizes edited chapters and never allows zero concurrency', () => {
    const plan = normalizeChapterPlan({ items: [{ id: '', title: '  Intro ', level: 2, order: 99 } as never], concurrency: 0 });
    expect(plan?.items[0].title).toBe('Intro');
    expect(plan?.items[0].order).toBe(1);
    expect(plan?.concurrency).toBe(1);
  });
});
