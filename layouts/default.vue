<template>
  <div class="app-shell">
    <div class="aurora-layer" aria-hidden="true"></div>
    <div class="grid-layer" aria-hidden="true"></div>
    <div class="sheen-layer" aria-hidden="true"></div>
    <main class="content-wrapper">
      <NuxtPage />
    </main>
  </div>
</template>

<style>
:root {
  --nh-bg-deep: oklch(15% 0.045 265);
  --nh-bg-ink: oklch(10% 0.035 255);
  --nh-cyan: oklch(83% 0.145 205);
  --nh-violet: oklch(72% 0.18 300);
  --nh-lime: oklch(82% 0.17 142);
  --nh-amber: oklch(82% 0.16 78);
  --nh-rose: oklch(69% 0.19 25);
  --nh-text: oklch(97% 0.018 240);
  --nh-muted: oklch(83% 0.035 245);
  --nh-glass: oklch(98% 0.018 240 / 0.14);
  --nh-glass-strong: oklch(98% 0.018 240 / 0.22);
  --nh-glass-border: oklch(100% 0.02 235 / 0.34);
  --nh-glass-line: oklch(100% 0 0 / 0.16);
  --nh-shadow: 0 24px 80px oklch(5% 0.035 265 / 0.45);
  --nh-radius: 8px;
  --nh-font-body: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Avenir Next", sans-serif;
  --nh-font-display: "Avenir Next", "SF Pro Display", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --nh-font-quiet: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}

html,
body,
#__nuxt {
  min-height: 100%;
  margin: 0;
}

body {
  color: var(--nh-text);
  background: var(--nh-bg-ink);
  font-family: var(--nh-font-body);
  font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

.app-shell {
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 14% 16%, oklch(72% 0.18 300 / 0.34), transparent 30rem),
    radial-gradient(circle at 84% 12%, oklch(82% 0.145 205 / 0.30), transparent 29rem),
    radial-gradient(circle at 65% 90%, oklch(82% 0.17 142 / 0.20), transparent 24rem),
    linear-gradient(135deg, oklch(13% 0.055 260), oklch(20% 0.085 300) 36%, oklch(16% 0.075 212) 72%, oklch(10% 0.045 250));
}

.aurora-layer,
.grid-layer,
.sheen-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.aurora-layer {
  z-index: 0;
  opacity: 0.9;
  background:
    conic-gradient(from 115deg at 50% 45%, transparent, oklch(82% 0.145 205 / 0.20), transparent, oklch(72% 0.18 300 / 0.24), transparent),
    linear-gradient(110deg, transparent 0 18%, oklch(100% 0 0 / 0.05) 21%, transparent 25% 100%);
  filter: blur(28px) saturate(1.18);
  animation: aurora-drift 18s ease-in-out infinite alternate;
}

.grid-layer {
  z-index: 1;
  opacity: 0.24;
  background-image:
    linear-gradient(oklch(100% 0 0 / 0.10) 1px, transparent 1px),
    linear-gradient(90deg, oklch(100% 0 0 / 0.08) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: linear-gradient(to bottom, transparent, black 18%, black 80%, transparent);
}

.sheen-layer {
  z-index: 2;
  opacity: 0.13;
  background:
    repeating-linear-gradient(115deg, oklch(100% 0 0 / 0.12) 0 1px, transparent 1px 16px);
  animation: scan-sheen 11s linear infinite;
}

.content-wrapper {
  position: relative;
  z-index: 3;
  min-height: 100vh;
}

.glass-panel {
  background:
    linear-gradient(145deg, oklch(100% 0 0 / 0.18), oklch(82% 0.075 235 / 0.07)),
    var(--nh-glass);
  border: 1px solid var(--nh-glass-border);
  border-radius: var(--nh-radius);
  box-shadow: var(--nh-shadow), inset 0 1px 0 oklch(100% 0 0 / 0.36);
  backdrop-filter: blur(22px) saturate(1.38);
  -webkit-backdrop-filter: blur(22px) saturate(1.38);
}

.glass-field {
  background: oklch(100% 0 0 / 0.14);
  border: 1px solid oklch(100% 0 0 / 0.24);
  border-radius: var(--nh-radius);
  color: var(--nh-text);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.20);
}

.glass-field::placeholder {
  color: oklch(82% 0.04 245 / 0.72);
}

.glass-field:focus {
  outline: none;
  border-color: oklch(83% 0.145 205 / 0.82);
  box-shadow:
    0 0 0 3px oklch(83% 0.145 205 / 0.18),
    inset 0 1px 0 oklch(100% 0 0 / 0.24);
}

.neon-button {
  border-radius: var(--nh-radius);
  background:
    linear-gradient(135deg, oklch(83% 0.145 205), oklch(72% 0.18 300));
  color: oklch(12% 0.04 260);
  box-shadow:
    0 10px 34px oklch(72% 0.18 300 / 0.30),
    inset 0 1px 0 oklch(100% 0 0 / 0.42);
}

.neon-button:hover:not(:disabled) {
  filter: brightness(1.08) saturate(1.08);
  transform: translateY(-1px);
}

.neon-button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
  box-shadow: none;
}

@keyframes aurora-drift {
  0% { transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1); }
  100% { transform: translate3d(2%, 1%, 0) rotate(6deg) scale(1.04); }
}

@keyframes scan-sheen {
  0% { background-position: 0 0; }
  100% { background-position: 220px 0; }
}
</style>
