// Web storage adapter — replaces the Electron window.thesisApp API.
// All project data is stored in localStorage under 'tsm_v1_*' keys.

;(function () {
  const P = 'tsm_v1'

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback }
    catch { return fallback }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
  function remove(key) { localStorage.removeItem(key) }

  function getProjects() { return read(`${P}_projects`, []) }
  function putProjects(list) { write(`${P}_projects`, list) }
  function getSaves(pid) { return read(`${P}_saves_${pid}`, []) }
  function putSaves(pid, list) { write(`${P}_saves_${pid}`, list) }
  function getLast() { return read(`${P}_last`, null) }
  function setLast(pid, sid) { write(`${P}_last`, { pid, sid }) }
  function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

  function summaries() {
    return getProjects().map((p) => {
      const saves = getSaves(p.id)
      const latest = saves.reduce((best, s) => (!best || s.at > best.at ? s : best), null)
      return {
        title: p.title,
        projectPath: p.id,
        saveCount: saves.length,
        latestSaveModifiedAt: latest?.at || null
      }
    })
  }

  function ensureProject(project) {
    const last = getLast()
    if (last?.pid) return last.pid
    const id = uid()
    const title = project?.meta?.title || 'Untitled Project'
    const list = getProjects()
    list.push({ id, title, createdAt: Date.now() })
    putProjects(list)
    setLast(id, null)
    return id
  }

  function updateProjectTitle(pid, project) {
    const list = getProjects()
    const p = list.find((x) => x.id === pid)
    if (p && project?.meta?.title) { p.title = project.meta.title; putProjects(list) }
  }

  window.thesisApp = {
    async getBootstrap() {
      const last = getLast()
      return {
        currentProjectPath: last?.pid || null,
        lastProjectPath: last?.pid || null,
        recentProjects: summaries()
      }
    },

    async listProjects() {
      return summaries()
    },

    async createProject(project) {
      const id = uid()
      const title = project?.meta?.title || 'Untitled Project'
      const list = getProjects()
      list.push({ id, title, createdAt: Date.now() })
      putProjects(list)
      setLast(id, null)
      return { canceled: false, projectPath: id }
    },

    async saveProject(project) {
      const pid = ensureProject(project)
      updateProjectTitle(pid, project)

      const saves = getSaves(pid)
      const now = Date.now()
      const existing = saves.find((s) => s.id === 'autosave')
      if (existing) { existing.at = now }
      else { saves.unshift({ id: 'autosave', label: 'Auto-save', at: now }) }
      putSaves(pid, saves)
      write(`${P}_data_${pid}_autosave`, project)
      setLast(pid, 'autosave')
      return { canceled: false, filePath: pid }
    },

    async saveProjectAsVersion(project, label) {
      const pid = ensureProject(project)
      updateProjectTitle(pid, project)

      const sid = uid()
      const saves = getSaves(pid)
      saves.unshift({ id: sid, label: label || '', at: Date.now() })
      putSaves(pid, saves)
      write(`${P}_data_${pid}_${sid}`, project)
      setLast(pid, sid)
      return { canceled: false, projectPath: pid }
    },

    async listProjectSaves(pid) {
      return getSaves(pid).map((s) => ({
        title: s.label || 'Auto-save',
        name: new Date(s.at).toLocaleString(),
        modifiedAt: s.at,
        filePath: `${pid}::${s.id}`
      }))
    },

    async loadProjectByPath(filePath) {
      const sep = filePath.lastIndexOf('::')
      if (sep === -1) return { ok: false }
      const pid = filePath.slice(0, sep)
      const sid = filePath.slice(sep + 2)
      const data = read(`${P}_data_${pid}_${sid}`, null)
      if (!data) return { ok: false }
      setLast(pid, sid)
      return { ok: true, data, projectPath: pid }
    },

    async loadRecentProject() {
      const last = getLast()
      if (!last?.pid || !last?.sid) return { ok: false }
      return window.thesisApp.loadProjectByPath(`${last.pid}::${last.sid}`)
    },

    async deleteProject(pid) {
      getSaves(pid).forEach((s) => remove(`${P}_data_${pid}_${s.id}`))
      remove(`${P}_saves_${pid}`)
      putProjects(getProjects().filter((p) => p.id !== pid))
      const last = getLast()
      if (last?.pid === pid) setLast(null, null)
      return { ok: true }
    },

    async chooseProjectFromDialog() {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json'
        input.onchange = (e) => {
          const file = e.target.files[0]
          if (!file) { resolve({ canceled: true }); return }
          const reader = new FileReader()
          reader.onload = (ev) => {
            try {
              const data = JSON.parse(ev.target.result)
              resolve({ canceled: false, ok: true, data, projectPath: null })
            } catch {
              resolve({ canceled: false, ok: false })
            }
          }
          reader.readAsText(file)
        }
        input.click()
      })
    }
  }
})()
