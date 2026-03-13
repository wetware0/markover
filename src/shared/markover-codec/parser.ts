import type {
  ParseResult,
  MarkovMetadata,
  CommentReply,
  CommentStatus,
  FileMeta,
  Author,
} from './schema';

/**
 * Pattern matching all markover HTML comment markers.
 *
 * Matches both self-contained markers like:
 *   <!-- markover:hl-start id="h1a2b3c4" -->
 *
 * And block markers with content like:
 *   <!-- markover:comment id="x" author="A" date="D" status="open" -->
 *   Some content here
 *   <!-- /markover:comment -->
 */
const COMMENT_BLOCK_RE =
  /<!--\s*markover:comment\s+([^>]*?)-->\n?([\s\S]*?)<!--\s*\/markover:comment\s*-->/g;

const REPLY_RE =
  /<!--\s*markover:reply\s+([^>]*?)-->\n?([\s\S]*?)<!--\s*\/markover:reply\s*-->/g;

const META_BLOCK_RE =
  /<!--\s*markover:meta\n([\s\S]*?)-->/g;

/**
 * Parse a markdown file containing markover metadata.
 * Returns clean markdown (with all markover comments stripped) and extracted metadata.
 */
export function parseMarkoverFile(source: string): ParseResult {
  const metadata: MarkovMetadata = {
    highlights: [],
    comments: [],
    insertions: [],
    deletions: [],
    fileMeta: null,
  };

  // Track all marker regions to strip from source
  const stripRegions: Array<{ start: number; end: number }> = [];

  // 1. Extract file-level metadata
  META_BLOCK_RE.lastIndex = 0;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = META_BLOCK_RE.exec(source)) !== null) {
    metadata.fileMeta = parseFileMeta(metaMatch[1]);
    stripRegions.push({ start: metaMatch.index, end: metaMatch.index + metaMatch[0].length });
  }

  // 2. Extract comment blocks (including replies)
  COMMENT_BLOCK_RE.lastIndex = 0;
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = COMMENT_BLOCK_RE.exec(source)) !== null) {
    const attrs = parseAttrs(commentMatch[1]);
    const innerContent = commentMatch[2];

    // Extract replies from inner content
    const replies: CommentReply[] = [];
    let commentText = innerContent;

    REPLY_RE.lastIndex = 0;
    let replyMatch: RegExpExecArray | null;
    while ((replyMatch = REPLY_RE.exec(innerContent)) !== null) {
      const replyAttrs = parseAttrs(replyMatch[1]);
      replies.push({
        id: replyAttrs.id || '',
        parentId: replyAttrs.parent || attrs.id || '',
        author: replyAttrs.author || '',
        date: replyAttrs.date || '',
        content: replyMatch[2].trim(),
      });
      // Remove reply from comment text
      commentText = commentText.replace(replyMatch[0], '');
    }

    metadata.comments.push({
      id: attrs.id || '',
      author: attrs.author || '',
      date: attrs.date || '',
      status: (attrs.status as CommentStatus) || 'open',
      content: commentText.trim(),
      replies,
    });

    stripRegions.push({
      start: commentMatch.index,
      end: commentMatch.index + commentMatch[0].length,
    });
  }

  // Inline markers (hl-start/end, ins-start/end, del-start/end) are intentionally
  // NOT stripped — they remain in the markdown and are parsed by the markdown-it
  // post-processor into HTML elements that TipTap picks up as marks.

  // Sort strip regions by start position
  stripRegions.sort((a, b) => a.start - b.start);

  // Build clean markdown by stripping all marker regions
  let cleanMarkdown = '';
  let srcPos = 0;
  // Map from source offset to clean offset
  const offsetMap: Array<{ srcStart: number; cleanStart: number; length: number }> = [];

  for (const region of stripRegions) {
    if (region.start > srcPos) {
      const chunk = source.slice(srcPos, region.start);
      offsetMap.push({ srcStart: srcPos, cleanStart: cleanMarkdown.length, length: chunk.length });
      cleanMarkdown += chunk;
    }
    srcPos = region.end;
  }

  // Remainder
  if (srcPos < source.length) {
    const chunk = source.slice(srcPos);
    offsetMap.push({ srcStart: srcPos, cleanStart: cleanMarkdown.length, length: chunk.length });
    cleanMarkdown += chunk;
  }

  // Trim trailing whitespace from stripping
  cleanMarkdown = cleanMarkdown.replace(/\n{3,}/g, '\n\n').trim() + '\n';

  return { cleanMarkdown, metadata };
}

/** Parse key="value" pairs from an attribute string */
function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/** Parse YAML-like file metadata (simple key-value, not full YAML) */
function parseFileMeta(content: string): FileMeta {
  const meta: FileMeta = { version: 1, authors: [] };
  const lines = content.split('\n');

  let inAuthors = false;
  let currentAuthor: Partial<Author> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('version:')) {
      meta.version = parseInt(trimmed.slice(8).trim(), 10) || 1;
      inAuthors = false;
    } else if (trimmed === 'authors:') {
      inAuthors = true;
    } else if (inAuthors) {
      if (trimmed.startsWith('- name:')) {
        if (currentAuthor?.name) {
          meta.authors.push({ name: currentAuthor.name, color: currentAuthor.color || '#888' });
        }
        currentAuthor = { name: trimmed.slice(7).trim().replace(/^"|"$/g, '') };
      } else if (trimmed.startsWith('color:') && currentAuthor) {
        currentAuthor.color = trimmed.slice(6).trim().replace(/^"|"$/g, '');
      }
    }
  }

  if (currentAuthor?.name) {
    meta.authors.push({ name: currentAuthor.name, color: currentAuthor.color || '#888' });
  }

  return meta;
}
