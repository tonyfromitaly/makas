import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Adisyon type: Archivo Narrow for labels, JetBrains Mono for numbers, Hanken Grotesk to read, Caveat for notes.
import '@fontsource/archivo-narrow/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/800.css';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/caveat/600.css';
import './styles.css';
import { App } from './App';
import { BookPage, bookSlug } from './screens/Book';
import { Setup } from './screens/Setup';
import { applyLook, loadLook, watchSystem } from './theme';

// The look is applied before the first paint so the app never flashes the wrong colours.
applyLook(loadLook());
watchSystem(loadLook);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The public booking page needs no login and none of the app around it (the demo shows it inside the app). */}
    {bookSlug() && import.meta.env.MODE !== 'demo' ? <BookPage slug={bookSlug()!} /> : location.hash.startsWith('#kurulum') ? <Setup /> : <App />}
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !bookSlug()) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
