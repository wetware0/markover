import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
// Imported from JS, not via @import in styles.css: Tailwind's PostCSS inlining doesn't
// rebase KaTeX's relative font URLs, so the fonts were never bundled.
import 'katex/dist/katex.min.css';
import './styles.css';
import './store/theme-store'; // Initialize theme before first paint

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
