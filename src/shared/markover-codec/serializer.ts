import type {
  MarkovMetadata,
  Comment,
  FileMeta,
} from './schema';

/**
 * Serialize markover metadata into a markdown file.
 * Inline markers (highlights, insertions, deletions) are already embedded
 * in the markdown by the ProseMirror serializer. This function only appends
 * comment blocks and file-level metadata.
 */
export function serializeMarkoverFile(markdown: string, metadata: MarkovMetadata): string {
  let result = markdown;

  // Append comment blocks at the end before file meta
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
