/**
 * UI layer for the home page: stylesheet, client-side script, and HTML shell.
 *
 * Design language: "time instrument" — aurora gradient backdrop, glass
 * panels, an SVG orbital chronograph hero, per-digit token cells, and a
 * smooth SVG countdown ring. Light/dark themes are driven by CSS custom
 * properties; the resolved theme lives on <html data-theme>.
 *
 * All imagery is inline SVG (no external fonts, scripts, or images), so the
 * CSP stays 'self' + nonce. CLIENT_JS mirrors the Base32/HOTP logic in
 * totp-core.ts so codes can be computed without the secret leaving the
 * browser; tests/client-drift.test.ts cross-checks both copies.
 */

const GITHUB_REPOSITORY_URL = "https://github.com/deeeeeeeeap/2fa-cfworker";

// Stamped at module load (worker cold start). CLIENT_JS overwrites the footer
// with the visitor's local year via the {year} i18n placeholder.
const COPYRIGHT_YEAR = new Date().getFullYear();

const PAGE_CSS = `
:root {
  --topbar-h: 78px;
  --bg: #f4f8ff;
  --surface: rgba(255, 255, 255, .72);
  --surface-2: rgba(255, 255, 255, .92);
  --border: rgba(18, 44, 99, .10);
  --border-2: rgba(18, 44, 99, .18);
  --text: #0a1430;
  --text-2: #41527a;
  --text-3: #5d6f99;
  --accent: #1769ff;
  --accent-2: #00a3c4;
  --accent-3: #7a5af8;
  --on-accent: #ffffff;
  --token-ink: #0f5ce8;
  --ring-track: rgba(18, 44, 99, .10);
  --danger: #d92d20;
  --warn-strong: #b46a08;
  --code-bg: #0b1526;
  --code-ink: #d6e2f3;
  --aurora-a: rgba(23, 105, 255, .14);
  --aurora-b: rgba(122, 90, 248, .12);
  --aurora-c: rgba(0, 163, 196, .11);
  --dot: rgba(58, 98, 180, .16);
  --shadow: 0 1px 2px rgba(10, 20, 48, .04), 0 16px 40px rgba(10, 20, 48, .08);
  --shadow-lift: 0 24px 56px rgba(10, 20, 48, .14);
  --focus: rgba(23, 105, 255, .32);
  --glow: none;
  --cell-bg: linear-gradient(180deg, #ffffff, #f3f7ff);
  --cell-inset: rgba(255, 255, 255, .55);
  --chip-bg: rgba(23, 105, 255, .08);
  --chip2-bg: rgba(0, 163, 196, .12);
  --chip2-ink: #0e7490;
  --panel-line: rgba(255, 255, 255, .6);
  --warning-border: #f2c277;
  --warning-bg: linear-gradient(90deg, #fff7e8, #fffdf8);
  --warning-ink: #9a5b14;
  --warning-title: #8a3d05;
  --warning-icon: #e8930c;
}
[data-theme="dark"] {
  --bg: #070b16;
  --surface: rgba(16, 24, 46, .60);
  --surface-2: rgba(21, 31, 58, .88);
  --border: rgba(146, 176, 255, .13);
  --border-2: rgba(146, 176, 255, .24);
  --text: #e9efff;
  --text-2: #a6b3d8;
  --text-3: #8392ba;
  --accent: #5b97ff;
  --accent-2: #2dd4bf;
  --accent-3: #9b8cff;
  --on-accent: #ffffff;
  --token-ink: #8db8ff;
  --ring-track: rgba(146, 176, 255, .14);
  --danger: #f97066;
  --warn-strong: #f0a020;
  --code-bg: #0a1322;
  --code-ink: #cfdef5;
  --aurora-a: rgba(48, 118, 255, .20);
  --aurora-b: rgba(139, 124, 255, .17);
  --aurora-c: rgba(45, 212, 191, .13);
  --dot: rgba(124, 152, 235, .10);
  --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 18px 48px rgba(0, 0, 0, .42);
  --shadow-lift: 0 26px 64px rgba(0, 0, 0, .55);
  --focus: rgba(91, 151, 255, .40);
  --glow: 0 0 26px rgba(91, 151, 255, .38);
  --cell-bg: linear-gradient(180deg, rgba(31, 44, 80, .92), rgba(17, 25, 48, .92));
  --cell-inset: rgba(146, 176, 255, .14);
  --chip-bg: rgba(91, 151, 255, .13);
  --chip2-bg: rgba(45, 212, 191, .14);
  --chip2-ink: #5eead4;
  --panel-line: rgba(146, 176, 255, .32);
  --warning-border: rgba(242, 166, 90, .38);
  --warning-bg: linear-gradient(90deg, rgba(122, 74, 18, .22), rgba(122, 74, 18, .10));
  --warning-ink: #eec189;
  --warning-title: #f6cf9b;
  --warning-icon: #f0a020;
}
html[data-theme="light"] { color-scheme: light; }
html[data-theme="dark"] { color-scheme: dark; }

* { box-sizing: border-box; }
html {
  min-height: 100%;
  margin: 0;
  padding: 0;
}
body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  color: var(--text);
  background: var(--bg);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    sans-serif;
  transition: background .4s ease, color .4s ease;
}
body::before {
  content: "";
  position: fixed;
  inset: -22vh -18vw;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(42% 38% at 16% 14%, var(--aurora-a), transparent 70%),
    radial-gradient(36% 34% at 86% 10%, var(--aurora-b), transparent 70%),
    radial-gradient(48% 42% at 52% 98%, var(--aurora-c), transparent 72%);
  animation: aurora 44s ease-in-out infinite alternate;
}
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: radial-gradient(var(--dot) 1px, transparent 1.35px);
  background-size: 26px 26px;
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, .5) 42%, transparent 80%);
  mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, .5) 42%, transparent 80%);
}
@keyframes aurora {
  0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); }
  50% { transform: translate3d(2%, -1.5%, 0) rotate(1.1deg) scale(1.03); }
  100% { transform: translate3d(-2%, 1.5%, 0) rotate(-1deg) scale(1.01); }
}
main,
section,
div {
  min-width: 0;
}
button,
input,
select {
  font: inherit;
  min-height: 44px;
}
button { cursor: pointer; }
:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.page { min-height: 100vh; }
.shell {
  width: min(1232px, calc(100vw - 48px));
  margin: 0 auto;
}

/* ---------- topbar ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  backdrop-filter: blur(16px) saturate(1.4);
}
.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: var(--topbar-h);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 25px;
  font-weight: 900;
  letter-spacing: -.03em;
  color: var(--text);
  text-decoration: none;
}
.brand strong { color: var(--accent); }
.brand-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  filter: drop-shadow(0 8px 18px rgba(23, 105, 255, .35));
}
.nav {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text);
  font-size: 15px;
  font-weight: 800;
}
.lang {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: var(--surface);
}
.lang button {
  min-width: 58px;
  min-height: 42px;
  border: 0;
  padding: 0 14px;
  background: transparent;
  color: var(--text-2);
  font-weight: 800;
  transition: color .2s ease, background .2s ease;
}
.lang .active {
  background: linear-gradient(135deg, var(--accent), var(--accent-3));
  color: var(--on-accent);
}
.theme-toggle {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-2);
  transition: color .2s ease, border-color .2s ease, transform .2s ease;
}
.theme-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: translateY(-1px);
}
.theme-toggle .ti { display: none; width: 20px; height: 20px; }
.theme-toggle[data-mode="auto"] .ti-auto { display: block; }
.theme-toggle[data-mode="light"] .ti-sun { display: block; }
.theme-toggle[data-mode="dark"] .ti-moon { display: block; }
.github {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 0 6px;
  border-radius: 10px;
  color: var(--text);
  text-decoration: none;
  transition: color .2s ease;
}
.github:hover,
.github:focus-visible { color: var(--accent); }
.github svg { width: 21px; height: 21px; }

/* ---------- lead: hero copy beside the generator panel ---------- */
/* The lead owns the first screen: it fills the viewport below the topbar and
   centers the hero + generator vertically, so the fold lands on its bottom
   padding instead of slicing through the cards below. */
.lead {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, .94fr) minmax(0, 1.06fr);
  align-items: center;
  gap: 32px;
  padding: 24px 0 64px;
  min-height: calc(100vh - var(--topbar-h));
  min-height: calc(100svh - var(--topbar-h));
}
.hero-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-width: 0;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 8px 16px;
  border: 1px solid var(--border-2);
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: .02em;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 2.4s ease-out infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 var(--focus); }
  70% { box-shadow: 0 0 0 10px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.hero-copy h1 {
  margin: 14px 0 0;
  font-size: clamp(32px, 3.4vw, 48px);
  line-height: 1.08;
  letter-spacing: -.045em;
  font-weight: 900;
  text-wrap: balance;
  background: linear-gradient(118deg, var(--text) 36%, var(--accent) 80%, var(--accent-3) 108%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
.hero-copy p {
  margin: 12px 0 0;
  max-width: 58ch;
  color: var(--text-2);
  font-size: clamp(15.5px, 1.2vw, 18px);
  line-height: 1.62;
}
.hero-art {
  align-self: center;
  width: min(64%, 290px);
  margin-top: 30px;
  pointer-events: none;
  user-select: none;
}
.hero-orbit {
  display: block;
  width: 100%;
  height: auto;
  filter: drop-shadow(0 26px 52px rgba(23, 105, 255, .20));
  animation: floaty 9s ease-in-out infinite alternate;
}
@keyframes floaty {
  from { transform: translateY(-6px); }
  to { transform: translateY(8px); }
}
.hero-orbit .orbit,
.hero-orbit .hand {
  transform-origin: 50% 50%;
  transform-box: view-box;
}
.hero-orbit .orbit-a { animation: spin 72s linear infinite; }
.hero-orbit .orbit-b { animation: spin 48s linear infinite reverse; }
.hero-orbit .orbit-c { animation: spin 96s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Decorative hint that more content sits below the fold. */
.scroll-cue {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-2);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-3);
  box-shadow: var(--shadow);
  pointer-events: none;
  animation: cue-bob 2.4s ease-in-out infinite;
}
.scroll-cue svg { width: 17px; height: 17px; }
@keyframes cue-bob {
  0%, 100% { transform: translate(-50%, 0); opacity: .8; }
  50% { transform: translate(-50%, 7px); opacity: 1; }
}

/* ---------- entry reveal ---------- */
.reveal {
  opacity: 0;
  transform: translateY(16px);
  animation: fade-up .8s cubic-bezier(.2, .7, .3, 1) forwards;
}
.d1 { animation-delay: .08s; }
.d2 { animation-delay: .16s; }
.d3 { animation-delay: .24s; }
.d4 { animation-delay: .32s; }
.d5 { animation-delay: .40s; }
@keyframes fade-up {
  to { opacity: 1; transform: none; }
}

/* ---------- panels ---------- */
.lower-grid {
  display: grid;
  grid-template-columns: minmax(0, .94fr) minmax(0, 1.06fr);
  grid-template-areas: "features api";
  gap: 18px;
  margin-top: 0;
}
.panel-api { grid-area: api; }
.panel {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  backdrop-filter: blur(18px) saturate(1.25);
  box-shadow: var(--shadow);
  padding: 26px;
  overflow: hidden;
}
.panel::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--panel-line), transparent);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 16px;
  color: var(--text);
  font-size: 19px;
  font-weight: 900;
}
.panel-ic {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: var(--chip-bg);
  color: var(--accent);
}
.panel-ic svg { width: 21px; height: 21px; }
.panel-tag {
  margin-left: auto;
  padding: 4px 9px;
  border: 1px solid var(--border-2);
  border-radius: 7px;
  color: var(--text-3);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  white-space: nowrap;
}
.chip {
  padding: 5px 9px;
  border-radius: 7px;
  background: var(--chip-bg);
  color: var(--accent);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .04em;
}
.chip-post {
  background: var(--chip2-bg);
  color: var(--chip2-ink);
}
.panel-chips {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

/* ---------- clock skew warning ---------- */
.drift-warn {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 6px;
  border: 1px solid var(--warning-border);
  border-radius: 12px;
  padding: 11px 14px;
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 13px;
  line-height: 1.55;
}
.drift-warn[hidden] { display: none; }
.drift-warn .note-ic { color: var(--warning-icon); }

/* ---------- fields ---------- */
.field { margin-top: 14px; }
.field label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  color: var(--text);
  font-weight: 800;
  font-size: 14.5px;
}
.label-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  color: var(--accent);
  flex: 0 0 auto;
}
.label-icon svg { width: 100%; height: 100%; }
.input-wrap { position: relative; }
.input-wrap input {
  width: 100%;
  min-width: 0;
  height: 48px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  padding: 0 56px 0 16px;
  color: var(--text);
  background: var(--surface-2);
  outline: none;
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 13.5px;
  text-overflow: ellipsis;
  transition: border-color .2s ease, box-shadow .2s ease;
}
.input-wrap input::placeholder {
  color: var(--text-3);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}
.input-wrap input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--focus);
}
.icon-button {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-3);
  transition: background .18s ease, color .18s ease, transform .18s ease;
}
.icon-button:hover,
.icon-button:focus-visible {
  background: var(--chip-bg);
  color: var(--accent);
  outline: none;
}
.icon-button:active { transform: translateY(1px); }
.icon-button .ic { width: 19px; height: 19px; }
.icon-button .ic-check { display: none; color: #16a34a; }
.icon-button.copied { background: var(--chip-bg); }
.icon-button.copied .ic-copy { display: none; }
.icon-button.copied .ic-check {
  display: block;
  animation: pop .3s cubic-bezier(.2, .9, .3, 1.4);
}
.icon-button.inline {
  position: static;
  width: 36px;
  height: 36px;
  min-height: 36px;
  margin-left: auto;
  color: #7e93b5;
}
.input-wrap.dual input { padding-right: 96px; }
.icon-button.reveal-toggle { right: 46px; }
.reveal-toggle .ic-eye-off { display: none; }
.reveal-toggle[aria-pressed="true"] .ic-eye { display: none; }
.reveal-toggle[aria-pressed="true"] .ic-eye-off { display: block; }
@keyframes pop {
  from { transform: scale(.5); }
  to { transform: scale(1); }
}
.field-hint,
.field-error {
  margin: 7px 0 0;
  font-size: 12px;
  line-height: 1.55;
}
.field-hint { color: var(--text-3); }
.field-error {
  color: var(--danger);
  font-weight: 700;
}
.field-error:empty,
.error:empty { display: none; }
.error {
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 13px;
  font-weight: 700;
}

/* ---------- advanced options ---------- */
.advanced {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--chip-bg);
}
.advanced summary {
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 15px;
  color: var(--text);
  font-weight: 800;
  font-size: 13.5px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.advanced summary::-webkit-details-marker { display: none; }
.advanced .chev {
  margin-left: auto;
  width: 16px;
  height: 16px;
  color: var(--text-3);
  transition: transform .25s ease;
}
.advanced[open] .chev { transform: rotate(180deg); }
.advanced[open] summary { border-bottom: 1px solid var(--border); }
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 13px 15px 15px;
}
.advanced-field {
  display: grid;
  gap: 6px;
  color: var(--text-2);
  font-weight: 800;
  font-size: 12px;
}
.select-wrap { position: relative; }
.select-wrap .chev {
  position: absolute;
  right: 11px;
  top: 50%;
  width: 15px;
  height: 15px;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.advanced-field select,
.advanced-field input {
  width: 100%;
  min-height: 46px;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--border-2);
  border-radius: 10px;
  padding: 0 32px 0 12px;
  color: var(--text);
  background: var(--surface-2);
  font-weight: 700;
  transition: border-color .2s ease, box-shadow .2s ease;
}
.advanced-field input { padding-right: 12px; }
.advanced-field select:focus-visible,
.advanced-field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--focus);
  outline: none;
}

/* ---------- generate button ---------- */
.primary {
  width: 100%;
  min-height: 52px;
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 0;
  border-radius: 14px;
  color: var(--on-accent);
  background: linear-gradient(135deg, var(--accent), var(--accent-3));
  box-shadow: 0 12px 28px var(--focus);
  font-weight: 900;
  font-size: 15.5px;
  letter-spacing: .01em;
  transition: transform .2s ease, box-shadow .2s ease, filter .2s ease;
}
.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 36px var(--focus);
  filter: saturate(1.1);
}
.primary:active { transform: translateY(0) scale(.995); }
.primary svg { width: 19px; height: 19px; }

/* ---------- token instrument ---------- */
.result-card {
  position: relative;
  margin-top: 16px;
  border: 1px solid var(--border-2);
  border-radius: 16px;
  background: var(--surface-2);
  overflow: hidden;
}
.result-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3));
}
.result-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 116px;
  align-items: center;
  gap: 14px;
  padding: 24px 20px 18px;
}
.token {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  padding: 6px;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
}
.token[data-copyable="false"] { cursor: default; }
.token .gap { width: 10px; flex: 0 0 auto; }
.digit {
  width: clamp(38px, 4.2vw, 54px);
  height: clamp(54px, 5.8vw, 74px);
  display: grid;
  place-items: center;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: var(--cell-bg);
  box-shadow: inset 0 1px 0 var(--cell-inset), 0 6px 16px rgba(10, 20, 48, .06);
  overflow: hidden;
  transition: border-color .2s ease;
}
.token[data-copyable="true"]:hover .digit,
.token:focus-visible .digit { border-color: var(--accent); }
.digit b {
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: clamp(28px, 3vw, 42px);
  font-weight: 900;
  line-height: 1;
  color: var(--token-ink);
  text-shadow: var(--glow);
  font-variant-numeric: tabular-nums;
}
.digit.idle b {
  opacity: .32;
  text-shadow: none;
}
.digit.roll b { animation: digit-roll .45s cubic-bezier(.2, .9, .3, 1.15); }
@keyframes digit-roll {
  0% { transform: translateY(62%); opacity: 0; filter: blur(3px); }
  100% { transform: translateY(0); opacity: 1; filter: blur(0); }
}
.token.copied .digit { border-color: #16a34a; }

.timer {
  position: relative;
  width: 108px;
  height: 108px;
  justify-self: end;
}
.ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.ring-track {
  fill: none;
  stroke: var(--ring-track);
  stroke-width: 7;
}
.ring-fg {
  fill: none;
  stroke: var(--accent);
  stroke-width: 7;
  stroke-linecap: round;
  transition: stroke-dashoffset 1s linear, stroke .4s ease;
}
.ring-fg.noanim { transition: none; }
.timer-inner {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 3px;
  text-align: center;
}
.timer-value {
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -.04em;
  line-height: 1;
  color: var(--text);
}
.timer-labels {
  display: flex;
  gap: 4px;
  justify-content: center;
  color: var(--text-3);
  font-size: 10px;
  font-weight: 800;
}
.timer.warn .ring-fg { stroke: var(--warn-strong); }
.timer.warn .timer-value { color: var(--warn-strong); }
.timer.danger .ring-fg { stroke: var(--danger); }
.timer.danger .timer-value { color: var(--danger); }
.timer.danger { animation: ring-pulse 1s ease-in-out infinite; }
@keyframes ring-pulse {
  50% { transform: scale(1.045); }
}
.next {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 42px;
  border-top: 1px dashed var(--border-2);
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1;
  white-space: nowrap;
}
.next b {
  color: var(--accent);
  font-size: 15px;
}

/* ---------- api panel ---------- */
.api-desc {
  margin: 0 0 14px;
  color: var(--text-2);
  line-height: 1.62;
  font-size: 14px;
}
.code-box {
  margin-top: 10px;
  border: 1px solid rgba(146, 176, 255, .16);
  border-radius: 14px;
  overflow: hidden;
  background: var(--code-bg);
  color: var(--code-ink);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
}
.code-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, .07);
}
.code-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.code-dot.d-r { background: #ff5f57; }
.code-dot.d-y { background: #febc2e; }
.code-dot.d-g { background: #28c840; }
.code-lang {
  margin-left: 7px;
  color: #7e93b5;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
}
.code-body { padding: 15px 18px 17px; }
.code-line {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  line-height: 1.85;
  font-size: 13.5px;
}
.code-line span:first-child { color: #5d7396; }
.code-line span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.code-key { color: #8ab4ff; }
.green {
  color: #5ee874;
  text-shadow: 0 0 14px rgba(94, 232, 116, .35);
}
.api-note-box {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  padding: 13px 15px;
  background: var(--chip-bg);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.55;
}
.note-ic {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
}
.note-ic svg { width: 100%; height: 100%; }

/* ---------- features ---------- */
.feature-grid {
  grid-area: features;
  display: grid;
  grid-template-columns: 1fr;
  /* Split the column height evenly so the stack matches the API panel height
     instead of leaving a ragged gap under the last card. */
  grid-auto-rows: 1fr;
  gap: 14px;
}
.feature {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: var(--shadow);
  padding: 18px;
  transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease;
}
.feature:hover {
  transform: translateY(-3px);
  border-color: var(--border-2);
  box-shadow: var(--shadow-lift);
}
.feature-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--chip-bg);
  color: var(--accent);
}
.feature-icon svg { width: 24px; height: 24px; }
.feature.f-teal .feature-icon { background: var(--chip2-bg); color: var(--chip2-ink); }
.feature.f-orange .feature-icon { background: rgba(242, 147, 12, .13); color: #e8930c; }
.feature.f-violet .feature-icon { background: rgba(122, 90, 248, .12); color: var(--accent-3); }
.feature h3 {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--text);
}
.feature p {
  margin: 0;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
}

/* ---------- warning ---------- */
.warning {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 74px;
  margin-top: 18px;
  border: 1px solid var(--warning-border);
  border-radius: 16px;
  padding: 15px 24px;
  color: var(--warning-ink);
  background: var(--warning-bg);
}
.warning-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  color: var(--warning-icon);
}
.warning-mark svg { width: 100%; height: 100%; }
.warning strong {
  display: block;
  margin-bottom: 4px;
  font-size: 17px;
  color: var(--warning-title);
}

/* ---------- footer ---------- */
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 22px 0 26px;
  padding-top: 15px;
  border-top: 1px solid var(--border);
  color: var(--text-3);
  font-size: 13px;
}
.footer-copy {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.footer-line + .footer-line::before { content: " · "; }
.footer a {
  color: var(--text-2);
  text-decoration: none;
  font-weight: 700;
  transition: color .2s ease;
}
.footer a:hover { color: var(--accent); }
.footer-links {
  display: flex;
  align-items: center;
  gap: 18px;
}

/* ---------- responsive ---------- */
@media (max-width: 1180px) {
  .lead { gap: 18px; }
  .hero-copy h1 { font-size: clamp(30px, 3.4vw, 40px); }
  .result-main { grid-template-columns: minmax(0, 1fr) 100px; gap: 10px; }
  .timer { width: 92px; height: 92px; }
  .timer-value { font-size: 22px; }
  .digit { width: clamp(30px, 3.3vw, 46px); height: clamp(46px, 4.6vw, 64px); }
  .digit b { font-size: clamp(22px, 2.4vw, 34px); }
  .token { gap: 6px; }
  .token .gap { width: 8px; }
}
@media (max-width: 960px) {
  :root { --topbar-h: 60px; }
  .brand { font-size: 22px; }
  .brand-mark { width: 36px; height: 36px; }
  .lead {
    grid-template-columns: 1fr;
    gap: 18px;
    padding: 24px 0 0;
    min-height: 0;
  }
  .scroll-cue { display: none; }
  .hero-copy {
    align-items: center;
    text-align: center;
  }
  .hero-copy p { margin-inline: auto; }
  .hero-art { width: min(56%, 250px); margin-top: 16px; }
  .lower-grid {
    grid-template-columns: 1fr;
    grid-template-areas: "api" "features";
    gap: 14px;
    margin-top: 14px;
  }
  .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; }
  .result-main { grid-template-columns: minmax(0, 1fr) 116px; }
  .timer { width: 108px; height: 108px; }
  .timer-value { font-size: 26px; }
  .digit { width: clamp(38px, 6vw, 54px); height: clamp(54px, 8.2vw, 74px); }
  .digit b { font-size: clamp(28px, 4.4vw, 42px); }
}
@media (max-width: 720px) {
  .shell { width: min(100% - 24px, 1232px); }
  /* Keep the topbar on a single row: brand left, controls right. A wrapped
     space-between nav used to strand the theme toggle mid-header. */
  .topbar-inner { gap: 10px; }
  .brand { font-size: 20px; gap: 10px; }
  .brand-mark { width: 34px; height: 34px; }
  .nav { gap: 8px; }
  .lang button { min-width: 46px; min-height: 38px; padding: 0 10px; }
  .theme-toggle { width: 40px; height: 40px; }
  .github { min-height: 40px; }
  .lead { padding: 18px 0 0; }
  .hero-copy h1 { margin-top: 14px; font-size: clamp(30px, 8.4vw, 38px); letter-spacing: -.04em; }
  .hero-copy p { margin-top: 12px; font-size: 15.5px; }
  .hero-art { width: min(68%, 230px); margin-top: 14px; }
  .feature-grid { grid-template-columns: 1fr; gap: 11px; }
  .feature { padding: 15px 16px; }
  .panel { padding: 18px; border-radius: 16px; }
  .panel-title { font-size: 17.5px; margin-bottom: 12px; }
  .result-main {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 18px 12px 14px;
  }
  .timer { justify-self: center; width: 98px; height: 98px; }
  .timer-value { font-size: 23px; }
  .token { flex-wrap: nowrap; }
  .next { font-size: 12.5px; }
  .footer {
    display: block;
    text-align: center;
    margin: 18px 0 20px;
  }
  .footer-line { display: block; }
  .footer-line + .footer-line::before { content: ""; }
  .footer-links { justify-content: center; margin-top: 10px; }
  .warning { align-items: flex-start; gap: 13px; padding: 14px 16px; min-height: 0; }
  .warning-mark { width: 34px; height: 34px; }
  .warning strong { font-size: 15.5px; }
  .api-note-box { font-size: 12.5px; }
  .field-hint, .field-error { font-size: 11.5px; }
}
@media (max-width: 480px) {
  .shell { width: min(100% - 16px, 1232px); }
  .advanced-grid { grid-template-columns: 1fr; gap: 9px; }
  .brand { font-size: 19px; gap: 9px; }
  .brand-mark { width: 33px; height: 33px; }
  .github span { display: none; }
  .lang button { min-width: 42px; padding: 0 8px; }
  .lead { padding: 14px 0 0; }
  .hero-badge { font-size: 11.5px; padding: 6px 12px; }
  .hero-copy h1 { font-size: clamp(26.5px, 8vw, 31px); }
  .hero-copy p { font-size: 14.5px; line-height: 1.6; }
  .hero-art { width: min(72%, 215px); }
  .input-wrap input { height: 46px; padding-left: 13px; font-size: 12.5px; }
  .input-wrap.dual input { padding-right: 92px; }
  .icon-button.reveal-toggle { right: 44px; }
  .digit {
    width: clamp(30px, 11vw, 42px);
    height: clamp(46px, 15vw, 60px);
    border-radius: 10px;
  }
  .digit b { font-size: clamp(22px, 7.4vw, 32px); }
  .token { gap: 5px; padding: 4px; }
  .token .gap { width: 6px; }
  /* 7/8-digit codes must fit without tripping the result card's
     overflow:hidden; tighten cells when more than 6 digits render. */
  .token.many { gap: 3px; padding: 4px 2px; }
  .token.many .gap { width: 4px; }
  .token.many .digit {
    width: clamp(24px, 9vw, 36px);
    height: clamp(40px, 13vw, 54px);
    border-radius: 8px;
  }
  .token.many .digit b { font-size: clamp(18px, 6vw, 26px); }
  .panel-tag { display: none; }
  .panel { padding: 15px; }
  .code-body { padding: 12px 13px 14px; }
  .code-line { font-size: 12.5px; }
  .primary { min-height: 50px; }
}
@media (max-width: 380px) {
  .brand { font-size: 18px; }
  .lang button { min-width: 40px; padding: 0 7px; }
  .github { padding: 0 2px; }
}

/* Short desktop windows: compress vertical rhythm so the generator panel
   stays fully usable above the fold instead of being cut mid-card. */
@media (min-width: 961px) and (max-height: 840px) {
  :root { --topbar-h: 58px; }
  .brand { font-size: 21px; }
  .brand-mark { width: 34px; height: 34px; }
  .lead { padding: 16px 0 52px; gap: 22px; }
  .scroll-cue { bottom: 12px; }
  .hero-badge { font-size: 12px; padding: 6px 13px; }
  .hero-copy h1 { margin-top: 12px; font-size: clamp(28px, 2.8vw, 38px); }
  .hero-copy p { margin-top: 10px; font-size: 15px; }
  .hero-art { width: min(50%, 225px); margin-top: 18px; }
  .panel { padding: 20px; }
  .panel-title { margin-bottom: 12px; }
  .field { margin-top: 10px; }
  .field label { margin-bottom: 6px; }
  .input-wrap input { height: 44px; }
  .icon-button { width: 40px; height: 40px; }
  .advanced { margin-top: 12px; }
  .advanced summary { min-height: 42px; }
  .primary { margin-top: 12px; min-height: 48px; }
  .result-card { margin-top: 12px; }
  .result-main { padding: 14px 16px 10px; }
  .digit { height: clamp(44px, 7.4vh, 60px); }
  .digit b { font-size: clamp(22px, 3.8vh, 32px); }
  .timer { width: 88px; height: 88px; }
  .timer-value { font-size: 21px; }
  .next { height: 36px; font-size: 12.5px; }
  .lower-grid { margin-top: 14px; }
  .feature { padding: 15px 16px; }
}
@media (min-width: 961px) and (max-height: 680px) {
  .hero-art { display: none; }
  .lead { padding: 12px 0 20px; gap: 18px; }
  .scroll-cue { display: none; }
  .hero-copy h1 { font-size: clamp(26px, 2.5vw, 32px); }
  .panel { padding: 16px 18px; }
  .panel-title { margin-bottom: 8px; }
  .field { margin-top: 8px; }
  .field-hint, .field-error { margin-top: 4px; }
  .advanced { margin-top: 10px; }
  .advanced summary { min-height: 38px; }
  .primary { margin-top: 10px; min-height: 46px; }
  .result-card { margin-top: 10px; }
  .result-main { padding: 10px 14px 6px; }
  .digit { height: clamp(40px, 6.8vh, 52px); }
  .digit b { font-size: clamp(20px, 3.4vh, 28px); }
  .timer { width: 74px; height: 74px; }
  .timer-value { font-size: 18px; }
  .next { height: 32px; }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
  }
  .reveal { opacity: 1; transform: none; }
}
`;

