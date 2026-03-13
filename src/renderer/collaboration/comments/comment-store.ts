import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Comment, CommentReply, CommentStatus } from '../../../shared/markover-codec';

interface CommentsState {
  comments: Comment[];
  activeCommentId: string | null;
  currentAuthor: string;

  setComments: (comments: Comment[]) => void;
  addComment: (id: string, content: string) => void;
  addReply: (commentId: string, content: string) => void;
  setStatus: (commentId: string, status: CommentStatus) => void;
  deleteComment: (commentId: string) => void;
  setActiveComment: (id: string | null) => void;
  setCurrentAuthor: (author: string) => void;
  getComment: (id: string) => Comment | undefined;
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: [],
  activeCommentId: null,
  currentAuthor: 'User',

  setComments: (comments) => set({ comments }),

  addComment: (id, content) => {
    const { currentAuthor, comments } = get();
    const comment: Comment = {
      id,
      author: currentAuthor,
      date: new Date().toISOString(),
      status: 'open',
      content,
      replies: [],
    };
    set({ comments: [...comments, comment], activeCommentId: id });
  },

  addReply: (commentId, content) => {
    const { currentAuthor, comments } = get();
    const reply: CommentReply = {
      id: nanoid(8),
      parentId: commentId,
      author: currentAuthor,
      date: new Date().toISOString(),
      content,
    };
    set({
      comments: comments.map((c) =>
        c.id === commentId ? { ...c, replies: [...c.replies, reply] } : c,
      ),
    });
  },

  setStatus: (commentId, status) => {
    set({
      comments: get().comments.map((c) =>
        c.id === commentId ? { ...c, status } : c,
      ),
    });
  },

  deleteComment: (commentId) => {
    set({
      comments: get().comments.filter((c) => c.id !== commentId),
      activeCommentId: get().activeCommentId === commentId ? null : get().activeCommentId,
    });
  },

  setActiveComment: (id) => set({ activeCommentId: id }),

  setCurrentAuthor: (author) => set({ currentAuthor: author }),

  getComment: (id) => get().comments.find((c) => c.id === id),
}));
