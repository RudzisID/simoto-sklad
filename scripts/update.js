// Update script for SiMOTO-sklad
// Downloads latest release ZIP from GitHub (direct CDN, no API token needed)
// Extracts and copies files over current installation
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const tag = process.argv[2]
if (!tag) {
  console.error('[X] No version tag specified')
  process.exit(1)
}

const projectDir = path.resolve(__dirname, '..')
const tmpDir = path.join(projectDir, '.tmp_update')
const zipPath = path.join(tmpDir, 'update.zip')
const extractPath = path.join(tmpDir, 'extracted')

// Files/directories to preserve (not overwrite)
const preserveList = ['.env', 'node_modules', 'logs']

// Ensure dotfiles (.gitignore style) are included in copy
function isExcluded(name) {
  return preserveList.includes(name)
}

// Clean and create temp dir
function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(extractPath, { recursive: true })
}

// Download ZIP from GitHub archive URL (direct download, no API)
function downloadZip() {
  const url = `https://github.com/RudzisID/simoto-sklad/archive/refs/tags/${tag}.zip`
  console.log('[i] Downloading: ' + url)
  return download(url, zipPath)
}

// Download a file from URL to destination (handles redirects recursively)
// Each call creates its own WriteStream — avoids piping to destroyed streams
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const abortTimer = setTimeout(() => {
      request.destroy()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(new Error('Download timeout (120s)'))
    }, 120000)

    const file = fs.createWriteStream(dest)
    file.on('error', (err) => {
      clearTimeout(abortTimer)
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })

    const request = https.get(url, (res) => {
      // Handle redirects (GitHub may redirect to CDN)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        clearTimeout(abortTimer)
        console.log('[i] Redirecting to: ' + res.headers.location)
        // Create a NEW stream in the recursive call — don't reuse closed one
        return download(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        clearTimeout(abortTimer)
        return reject(new Error('HTTP ' + res.statusCode))
      }
      console.log('[i] Downloading ZIP...')
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        clearTimeout(abortTimer)
        const stats = fs.statSync(dest)
        console.log('[i] Downloaded ' + (stats.size / 1024 / 1024).toFixed(1) + ' MB')
        resolve()
      })
    })
    request.on('error', (err) => {
      clearTimeout(abortTimer)
      file.close()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
  })
}

// Extract ZIP using PowerShell's Expand-Archive
function extractZip() {
  console.log('[i] Extracting ZIP...')
  try {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`,
      { stdio: 'pipe', timeout: 120000 }
    )
  } catch (e) {
    throw new Error('Extraction failed: ' + (e.stderr ? e.stderr.toString().trim() : e.message))
  }

  // Find root folder inside extracted ZIP (e.g., "simoto-sklad-1.4.0")
  const items = fs.readdirSync(extractPath)
  const rootFolder = items.find((i) =>
    fs.statSync(path.join(extractPath, i)).isDirectory()
  )
  if (!rootFolder) {
    throw new Error('No root folder found in archive')
  }
  return path.join(extractPath, rootFolder)
}

// Recursively copy files, excluding preserved items
function copyFiles(srcDir, destDir) {
  let count = 0
  const entries = fs.readdirSync(srcDir)

  for (const entry of entries) {
    if (isExcluded(entry)) {
      console.log('[i] Preserving: ' + entry)
      continue
    }
    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(destDir, entry)
    const stat = fs.statSync(srcPath)

    if (stat.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      count += copyFiles(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
      count++
    }
  }
  return count
}

// Cleanup temp directory
function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// Main
async function main() {
  try {
    setup()
    await downloadZip()
    const sourceDir = extractZip()
    console.log('[i] Copying files...')
    const fileCount = copyFiles(sourceDir, projectDir)
    cleanup()
    console.log('[OK] Updated! Copied ' + fileCount + ' files.')
    console.log('UPDATE_OK=true')
    process.exit(0)
  } catch (err) {
    cleanup()
    console.error('[X] Update failed: ' + err.message)
    console.error('UPDATE_FAILED=true')
    process.exit(1)
  }
}

main()
