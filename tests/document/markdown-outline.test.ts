import { describe, expect, it } from 'vitest';
import {
  flattenMarkdownOutline,
  parseMarkdownOutline,
} from '@/lib/document/markdown-outline';

describe('parseMarkdownOutline', () => {
  it('builds a H1/H2/H3 tree in document order', () => {
    const outline = parseMarkdownOutline(
      '# Course\n\n## Chapter 1\n### Topic A\n### Topic B\n## Chapter 2\n',
    );
    expect(outline.maxHeadingLevel).toBe(3);
    expect(outline.headingCount).toBe(5);
    expect(outline.headings[0].children.map((node) => node.title)).toEqual([
      'Chapter 1',
      'Chapter 2',
    ]);
    expect(outline.headings[0].children[0].children.map((node) => node.title)).toEqual([
      'Topic A',
      'Topic B',
    ]);
    expect(flattenMarkdownOutline(outline).map((node) => node.title)).toEqual([
      'Course',
      'Chapter 1',
      'Topic A',
      'Topic B',
      'Chapter 2',
    ]);
  });

  it('tracks explicit page markers and closes ranges at the next heading', () => {
    const outline = parseMarkdownOutline(
      '<!-- page: 1 -->\n# Course\n<!-- page: 3 -->\n## Chapter\ntext\n<!-- page: 5 -->\n### Topic\n',
    );
    const flat = flattenMarkdownOutline(outline);
    expect(outline.hasPageMarkers).toBe(true);
    expect(flat[0]).toMatchObject({ pageStart: 1, pageEnd: 5 });
    expect(flat[1]).toMatchObject({ pageStart: 3, pageEnd: 5 });
    expect(flat[2]).toMatchObject({ pageStart: 5, pageEnd: 5 });
  });

  it('does not fabricate page numbers when the Markdown has none', () => {
    const outline = parseMarkdownOutline('# Course\n\n## Chapter\nText');
    expect(outline.hasPageMarkers).toBe(false);
    expect(outline.pageCount).toBeUndefined();
    expect(flattenMarkdownOutline(outline).every((node) => node.pageStart === undefined)).toBe(
      true,
    );
  });
});
