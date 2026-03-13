import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
}).use(taskLists, { enabled: true, label: true, labelAfter: true });

/**
 * Parse markdown string to HTML that TipTap can consume.
 */
export function markdownToHtml(markdown: string): string {
  return md.render(markdown);
}
