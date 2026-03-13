import type {
  MarkovMetadata,
  Comment,
  Highlight,
  TrackedInsertion,
  TrackedDeletion,
  FileMeta,
} from './schema';

/**
 * Inject markover metadata back into clean markdown.
 * Inserts HTML comment markers at the correct positions.
 */
export function serializeMarkoverFile(cleanMarkdown: string, metadata: MarkovMetadata): string {
  // Collect all insertions to make, sorted by offset (descending so we can insert back-to-front)
  const insertions: Array<{ offset: number; text: string; priority: number }> = [];

  // Inline markers for highlights
  for (const hl of metadata.highlights) {
    insertions.push({
      offset: hl.startOffset,
      text: `<!-- markover:hl-start id="${hl.id}" -->`,
      priority: 0,
    });
    insertions.push({
      offset: hl.endOffset,
      text: `<!-- markover:hl-end id="${hl.id}" -->`,
      priority: 1,
    });
  }

  // Inline markers for tracked insertions
  for (const ins of metadata.insertions) {
    insertions.push({
      offset: ins.startOffset,
      text: `<!-- markover:ins-start id="${ins.id}" author="${ins.author}" date="${ins.date}" -->`,
      priority: 0,
    });
    insertions.push({
      offset: ins.endOffset,
      text: `<!-- markover:ins-end id="${ins.id}" -->`,
      priority: 1,
    });
  }

  // Inline markers for tracked deletions
  for (const del of metadata.deletions) {
    insertions.push({
      offset: del.startOffset,
      text: `<!-- markover:del-start id="${del.id}" author="${del.author}" date="${del.date}" -->`,
      priority: 0,
    });
    insertions.push({
      offset: del.endOffset,
      text: `<!-- markover:del-end id="${del.id}" -->`,
      priority: 1,
    });
  }

  // Sort descending by offset, then by priority (end markers before start markers at same offset)
  insertions.sort((a, b) => {
    if (b.offset !== a.offset) return b.offset - a.offset;
    return b.priority - a.priority;
  });

  // Insert markers back-to-front so offsets remain valid
  let result = cleanMarkdown;
  for (const ins of insertions) {
    result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
  }

  // Append comment blocks after the paragraphs they reference
  // For simplicity, we append all comment blocks at the end before file meta
  if (metadata.comments.length > 0) {
    result = result.trimEnd() + '\n';

    for (const comment of metadata.comments) {
      result += '\n' + serializeComment(comment);
    }
  }

  // Append file-level metadata at the very end
  if (metadata.fileMeta) {
    result = result.trimEnd() + '\n\n' + serializeFileMeta(metadata.fileMeta);
  }

  // Ensure trailing newline
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  return result;
}

function serializeComment(comment: Comment): string {
  let block = `<!-- markover:comment id="${comment.id}" author="${comment.author}" date="${comment.date}" status="${comment.status}" -->\n`;
  block += comment.content + '\n';

  for (const reply of comment.replies) {
    block += `<!-- markover:reply id="${reply.id}" parent="${reply.parentId}" author="${reply.author}" date="${reply.date}" -->\n`;
    block += reply.content + '\n';
    block += `<!-- /markover:reply -->\n`;
  }

  block += `<!-- /markover:comment -->\n`;
  return block;
}

function serializeFileMeta(meta: FileMeta): string {
  let block = '<!-- markover:meta\n';
  block += `version: ${meta.version}\n`;

  if (meta.authors.length > 0) {
    block += 'authors:\n';
    for (const author of meta.authors) {
      block += `  - name: "${author.name}"\n`;
      block += `    color: "${author.color}"\n`;
    }
  }

  block += '-->\n';
  return block;
}
