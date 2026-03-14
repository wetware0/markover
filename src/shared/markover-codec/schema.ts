/** Status values for comments */
export type CommentStatus = 'open' | 'resolved' | 'pending';

/** Author information */
export interface Author {
  name: string;
  color: string;
}

/** A reply within a comment thread */
export interface CommentReply {
  id: string;
  parentId: string;
  author: string;
  date: string;
  content: string;
}

/** A comment attached to highlighted text */
export interface Comment {
  id: string;
  author: string;
  date: string;
  status: CommentStatus;
  content: string;
  replies: CommentReply[];
}

/** A highlighted region of text (linked to a comment by ID) */
export interface Highlight {
  id: string;
  /** Offset in the clean markdown where the highlight starts */
  startOffset: number;
  /** Offset in the clean markdown where the highlight ends */
  endOffset: number;
}

/** A tracked insertion */
export interface TrackedInsertion {
  id: string;
  author: string;
  date: string;
  /** Offset in the clean markdown where the insertion starts */
  startOffset: number;
  /** Offset in the clean markdown where the insertion ends */
  endOffset: number;
}

/** A tracked deletion */
export interface TrackedDeletion {
  id: string;
  author: string;
  date: string;
  /** Offset in the clean markdown where the deletion starts */
  startOffset: number;
  /** Offset in the clean markdown where the deletion ends */
  endOffset: number;
}

/** File-level metadata stored at end of file */
export interface FileMeta {
  version: number;
  authors: Author[];
}

/** All metadata extracted from a markdown file */
export interface MarkovMetadata {
  highlights: Highlight[];
  comments: Comment[];
  insertions: TrackedInsertion[];
  deletions: TrackedDeletion[];
  fileMeta: FileMeta | null;
  /** Words declared via <!-- cspell:ignore word1 word2 --> */
  cspellIgnores: string[];
}

/** Result of parsing: clean markdown + extracted metadata */
export interface ParseResult {
  /** Markdown with all markover HTML comments stripped */
  cleanMarkdown: string;
  /** Extracted metadata */
  metadata: MarkovMetadata;
}

/** Marker types found in the source */
export type MarkerType =
  | 'hl-start'
  | 'hl-end'
  | 'comment'
  | '/comment'
  | 'reply'
  | '/reply'
  | 'ins-start'
  | 'ins-end'
  | 'del-start'
  | 'del-end'
  | 'meta';

/** A raw marker extracted from source */
export interface RawMarker {
  type: MarkerType;
  attrs: Record<string, string>;
  content: string;
  /** Start offset in original markdown */
  sourceStart: number;
  /** End offset in original markdown (exclusive) */
  sourceEnd: number;
}
