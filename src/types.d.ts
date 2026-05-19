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

declare global {
  // Set to true by the preload when MARKOVER_E2E_TEST is in the environment.
  // Used by the renderer to skip blocking UI (beforeunload guard, modal
  // dialogs) that would otherwise race the Playwright teardown.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const __MARKOVER_E2E__: boolean | undefined;
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __MARKOVER_E2E__?: boolean;
  }
}

export {};
