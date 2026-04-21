import { renderItem } from "../../index.js"
import fs from "node:fs"
import sharp from "sharp"
import locations from "./locations.json" with { type: "json" }

const assets = `${import.meta.dirname}/pack`
const rendersDir = `${import.meta.dirname}/renders`
const realDir = `${import.meta.dirname}/real`

fs.mkdirSync(rendersDir, { recursive: true })

const tests = [
  ["cube_side",          "light_test_cube_side",          locations.cube],
  ["cube_front",         "light_test_cube_front",         locations.cube],
  ["cube_display_side",  "light_test_cube_display_side",  locations.cube_display],
  ["cube_display_front", "light_test_cube_display_front", locations.cube_display],
  ["side",               "light_test_side",               locations.sphere],
  ["front",              "light_test_front",              locations.sphere],
]

for (const [igFile, itemId, points] of tests) {
  const renderPath = `${rendersDir}/${itemId}.png`
  await renderItem({ id: itemId, assets, path: renderPath })

  const raw = await sharp(renderPath).raw().toBuffer()
  const { width, channels } = await sharp(renderPath).metadata()
  const ig = await sharp(`${realDir}/${igFile}.png`).raw().toBuffer()
  const { width: iw, channels: ic } = await sharp(`${realDir}/${igFile}.png`).metadata()

  console.log("=== " + igFile.toUpperCase() + " ===")
  let allPerfect = true
  for (const [n, [x, y]] of Object.entries(points)) {
    const igv = ig[(y * iw + x) * ic]
    const rnv = raw[(y * width + x) * channels]
    if (rnv !== igv) {
      console.log(n.padEnd(8) + " ig=" + igv + " rn=" + rnv + " diff=" + (rnv - igv))
      allPerfect = false
    }
  }
  if (allPerfect) console.log("ALL PERFECT")
  console.log()
}
