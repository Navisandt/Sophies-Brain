// Server-backed storage adapter — replaces the Electron window.thesisApp API.
// All project data is persisted in PostgreSQL via a thin Express API.

;(function () {
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(path, opts)
    if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status}`)
    return res.json()
  }

  window.thesisApp = {
    async getBootstrap() {
      return api('GET', '/api/bootstrap')
    },

    async listProjects() {
      return api('GET', '/api/projects')
    },

    async createProject(project) {
      return api('POST', '/api/projects', { project })
    },

    async saveProject(project) {
      return api('POST', '/api/save', { project })
    },

    async saveProjectAsVersion(project, label) {
      return api('POST', '/api/save-version', { project, label })
    },

    async listProjectSaves(pid) {
      return api('GET', `/api/projects/${encodeURIComponent(pid)}/saves`)
    },

    async loadProjectByPath(filePath) {
      return api('GET', `/api/load?filePath=${encodeURIComponent(filePath)}`)
    },

    async loadRecentProject() {
      return api('GET', '/api/load-recent')
    },

    async deleteProject(pid) {
      return api('DELETE', `/api/projects/${encodeURIComponent(pid)}`)
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
