import { Canvas, Image, ImageData, loadImage } from "skia-canvas"
import { fileURLToPath } from "node:url"
import getTHREE from "node-three"
import createContext from "gl"
import path from "node:path"
import sharp from "sharp"
import fs from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const { THREE, loadTexture } = (await getTHREE({ Canvas, Image, ImageData, fetch, Request, Response, Headers }))

export function makeModelScene() {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.01, 100)
  camera.position.set(0, 0, 30)
  camera.up = new THREE.Vector3(0, -1, 0)
  camera.lookAt(0, 0, 0)

  return { scene, camera }
}

export async function renderModelScene(scene, camera, outputPath, w = 1024, h = 1024) {
  const gl = createContext(w, h)

  const renderer = new THREE.WebGLRenderer({
    context: gl,
    preserveDrawingBuffer: true
  })

  renderer.setSize(w, h)
  renderer.setClearColor(0x000000, 0)

  renderer.render(scene, camera, new THREE.WebGLRenderTarget(w, h))

  const buff = Buffer.alloc(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buff)

  return sharp(buff, {
    raw: { width: w, height: h, channels: 4 }
  }).png().toBuffer()
}

function resolveNamespace(str) {
  const parts = str.split(":")
  if (parts.length === 2) {
    return { namespace: parts[0], item: parts[1] }
  } else {
    return { namespace: "minecraft", item: str }
  }
}

const DEFAULT_BLOCKSTATES = {
  facing: "north",
  half: "bottom",
  shape: "straight",
  attachment: "floor",
  up: true,
  shape: ["straight", "north_south"],
  age: [7, 6, 5, 4, 3, 2, 1, 0],
  tilt: "none",
  bottom: false,
  north: false,
  east: false,
  south: false,
  west: false,
  axis: "y",
  face: "wall",
  orientation: "north_up",
  side_chain: "unconnected",
  powered: false
}

const UNIQUE_DEFAULT_BLOCKSTATES = {
  "*_mushroom_block": {
    north: true,
    east: true,
    south: true,
    west: true,
    up: true,
    down: true
  },
  fire: {
    up: false
  },
  "*_stairs|*_glazed_terracotta|cocoa": {
    facing: "south"
  },
  "*_amethyst_bud|amethyst_cluster|barrel|end_rod|*lightning_rod|*piston*": {
    facing: "up"
  },
  "*campfire": {
    lit: true
  },
  glow_lichen: {
    up: false,
    down: true
  },
  grindstone: {
    face: "floor"
  }
}

function getUniqueDefault(blockstate) {
  if (UNIQUE_DEFAULT_BLOCKSTATES[blockstate]) return UNIQUE_DEFAULT_BLOCKSTATES[blockstate]

  for (const key in UNIQUE_DEFAULT_BLOCKSTATES) {
    const patterns = key.split("|").map(pattern =>
      new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    )

    if (patterns.some(regex => regex.test(blockstate))) {
      return UNIQUE_DEFAULT_BLOCKSTATES[key]
    }
  }

  return {}
}

