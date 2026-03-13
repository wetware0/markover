declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }
  const taskLists: MarkdownIt.PluginWithOptions<TaskListsOptions>;
  export default taskLists;
}

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const footnotePlugin: MarkdownIt.PluginSimple;
  export default footnotePlugin;
}

declare module 'markdown-it-front-matter' {
  import type MarkdownIt from 'markdown-it';
  const frontMatterPlugin: MarkdownIt.PluginWithOptions<(fm: string) => void>;
  export default frontMatterPlugin;
}
