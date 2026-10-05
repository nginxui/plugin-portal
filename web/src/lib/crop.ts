import type { CSSProperties } from 'vue'

// The part of a screenshot that lists show, as shares of the image's width
// and height from its top left corner. Opening the screenshot shows it whole.

export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

interface Shot {
  crop?: Crop
  dark_crop?: Crop
}

/** The crop of the image shown: the dark one's, or the light one's when it has none. */
export function cropOf(shot: Shot, dark: boolean): Crop | undefined {
  return dark ? shot.dark_crop ?? shot.crop : shot.crop
}

/**
 * Semantic styles for an AImage: base styles as they are, or with a crop a
 * 16:10 frame that shows only that part of the image.
 */
export function croppedStyles(crop: Crop | undefined, base: { root: CSSProperties, image: CSSProperties }) {
  if (!crop)
    return base
  const { width: _w, height: _h, objectFit: _f, aspectRatio, ...frame } = base.image
  return {
    root: { ...base.root, ...frame, position: 'relative', aspectRatio: aspectRatio ?? '16 / 10', overflow: 'hidden', boxSizing: 'border-box' },
    image: {
      position: 'absolute',
      display: 'block',
      maxWidth: 'none',
      width: `${100 / crop.width}%`,
      height: `${100 / crop.height}%`,
      left: `${-crop.x / crop.width * 100}%`,
      top: `${-crop.y / crop.height * 100}%`,
    },
  } as { root: CSSProperties, image: CSSProperties }
}

interface Image extends Shot {
  path: string
  dark_path?: string
}

/** Whether a screenshot shows a different image: another file or another part of it. */
export function imageChanged(a: Image, b: Image): boolean {
  const same = (x?: Crop, y?: Crop) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)
  return a.path !== b.path || (a.dark_path ?? '') !== (b.dark_path ?? '') || !same(a.crop, b.crop) || !same(a.dark_crop, b.dark_crop)
}
