import { listDirectory, fileExists, makeModelScene, renderModelScene, parseBlockstate, parseItemDefinition, resolveModelData, loadModel } from "./blockmodel-utils.js"
import fs from "node:fs"
import path from "node:path"

const assets = [
  "C:/Users/ewanh/AppData/Roaming/.minecraft/resourcepacks/26.2-snapshot-2"
]
const outputDir = "renders/animated"
const blockDisplay = {
  rotation: [30, 225, 0],
  scale: [0.625, 0.625, 0.625]
}
const itemDisplay = "gui"
const chunkSize = 32

fs.mkdirSync(path.join(outputDir, "blocks"), { recursive: true })
fs.mkdirSync(path.join(outputDir, "items"), { recursive: true })

const blockstateFiles = await listDirectory("assets/minecraft/blockstates", assets).then(arr => arr.filter(f => f.endsWith(".json")))
const itemFiles = await listDirectory("assets/minecraft/items", assets).then(arr => arr.filter(f => f.endsWith(".json")))

async function processChunk(files, prepare) {
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    const prepared = await Promise.all(chunk.map(prepare))
    for (const entry of prepared) {
      if (!entry) continue
      await renderModelScene(entry.scene, entry.camera, { path: entry.path, animated: true })
      console.log("Done", entry.kind, entry.modelId)
    }
  }
}

async function hasAnimatedTexture(resolved) {
  if (!resolved?.textures) return false
  for (const value of Object.values(resolved.textures)) {
    if (typeof value !== "string" || value.startsWith("#")) continue
    const texPath = `assets/minecraft/textures/${value.replace(/^minecraft:/, "")}.png.mcmeta`
    const resolvedPath = await fileExists(texPath, assets)
    if (!resolvedPath) continue
    try {
      const meta = JSON.parse(fs.readFileSync(resolvedPath, "utf8"))
      if (meta.animation) return true
    } catch {}
  }
  return false
}

async function prepareBlock(file) {
  const modelId = path.basename(file, ".json")
  const models = await parseBlockstate(assets, modelId)
  let animated = false
  const resolvedModels = []
  for (const model of models) {
    const resolved = await resolveModelData(assets, model)
    resolvedModels.push(resolved)
    if (await hasAnimatedTexture(resolved)) animated = true
  }
  if (!animated) return null

  const { scene, camera } = makeModelScene()
  for (const resolved of resolvedModels) {
    await loadModel(scene, assets, resolved, { display: blockDisplay })
  }
  return { kind: "block", modelId, scene, camera, path: `${outputDir}/blocks/${modelId}.png` }
}

async function prepareItem(file) {
  const modelId = path.basename(file, ".json")
  const models = await parseItemDefinition(assets, modelId, { display: itemDisplay })
  let animated = false
  const resolvedModels = []
  for (const model of models) {
    const resolved = await resolveModelData(assets, model)
    resolvedModels.push(resolved)
    if (await hasAnimatedTexture(resolved)) animated = true
  }
  if (!animated) return null

  const { scene, camera } = makeModelScene()
  for (const resolved of resolvedModels) {
    await loadModel(scene, assets, resolved, { display: itemDisplay })
  }
  return { kind: "item", modelId, scene, camera, path: `${outputDir}/items/${modelId}.png` }
}

await processChunk(blockstateFiles, prepareBlock)
await processChunk(itemFiles, prepareItem)
