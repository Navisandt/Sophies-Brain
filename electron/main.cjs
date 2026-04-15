const { app, BrowserWindow, dialog, ipcMain, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow = null
let currentProjectId = null
let currentProjectPath = null
let currentSavePath = null

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function getProjectsRootDir() {
  const dir = path.join(app.getPath('documents'), 'Thesis System Map', 'Projects')
  ensureDir(dir)
  return dir
}

function getSettingsPath() {
  const dir = app.getPath('userData')
  ensureDir(dir)
  return path.join(dir, 'settings.json')
}

function readSettings() {
  return readJson(getSettingsPath(), {
    lastProjectId: null,
    lastProjectPath: null,
    lastSavePath: null
  })
}

function writeSettings(nextSettings) {
  writeJson(getSettingsPath(), nextSettings)
}

function setLastOpened(projectId, projectPath, savePath) {
  const settings = readSettings()
  settings.lastProjectId = projectId || null
  settings.lastProjectPath = projectPath || null
  settings.lastSavePath = savePath || null
  writeSettings(settings)
}

function getLastOpened() {
  const settings = readSettings()
  return {
    lastProjectId: settings.lastProjectId || null,
    lastProjectPath: settings.lastProjectPath || null,
    lastSavePath: settings.lastSavePath || null
  }
}

function sanitizeName(value, fallback = 'Untitled Project') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()

  return cleaned || fallback
}

function slugify(value, fallback = 'project') {
  const cleaned = sanitizeName(value, fallback)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return cleaned || fallback
}

