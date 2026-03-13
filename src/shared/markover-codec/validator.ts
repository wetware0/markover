import type { MarkovMetadata } from './schema';

export interface ValidationError {
  type: 'orphaned_highlight' | 'orphaned_comment' | 'missing_id' | 'duplicate_id' | 'invalid_range';
  message: string;
  id?: string;
}

/**
 * Validate the integrity of parsed markover metadata.
 * Returns an array of validation errors (empty = valid).
 */
export function validateMetadata(metadata: MarkovMetadata): ValidationError[] {
  const errors: ValidationError[] = [];
  const allIds = new Set<string>();

  // Check for duplicate IDs across all types
  const checkDuplicateId = (id: string, context: string) => {
    if (!id) {
      errors.push({ type: 'missing_id', message: `Missing ID in ${context}` });
      return;
    }
    if (allIds.has(id)) {
      errors.push({ type: 'duplicate_id', message: `Duplicate ID "${id}" in ${context}`, id });
    }
    allIds.add(id);
  };

  // Validate highlights have matching comments
  const commentIds = new Set(metadata.comments.map((c) => c.id));
  for (const hl of metadata.highlights) {
    checkDuplicateId(hl.id, 'highlight');
    if (!commentIds.has(hl.id)) {
      errors.push({
        type: 'orphaned_highlight',
        message: `Highlight "${hl.id}" has no matching comment`,
        id: hl.id,
      });
    }
    if (hl.startOffset > hl.endOffset) {
      errors.push({
        type: 'invalid_range',
        message: `Highlight "${hl.id}" has start > end (${hl.startOffset} > ${hl.endOffset})`,
        id: hl.id,
      });
    }
  }

  // Validate comments have matching highlights
  const highlightIds = new Set(metadata.highlights.map((h) => h.id));
  for (const comment of metadata.comments) {
    // Comments reuse highlight IDs, so don't check duplicate here
    if (!highlightIds.has(comment.id)) {
      errors.push({
        type: 'orphaned_comment',
        message: `Comment "${comment.id}" has no matching highlight`,
        id: comment.id,
      });
    }

    // Validate replies
    for (const reply of comment.replies) {
      checkDuplicateId(reply.id, 'reply');
    }
  }

  // Validate insertions
  for (const ins of metadata.insertions) {
    checkDuplicateId(ins.id, 'insertion');
    if (ins.startOffset > ins.endOffset) {
      errors.push({
        type: 'invalid_range',
        message: `Insertion "${ins.id}" has start > end`,
        id: ins.id,
      });
    }
  }

  // Validate deletions
  for (const del of metadata.deletions) {
    checkDuplicateId(del.id, 'deletion');
    if (del.startOffset > del.endOffset) {
      errors.push({
        type: 'invalid_range',
        message: `Deletion "${del.id}" has start > end`,
        id: del.id,
      });
    }
  }

  return errors;
}