export const CLIENT_JS = `
const maxSecretLength = 256;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const hashName = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
const RING_CIRCUMFERENCE = 2 * Math.PI * 44; // must match r="44" on #ringFg
const CLOCK_SKEW_WARN_MS = 10000;
let clockSkewSeconds = 0;
let cachedSecret = "";
let cachedAlgorithm = "";
let cachedKey = null;
let currentLang = "zh";
let lastTokenText = "";
let lastTokenIdle = true;
let lastRemaining = -1;
const els = {
  secret: document.querySelector("#secret"),
  otpauth: document.querySelector("#otpauth"),
  digits: document.querySelector("#digits"),
  period: document.querySelector("#period"),
  algorithm: document.querySelector("#algorithm"),
  advanced: document.querySelector("#advanced"),
  token: document.querySelector("#token"),
  timer: document.querySelector("#timer"),
  timerCircle: document.querySelector("#timerCircle"),
  ringFg: document.querySelector("#ringFg"),
  next: document.querySelector("#next"),
  endpoint: document.querySelector("#endpoint"),
  jsonToken: document.querySelector("#jsonToken"),
  error: document.querySelector("#error"),
  secretError: document.querySelector("#secret-error"),
  status: document.querySelector("#status"),
  generate: document.querySelector("#generate"),
  copySecret: document.querySelector("#copySecret"),
  toggleSecret: document.querySelector("#toggleSecret"),
  copyOtpauth: document.querySelector("#copyOtpauth"),
  copyEndpoint: document.querySelector("#copyEndpoint"),
  copyJson: document.querySelector("#copyJson"),
  driftWarn: document.querySelector("#driftWarn"),
  driftWarnText: document.querySelector("#driftWarnText"),
  themeToggle: document.querySelector("#themeToggle"),
  handHour: document.querySelector("#handHour"),
  handMin: document.querySelector("#handMin"),
  handSec: document.querySelector("#handSec"),
  langButtons: document.querySelectorAll("[data-lang]")
};

const i18n = {
  zh: {
    pageTitle: "2FA Worker - 生成 TOTP 验证码",
    navLabel: "主导航",
    langLabel: "语言",
    heroBadge: "RFC 6238 标准 · 全球边缘网络",
    heroTitle: "即时生成 TOTP 验证码",
    heroDesc: "根据 TOTP 密钥计算 6 位 2FA 验证码。<br>通过快速 JSON API 进行自动化与集成。",
    panelTitle: "生成 TOTP 验证码",
    secretLabel: "TOTP 密钥",
    secretHelp: "支持 Base32 字符 A-Z 和 2-7；空格、连字符和末尾 = 会自动忽略。",
    secretPlaceholder: "粘贴 Base32 TOTP 密钥，或打开 /#/tok/YOUR_SECRET 自动填入",
    copySecret: "复制密钥",
    showSecret: "显示密钥",
    hideSecret: "隐藏密钥",
    otpauthLabel: "otpauth:// 链接（可选）",
    otpauthHelp: "粘贴后会自动填充密钥与高级选项。",
    otpauthPlaceholder: "otpauth://totp/Issuer:account?secret=YOUR_SECRET",
    copyOtpauth: "复制链接",
    advancedLabel: "高级选项",
    algorithmLabel: "哈希算法",
    digitsLabel: "验证码位数",
    periodLabel: "周期（秒）",
    generate: "生成验证码",
    tokenAria: "点击复制验证码",
    timerAria: "验证码剩余时间",
    seconds: "秒",
    remaining: "剩余",
    idle: "新代码将在 <b>--</b> 秒后生成",
    next: "新代码将在 <b>{remaining}</b> 秒后生成",
    apiTitle: "JSON API",
    apiDesc: "推荐使用 POST /api/totp 获取当前 TOTP 验证码。",
    endpointLabel: "接口地址",
    endpointPlaceholder: "输入密钥后自动生成 /tok/YOUR_SECRET",
    copyEndpoint: "复制接口",
    returnLabel: "返回结果（application/json）",
    copyJson: "复制 JSON",
    apiNote: "POST /api/totp 更适合自动化；URL secret 接口仅建议用于兼容旧工具或临时测试。",
    featureTotpTitle: "即时 TOTP 验证码",
    featureTotpText: "生成有效的 6 位数字验证码，实时倒计时确保使用时效性。",
    featureApiTitle: "JSON API",
    featureApiText: "简单、快速、轻量的 API 设计，适合自动化和集成。",
    featureCfTitle: "运行在 Cloudflare Workers",
    featureCfText: "全球边缘性能，构建速度快，可靠性高。",
    featureDbTitle: "无需数据库",
    featureDbText: "无状态设计，无需存储、无设置、无需维护。",
    warningTitle: "仅用于测试和自动化用途",
    warningText: "请勿公开泄露生产环境的密钥。您需要对密钥的安全性负责。",
    clockSkewWarn: "本机时钟与服务器相差约 {seconds} 秒，生成的验证码可能无效，请校准系统时间。",
    footerCopy: "<span class=\\"footer-line\\">© {year} 2FA Worker</span><span class=\\"footer-line\\">基于 <a href=\\"https://developers.cloudflare.com/workers/\\" rel=\\"noreferrer\\">Cloudflare Workers</a> 构建</span><span class=\\"footer-line\\">Web Crypto</span>",
    github: "GitHub",
    themeAuto: "主题：跟随系统",
    themeLight: "主题：浅色",
    themeDark: "主题：深色",
    normalizeMissing: "请输入 Secret",
    normalizeTooLong: "Secret 过长",
    normalizeTooShort: "Secret 太短，无法解码出有效密钥",
    normalizeInvalid: "Secret 只能包含 Base32 字符 A-Z 和 2-7",
    invalidUrlEncoding: "Secret URL 编码无效",
    invalidOtpAuth: "otpauth:// 链接格式无效",
    invalidPeriod: "Period 必须是 5 到 300 秒",
    copySuccess: "已复制到剪贴板",
    copyEmpty: "当前没有可复制的内容",
    copyFail: "复制失败，请手动选择内容",
    invalidFragment: "URL fragment 中的 Secret 编码无效"
  },
  en: {
    pageTitle: "2FA Worker - Generate TOTP codes",
    navLabel: "Primary navigation",
    langLabel: "Language",
    heroBadge: "RFC 6238 standard · Global edge network",
    heroTitle: "Generate TOTP codes instantly",
    heroDesc: "Calculate 6-digit 2FA codes from a TOTP secret.<br>Automate and integrate through a fast JSON API.",
    panelTitle: "Generate TOTP code",
    secretLabel: "TOTP secret",
    secretHelp: "Use Base32 characters A-Z and 2-7; spaces, hyphens, and trailing = are ignored.",
    secretPlaceholder: "Paste a Base32 TOTP secret, or open /#/tok/YOUR_SECRET to fill it",
    copySecret: "Copy secret",
    showSecret: "Show secret",
    hideSecret: "Hide secret",
    otpauthLabel: "otpauth:// link (optional)",
    otpauthHelp: "Pasting a link fills in the secret and advanced options automatically.",
    otpauthPlaceholder: "otpauth://totp/Issuer:account?secret=YOUR_SECRET",
    copyOtpauth: "Copy link",
    advancedLabel: "Advanced options",
    algorithmLabel: "Hash algorithm",
    digitsLabel: "Code digits",
    periodLabel: "Period (seconds)",
    generate: "Generate code",
    tokenAria: "Click to copy code",
    timerAria: "Code time remaining",
    seconds: "sec",
    remaining: "left",
    idle: "Next code will be generated in <b>--</b> seconds",
    next: "Next code will be generated in <b>{remaining}</b> seconds",
    apiTitle: "JSON API",
    apiDesc: "Use POST /api/totp for automated TOTP code retrieval.",
    endpointLabel: "Endpoint",
    endpointPlaceholder: "Generated after entering a secret: /tok/YOUR_SECRET",
    copyEndpoint: "Copy endpoint",
    returnLabel: "Response (application/json)",
    copyJson: "Copy JSON",
    apiNote: "POST /api/totp is preferred for automation; URL-secret endpoints are for compatibility or temporary testing only.",
    featureTotpTitle: "Instant TOTP code",
    featureTotpText: "Generate a valid 6-digit code with a live countdown for timing confidence.",
    featureApiTitle: "JSON API",
    featureApiText: "Simple, fast, lightweight API design for automation and integration.",
    featureCfTitle: "Runs on Cloudflare Workers",
    featureCfText: "Global edge performance with fast builds and high reliability.",
    featureDbTitle: "No database required",
    featureDbText: "Stateless by design: no storage, no setup, and no maintenance.",
    warningTitle: "For testing and automation only",
    warningText: "Do not expose production secrets publicly. You are responsible for keeping secrets safe.",
    clockSkewWarn: "Your device clock differs from the server by about {seconds} seconds; generated codes may be rejected. Please sync your system time.",
    footerCopy: "<span class=\\"footer-line\\">© {year} 2FA Worker</span><span class=\\"footer-line\\">Built on <a href=\\"https://developers.cloudflare.com/workers/\\" rel=\\"noreferrer\\">Cloudflare Workers</a></span><span class=\\"footer-line\\">Web Crypto</span>",
    github: "GitHub",
    themeAuto: "Theme: follow system",
    themeLight: "Theme: light",
    themeDark: "Theme: dark",
    normalizeMissing: "Please enter a Secret",
    normalizeTooLong: "Secret is too long",
    normalizeTooShort: "Secret is too short to decode into a key",
    normalizeInvalid: "Secret can only contain Base32 characters A-Z and 2-7",
    invalidUrlEncoding: "Secret URL encoding is invalid",
    invalidOtpAuth: "otpauth:// link format is invalid",
    invalidPeriod: "Period must be between 5 and 300 seconds",
    copySuccess: "Copied to clipboard",
    copyEmpty: "Nothing to copy yet",
    copyFail: "Copy failed. Please select the text manually.",
    invalidFragment: "Secret encoding in the URL fragment is invalid"
  }
};

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || i18n.zh[key] || key;
}

function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem("language");
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  const preferred = String(navigator.language || "").toLowerCase();
  if (!preferred) return "zh";
  return preferred.startsWith("zh") ? "zh" : "en";
}

function storedThemeMode() {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "auto";
}

function themeModeLabelKey(mode) {
  if (mode === "light") return "themeLight";
  if (mode === "dark") return "themeDark";
  return "themeAuto";
}

function updateThemeButton() {
  if (!els.themeToggle) return;
  const mode = storedThemeMode();
  const label = t(themeModeLabelKey(mode));
  els.themeToggle.dataset.mode = mode;
  els.themeToggle.title = label;
  els.themeToggle.setAttribute("aria-label", label);
}

function applyTheme() {
  const mode = storedThemeMode();
  const dark = mode === "auto" ? window.matchMedia("(prefers-color-scheme: dark)").matches : mode === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // Keep browser chrome (mobile address bar) in sync when the manual theme
  // disagrees with the OS preference the static meta tags were written for.
  const themeColor = dark ? "#070b16" : "#f4f8ff";
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", themeColor);
  }
  updateThemeButton();
}

function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(storedThemeMode()) + 1) % order.length];
  try {
    if (next === "auto") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", next);
    }
  } catch {}
  applyTheme();
}

function applyTranslations() {
  document.documentElement.lang = currentLang === "en" ? "en" : "zh-CN";
  document.title = t("pageTitle");
  const year = String(new Date().getFullYear());
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-html]")) {
    element.innerHTML = t(element.dataset.i18nHtml).replace("{year}", year);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll("[data-i18n-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel));
  }
  for (const element of document.querySelectorAll("[data-i18n-title]")) {
    const value = t(element.dataset.i18nTitle);
    element.title = value;
    element.setAttribute("aria-label", value);
  }
  for (const button of els.langButtons) {
    const active = button.dataset.lang === currentLang;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateThemeButton();
  updateDriftWarning();
}

// Both setters skip identical writes so the per-second tick cannot make
// assertive live regions re-announce the same message to screen readers.
function setFieldError(message = "") {
  if (els.secretError && els.secretError.textContent !== message) {
    els.secretError.textContent = message;
  }
}

/**
 * Action errors (copy failures, bad otpauth links, bad URL fragments) live in
 * #error but are NOT cleared by the per-second tick; they persist until the
 * user edits an input or the action succeeds. tick() only clears messages it
 * wrote itself (tracked via tickOwnsError).
 */
function setActionError(message = "") {
  if (els.error.textContent !== message) {
    els.error.textContent = message;
  }
}

function setLanguage(lang) {
  currentLang = lang === "en" ? "en" : "zh";
  try {
    localStorage.setItem("language", currentLang);
  } catch {}
  applyTranslations();
  tick();
}

function normalizeBase32(input) {
  let secret = String(input || "").trim();
  if (secret.includes("%")) {
    try {
      secret = decodeURIComponent(secret);
    } catch {
      throw new Error(t("invalidUrlEncoding"));
    }
  }
  secret = secret.replace(/[\\s-]/g, "").replace(/=+$/g, "").toUpperCase();
  if (!secret) throw new Error(t("normalizeMissing"));
  if (secret.length > maxSecretLength) throw new Error(t("normalizeTooLong"));
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error(t("normalizeInvalid"));
  return secret;
}

function applyOtpAuth() {
  setActionError("");
  const value = els.otpauth.value.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "otpauth:") return;
    const secret = url.searchParams.get("secret");
    if (!secret) return;
    els.secret.value = secret;
    const algorithm = String(url.searchParams.get("algorithm") || "").replace(/-/g, "").toUpperCase();
    if (algorithm === "SHA1" || algorithm === "SHA256" || algorithm === "SHA512") {
      els.algorithm.value = algorithm;
    }
    const digits = url.searchParams.get("digits");
    if (digits === "6" || digits === "7" || digits === "8") {
      els.digits.value = digits;
    }
    const period = Number(url.searchParams.get("period"));
    if (Number.isInteger(period) && period >= 5 && period <= 300) {
      els.period.value = String(period);
    }
    if (els.algorithm.value !== "SHA1" || els.digits.value !== "6" || els.period.value !== "30") {
      els.advanced.open = true;
    }
  } catch {
    setActionError(t("invalidOtpAuth"));
  }
}

function base32ToBytes(input) {
  const secret = normalizeBase32(input);
  let buffer = 0;
  let bitsLeft = 0;
  const out = [];
  for (const char of secret) {
    const value = alphabet.indexOf(char);
    buffer = (buffer << 5) | value;
    bitsLeft += 5;
    while (bitsLeft >= 8) {
      out.push((buffer >> (bitsLeft - 8)) & 255);
      bitsLeft -= 8;
    }
  }
  // Mirrors the server's empty-key guard in totp-core.ts; without it a
  // 1-character secret reaches importKey and surfaces a raw DataError.
  if (out.length === 0) throw new Error(t("normalizeTooShort"));
  return new Uint8Array(out);
}

function counterToBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

async function cryptoKeyFor(secret, algorithm) {
  if (cachedKey && cachedSecret === secret && cachedAlgorithm === algorithm) {
    return cachedKey;
  }
  cachedSecret = secret;
  cachedAlgorithm = algorithm;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    base32ToBytes(secret),
    { name: "HMAC", hash: { name: hashName[algorithm] } },
    false,
    ["sign"]
  );
  return cachedKey;
}

async function hotp(secret, counter, digits, algorithm) {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await cryptoKeyFor(secret, algorithm), counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 15;
  const binary =
    ((signature[offset] & 127) * 2 ** 24) +
    ((signature[offset + 1] & 255) << 16) +
    ((signature[offset + 2] & 255) << 8) +
    (signature[offset + 3] & 255);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function renderTokenCells(text, idle) {
  if (text === lastTokenText && idle === lastTokenIdle) return;
  const groupAt = text.length === 6 ? 3 : 4;
  let html = "";
  for (let i = 0; i < text.length; i += 1) {
    if (i === groupAt) html += '<span class="gap" aria-hidden="true"></span>';
    const changed = lastTokenIdle || lastTokenText.length !== text.length || lastTokenText[i] !== text[i];
    const roll = !idle && changed;
    html += '<span class="digit' + (idle ? " idle" : "") + (roll ? " roll" : "") + '"><b>' + text[i] + "</b></span>";
  }
  els.token.innerHTML = html;
  els.token.classList.toggle("many", text.length > 6);
  lastTokenText = text;
  lastTokenIdle = idle;
}

function resetRing(offset) {
  if (!els.ringFg) return;
  els.ringFg.classList.add("noanim");
  els.ringFg.style.strokeDashoffset = String(offset);
  void els.ringFg.getBoundingClientRect();
  els.ringFg.classList.remove("noanim");
}

// The ring animates toward the *next* second boundary with a 1s linear
// transition, so motion is continuous instead of stepping once per tick.
function setRing(remaining, period) {
  if (!els.ringFg) return;
  if (remaining > lastRemaining) {
    resetRing(RING_CIRCUMFERENCE * (1 - Math.min(1, remaining / period)));
  }
  const target = Math.max(0, Math.min(1, (remaining - 1) / period));
  els.ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - target));
  els.timerCircle.classList.toggle("warn", remaining <= 10 && remaining > 5);
  els.timerCircle.classList.toggle("danger", remaining <= 5);
  lastRemaining = remaining;
}

// Non-default advanced options must travel with the endpoint, otherwise the
// previewed URL would return a different code than the page shows.
function endpointUrl(secret, period, digits, algorithm) {
  const params = new URLSearchParams();
  if (algorithm !== "SHA1") params.set("algorithm", algorithm);
  if (digits !== 6) params.set("digits", String(digits));
  if (period !== 30) params.set("period", String(period));
  const query = params.toString();
  return location.origin + "/tok/" + secret + (query ? "?" + query : "");
}

function setIdle(message = t("idle")) {
  renderTokenCells("••••••", true);
  els.token.dataset.value = "";
  els.token.dataset.copyable = "false";
  els.token.setAttribute("aria-disabled", "true");
  els.timer.textContent = "--";
  resetRing(RING_CIRCUMFERENCE);
  els.timerCircle.classList.remove("warn");
  els.timerCircle.classList.remove("danger");
  els.timerCircle.setAttribute("aria-valuenow", "0");
  lastRemaining = -1;
  els.next.innerHTML = message;
  els.endpoint.value = "";
  els.jsonToken.textContent = "------";
}

let tickTimer = 0;
let tickGeneration = 0;
let tickOwnsError = false;

// Re-run just after the next wall-clock second so the countdown never
// visibly skips or lags the way a free-running setInterval does.
function scheduleTick() {
  window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(tick, 1015 - (Date.now() % 1000));
}

async function tick() {
  const generation = ++tickGeneration;
  try {
    if (tickOwnsError) {
      setActionError("");
      tickOwnsError = false;
    }
    if (!els.secret.value.trim()) {
      setIdle();
      return;
    }

    let secret;
    try {
      secret = normalizeBase32(els.secret.value);
      base32ToBytes(secret);
      setFieldError("");
    } catch (error) {
      setIdle();
      setFieldError(error.message || String(error));
      return;
    }

    const period = Number(els.period.value || 30);
    const digits = Number(els.digits.value || 6);
    const algorithm = els.algorithm.value;
    if (!Number.isInteger(period) || period < 5 || period > 300) {
      throw new Error(t("invalidPeriod"));
    }

    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / period);
    const remaining = period - (now % period);
    const progress = Math.round((remaining / period) * 100);
    const token = await hotp(secret, BigInt(counter), digits, algorithm);
    if (generation !== tickGeneration) return;
    renderTokenCells(token, false);
    els.token.dataset.value = token;
    els.token.dataset.copyable = "true";
    els.token.setAttribute("aria-disabled", "false");
    els.timer.textContent = String(remaining);
    setRing(remaining, period);
    els.timerCircle.setAttribute("aria-valuenow", String(progress));
    els.next.innerHTML = t("next").replace("{remaining}", String(remaining));
    els.endpoint.value = endpointUrl(secret, period, digits, algorithm);
    els.jsonToken.textContent = token;
  } catch (error) {
    if (generation !== tickGeneration) return;
    setIdle(t("idle"));
    setActionError(error.message || String(error));
    tickOwnsError = true;
  } finally {
    if (generation === tickGeneration) scheduleTick();
  }
}

function loadUrlSecret() {
  const match = location.hash.match(/^#\\/tok\\/([^?]+)/);
  if (!match) return;
  try {
    els.secret.value = normalizeBase32(match[1]);
  } catch {
    setActionError(t("invalidFragment"));
  } finally {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

/**
 * TOTP depends entirely on wall-clock agreement: a device clock off by more
 * than the period silently generates rejected codes. Compare the local clock
 * against the Date header of a same-origin /healthz response and show a
 * persistent warning when they disagree noticeably. Fails silent: offline
 * usage (local generation) must keep working.
 */
async function checkClockSkew() {
  try {
    const started = Date.now();
    const response = await fetch("/healthz", { cache: "no-store" });
    const dateHeader = response.headers.get("date");
    if (!dateHeader) return;
    const serverMs = new Date(dateHeader).getTime();
    if (!Number.isFinite(serverMs)) return;
    // +500ms: the Date header truncates to whole seconds; midpoint of the
    // request approximates when the server stamped it.
    const skewMs = serverMs + 500 - (started + Date.now()) / 2;
    if (Math.abs(skewMs) < CLOCK_SKEW_WARN_MS) return;
    clockSkewSeconds = Math.round(Math.abs(skewMs) / 1000);
    if (els.driftWarn) {
      els.driftWarn.hidden = false;
      updateDriftWarning();
    }
  } catch {}
}

function updateDriftWarning() {
  if (!els.driftWarn || els.driftWarn.hidden || !els.driftWarnText) return;
  els.driftWarnText.textContent = t("clockSkewWarn").replace("{seconds}", String(clockSkewSeconds));
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The hero dial is a working clock showing the visitor's local time; the
// second hand sweeps smoothly unless reduced motion is requested.
function updateClockHands() {
  if (!els.handHour) return;
  const now = new Date();
  const seconds = now.getSeconds() + (reduceMotion ? 0 : now.getMilliseconds() / 1000);
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  els.handSec.style.transform = "rotate(" + seconds * 6 + "deg)";
  els.handMin.style.transform = "rotate(" + minutes * 6 + "deg)";
  els.handHour.style.transform = "rotate(" + hours * 30 + "deg)";
}

function clockLoop() {
  if (!document.hidden) updateClockHands();
  window.setTimeout(clockLoop, reduceMotion ? 1000 : 120);
}

function flashCopied(element) {
  if (!element) return;
  element.classList.add("copied");
  window.setTimeout(() => element.classList.remove("copied"), 900);
}

// Fallback for browsers/contexts without the async clipboard API. The token
// digits render as separate cells, so "select it manually" is not an option.
function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  area.remove();
  return copied;
}

async function copyValue(value, trigger) {
  const text = String(value || "").trim();
  if (!text || text === "------") {
    els.status.textContent = t("copyEmpty");
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = legacyCopy(text);
  }
  if (copied) {
    flashCopied(trigger);
    setActionError("");
    els.status.textContent = t("copySuccess");
  } else {
    setActionError(t("copyFail"));
  }
}

for (const el of [els.secret, els.digits, els.period, els.algorithm]) {
  el.addEventListener("input", () => {
    setActionError("");
    setFieldError("");
    tick();
  });
  el.addEventListener("change", tick);
}
els.otpauth.addEventListener("input", () => {
  applyOtpAuth();
  tick();
});

// Background tabs throttle setTimeout chains (up to ~1/minute in Chrome), so
// the displayed code can be long expired when the user returns. Recompute
// immediately on tab focus.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

els.generate.addEventListener("click", () => {
  if (!els.secret.value.trim()) {
    setFieldError(t("normalizeMissing"));
    els.secret.focus();
    return;
  }
  tick();
});
els.copySecret.addEventListener("click", (event) => copyValue(els.secret.value, event.currentTarget));
els.toggleSecret.addEventListener("click", () => {
  const show = els.secret.type === "password";
  els.secret.type = show ? "text" : "password";
  els.toggleSecret.setAttribute("aria-pressed", String(show));
  els.toggleSecret.dataset.i18nTitle = show ? "hideSecret" : "showSecret";
  const label = t(show ? "hideSecret" : "showSecret");
  els.toggleSecret.title = label;
  els.toggleSecret.setAttribute("aria-label", label);
});
els.copyOtpauth.addEventListener("click", (event) => copyValue(els.otpauth.value, event.currentTarget));
els.copyEndpoint.addEventListener("click", (event) => copyValue(els.endpoint.value, event.currentTarget));
els.copyJson.addEventListener("click", (event) => {
  const token = els.jsonToken.textContent || "";
  copyValue(/^\\d{6,8}$/.test(token) ? '{ "token": "' + token + '" }' : "", event.currentTarget);
});
els.token.addEventListener("click", () => {
  const value = els.token.dataset.value || "";
  if (/^\\d{6,8}$/.test(value)) copyValue(value, els.token);
});
for (const button of els.langButtons) {
  button.addEventListener("click", () => setLanguage(button.dataset.lang));
}
if (els.themeToggle) {
  els.themeToggle.addEventListener("click", cycleTheme);
}
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
if (typeof systemTheme.addEventListener === "function") {
  systemTheme.addEventListener("change", () => {
    if (storedThemeMode() === "auto") applyTheme();
  });
}

if (els.ringFg) {
  els.ringFg.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
}
currentLang = detectInitialLanguage();
applyTheme();
loadUrlSecret();
applyTranslations();
clockLoop();
checkClockSkew();
tick();
`;

