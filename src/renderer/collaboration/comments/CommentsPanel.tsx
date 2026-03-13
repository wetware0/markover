import React, { useState } from 'react';
import { useCommentsStore } from './comment-store';
import { MessageSquare, Check, Trash2, Send, ChevronDown, ChevronRight } from 'lucide-react';
import type { Comment, CommentStatus } from '../../../shared/markover-codec';

interface CommentsPanelProps {
  onNavigateToComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
}

export function CommentsPanel({ onNavigateToComment, onDeleteComment }: CommentsPanelProps) {
  const { comments, activeCommentId, setActiveComment, addReply, setStatus } = useCommentsStore();
  const [filter, setFilter] = useState<'all' | CommentStatus>('all');

  const filtered = filter === 'all' ? comments : comments.filter((c) => c.status === filter);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <MessageSquare size={16} />
          Comments ({comments.length})
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-sm text-gray-400 text-center">
            No comments yet. Select text and click the comment button to add one.
          </div>
        ) : (
          filtered.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              isActive={comment.id === activeCommentId}
              onActivate={() => {
                setActiveComment(comment.id);
                onNavigateToComment(comment.id);
              }}
              onReply={(content) => addReply(comment.id, content)}
              onResolve={() => setStatus(comment.id, 'resolved')}
              onReopen={() => setStatus(comment.id, 'open')}
              onDelete={() => onDeleteComment(comment.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface CommentThreadProps {
  comment: Comment;
  isActive: boolean;
  onActivate: () => void;
  onReply: (content: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

function CommentThread({
  comment,
  isActive,
  onActivate,
  onReply,
  onResolve,
  onReopen,
  onDelete,
}: CommentThreadProps) {
  const [replyText, setReplyText] = useState('');
  const [expanded, setExpanded] = useState(true);

  const handleReply = () => {
    if (!replyText.trim()) return;
    onReply(replyText.trim());
    setReplyText('');
  };

  const statusColor = {
    open: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
  }[comment.status];

  return (
    <div
      className={`border-b border-gray-200 ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
      onClick={onActivate}
    >
      <div className="px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="p-0.5 hover:bg-gray-200 rounded"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className="text-sm font-medium text-gray-800">{comment.author}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor}`}>
              {comment.status}
            </span>
          </div>
          <span className="text-xs text-gray-400">
            {formatDate(comment.date)}
          </span>
        </div>

        {expanded && (
          <>
            {/* Comment body */}
            <p className="text-sm text-gray-700 ml-6 mb-2">{comment.content}</p>

            {/* Replies */}
            {comment.replies.map((reply) => (
              <div key={reply.id} className="ml-6 pl-3 border-l-2 border-gray-200 mb-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-700">{reply.author}</span>
                  <span className="text-xs text-gray-400">{formatDate(reply.date)}</span>
                </div>
                <p className="text-sm text-gray-600">{reply.content}</p>
              </div>
            ))}

            {/* Reply input */}
            <div className="ml-6 flex items-center gap-1 mt-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReply()}
                onClick={(e) => e.stopPropagation()}
                placeholder="Reply..."
                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleReply(); }}
                disabled={!replyText.trim()}
                className="p-1 text-blue-600 hover:bg-blue-100 rounded disabled:opacity-30"
              >
                <Send size={14} />
              </button>
            </div>

            {/* Actions */}
            <div className="ml-6 flex items-center gap-2 mt-2">
              {comment.status === 'open' || comment.status === 'pending' ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onResolve(); }}
                  className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-50 rounded px-1.5 py-0.5"
                >
                  <Check size={12} /> Resolve
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReopen(); }}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5"
                >
                  Reopen
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 rounded px-1.5 py-0.5"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