export async function parseBlockstate(assets, blockstate, data = {}) {
  const { namespace, item } = resolveNamespace(blockstate)
  const overridePath = `${__dirname}/overrides/blockstates/${item}.json`
  const assetPath = `${assets}/assets/${namespace}/blockstates/${item}.json`
  const path = await fileExists(overridePath) ? overridePath : assetPath
  const json = JSON.parse(await fs.promises.readFile(path, "utf8"))

  const models = []

  if (json.variants) {
    const variants = Object.entries(json.variants)

    const scored = variants.map(([key, value]) => {
      let score = 0
      if (key === "") {
        score = 0.1
      } else {
        const parts = key.split(",").map(s => s.trim())
        score = parts.reduce((acc, part) => {
          const [k, v] = part.split("=")
          const raw = data[k] ?? getUniqueDefault(blockstate)[k] ?? DEFAULT_BLOCKSTATES[k]
          const actuals = Array.isArray(raw) ? raw.map(e => e.toString()) : [raw?.toString()]
          const index = actuals.indexOf(v)
          if (index === -1) return acc
          return acc + (actuals.length - index)
        }, 0)
      }

      const entry = Array.isArray(value) ? value[0] : value
      return { score, model: entry }
    }).filter(e => e.model)

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score)
      models.push(scored[0].model)
    }
  } else if (json.multipart) {
    const scoredParts = json.multipart.map((part, index) => {
      const when = part.when
      if (!when) return { score: 0, values: [], part, index, match: true }

      const conds = when.OR ?? when.AND ?? [when]
      const isOr = !!when.OR

      let score = 0
      let match = isOr ? false : true

      let values = {}

      for (const cond of conds) {
        const matches = Object.entries(cond).every(([k, v]) => {
          const allowed = v.split("|")
          const raw = data[k] ?? getUniqueDefault(blockstate)[k] ?? DEFAULT_BLOCKSTATES[k]
          const actuals = Array.isArray(raw) ? raw.map(e => e.toString()) : [raw?.toString()]
          const matchIndex = actuals.findIndex(val => allowed.includes(val ?? "none"))
          if (matchIndex !== -1) score += actuals.length - matchIndex
          return matchIndex !== -1
        })

        if (matches) {
          for (const key in cond) {
            values[key] = cond[key]
          }
        }

        if (isOr && matches) {
          match = true
          break
        }
        if (!isOr && !matches) {
          match = false
          break
        }
      }

      return { score, values: Object.entries(values), part, index, match }
    }).filter(p => p.match)

    const usedKeyValues = {}

    scoredParts
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .forEach(({ values, part }) => {
        if (values.some(([k, v]) => usedKeyValues[k] && usedKeyValues[k] !== v)) return
        for (const [key, value] of values) {
          usedKeyValues[key] = value
        }
        const apply = Array.isArray(part.apply) ? part.apply[0] : part.apply
        if (apply?.model) models.push(apply)
      })
  }

  for (const model of models) {
    model.type = "block"
  }

  return models
}

function normalize(val) {
  return String(val).replace(/^minecraft:/, "")
}

export async function parseItemDefinition(assets, itemId, data = {}, display = "gui") {
  const { namespace, item } = resolveNamespace(itemId)
  const filePath = `${assets}/assets/${namespace}/items/${item}.json`
  const json = JSON.parse(await fs.promises.readFile(filePath, "utf8"))
  return await resolveItemModel(json.model, assets, data, display)
}

function resolveItemModel(def, assets, data, display) {
  while (def) {
    const type = normalize(def.type)

    if (type === "special") {
      const model = new String(def.base)
      def.model.type = normalize(def.model.type)
      model.special = def.model
      return [model]
    }

    if (type === "composite") {
      const result = []
      for (const model of def.models) {
        const nested = resolveItemModel(model, assets, data, display)
        result.push(...nested)
      }
      return result
    }

    if (type === "select") {
      const prop = normalize(def.property)
      let value = normalize(data[prop] ?? "")
      if (!value && prop === "display_context") {
        value = display
      }
      const matched = def.cases.find(c => {
        const when = c.when
        if (Array.isArray(when)) return when.map(normalize).includes(value)
        return normalize(when) === value
      })
      def = matched?.model || def.fallback
      continue
    }

    if (type === "condition") {
      const prop = normalize(def.property)
      const value = normalize(data[prop])
      const isTruthy = value === "true"
      def = isTruthy ? def.on_true : def.on_false
      continue
    }

    if (type === "range_dispatch") {
      const prop = normalize(def.property)
      const num = parseFloat(data[prop] ?? 0)
      const scaled = (def.scale ?? 1) * num
      const entries = def.entries || []
      let chosen = def.fallback
      for (const entry of entries) {
        if (scaled >= entry.threshold) chosen = entry.model
      }
      def = chosen
      continue
    }

    if (type === "model") {
      return [def.model]
    }

    return []
  }
  return []
}

async function fileExists(path) {
  try {
    await fs.promises.access(path)
    return true
  } catch {
    return false
  }
}

async function loadMinecraftTexture(path) {
  const image = await loadImage(path)

  const metaPath = path + ".mcmeta"
  if (!(await fileExists(metaPath))) return image

  let meta
  try {
    meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8"))?.animation ?? {}
  } catch {
    return image
  }

  const frameWidth = meta.width
  const frameHeight = meta.height

  const cropW =
    frameWidth ??
    (frameHeight
      ? image.width
      : Math.min(image.width, image.height))

  const cropH =
    frameHeight ??
    (frameWidth
      ? image.height
      : Math.min(image.width, image.height))

  const canvas = new Canvas(cropW, cropH)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(image, 0, 0, cropW, cropH, 0, 0, cropW, cropH)

  return canvas
}

