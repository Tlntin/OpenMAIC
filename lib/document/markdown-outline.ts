/**
 * Parse the structural outline of MinerU/Markdown course material.
 *
 * Markdown produced by different extractors does not use one page-marker
 * syntax, so page numbers are optional. We recognize the common explicit
 * markers and keep page ranges undefined when the source does not contain
 * reliable page boundaries instead of inventing them from line numbers.
 */

export type MarkdownHeadingLevel = 1 | 2 | 3;

export interface MarkdownOutlineNode {
  id: string;
  level: MarkdownHeadingLevel;
  title: string;
  lineStart: number;
  lineEnd: number;
  pageStart?: number;
  pageEnd?: number;
  parentId?: string;
  children: MarkdownOutlineNode[];
}
export interface MarkdownOutline {
  headings: MarkdownOutlineNode[];
  headingCount: number;
  maxHeadingLevel: MarkdownHeadingLevel | 0;
  totalLines: number;
  pageCount?: number;
  hasPageMarkers: boolean;
}

const PAGE_MARKER_PATTERNS = [
  /<!--\s*(?:page|页)\s*[:#-]?\s*(\d+)\s*-->/i,
  /^\s*[-=]{2,}\s*(?:page|页)\s+(\d+)\s*[-=]{0,}\s*$/i,
  /^\s*\[\s*(?:page|页)\s+(\d+)\s*\]\s*$/i,
];

function pageMarker(line: string): number | undefined {
  for (const pattern of PAGE_MARKER_PATTERNS) {
    const match = pattern.exec(line);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function heading(line: string): { level: MarkdownHeadingLevel; title: string } | null {
  const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length as MarkdownHeadingLevel,
    title: match[2].trim(),
  };
}

function finishNode(node: MarkdownOutlineNode, lineEnd: number, pageEnd?: number): void {
  node.lineEnd = Math.max(node.lineStart, lineEnd);
  if (pageEnd !== undefined) node.pageEnd = pageEnd;
}

/** Parse a Markdown document into a H1/H2/H3 outline tree. */
export function parseMarkdownOutline(markdown: string): MarkdownOutline {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const roots: MarkdownOutlineNode[] = [];
  const flat: MarkdownOutlineNode[] = [];
  const stack: MarkdownOutlineNode[] = [];
  let currentPage: number | undefined;
  let maxHeadingLevel: MarkdownHeadingLevel | 0 = 0;

  const closeUntil = (nextLevel: MarkdownHeadingLevel, lineNumber: number) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= nextLevel) {
      const closed = stack.pop()!;
      finishNode(closed, lineNumber - 1, currentPage);
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const markerPage = pageMarker(lines[index]);
    if (markerPage !== undefined) {
      currentPage = markerPage;
      continue;
    }

    const parsed = heading(lines[index]);
    if (!parsed) continue;
    closeUntil(parsed.level, lineNumber);

    const node: MarkdownOutlineNode = {
      id: `heading-${flat.length + 1}`,
      level: parsed.level,
      title: parsed.title,
      lineStart: lineNumber,
      lineEnd: lines.length,
      ...(currentPage !== undefined ? { pageStart: currentPage } : {}),
      children: [],
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parentId = parent.id;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    flat.push(node);
    stack.push(node);
    if (parsed.level > maxHeadingLevel) maxHeadingLevel = parsed.level;
  }

  while (stack.length > 0) {
    const closed = stack.pop()!;
    finishNode(closed, lines.length, currentPage);
  }

  const pages = flat.flatMap((node) => [node.pageStart, node.pageEnd]).filter(
    (page): page is number => page !== undefined,
  );

  return {
    headings: roots,
    headingCount: flat.length,
    maxHeadingLevel,
    totalLines: lines.length,
    ...(pages.length > 0 ? { pageCount: Math.max(...pages) } : {}),
    hasPageMarkers: pages.length > 0,
  };
}

/** Flatten a tree while preserving document order. */
export function flattenMarkdownOutline(outline: MarkdownOutline): MarkdownOutlineNode[] {
  const result: MarkdownOutlineNode[] = [];
  const visit = (nodes: MarkdownOutlineNode[]) => {
    for (const node of nodes) {
      result.push(node);
      visit(node.children);
    }
  };
  visit(outline.headings);
  return result;
}
