/**
 * The window title string. Renderer-side single source of truth; sent to main
 * via SESSION_STATE, which calls mainWindow.setTitle with this value.
 */
export function composeTitle(documentName: string, githubLogin: string | null): string {
  const base = `${documentName} — Markover`;
  return githubLogin ? `${base} · GitHub: ${githubLogin}` : base;
}