export async function resolveModelData(assets, model) {
  let merged = {}

  let type
  if (typeof model === "object" && !(model instanceof String)) {
    merged.x = model.x
    merged.y = model.y
    merged.uvlock = model.uvlock
    type = model.type
    model = model.model
  }

  const { namespace, item } = resolveNamespace(model)

  let stack = []
  let currentNamespace = namespace
  let currentItem = item
  let currentPath

  try {
    while (true) {
      const overridePath = `${__dirname}/overrides/models/${currentItem}.json`
      const hasOverride = await fileExists(overridePath)

      if (hasOverride) {
        currentPath = overridePath
        merged.overridden = true
      } else {
        currentPath = `${assets}/assets/${currentNamespace}/models/${currentItem}.json`
      }

      const json = JSON.parse(await fs.promises.readFile(currentPath, "utf8"))
      stack.push(json)

      if (!json.parent || json.parent.startsWith("builtin")) break

      const parentId = json.parent.replace(/^minecraft:/, "")
      const resolved = resolveNamespace(parentId)
      currentNamespace = resolved.namespace
      currentItem = resolved.item
    }

  } catch {
    stack = [JSON.parse(await fs.promises.readFile(`${__dirname}/overrides/models/~missing.json`, "utf8"))]
  }

  if (model.special) {
    const resolved = await resolveSpecialModel(assets, model.special)
    if (resolved) {
      stack.push(resolved.model)
      merged.y = 180
      if (resolved.rotation) {
        merged.x = resolved.rotation[0]
        merged.y += resolved.rotation[1]
      }
      if (resolved.offset) {
        merged.offset = resolved.offset
      }
    }
  }

  // Merge down the chain
  for (const layer of stack) {
    for (const key in layer) {
      if (key === "textures") {
        merged.textures ??= {}
        for (const [key, value] of Object.entries(layer.textures)) {
          if (!(key in merged.textures)) {
            merged.textures[key] = value
          }
        }
      } else if (key === "display") {
        if (type === "block") continue
        merged.display ??= {}
        for (const [key, value] of Object.entries(layer.display)) {
          if (!(key in merged.display)) {
            merged.display[key] = value
          }
        }
      } else if (!merged[key]) {
        merged[key] = layer[key]
      }
    }
  }

  // Fully resolve textures
  for (const key in merged.textures) {
    let value = merged.textures[key]
    while (value?.startsWith("#")) {
      const ref = value.slice(1)
      value = merged.textures[ref]
    }
    merged.textures[key] = value
  }

  // Handle builtin/generated
  if (stack[stack.length - 1].parent === "builtin/generated") {
    const texRef = merged.textures?.layer0
    if (!texRef) return merged
    const { namespace, item } = resolveNamespace(texRef)
    const texPath = `${assets}/assets/${namespace}/textures/${item}.png`
    const image = await loadMinecraftTexture(texPath)
    const width = image.width
    const height = image.height
    const depth = 16 / Math.max(width, height)
    const elements = []
    const canvas = new Canvas(width, height)
    const ctx = canvas.getContext("2d")
    ctx.drawImage(image, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height).data
    
    // Helper function to check if a pixel is opaque
    const isOpaque = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false
      const i = (y * width + x) * 4
      return imageData[i + 3] >= 1
    }
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const alpha = imageData[i + 3]
        if (alpha === 0) continue
        
        const x1 = x * depth
        const y1 = 16 - (y + 1) * depth
        const x2 = x1 + depth
        const y2 = y1 + depth
        
        // Calculate UV coordinates for this pixel
        const u1 = x / width * 16
        const v1 = y / height * 16
        const u2 = (x + 1) / width * 16
        const v2 = (y + 1) / height * 16
        
        // Only include faces that are exposed (not touching another opaque pixel)
        const faces = {}
        
        if (!isOpaque(x, y - 1)) faces.up = { texture: "#layer0", uv: [u1, v1, u2, v2] }      // pixel above
        if (!isOpaque(x, y + 1)) faces.down = { texture: "#layer0", uv: [u1, v1, u2, v2] }    // pixel below
        if (!isOpaque(x - 1, y)) faces.west = { texture: "#layer0", uv: [u1, v1, u2, v2] }    // pixel left
        if (!isOpaque(x + 1, y)) faces.east = { texture: "#layer0", uv: [u1, v1, u2, v2] }    // pixel right
        
        // North and south faces are always visible (front and back of the extruded texture)
        faces.north = { texture: "#layer0", uv: [u1, v1, u2, v2] }
        faces.south = { texture: "#layer0", uv: [u1, v1, u2, v2] }
        
        elements.push({
          from: [x1, y1, 8 - depth / 2],
          to: [x2, y2, 8 + depth / 2],
          faces: faces
        })
      }
    }
    merged.elements = elements
  }

  return merged
}

