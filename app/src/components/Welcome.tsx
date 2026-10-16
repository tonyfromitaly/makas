import { useState, type ReactNode } from 'react';
import { Icon } from './ui';
import type { T } from '../i18n';

const media = (f: string) => `${import.meta.env.BASE_URL}media/${f}`;

/** Full-bleed hero: real shop footage, the barber-pole band and the intro film in a phone frame. */
export function Hero({ t, children }: { t: T; children: ReactNode }) {
  const [film, setFilm] = useState(false);
  return (
    <div className="hero">
      <video className="hero-video" src={media('dukkan-loop.mp4')} poster={media('dukkan-poster.jpg')} autoPlay muted loop playsInline aria-hidden />
      <div className="hero-shade" />
      <div className="pole-band" aria-hidden />
      <div className="hero-inner">
        <section className="hero-copy">
          <span className="hero-mark">
            <Icon name="scissors" size={22} /> Makas
          </span>
          <h1 className="hero-title">
            {t('heroA')}
            <br />
            <em>{t('heroB')}</em>
          </h1>
          <p className="hero-body">{t('welcomeBody')}</p>
          <p className="hero-points">{t('welcomePoints')}</p>
          <button className="film-btn" onClick={() => setFilm(true)}>
            <span className="play">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
            </span>
            {t('watchFilm')} · 0:19
          </button>
        </section>
        <section className="hero-panel">{children}</section>
        <aside className="hero-phone" aria-label={t('film')}>
          <video src={media('makas-film.mp4')} poster={media('makas-film-poster.jpg')} autoPlay muted loop playsInline />
        </aside>
      </div>
      {film && (
        <div className="film-modal" onClick={() => setFilm(false)}>
          <video src={media('makas-film.mp4')} autoPlay controls playsInline onClick={(e) => e.stopPropagation()} />
          <button className="icon-btn film-close" onClick={() => setFilm(false)} aria-label="close">
            <Icon name="x" />
          </button>
        </div>
      )}
    </div>
  );
}

/** First visit of the live demo: the hero with a single "start" action. */
export function Welcome({ t, onStart }: { t: T; onStart(): void }) {
  return (
    <div className="welcome">
      <Hero t={t}>
        <div className="hero-card">
          <p className="hero-demo-note">Berber Halil · demo</p>
          <button className="btn primary block big" onClick={onStart}>
            {t('startDemo')} <Icon name="chevR" />
          </button>
        </div>
      </Hero>
    </div>
  );
}
