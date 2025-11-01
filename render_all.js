import { makeModelScene, renderModelScene, parseBlockstate, parseItemDefinition, resolveModelData, loadModel } from "./blockmodel-utils.js"
import fs from "node:fs"
import path from "node:path"

const assets = "C:/Users/ewanh/AppData/Roaming/.minecraft/resourcepacks/1.21.9"
const outputDir = "renders"
const blockDisplay = {
  rotation: [30, 225, 0],
  scale: [0.625, 0.625, 0.625]
}
const itemDisplay = "gui"

fs.mkdirSync(path.join(outputDir, "blocks"), { recursive: true })
fs.mkdirSync(path.join(outputDir, "items"), { recursive: true })

const blockstatesPath = `${assets}/assets/minecraft/blockstates`
const itemsPath = `${assets}/assets/minecraft/items`

const blockstateFiles = fs.readdirSync(blockstatesPath).filter(f => f.endsWith(".json"))
const itemFiles = fs.readdirSync(itemsPath).filter(f => f.endsWith(".json"))

for (const file of blockstateFiles) {
  const modelId = path.basename(file, ".json")
  const { scene, camera } = makeModelScene()
  const models = await parseBlockstate(assets, modelId, {})
  for (const model of models) {
    const resolved = await resolveModelData(assets, model)
    await loadModel(scene, assets, resolved, blockDisplay)
  }
  const buffer = await renderModelScene(scene, camera)
  fs.writeFileSync(`${outputDir}/blocks/${modelId}.png`, buffer)
  console.log("Done block", modelId)
}

for (const file of itemFiles) {
  const modelId = path.basename(file, ".json")
  const { scene, camera } = makeModelScene()
  const models = await parseItemDefinition(assets, modelId, {}, itemDisplay)
  for (const model of models) {
    const resolved = await resolveModelData(assets, model)
    await loadModel(scene, assets, resolved, itemDisplay)
  }
  const buffer = await renderModelScene(scene, camera)
  fs.writeFileSync(`${outputDir}/items/${modelId}.png`, buffer)
  console.log("Done item", modelId)
}