const COLOURS = {
  black: "#1d1d21",
  blue: "#3c44aa",
  brown: "#835432",
  cyan: "#169c9c",
  gray: "#474f52",
  green: "#5e7c16",
  light_blue: "#3ab3da",
  light_gray: "#9d9d97",
  lime: "#80c71f",
  magenta: "#c74ebd",
  orange: "#f9801d",
  pink: "#f38baa",
  purple: "#8932b8",
  red: "#b02e26",
  white: "#f9fffe",
  yellow: "#fed83d"
}

async function resolveSpecialModel(assets, data) {
  if (data.type === "head") {
    data.type = `${data.kind}_${data.kind.includes("skeleton") ? "skull" : "head"}`
  }
  if (!await fileExists(`${__dirname}/overrides/models/~item/${data.type}.json`)) return
  const model = await resolveModelData(assets, `~item/${data.type}`)
  let offset, rotation
  if (data.type === "banner") {
    model.tints = [COLOURS[data.color]]
  } else if (data.type === "bed") {
    model.textures = {
      bed: `entity/bed/${normalize(data.texture)}`
    }
    rotation = [0, 180]
  } else if (data.type === "chest") {
    model.textures = {
      chest: `entity/chest/${normalize(data.texture)}`
    }
  } else if (data.type === "shulker_box") {
    model.textures = {
      shulker_box: `entity/shulker/${normalize(data.texture)}`
    }
  } else if (data.type === "copper_golem_statue") {
    model.textures = {
      golem: `${normalize(data.texture).slice(9).slice(0, -4)}`
    }
    offset = [0, -3.8]
    rotation = [180, 180]
  }
  return {
    model,
    offset,
    rotation
  }
}

