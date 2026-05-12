import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultSourceDir = path.join(rootDir, 'lib/librime-wasm/runtime')
const sourceDir = path.resolve(process.env.LIBRIME_WASM_SOURCE_DIR ?? defaultSourceDir)
const publicDir = path.join(rootDir, 'public/librime-wasm')
const requiredFiles = ['worker.js', 'rime.js', 'rime.wasm']
const downloadedRuntimeFiles = ['rime.js', 'rime.wasm', 'rime.data']
const defaultRuntimeUrl = 'https://github.com/LibreService/my_rime/releases/download/latest/my-rime-dist.zip'
const runtimeDownloadUrl = process.env.LIBRIME_WASM_DOWNLOAD_URL ?? defaultRuntimeUrl
const autoDownload = process.env.LIBRIME_WASM_AUTO_DOWNLOAD !== '0' && process.env.LIBRIME_WASM_SKIP_DOWNLOAD !== '1'
const cacheDir = path.join(rootDir, '.cache/librime-wasm')
const cacheFile = path.join(cacheDir, 'my-rime-dist.zip')

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function readSchemas() {
  const schemasPath = path.join(sourceDir, 'schemas.json')
  if (!(await exists(schemasPath))) return []

  try {
    return JSON.parse(await readFile(schemasPath, 'utf8'))
  } catch {
    return []
  }
}

async function missingRequiredFiles() {
  const missingFiles = []
  for (const file of requiredFiles) {
    if (!(await exists(path.join(sourceDir, file)))) missingFiles.push(file)
  }
  return missingFiles
}

async function downloadRuntimeArchive() {
  await mkdir(cacheDir, { recursive: true })

  if (await exists(cacheFile)) return await readFile(cacheFile)

  console.log(`Downloading librime wasm runtime from ${runtimeDownloadUrl}`)
  const response = await fetch(runtimeDownloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download librime wasm runtime: ${response.status} ${response.statusText}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(cacheFile, bytes)
  return bytes
}

async function extractDownloadedRuntime() {
  if (!autoDownload || sourceDir !== path.resolve(defaultSourceDir)) return false

  const zip = await JSZip.loadAsync(await downloadRuntimeArchive())
  const extractedFiles = []

  for (const fileName of downloadedRuntimeFiles) {
    const entry = zip.file(`my-rime-dist/${fileName}`)
    if (!entry) continue

    await writeFile(path.join(sourceDir, fileName), Buffer.from(await entry.async('uint8array')))
    extractedFiles.push(fileName)
  }

  if (extractedFiles.length > 0) {
    console.log(`Extracted librime wasm runtime files: ${extractedFiles.join(', ')}`)
  }

  return extractedFiles.length > 0
}

async function main() {
  let missingFiles = await missingRequiredFiles()
  if (missingFiles.length > 0) {
    try {
      await extractDownloadedRuntime()
      missingFiles = await missingRequiredFiles()
    } catch (error) {
      console.warn(error instanceof Error ? error.message : String(error))
    }
  }

  await rm(publicDir, { recursive: true, force: true })
  await mkdir(publicDir, { recursive: true })

  const hasRequiredFiles = missingFiles.length === 0

  if (hasRequiredFiles) {
    const files = await readdir(sourceDir)
    await Promise.all(files
      .filter((file) => file !== 'README.md')
      .map((file) => cp(path.join(sourceDir, file), path.join(publicDir, file), { recursive: true })))
  }

  const manifest = hasRequiredFiles
    ? {
      available: true,
      generatedAt: new Date().toISOString(),
      basePath: '/librime-wasm',
      worker: 'worker.js',
      workerType: 'classic',
      rimeJs: 'rime.js',
      rimeWasm: 'rime.wasm',
      rimeData: await exists(path.join(sourceDir, 'rime.data')) ? 'rime.data' : undefined,
      source: runtimeDownloadUrl === defaultRuntimeUrl ? 'LibreService/my_rime latest release' : runtimeDownloadUrl,
      schemas: await readSchemas(),
    }
    : {
      available: false,
      generatedAt: new Date().toISOString(),
      basePath: '/librime-wasm',
      reason: `Missing ${missingFiles.join(', ')} in librime wasm runtime source directory`,
      schemas: [],
    }

  await writeFile(path.join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Prepared librime wasm manifest: ${manifest.available ? 'available' : 'unavailable'}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