function makeId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function makeTimestamp() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`
}

function getProjectMetaPath(projectPath) {
  return path.join(projectPath, 'project-meta.json')
}

function getProjectSavesDir(projectPath) {
  const dir = path.join(projectPath, 'saves')
  ensureDir(dir)
  return dir
}

function createProjectFolder(projectTitle) {
  const root = getProjectsRootDir()
  const base = slugify(projectTitle, 'project')
  let folderName = base
  let counter = 2

  while (fs.existsSync(path.join(root, folderName))) {
    folderName = `${base}-${counter}`
    counter += 1
  }

  const projectPath = path.join(root, folderName)
  ensureDir(projectPath)
  ensureDir(path.join(projectPath, 'saves'))
  return projectPath
}

function readProjectMeta(projectPath) {
  const fallbackTitle = path.basename(projectPath)
  return readJson(getProjectMetaPath(projectPath), {
    id: null,
    title: fallbackTitle,
    createdAt: null,
    updatedAt: null
  })
}

function writeProjectMeta(projectPath, meta) {
  writeJson(getProjectMetaPath(projectPath), meta)
}

function createSaveFilename(saveLabel = '') {
  const base = sanitizeName(saveLabel || '', '').trim()
  if (base) {
    return `${base} - ${makeTimestamp()}.json`
  }
  return `${makeTimestamp()}.json`
}

function listSaveFiles(projectPath) {
  const savesDir = getProjectSavesDir(projectPath)

  return fs.readdirSync(savesDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => {
      const filePath = path.join(savesDir, name)
      const stat = fs.statSync(filePath)
      const data = readJson(filePath, {})
      return {
        name,
        filePath,
        modifiedMs: stat.mtimeMs,
        modifiedAt: stat.mtime.toISOString(),
        title: data?._saveMeta?.label || data?.meta?.title || name.replace(/\.json$/i, '')
      }
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
}

function listProjects() {
  const root = getProjectsRootDir()

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const projectPath = path.join(root, entry.name)
      const meta = readProjectMeta(projectPath)
      const saves = listSaveFiles(projectPath)
      const latestSave = saves[0] || null
      const stat = fs.statSync(projectPath)

      return {
        id: meta.id || entry.name,
        title: meta.title || entry.name,
        projectPath,
        saveCount: saves.length,
        latestSavePath: latestSave?.filePath || null,
        latestSaveModifiedAt: latestSave?.modifiedAt || null,
        modifiedMs: latestSave ? latestSave.modifiedMs : stat.mtimeMs
      }
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
}

function listProjectSaves(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return []

  return listSaveFiles(projectPath).map((save) => ({
    filePath: save.filePath,
    title: save.title,
    modifiedAt: save.modifiedAt,
    name: save.name
  }))
}

function loadSaveFile(filePath) {
  const data = readJson(filePath, null)
  if (!data) {
    throw new Error('Could not read save file')
  }
  return data
}

function findProjectById(projectId) {
  return listProjects().find((project) => project.id === projectId) || null
}

function overwriteSave(filePath, project) {
  const existing = readJson(filePath, {})
  const payload = {
    ...project,
    _saveMeta: existing?._saveMeta || {
      label: '',
      createdAt: new Date().toISOString()
    }
  }

  writeJson(filePath, payload)

  const projectPath = path.dirname(path.dirname(filePath))
  const meta = readProjectMeta(projectPath)
  meta.updatedAt = new Date().toISOString()
  if (project?.meta?.title) {
    meta.title = sanitizeName(project.meta.title, meta.title || 'Untitled Project')
  }
  writeProjectMeta(projectPath, meta)

  currentProjectId = meta.id
  currentProjectPath = projectPath
  currentSavePath = filePath
  setLastOpened(currentProjectId, currentProjectPath, currentSavePath)

  return {
    canceled: false,
    projectId: currentProjectId,
    projectPath: currentProjectPath,
    filePath: currentSavePath
  }
}

function createNewSaveInProject(projectPath, project, saveLabel = '') {
  const savesDir = getProjectSavesDir(projectPath)
  const savePath = path.join(savesDir, createSaveFilename(saveLabel))

  const payload = {
    ...project,
    _saveMeta: {
      label: sanitizeName(saveLabel || '', ''),
      createdAt: new Date().toISOString()
    }
  }

  writeJson(savePath, payload)

  const meta = readProjectMeta(projectPath)
  meta.updatedAt = new Date().toISOString()
  if (project?.meta?.title) {
    meta.title = sanitizeName(project.meta.title, meta.title || 'Untitled Project')
  }
  writeProjectMeta(projectPath, meta)

  currentProjectId = meta.id
  currentProjectPath = projectPath
  currentSavePath = savePath
  setLastOpened(currentProjectId, currentProjectPath, currentSavePath)

  return {
    canceled: false,
    projectId: currentProjectId,
    projectPath: currentProjectPath,
    filePath: currentSavePath
  }
}

function createNewProject(project) {
  const projectTitle = sanitizeName(project?.meta?.title, 'Untitled Project')
  const projectPath = createProjectFolder(projectTitle)
  const meta = {
    id: makeId('project'),
    title: projectTitle,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  writeProjectMeta(projectPath, meta)
  const result = createNewSaveInProject(projectPath, project, 'Initial save')

  return {
    ...result,
    projectTitle: meta.title
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#101314',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  if (!app.isPackaged) {
    // Hot reload: watch src/ and reload renderer on any change (dev only)
    const srcDir = path.join(__dirname, '..', 'src')
    let reloadTimeout = null
    fs.watch(srcDir, { recursive: true }, () => {
      if (reloadTimeout) return
      reloadTimeout = setTimeout(() => {
        mainWindow?.webContents.reload()
        reloadTimeout = null
      }, 100)
    })

    // Manual reload shortcut (dev only)
    globalShortcut.register('CommandOrControl+R', () => {
      mainWindow?.webContents.reload()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('project:get-bootstrap', () => {
  const recentProjects = listProjects()
  const lastOpened = getLastOpened()

  return {
    currentProjectPath,
    currentSavePath,
    lastProjectId: lastOpened.lastProjectId,
    lastProjectPath: lastOpened.lastProjectPath,
    lastSavePath: lastOpened.lastSavePath,
    recentProjects
  }
})

ipcMain.handle('project:list', () => {
  return listProjects()
})

ipcMain.handle('project:list-saves', (_event, projectPath) => {
  return listProjectSaves(projectPath)
})

ipcMain.handle('project:load-recent', () => {
  const lastOpened = getLastOpened()

  if (!lastOpened.lastSavePath || !fs.existsSync(lastOpened.lastSavePath)) {
    return { ok: false, reason: 'No recent save found' }
  }

  const data = loadSaveFile(lastOpened.lastSavePath)
  const projectPath = lastOpened.lastProjectPath || path.dirname(path.dirname(lastOpened.lastSavePath))
  const meta = readProjectMeta(projectPath)

  currentProjectId = meta.id
  currentProjectPath = projectPath
  currentSavePath = lastOpened.lastSavePath
  setLastOpened(currentProjectId, currentProjectPath, currentSavePath)

  return {
    ok: true,
    projectId: currentProjectId,
    projectPath: currentProjectPath,
    filePath: currentSavePath,
    data
  }
})

ipcMain.handle('project:load-by-path', (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'Save file not found' }
  }

  const data = loadSaveFile(filePath)
  const projectPath = path.dirname(path.dirname(filePath))
  const meta = readProjectMeta(projectPath)

  currentProjectId = meta.id
  currentProjectPath = projectPath
  currentSavePath = filePath
  setLastOpened(currentProjectId, currentProjectPath, currentSavePath)

  return {
    ok: true,
    projectId: currentProjectId,
    projectPath,
    filePath,
    data
  }
})

ipcMain.handle('project:create', (_event, project) => {
  return createNewProject(project)
})

ipcMain.handle('project:save', (_event, project) => {
  if (currentSavePath && fs.existsSync(currentSavePath)) {
    return overwriteSave(currentSavePath, project)
  }

  if (currentProjectPath && fs.existsSync(currentProjectPath)) {
    return createNewSaveInProject(currentProjectPath, project)
  }

  return createNewProject(project)
})

ipcMain.handle('project:save-as-version', (_event, payload) => {
  const project = payload?.project || payload
  const saveLabel = payload?.saveLabel || ''

  if (currentProjectPath && fs.existsSync(currentProjectPath)) {
    return createNewSaveInProject(currentProjectPath, project, saveLabel)
  }

  return createNewProject(project)
})

ipcMain.handle('project:delete', (_event, projectPath) => {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { ok: false, reason: 'Project not found' }
  }

  fs.rmSync(projectPath, { recursive: true, force: true })

  const settings = readSettings()
  if (settings.lastProjectPath === projectPath) {
    settings.lastProjectId = null
    settings.lastProjectPath = null
    settings.lastSavePath = null
    writeSettings(settings)
  }

  if (currentProjectPath === projectPath) {
    currentProjectId = null
    currentProjectPath = null
    currentSavePath = null
  }

  return { ok: true }
})

ipcMain.handle('project:choose-from-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open save',
    defaultPath: getProjectsRootDir(),
    properties: ['openFile'],
    filters: [{ name: 'Thesis System Map Save', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true }
  }

  const filePath = result.filePaths[0]
  const data = loadSaveFile(filePath)
  const projectPath = path.dirname(path.dirname(filePath))
  const meta = readProjectMeta(projectPath)

  currentProjectId = meta.id
  currentProjectPath = projectPath
  currentSavePath = filePath
  setLastOpened(currentProjectId, currentProjectPath, currentSavePath)

  return {
    canceled: false,
    ok: true,
    projectId: currentProjectId,
    projectPath,
    filePath,
    data
  }
})