export async function loadModel(scene, assets, model, display = "gui") {
  const textureCache = new Map()

  function resolveTexturePath(id) {
    const { namespace, item } = resolveNamespace(id)
    return `${assets}/assets/${namespace}/textures/${item}.png`
  }

  async function loadTextureAsync(id, tint) {
    if (textureCache.has(id)) return textureCache.get(id)

    let image
    if (id) {
      const path = resolveTexturePath(id)
      if (await fileExists(path)) {
        image = await loadMinecraftTexture(path)
      } else {
        image = await loadImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAABlBMVEUAAAD7PvmZUnQ7AAAADElEQVR4XmNoYHAAAAHEAMFho6CnAAAAAElFTkSuQmCC")
      }
    } else {
      image = await loadImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAABlBMVEUAAAD7PvmZUnQ7AAAADElEQVR4XmNoYHAAAAHEAMFho6CnAAAAAElFTkSuQmCC")
    }

    if (tint) {
      const canvas = new Canvas(image.width, image.height)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(image, 0, 0)
      ctx.globalCompositeOperation = "multiply"
      ctx.fillStyle = COLOURS[tint] ?? tint
      ctx.fillRect(0, 0, image.width, image.height)
      ctx.globalCompositeOperation = "destination-in"
      ctx.drawImage(image, 0, 0)
      image = canvas
    }

    const texture = await loadTexture(image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.needsUpdate = true

    textureCache.set(id, texture)
    return texture
  }

  let settings
  if (typeof display === "object") {
    if (display.type === "fallback" && model.display?.[display.display]) {
      settings = model.display[display.display]
    } else {
      settings = structuredClone(display)
    }
  } else {
    settings = model.display?.[display]
  }

  if (model.ignore_rotations) {
    delete settings.rotation
  }

  let rotation = [0, 0, 0]
  if (settings?.rotation) {
    rotation = settings.rotation
  }
  rotation = rotation.map(e => e + 0.00001)

  let faceNormals = {
    west:   new THREE.Vector3(-1, 0, 0),
    east:   new THREE.Vector3(1, 0, 0),
    up:     new THREE.Vector3(0, 1, 0),
    down:   new THREE.Vector3(0, -1, 0),
    south:  new THREE.Vector3(0, 0, 1),
    north:  new THREE.Vector3(0, 0, -1)
  }

  const yRot = ((model?.y ?? 0) % 360 + 360) % 360
  for (let i = 0; i < yRot / 90; i++) {
    faceNormals = {
      up: faceNormals.up,
      down: faceNormals.down,
      north: faceNormals.east,
      east: faceNormals.south,
      south: faceNormals.west,
      west: faceNormals.north
    }
  }

  const xRot = ((model?.x ?? 0) % 360 + 360) % 360
  for (let i = 0; i < xRot / 90; i++) {
    faceNormals = {
      east: faceNormals.east,
      west: faceNormals.west,
      up: faceNormals.north,
      north: faceNormals.down,
      down: faceNormals.south,
      south: faceNormals.up
    }
  }

  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    "YXZ"
  )

  const rotated = Object.fromEntries(
    Object.entries(faceNormals).map(([face, vec]) => [
      face,
      vec.clone().applyEuler(euler)
    ])
  )

  const faceMapping = Object.fromEntries(
   Object.entries(rotated).map(([face, vec]) => {
     const abs = [Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z)]
     const max = abs.indexOf(Math.max(...abs))
     return [face, 
       max === 0 ? (vec.x > 0 ? "east" : "west") :
       max === 1 ? (vec.y > 0 ? "up" : "down") :
                   (vec.z > 0 ? "south" : "north")
     ]
   })
  )

  const upColour = [0.988, 0.988, 0.988]
  const downColour = [0.471, 0.471, 0.471]

  const cols = [0.471, 0.494, 0.686, 0.851, 0.988]

  let getFaceColour
  if (model.gui_light === "front") {
    getFaceColour = faceName => {
      const newFace = faceMapping[faceName]

      if (newFace === "up") return upColour
      if (newFace === "down") return downColour

      const normal = rotated[faceName]

      let t = Math.max(0, normal.dot(new THREE.Vector3(0, 0, 1)))

      if (normal.x < 0) {
        t = Math.min(1, (t + 1.2) / 2)
      }
      const linear = Math.asin(t) * 2 / Math.PI

      const scaled = linear * (cols.length - 1)
      const i = Math.floor(scaled)
      const f = scaled - i

      const start = cols[i] ?? cols[cols.length - 1]
      const end = cols[i + 1] ?? cols[cols.length - 1]
      const v = start + (end - start) * f

      return [v, v, v]
    }
  } else {
    getFaceColour = faceName => {
      const newFace = faceMapping[faceName]
      
      if (newFace === "up") return upColour
      if (newFace === "down") return downColour
      
      const normal = rotated[faceName]

      const t = Math.max(0, normal.dot(new THREE.Vector3(-1, 0, 0)))
      const linear = Math.asin(t) * 2 / Math.PI

      const scaled = linear * (cols.length - 1)
      const i = Math.floor(scaled)
      const f = scaled - i

      const start = cols[i] ?? cols[cols.length - 1]
      const end = cols[i + 1] ?? cols[cols.length - 1]
      const v = start + (end - start) * f

      return [v, v, v]
    }
  }

  const rootGroup = new THREE.Group()
  const displayGroup = new THREE.Group()
  const containerGroup = new THREE.Group()
  rootGroup.add(displayGroup)
  displayGroup.add(containerGroup)
  
  if (model.x || model.y) {
    const x = THREE.MathUtils.degToRad(-(model?.x ?? 0))
    const y = THREE.MathUtils.degToRad(model?.y ?? 0)
    containerGroup.rotation.set(x, y, 0, "YXZ")
  }

  if (model.offset) {
    rootGroup.position.set(...model.offset)
  }

  for (const element of model.elements || []) {
    const from = new THREE.Vector3().fromArray(element.from)
    const to = new THREE.Vector3().fromArray(element.to)
    const size = new THREE.Vector3().subVectors(to, from)

    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)

    const faceOrder = ["west", "east", "up", "down", "south", "north"]

    const colorCount = geometry.attributes.position.count
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colorCount * 3), 3))

    for (let i = 0; i < faceOrder.length; i++) {
      const faceName = faceOrder[i]
      const face = element.faces?.[faceName]
      if (!face) continue
      let [u1, v1, u2, v2] = face.uv || []
      if (!face.uv) {
        const [fx, fy, fz] = element.from
        const [tx, ty, tz] = element.to
        if (faceName === "up") {
          u1 = fx
          u2 = tx
          v2 = tz
          v1 = fz
        } else if (faceName === "down") {
          u1 = fx
          u2 = tx
          v2 = 16 - fz
          v1 = 16 - tz
        } else if (faceName === "north") {
          u1 = 16 - tx
          u2 = 16 - fx
          v1 = 16 - ty
          v2 = 16 - fy
        } else if (faceName === "south") {
          u1 = fx
          u2 = tx
          v1 = 16 - ty
          v2 = 16 - fy
        } else if (faceName === "east") {
          u1 = 16 - tz
          u2 = 16 - fz
          v1 = 16 - ty
          v2 = 16 - fy
        } else if (faceName === "west") {
          u1 = fz
          u2 = tz
          v1 = 16 - ty
          v2 = 16 - fy
        }
      }

      let uv = [
        [u2, v1],
        [u1, v1],
        [u2, v2],
        [u1, v2]
      ]

      let rot = face.rotation ?? 0
      if (rot === 90) uv = [uv[1], uv[3], uv[0], uv[2]]
      else if (rot === 180) uv = [uv[3], uv[2], uv[1], uv[0]]
      else if (rot === 270) uv = [uv[2], uv[0], uv[3], uv[1]]

      if (model?.uvlock) {
        let angle = 0
        if ((faceName === "up" || faceName === "down") && model?.y) {
          angle = -model.y
        } else if ((faceName === "north" || faceName === "south") && model?.x) {
          angle = -model.x
        }

        if (angle % 360 !== 0) {
          const center = new THREE.Vector2(8, 8)
          uv = uv.map(([u, v]) => {
            const vec = new THREE.Vector2(u, v)
            vec.rotateAround(center, THREE.MathUtils.degToRad(angle))
            return [vec.x, vec.y]
          })
        }
      }

      geometry.attributes.uv.array.set(uv.flatMap(([u, v]) => [u / 16, v / 16]), i * 8)

      let colour
      if (element.shade === false) {
        colour = [1, 1, 1]
      } else {
        colour = getFaceColour(faceName)
      }

      for (let j = 0; j < 4; j++) {
        const vertexIndex = (i * 4 + j) * 3
        geometry.attributes.color.array[vertexIndex] = colour[0]
        geometry.attributes.color.array[vertexIndex + 1] = colour[1]
        geometry.attributes.color.array[vertexIndex + 2] = colour[2]
      }
    }
    geometry.attributes.uv.needsUpdate = true
    geometry.attributes.color.needsUpdate = true

    const materials = []
    for (const faceName of faceOrder) {
      const face = element.faces?.[faceName]
      if (!face || !face.texture) {
        materials.push(new THREE.MeshBasicMaterial({ visible: false }))
        continue
      }

      let texRef = face.texture
      if (texRef && !texRef.startsWith("#")) texRef = "#" + texRef

      let tint
      if (model.tints) {
        const m = texRef.match(/^#layer(\d+)$/)
        if (m) {
          tint = model.tints[m[1]]
        }
      }

      while (texRef && texRef.startsWith("#")) {
        texRef = model.textures?.[texRef.slice(1)]
      }

      const map = await loadTextureAsync(texRef, tint)

      materials.push(new THREE.MeshBasicMaterial({
        map,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.01
      }))
    }

    const mesh = new THREE.Mesh(geometry, materials)
    mesh.position.set(
      8 - (from.x + size.x / 2),
      from.y + size.y / 2 - 8,
      from.z + size.z / 2 - 8
    )

    if (element.rotation) {
      const { origin, axis, angle } = element.rotation
      const pivot = new THREE.Vector3(
        8 - origin[0],
        origin[1] - 8,
        origin[2] - 8
      )
      const axisVec = new THREE.Vector3(
        axis === "x" ? 1 : 0,
        axis === "y" ? 1 : 0,
        axis === "z" ? 1 : 0
      )

      const rotGroup = new THREE.Group()
      rotGroup.position.copy(pivot)

      mesh.position.sub(pivot)
      rotGroup.add(mesh)

      rotGroup.rotateOnAxis(axisVec, THREE.MathUtils.degToRad(axis === "x" ? angle : -angle))
      containerGroup.add(rotGroup)
    } else {
      containerGroup.add(mesh)
    }
  }

  if (settings) {
    if (settings.rotation) {
      const delta = new THREE.Euler(
        THREE.MathUtils.degToRad(settings.rotation[0]),
        THREE.MathUtils.degToRad(-settings.rotation[1]),
        THREE.MathUtils.degToRad(-settings.rotation[2]),
        displayGroup.rotation.order
      )
      displayGroup.quaternion.multiply(new THREE.Quaternion().setFromEuler(delta))
    }
    if (settings.translation) {
      displayGroup.position.set(
        -settings.translation[0],
        settings.translation[1],
        settings.translation[2]
      )
    }
    if (settings.scale) {
      displayGroup.scale.set(
        settings.scale[0],
        settings.scale[1],
        settings.scale[2]
      )
    }
  }
  scene.add(rootGroup)
}