const SVG_COPY_ICON = `<svg class="ic ic-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/></svg><svg class="ic ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

const SVG_EYE_ICON = `<svg class="ic ic-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg><svg class="ic ic-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/><path d="m4.5 3.5 15 17"/></svg>`;

const SVG_CHEVRON = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>`;

const SVG_GITHUB = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.66.41.36.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>`;

// The dial is a real clock: #handHour/#handMin/#handSec are rotated by
// CLIENT_JS to the visitor's local (physical) time.
const SVG_HERO_ORBIT = `<svg class="hero-orbit" viewBox="0 0 520 520" fill="none" aria-hidden="true">
<defs>
<linearGradient id="gOrbit" x1="0" y1="0" x2="520" y2="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2f7dff"/><stop offset="1" stop-color="#8a6bff"/></linearGradient>
<radialGradient id="gLens" cx="0.5" cy="0.4" r="0.78"><stop offset="0" stop-color="#8fc0ff" stop-opacity=".96"/><stop offset=".55" stop-color="#3f86ff" stop-opacity=".84"/><stop offset="1" stop-color="#7a5af8" stop-opacity=".58"/></radialGradient>
</defs>
<g class="orbit orbit-a">
<circle cx="260" cy="260" r="238" stroke="url(#gOrbit)" stroke-opacity=".34" stroke-width="1.5" stroke-dasharray="3 14"/>
<circle cx="498" cy="260" r="7" fill="url(#gOrbit)"/>
<circle cx="498" cy="260" r="13" stroke="url(#gOrbit)" stroke-opacity=".4"/>
</g>
<g class="orbit orbit-b">
<circle cx="260" cy="260" r="192" stroke="url(#gOrbit)" stroke-opacity=".3" stroke-width="1.2" stroke-dasharray="2 10"/>
<circle cx="260" cy="68" r="5" fill="#2dd4bf"/>
</g>
<g class="orbit orbit-c">
<circle cx="260" cy="260" r="158" stroke="url(#gOrbit)" stroke-opacity=".38" stroke-width="1"/>
<circle cx="102" cy="260" r="4" fill="#9b8cff"/>
</g>
<circle cx="260" cy="260" r="132" stroke="url(#gOrbit)" stroke-opacity=".42" stroke-width="9" stroke-dasharray="1.5 12.32"/>
<circle cx="60" cy="122" r="3" fill="url(#gOrbit)" fill-opacity=".7"/>
<circle cx="468" cy="418" r="2.5" fill="url(#gOrbit)" fill-opacity=".6"/>
<circle cx="260" cy="260" r="112" fill="url(#gLens)"/>
<circle cx="260" cy="260" r="112" stroke="url(#gOrbit)" stroke-opacity=".55" stroke-width="1.5"/>
<g stroke="#ffffff" stroke-opacity=".7" stroke-width="3.5" stroke-linecap="round">
<line x1="260" y1="158" x2="260" y2="172"/>
<line x1="362" y1="260" x2="348" y2="260"/>
<line x1="260" y1="362" x2="260" y2="348"/>
<line x1="158" y1="260" x2="172" y2="260"/>
</g>
<g stroke="#ffffff" stroke-opacity=".4" stroke-width="2" stroke-linecap="round">
<line x1="311" y1="171.7" x2="304" y2="183.8"/>
<line x1="348.3" y1="209" x2="336.2" y2="216"/>
<line x1="348.3" y1="311" x2="336.2" y2="304"/>
<line x1="311" y1="348.3" x2="304" y2="336.2"/>
<line x1="209" y1="348.3" x2="216" y2="336.2"/>
<line x1="171.7" y1="311" x2="183.8" y2="304"/>
<line x1="171.7" y1="209" x2="183.8" y2="216"/>
<line x1="209" y1="171.7" x2="216" y2="183.8"/>
</g>
<line id="handHour" class="hand" x1="260" y1="260" x2="260" y2="204" stroke="#ffffff" stroke-opacity=".95" stroke-width="6" stroke-linecap="round"/>
<line id="handMin" class="hand" x1="260" y1="260" x2="260" y2="176" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
<line id="handSec" class="hand" x1="260" y1="274" x2="260" y2="164" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>
<circle cx="260" cy="260" r="6.5" fill="#ffffff"/>
<circle cx="260" cy="260" r="2.6" fill="#1f6fe8"/>
</svg>`;

const IDLE_TOKEN_CELLS = `<span class="digit idle"><b>•</b></span><span class="digit idle"><b>•</b></span><span class="digit idle"><b>•</b></span><span class="gap" aria-hidden="true"></span><span class="digit idle"><b>•</b></span><span class="digit idle"><b>•</b></span><span class="digit idle"><b>•</b></span>`;

// Built once at module load; "__NONCE__" marks where the per-request CSP
// nonce goes, so each request only pays for a cheap join().
const PAGE_HTML = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>2FA Worker - 生成 TOTP 验证码</title>
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f8ff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#070b16">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
<link rel="shortcut icon" type="image/png" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon.png">
<script nonce="__NONCE__">(function () { var stored = null; try { stored = localStorage.getItem("theme"); } catch (error) {} var dark = stored === "dark" || (stored !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; })();</script>
<style nonce="__NONCE__">${PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="topbar">
    <div class="shell topbar-inner">
      <a class="brand" href="/">
        <svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="gBrand" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2f7dff"/><stop offset="1" stop-color="#7a5af8"/></linearGradient></defs><path d="M24 3 41 9.5v12.2c0 10.4-6.8 17.6-17 21.3C13.8 39.3 7 32.1 7 21.7V9.5Z" fill="url(#gBrand)"/><circle cx="24" cy="22" r="10" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="2.4"/><path d="M24 16v6l4.2 2.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span><strong>2FA</strong> Worker</span>
      </a>
      <nav class="nav" aria-label="主导航" data-i18n-label="navLabel">
        <span class="lang" aria-label="语言" data-i18n-label="langLabel"><button class="active" type="button" data-lang="zh" aria-pressed="true">中文</button><button type="button" data-lang="en" aria-pressed="false">EN</button></span>
        <button id="themeToggle" class="theme-toggle" type="button" data-mode="auto" aria-label="主题：跟随系统" title="主题：跟随系统"><svg class="ti ti-auto" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="currentColor"/></svg><svg class="ti ti-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg><svg class="ti ti-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 13.4A8.4 8.4 0 0 1 10.6 3.6a8.4 8.4 0 1 0 9.8 9.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>
        <a class="github" href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">${SVG_GITHUB}<span data-i18n="github">GitHub</span></a>
      </nav>
    </div>
  </header>

  <main class="shell">
    <section class="lead">
      <div class="hero-copy">
        <span class="hero-badge reveal"><i class="pulse-dot" aria-hidden="true"></i><span data-i18n="heroBadge">RFC 6238 标准 · 全球边缘网络</span></span>
        <h1 class="reveal d1" data-i18n="heroTitle">即时生成 TOTP 验证码</h1>
        <p class="reveal d2" data-i18n-html="heroDesc">根据 TOTP 密钥计算 6 位 2FA 验证码。<br>通过快速 JSON API 进行自动化与集成。</p>
        <div class="hero-art reveal d2" aria-hidden="true">${SVG_HERO_ORBIT}</div>
      </div>

      <section class="panel reveal d3">
        <div class="panel-title"><span class="panel-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14.5" r="3.5"/><path d="m10.8 12 8.7-8.7"/><path d="m15.5 7.5 2.6 2.6"/><path d="m12.8 10.2 1.8 1.8"/></svg></span><span data-i18n="panelTitle">生成 TOTP 验证码</span><span class="panel-tag" aria-hidden="true">RFC 6238</span></div>
        <div id="driftWarn" class="drift-warn" role="status" hidden><span class="note-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3 1.8"/></svg></span><span id="driftWarnText"></span></div>
        <div class="field">
          <label for="secret"><span data-i18n="secretLabel">TOTP 密钥</span></label>
          <div class="input-wrap dual"><input id="secret" autocomplete="off" spellcheck="false" value="" aria-describedby="secret-help secret-error" type="password" placeholder="粘贴 Base32 TOTP 密钥，或打开 /#/tok/YOUR_SECRET 自动填入" data-i18n-placeholder="secretPlaceholder"><button id="toggleSecret" class="icon-button reveal-toggle" type="button" aria-pressed="false" aria-label="显示密钥" title="显示密钥" data-i18n-title="showSecret">${SVG_EYE_ICON}</button><button id="copySecret" class="icon-button" type="button" aria-label="复制密钥" title="复制密钥" data-i18n-title="copySecret">${SVG_COPY_ICON}</button></div>
          <p id="secret-help" class="field-hint" data-i18n="secretHelp">支持 Base32 字符 A-Z 和 2-7；空格、连字符和末尾 = 会自动忽略。</p>
          <p id="secret-error" class="field-error" role="alert" aria-live="assertive"></p>
        </div>
        <div class="field">
          <label for="otpauth"><span data-i18n="otpauthLabel">otpauth:// 链接（可选）</span></label>
          <div class="input-wrap"><input id="otpauth" autocomplete="off" spellcheck="false" placeholder="otpauth://totp/Issuer:account?secret=YOUR_SECRET" data-i18n-placeholder="otpauthPlaceholder"><button id="copyOtpauth" class="icon-button" type="button" aria-label="复制链接" title="复制链接" data-i18n-title="copyOtpauth">${SVG_COPY_ICON}</button></div>
          <p class="field-hint" data-i18n="otpauthHelp">粘贴后会自动填充密钥与高级选项。</p>
        </div>
        <details id="advanced" class="advanced">
          <summary><span data-i18n="advancedLabel">高级选项</span>${SVG_CHEVRON}</summary>
          <div class="advanced-grid">
            <label class="advanced-field"><span data-i18n="algorithmLabel">哈希算法</span><span class="select-wrap"><select id="algorithm">
              <option value="SHA1" selected>SHA1</option>
              <option value="SHA256">SHA256</option>
              <option value="SHA512">SHA512</option>
            </select>${SVG_CHEVRON}</span></label>
            <label class="advanced-field"><span data-i18n="digitsLabel">验证码位数</span><span class="select-wrap"><select id="digits">
              <option value="6" selected>6</option>
              <option value="7">7</option>
              <option value="8">8</option>
            </select>${SVG_CHEVRON}</span></label>
            <label class="advanced-field"><span data-i18n="periodLabel">周期（秒）</span><input id="period" type="number" inputmode="numeric" min="5" max="300" step="1" value="30"></label>
          </div>
        </details>
        <button id="generate" class="primary" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2.5 5.5 13H11l-1 8.5L17.5 11H12Z"/></svg><span data-i18n="generate">生成验证码</span></button>
        <div class="result-card">
          <div class="result-main">
            <button id="token" class="token" type="button" aria-live="polite" aria-label="点击复制验证码" title="点击复制验证码" data-i18n-title="tokenAria" data-copyable="false" data-value="" aria-disabled="true">${IDLE_TOKEN_CELLS}</button>
            <div id="timerCircle" class="timer" role="progressbar" aria-label="验证码剩余时间" data-i18n-label="timerAria" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="44"/><circle id="ringFg" class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="276.46"/></svg>
              <div class="timer-inner"><b id="timer" class="timer-value">--</b><span class="timer-labels"><span data-i18n="seconds">秒</span><span data-i18n="remaining">剩余</span></span></div>
            </div>
          </div>
          <div id="next" class="next" data-i18n-html="idle">新代码将在 <b>--</b> 秒后生成</div>
        </div>
        <p id="error" class="error" role="alert" aria-live="assertive"></p>
        <p id="status" class="sr-only" aria-live="polite" aria-atomic="true"></p>
      </section>

      <div class="scroll-cue" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9.5 6 6 6-6"/></svg></div>
    </section>

    <section class="lower-grid">
      <section id="api" class="panel panel-api reveal d4">
        <div class="panel-title"><span class="panel-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 9-3.5 3 3.5 3"/><path d="m15.5 9 3.5 3-3.5 3"/><path d="M13 7.5 11 16.5"/></svg></span><span data-i18n="apiTitle">JSON API</span><span class="panel-chips" aria-hidden="true"><span class="chip">GET</span><span class="chip chip-post">POST</span></span></div>
        <p class="api-desc" data-i18n="apiDesc">推荐使用 POST /api/totp 获取当前 TOTP 验证码。</p>
        <div class="field">
          <label for="endpoint" data-i18n="endpointLabel">接口地址</label>
          <div class="input-wrap"><input id="endpoint" readonly value="" placeholder="输入密钥后自动生成 /tok/YOUR_SECRET" data-i18n-placeholder="endpointPlaceholder"><button id="copyEndpoint" class="icon-button" type="button" aria-label="复制接口" title="复制接口" data-i18n-title="copyEndpoint">${SVG_COPY_ICON}</button></div>
        </div>
        <div class="field">
          <label><span class="label-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5c-2 0-2.5 1-2.5 2.5v2c0 1.5-.7 2.3-2 3 1.3.7 2 1.5 2 3v2c0 1.5.5 2.5 2.5 2.5"/><path d="M15 4.5c2 0 2.5 1 2.5 2.5v2c0 1.5.7 2.3 2 3-1.3.7-2 1.5-2 3v2c0 1.5-.5 2.5-2.5 2.5"/></svg></span><span data-i18n="returnLabel">返回结果（application/json）</span></label>
          <div class="code-box">
            <div class="code-head"><span class="code-dot d-r" aria-hidden="true"></span><span class="code-dot d-y" aria-hidden="true"></span><span class="code-dot d-g" aria-hidden="true"></span><span class="code-lang" aria-hidden="true">application/json</span><button id="copyJson" class="icon-button inline" type="button" aria-label="复制 JSON" title="复制 JSON" data-i18n-title="copyJson">${SVG_COPY_ICON}</button></div>
            <div class="code-body">
              <div class="code-line"><span>1</span><span>{</span></div>
              <div class="code-line"><span>2</span><span>&nbsp;&nbsp;"<span class="code-key">token</span>": "<span id="jsonToken" class="green">------</span>"</span></div>
              <div class="code-line"><span>3</span><span>}</span></div>
            </div>
          </div>
        </div>
        <div class="api-note-box"><span class="note-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 11v5"/><path d="M12 7.6v.2"/></svg></span><span data-i18n="apiNote">POST /api/totp 更适合自动化；URL secret 接口仅建议用于兼容旧工具或临时测试。</span></div>
      </section>

      <section class="feature-grid" id="guide">
      <div class="feature reveal d4"><span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 19.5 5v6c0 4.8-3.2 8.2-7.5 9.5C7.7 19.2 4.5 15.8 4.5 11V5Z"/><circle cx="12" cy="11" r="4.2"/><path d="M12 8.8V11l1.6 1"/></svg></span><div><h3 data-i18n="featureTotpTitle">即时 TOTP 验证码</h3><p data-i18n="featureTotpText">生成有效的 6 位数字验证码，实时倒计时确保使用时效性。</p></div></div>
      <div class="feature f-teal reveal d4"><span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 9-3.5 3 3.5 3"/><path d="m15.5 9 3.5 3-3.5 3"/><path d="M13 7.5 11 16.5"/></svg></span><div><h3 data-i18n="featureApiTitle">JSON API</h3><p data-i18n="featureApiText">简单、快速、轻量的 API 设计，适合自动化和集成。</p></div></div>
      <div class="feature f-orange reveal d5"><span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.7 11a3.8 3.8 0 0 1-.9 7.5Z"/><path d="m12.5 11.5-2 3h3l-2 3"/></svg></span><div><h3 data-i18n="featureCfTitle">运行在 Cloudflare Workers</h3><p data-i18n="featureCfText">全球边缘性能，构建速度快，可靠性高。</p></div></div>
      <div class="feature f-violet reveal d5"><span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/></svg></span><div><h3 data-i18n="featureDbTitle">无需数据库</h3><p data-i18n="featureDbText">无状态设计，无需存储、无设置、无需维护。</p></div></div>
      </section>
    </section>

    <section id="security" class="warning">
      <span class="warning-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20.2H2Z"/><path d="M12 9.5V15"/><path d="M12 17.4v.2"/></svg></span>
      <div><strong data-i18n="warningTitle">仅用于测试和自动化用途</strong><span data-i18n="warningText">请勿公开泄露生产环境的密钥。您需要对密钥的安全性负责。</span></div>
    </section>

    <footer class="footer">
      <div class="footer-copy" data-i18n-html="footerCopy"><span class="footer-line">© ${COPYRIGHT_YEAR} 2FA Worker</span><span class="footer-line">基于 <a href="https://developers.cloudflare.com/workers/" rel="noreferrer">Cloudflare Workers</a> 构建</span><span class="footer-line">Web Crypto</span></div>
      <div class="footer-links"><a href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" data-i18n="github">GitHub</a></div>
    </footer>
  </main>
</div>
<script nonce="__NONCE__">${CLIENT_JS}</script>
</body>
</html>`;
const PAGE_HTML_SEGMENTS = PAGE_HTML.split("__NONCE__");

export function homeHtml(scriptNonce: string): string {
  return PAGE_HTML_SEGMENTS.join(scriptNonce);
}
