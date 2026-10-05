<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, useTemplateRef } from 'vue'
import logo from '@/assets/logo.svg'

// A wall of plugin tiles drifting past, columns in turns up and down, with
// the Nginx UI logo glowing in the middle. Decoration only.

// Enough columns and rows to cover the area even while a column moves:
// each copy of a column must be taller than the tilted area.
// quiet: how far around the logo the tiles fade, in logo sizes; fade: the
// bottom edge melts into the background, for a sheet that rises over it;
// covered: how much of the bottom that sheet hides, so the logo centers in
// what stays visible.
const props = withDefaults(defineProps<{ columns?: number, rows?: number, mark?: number, quiet?: number, fade?: boolean, covered?: number }>(), { columns: 5, rows: 7, mark: 132, quiet: 3, fade: false, covered: 0 })

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

// The logo takes its size, or less on a short wall, so it always fits.
const root = useTemplateRef<HTMLElement>('root')
const { height } = useElementSize(root)
const markSize = computed(() => Math.round(Math.min(props.mark, ((height.value || props.mark * 2) - props.covered) * 0.56)))

// Each column starts elsewhere in the list and moves at its own pace; the
// tiles repeat once so the loop has no seam.
const wall = Array.from({ length: props.columns }, (_, column) => {
  const tiles = Array.from({ length: props.rows }, (_, row) => TILES[(column * 4 + row * 2) % TILES.length])
  return { tiles: [...tiles, ...tiles], up: column % 2 === 0, seconds: 34 + (column % 3) * 9 }
})
</script>

<template>
  <div ref="root" class="wall" aria-hidden="true" :style="{ '--mark': `${markSize}px`, '--quiet': props.quiet, '--covered': `${props.covered}px` }">
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
    <div class="veil" />
    <div v-if="props.fade" class="fade" />
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
  background: var(--portal-wall-bg);
}

/* Only the tracks move; everything above them is painted once, so a frame
   only shifts layers. Masks or filters over the tracks would redraw them. */
.field {
  position: absolute;
  inset: 0;
}

/* The tiles stay quiet: gone around the logo so it leads. */
.veil {
  position: absolute;
  inset: 0 0 var(--covered);
  pointer-events: none;
  background: radial-gradient(circle at 50% 50%, var(--portal-wall-bg) calc(var(--mark) * 0.7), color-mix(in srgb, var(--portal-wall-bg) 60%, transparent) calc(var(--mark) * var(--quiet) * 0.5), transparent calc(var(--mark) * var(--quiet)));
}

.fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent 60%, var(--portal-wall-bg) calc(100% - var(--covered)));
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
  will-change: transform;
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
  background: color-mix(in srgb, currentColor 8%, var(--portal-wall-bg));
}

.tile > span {
  opacity: 0.5;
}

.tile.blue {
  color: var(--portal-wall-blue);
}

.tile.cyan {
  color: var(--portal-wall-cyan);
}

.tile.green {
  color: var(--portal-wall-green);
}

.tile.purple {
  color: var(--portal-wall-purple);
}

.tile.orange {
  color: var(--portal-wall-orange);
}

.tile.magenta {
  color: var(--portal-wall-magenta);
}

.tile.red {
  color: var(--portal-wall-red);
}

.center {
  position: absolute;
  inset: 0 0 var(--covered);
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
  width: calc(var(--mark) * 2);
  height: calc(var(--mark) * 2);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(22, 119, 255, 0.55) 0, rgba(22, 119, 255, 0.18) 38%, transparent 68%);
  grid-area: 1 / 1;
  will-change: transform, opacity;
  animation: glow 3.6s ease-in-out infinite;
}

@keyframes glow {
  0%,
  100% {
    transform: scale(0.8);
    opacity: 0.55;
  }

  50% {
    transform: scale(1.1);
    opacity: 1;
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
