import { create } from 'zustand';

interface EditorState {
  filePath: string | null;
  fileName: string;
  isDirty: boolean;
  wordCount: number;
  charCount: number;
  lineCount: number;
  cursorLine: number;
  cursorCol: number;

  setFile: (filePath: string | null, fileName: string) => void;
  setDirty: (dirty: boolean) => void;
  setWordCount: (words: number, chars: number, lines: number) => void;
  setCursor: (line: number, col: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  filePath: null,
  fileName: 'Untitled',
  isDirty: false,
  wordCount: 0,
  charCount: 0,
  lineCount: 0,
  cursorLine: 1,
  cursorCol: 1,

  setFile: (filePath, fileName) => set({ filePath, fileName, isDirty: false }),
  setDirty: (isDirty) => set({ isDirty }),
  setWordCount: (wordCount, charCount, lineCount) => set({ wordCount, charCount, lineCount }),
  setCursor: (cursorLine, cursorCol) => set({ cursorLine, cursorCol }),
}));
