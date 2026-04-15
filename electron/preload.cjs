const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('thesisApp', {
  getBootstrap: () => ipcRenderer.invoke('project:get-bootstrap'),
  listProjects: () => ipcRenderer.invoke('project:list'),
  listProjectSaves: (projectPath) => ipcRenderer.invoke('project:list-saves', projectPath),
  loadRecentProject: () => ipcRenderer.invoke('project:load-recent'),
  loadProjectByPath: (filePath) => ipcRenderer.invoke('project:load-by-path', filePath),
  createProject: (data) => ipcRenderer.invoke('project:create', data),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  saveProjectAsVersion: (project, saveLabel) => ipcRenderer.invoke('project:save-as-version', { project, saveLabel }),
  chooseProjectFromDialog: () => ipcRenderer.invoke('project:choose-from-dialog'),
  deleteProject: (projectPath) => ipcRenderer.invoke('project:delete', projectPath)
})