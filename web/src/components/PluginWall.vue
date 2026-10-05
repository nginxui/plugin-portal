<script setup lang="ts">
import logo from '@/assets/logo.svg'

// A wall of plugin tiles drifting past, columns in turns up and down, with
// the Nginx UI logo glowing in the middle. Decoration only.

// Enough columns and rows to cover the area even while a column moves:
// each copy of a column must be taller than the tilted area.
// quiet: how far around the logo the tiles fade, in logo sizes.
const props = withDefaults(defineProps<{ columns?: number, rows?: number, mark?: number, quiet?: number }>(), { columns: 5, rows: 7, mark: 132, quiet: 3 })

// What plugins add to Nginx UI, each in a tone of its own.
const TILES = [
  { icon: 'i-tabler-certificate', tone: 'blue' },
  { icon: 'i-tabler-world-www', tone: 'cyan' },
  { icon: 'i-tabler-shield-lock', tone: 'green' },
  { icon: 'i-tabler-chart-line', tone: 'purple' },
  { icon: 'i-tabler-bell', tone: 'orange' },
  { icon: 'i-tabler-robot', tone: 'magenta' },
  { icon: 'i-tabler-database', tone: 'blue' },
  { icon: 'i-tabler-ban', tone: 'red' },
  { icon: 'i-tabler-radar', tone: 'cyan' },
  { icon: 'i-tabler-file-analytics', tone: 'green' },
  { icon: 'i-tabler-template', tone: 'purple' },
  { icon: 'i-tabler-language', tone: 'orange' },
  { icon: 'i-tabler-heartbeat', tone: 'red' },
  { icon: 'i-tabler-cloud-upload', tone: 'blue' },
  { icon: 'i-tabler-plug', tone: 'magenta' },
]

// Each column starts elsewhere in the list and moves at its own pace; the
// tiles repeat once so the loop has no seam.
const wall = Array.from({ length: props.columns }, (_, column) => {
  const tiles = Array.from({ length: props.rows }, (_, row) => TILES[(column * 4 + row * 2) % TILES.length])
  return { tiles: [...tiles, ...tiles], up: column % 2 === 0, seconds: 34 + (column % 3) * 9 }
})
</script>

<template>
  <div class="wall" aria-hidden="true" :style="{ '--mark': `${props.mark}px`, '--quiet': props.quiet }">
    <div class="field">
      <div class="tilt">
        <div v-for="(column, index) in wall" :key="index" class="column">
          <div class="track" :class="column.up ? 'up' : 'down'" :style="{ animationDuration: `${column.seconds}s` }">
            <span v-for="(tile, row) in column.tiles" :key="row" class="tile" :class="tile.tone">
              <span :class="tile.icon" />
            </span>
          </div>
        </div>
      </div>
    </div>
    <div class="center">
      <span class="glow" />
      <span class="mark"><img :src="logo" alt=""></span>
    </div>
  </div>
</template>

<style scoped>
.wall {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

/* The tiles stay quiet: faint, and gone around the logo so it leads. */
.field {
  position: absolute;
  inset: 0;
  opacity: 0.85;
  mask-image: radial-gradient(circle at 50% 50%, transparent calc(var(--mark) * 0.7), rgba(0, 0, 0, 0.4) calc(var(--mark) * var(--quiet) * 0.5), #000 calc(var(--mark) * var(--quiet)));
}

.tilt {
  position: absolute;
  inset: -30% -20%;
  display: flex;
  justify-content: center;
  gap: 18px;
  transform: rotate(-12deg);
}

.column {
  flex: none;
}

.track {
  display: flex;
  flex-direction: column;
  gap: 18px;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.track.up {
  animation-name: wall-up;
}

.track.down {
  animation-name: wall-down;
}

/* The tiles repeat once, so half the track brings the first tile back. */
@keyframes wall-up {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(calc(-50% - 9px));
  }
}

@keyframes wall-down {
  from {
    transform: translateY(calc(-50% - 9px));
  }

  to {
    transform: translateY(0);
  }
}

.tile {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  font-size: 30px;
  border-radius: 20px;
  background: color-mix(in srgb, currentColor 9%, var(--portal-card));
  filter: var(--portal-wall-filter);
}

.tile > span {
  opacity: 0.55;
}

.tile.blue {
  color: #1677ff;
}

.tile.cyan {
  color: #13a8a8;
}

.tile.green {
  color: #389e0d;
}

.tile.purple {
  color: #722ed1;
}

.tile.orange {
  color: #d46b08;
}

.tile.magenta {
  color: #c41d7f;
}

.tile.red {
  color: #cf1322;
}

.center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.mark {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--mark);
  height: var(--mark);
  grid-area: 1 / 1;
}

/* The logo is its own rounded white tile, so it fills the mark. */
.mark img {
  width: 100%;
  height: 100%;
  filter:
    drop-shadow(0 18px 32px rgba(22, 119, 255, 0.28))
    drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
}

.glow {
  width: var(--mark);
  height: var(--mark);
  border-radius: calc(var(--mark) * 0.3);
  background: #1677ff;
  opacity: 0.35;
  filter: blur(calc(var(--mark) * 0.2));
  grid-area: 1 / 1;
  animation: glow 3.6s ease-in-out infinite;
}

@keyframes glow {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.25;
  }

  50% {
    transform: scale(1.6);
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .track.up,
  .track.down,
  .glow {
    animation: none;
  }
}
</style>
