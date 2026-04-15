import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { defaultProject } from './data.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const makeId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

const CLUSTER_COLORS = [
  { name: 'Electric blue', hex: '#4d8fff' },
  { name: 'Cyan',          hex: '#22ccee' },
  { name: 'Teal',          hex: '#00bb99' },
  { name: 'Emerald',       hex: '#44dd88' },
  { name: 'Lime',          hex: '#99dd22' },
  { name: 'Amber',         hex: '#ffbb00' },
  { name: 'Orange',        hex: '#ff8833' },
  { name: 'Coral red',     hex: '#ff5566' },
  { name: 'Rose',          hex: '#ff4499' },
  { name: 'Violet',        hex: '#cc55ff' },
  { name: 'Periwinkle',    hex: '#8899ff' },
  { name: 'Cream',         hex: '#ffddaa' },
  { name: 'Silver',        hex: '#aabbcc' },
]

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

function nextUnusedColor() {
  const used = new Set(state.project.clusters.map(c => c.color))
  return (CLUSTER_COLORS.find(c => !used.has(c.hex)) || CLUSTER_COLORS[0]).hex
}

const state = {
  project: clone(defaultProject),
  selectedClusterId: null,
  selectedNodeId: null,
  selectedLinkId: null,
  expandedClusterId: null,
  connectMode: false,
  connectSourceId: null,
  connectPhase: null,
  connectTargetClusterId: null,
  showLabels: true,
  autoRotate: true,
  darkMode: true,
  startupView: 'projects',
  selectedStartupProjectPath: null,
  nodeMeshMap: new Map(),
  linkMeshMap: new Map(),
  shellMap: new Map(),
  occlusionMap: new Map(),
  labelMap: new Map(),
  zoomLabelMap: new Map(),
  signalMap: new Map(),
  hoveredNodeId: null,
  hoveredClusterId: null,
  cameraAnim: null,
  savedCameraState: null,
  povMode: false,
  povNodeId: null,
  povLabelMap: new Map(),
  povSavedCameraState: null,
  povOffsets: new Map(),
  povRelevantClusterIds: new Set(),
  povAnimProgress: 0,
  povAnimDirection: 0,
  toastTimer: null,
  currentProjectPath: null,
  relationEditMode: false,
  showParticles: true,
  presentationMode: false,
  presentationEditing: false,
  presentationStep: 0,
  activePresentationId: null,
  clusterFocusMode: false,
  clusterFocusId: null,
  perspectiveTransition: null,
  sidebarSearchQuery: ''
}

const ui = {
  sceneRoot: document.getElementById('scene-root'),
  projectPath: document.getElementById('project-path'),
  brandTitle: document.getElementById('brand-title'),
  autoRotateToggle: { checked: true },
  hudTitleText: document.getElementById('hud-title-text'),
  hudSubtitle: document.getElementById('hud-subtitle'),
  hudCounts: document.getElementById('hud-counts'),
  selectionCard: document.getElementById('selection-card'),
  toast: document.getElementById('toast'),
  clusterNodeTree: document.getElementById('cluster-node-tree'),
  startupScreen: document.getElementById('startup-screen'),
  appShell: document.getElementById('app-shell'),
  startupLoadRecentBtn: document.getElementById('startup-load-recent-btn'),
  startupOpenProjectBtn: document.getElementById('startup-open-project-btn'),
  startupNewProjectBtn: document.getElementById('startup-new-project-btn'),
  startupRecentMeta: document.getElementById('startup-recent-meta'),
  startupProjectList: document.getElementById('startup-project-list'),
  startupBackBtn: document.getElementById('startup-back-btn'),
  startupListHeading: document.getElementById('startup-list-heading'),
  saveVersionModal: document.getElementById('save-version-modal'),
  saveVersionName: document.getElementById('save-version-name'),
  cancelSaveVersionBtn: document.getElementById('cancel-save-version-btn'),
  confirmSaveVersionBtn: document.getElementById('confirm-save-version-btn'),
}

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe3e8ea)
scene.fog = new THREE.FogExp2(0xd9e0e3, 0.006)

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
camera.position.set(0, 0, 21)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.92
renderer.outputColorSpace = THREE.SRGBColorSpace
ui.sceneRoot.appendChild(renderer.domElement)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.05, 0.2, 0.9))

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.minDistance = 10
controls.maxDistance = 36
controls.autoRotate = true
controls.autoRotateSpeed = 0.14
controls.enablePan = false

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
let pointerDown = { x: 0, y: 0 }
let isDragging = false

const world = {
  nodesGroup: new THREE.Group(),
  linksGroup: new THREE.Group(),
  shellsGroup: new THREE.Group(),
  occlusionShellsGroup: new THREE.Group(),
  leavingShellsGroup: new THREE.Group(),
  atmosphere: null,
  floorGroup: new THREE.Group(),
  selectionSprite: null,
  connectLine: null
}
scene.add(world.nodesGroup, world.linksGroup, world.occlusionShellsGroup, world.shellsGroup, world.leavingShellsGroup, world.floorGroup)

const DIM_COLOR = 0xadc0c6
const LINK_COLOR = 0x557880
const INACTIVE_LINK = 0xd7e2e5
const ACTIVE_LINK = 0x7ea9b6

function createFlashOverlayMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFlashT:        { value: 0.0 },
      uFlashStrength: { value: 0.0 },
      uSigma:         { value: 0.018 },
    },
    vertexShader: `
      attribute float vT;
      uniform float uFlashT;
      uniform float uFlashStrength;
      uniform float uSigma;
      varying float vBright;
      void main() {
        float d = vT - uFlashT;
        vBright = exp(-d * d / (2.0 * uSigma * uSigma)) * uFlashStrength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vBright;
      void main() {
        if (vBright < 0.02) discard;
        gl_FragColor = vec4(0.86, 0.95, 0.98, vBright * 2.8);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

const DOT_TEXTURE = createDotTexture()

buildAtmosphere()
buildFloor()
wireUI()
applySceneTheme()
resizeViewport()
animate()
bootstrapApp()

let resizeRaf = null
new ResizeObserver(() => {
  if (resizeRaf) return
  resizeRaf = requestAnimationFrame(() => {
    resizeViewport()
    resizeRaf = null
  })
}).observe(ui.sceneRoot)

// ── Scene building ──────────────────────────────────────────────────────────

function buildAtmosphere() {
  const count = 900
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 120
    positions[i * 3 + 1] = (Math.random() - 0.5) * 120
    positions[i * 3 + 2] = (Math.random() - 0.5) * 120
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  })
  world.atmosphere = new THREE.Points(geo, mat)
  scene.add(world.atmosphere)
}

function buildFloor() {
  const floorGeo = new THREE.CircleGeometry(34, 96)
  const floorMat = new THREE.MeshBasicMaterial({
    color: 0xf3f5f2,
    transparent: true,
    opacity: 0.94,
    depthWrite: false
  })
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -24
  world.floorGroup.add(floor)

  const ringGeo = new THREE.RingGeometry(8.6, 8.72, 120)
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xcfdade,
        transparent: true,
        opacity: 0.42 - i * 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    ring.scale.setScalar(1 + i * 0.62)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -23.95 + i * 0.01
    world.floorGroup.add(ring)
  }
}

// ── UI wiring ───────────────────────────────────────────────────────────────

function wireUI() {
  ui.startupLoadRecentBtn.addEventListener('click', handleLoadRecentProject)
  ui.startupOpenProjectBtn.addEventListener('click', openStartupProjectBrowser)
  ui.startupNewProjectBtn.addEventListener('click', handleCreateNewProject)

  // BUG FIX: new-project-btn was registered twice — now only once here
  document.getElementById('new-project-btn').addEventListener('click', () => {
    state.project = migrateProjectPerspectives(clone(defaultProject))
    state.currentProjectPath = null
    clearSelection()
    autoResizeAllClusters()
    distributeAllClusters()
    refreshAll()
    renderPerspectiveSwitcher()
    showToast('Demo project restored')
    moreMenu.classList.add('hidden')
  })

  ui.startupBackBtn.addEventListener('click', openStartupProjectBrowser)

  ui.cancelSaveVersionBtn.addEventListener('click', closeSaveVersionModal)

  ui.confirmSaveVersionBtn.addEventListener('click', async () => {
    syncActivePerspective()
    state.project.meta.autoRotate = state.autoRotate
    state.project.meta.showParticles = state.showParticles
    const saveLabel = ui.saveVersionName.value.trim()
    const result = await window.thesisApp.saveProjectAsVersion(state.project, saveLabel)

    if (!result?.canceled) {
      state.currentProjectPath = result.projectPath || null
      syncProjectPath()
      markClean()
      closeSaveVersionModal()
      showToast(saveLabel ? `New save created: ${saveLabel}` : 'New save created in this project')
    }
  })

  ui.saveVersionModal.addEventListener('click', (event) => {
    if (event.target === ui.saveVersionModal) closeSaveVersionModal()
  })

  document.getElementById('connect-hud-back-btn').addEventListener('click', () => {
    if (state.connectPhase === 'pick-nodes') connectZoomOut(false)
  })

  document.getElementById('connect-hud-exit-btn').addEventListener('click', exitConnectMode)

  // ··· more menu
  const moreBtn = document.getElementById('sb-more-btn')
  const moreMenu = document.getElementById('sb-more-menu')
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    moreMenu.classList.toggle('hidden')
  })
  document.addEventListener('click', () => moreMenu.classList.add('hidden'))

  document.getElementById('dark-mode-btn').addEventListener('click', () => {
    state.darkMode = !state.darkMode
    applySceneTheme()
    rebuildScene()
    document.getElementById('dark-mode-btn').textContent = state.darkMode ? 'Light mode' : 'Dark mode'
    showToast(state.darkMode ? 'Dark mode enabled' : 'Light mode enabled')
    moreMenu.classList.add('hidden')
  })

  document.getElementById('save-project-btn').addEventListener('click', async () => {
    syncActivePerspective()
    state.project.meta.autoRotate = state.autoRotate
    state.project.meta.showParticles = state.showParticles
    const result = await window.thesisApp.saveProject(state.project)
    if (!result?.canceled) {
      state.currentProjectPath = result.filePath
      syncProjectPath()
      markClean()
      showToast('Project saved')
    }
  })

  document.getElementById('save-project-as-btn').addEventListener('click', () => {
    openSaveVersionModal()
    moreMenu.classList.add('hidden')
  })

  document.getElementById('download-save-btn').addEventListener('click', () => {
    moreMenu.classList.add('hidden')
    const title = state.project?.meta?.title || 'project'
    const filename = title.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase() + '.json'
    const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  })

  document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar')
    const appShell = document.getElementById('app-shell')
    const isCollapsed = sidebar.classList.toggle('collapsed')
    appShell.classList.toggle('sidebar-collapsed', isCollapsed)
  })

  const searchInput = document.getElementById('sidebar-search-input')
  const searchClear = document.getElementById('sidebar-search-clear')
  searchInput.addEventListener('input', (e) => {
    state.sidebarSearchQuery = e.target.value
    searchClear.classList.toggle('hidden', state.sidebarSearchQuery.length === 0)
    renderLists()
  })
  searchClear.addEventListener('click', () => {
    searchInput.value = ''
    state.sidebarSearchQuery = ''
    searchClear.classList.add('hidden')
    renderLists()
    searchInput.focus()
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = ''
      state.sidebarSearchQuery = ''
      searchClear.classList.add('hidden')
      renderLists()
    }
  })

  // BUG FIX: "Open JSON" now actually opens a file dialog instead of just showing
  // the startup project list (which is hidden when the workspace is visible)
  document.getElementById('open-project-btn').addEventListener('click', async () => {
    moreMenu.classList.add('hidden')
    const result = await window.thesisApp.chooseProjectFromDialog()
    if (result?.canceled || !result?.ok || !result.data) return
    state.project = sanitizeProject(result.data)
    state.currentProjectPath = result.projectPath || null
    clearSelection()
    autoResizeAllClusters()
    distributeAllClusters()
    refreshAll()
    markClean()
    renderPerspectiveSwitcher()
    showToast('Project loaded')
  })

  document.getElementById('return-to-menu-btn').addEventListener('click', () => {
    moreMenu.classList.add('hidden')
    ui.appShell.classList.add('hidden-app')
    ui.startupScreen.classList.remove('hidden')
    bootstrapApp()
  })

  // + add menu
  const addItemBtn = document.getElementById('add-item-btn')
  const addItemMenu = document.getElementById('add-item-menu')
  addItemBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    addItemMenu.classList.toggle('hidden')
  })
  document.addEventListener('click', () => addItemMenu.classList.add('hidden'))

  document.getElementById('add-cluster-btn').addEventListener('click', () => {
    const id = makeId('cluster')
    const nextIndex = state.project.clusters.length + 1
    const position = getNewClusterPosition()
    state.project.clusters.push({ id, name: `Cluster ${nextIndex}`, color: nextUnusedColor(), position, radius: 2.4 })
    selectCluster(id)
    refreshAll()
    showToast(`Cluster created (${state.project.clusters.length} total)`)
    addItemMenu.classList.add('hidden')
  })

  document.getElementById('add-node-btn').addEventListener('click', () => {
    const cluster = selectedCluster() || state.project.clusters[0]
    if (!cluster) return showToast('Create a cluster first')
    const id = makeId('node')
    const p = createNodePositionNearCluster(cluster)
    const existingCount = state.project.nodes.filter((n) => n.clusterId === cluster.id).length
    const label = `${cluster.name} ${existingCount + 1}`
    state.project.nodes.push({ id, clusterId: cluster.id, label, position: p, note: '' })
    autoResizeCluster(cluster.id)
    distributeNodesInCluster(cluster.id)
    selectNode(id)
    refreshAll()
    addItemMenu.classList.add('hidden')
  })

  // Auto-rotate icon button
  const autoRotateBtn = document.getElementById('autorotate-toggle-btn')
  autoRotateBtn.classList.toggle('active', state.autoRotate)
  autoRotateBtn.addEventListener('click', () => {
    state.autoRotate = !state.autoRotate
    controls.autoRotate = state.autoRotate
    ui.autoRotateToggle.checked = state.autoRotate
    autoRotateBtn.classList.toggle('active', state.autoRotate)
  })

  // Particles icon button
  const particlesBtn = document.getElementById('particles-toggle-btn')
  particlesBtn.classList.add('active')
  particlesBtn.addEventListener('click', () => {
    state.showParticles = !state.showParticles
    if (world.atmosphere) world.atmosphere.visible = state.showParticles
    particlesBtn.classList.toggle('active', state.showParticles)
  })

  document.getElementById('presentation-edit-btn').addEventListener('click', togglePresentationEditor)

  document.getElementById('pres-new-btn').addEventListener('click', () => {
    if (!Array.isArray(state.project.presentations)) state.project.presentations = []
    const id = makeId('pres')
    state.project.presentations.push({ id, name: 'New Presentation', steps: [] })
    state.activePresentationId = id
    renderPresentationEditor()
  })

  ui.brandTitle.addEventListener('input', () => {
    state.project.meta.title = ui.brandTitle.textContent.trim()
    updateHud()
  })
  ui.brandTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ui.brandTitle.blur() }
  })

  // ── Pointer events on canvas ──────────────────────────────────────────────

  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDown = { x: event.clientX, y: event.clientY }
    isDragging = false
  })

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) isDragging = true
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    if (state.connectMode && state.connectPhase === 'pick-cluster') {
      raycaster.setFromCamera(mouse, camera)
      const shellMeshes = getClusterShellMeshes()
      const hits = raycaster.intersectObjects(shellMeshes)
      const hitClusterId = hits.length ? hits[0].object.userData.clusterId : null
      const sourceNode = getNode(state.connectSourceId)
      const validClusterId = (hitClusterId && hitClusterId !== sourceNode?.clusterId) ? hitClusterId : null

      if (validClusterId !== state.hoveredClusterId) {
        if (state.hoveredClusterId) {
          const oldShell = state.shellMap.get(state.hoveredClusterId)
          if (oldShell) oldShell.hitMesh.material.opacity = 0
        }
        state.hoveredClusterId = validClusterId
        if (validClusterId) {
          const shell = state.shellMap.get(validClusterId)
          if (shell) shell.hitMesh.material.opacity = 0.06
        }
        const hudSource = document.getElementById('connect-hud-source')
        const sourceName = getNode(state.connectSourceId)?.label || ''
        if (validClusterId) {
          const cluster = getCluster(validClusterId)
          hudSource.innerHTML = `${sourceName} <span style="color:var(--muted);font-weight:400;">→</span> ${cluster?.name || ''}`
        } else {
          hudSource.textContent = sourceName
        }
      }
    }

    if (state.connectMode && state.connectPhase === 'pick-nodes') {
      raycaster.setFromCamera(mouse, camera)
      const clusterNodes = state.project.nodes.filter((n) => n.clusterId === state.connectTargetClusterId)
      const meshes = clusterNodes.map((n) => state.nodeMeshMap.get(n.id)?.coreMesh).filter(Boolean)
      const hits = raycaster.intersectObjects(meshes)
      const hitId = hits.length ? hits[0].object.userData.nodeId : null

      if (hitId !== state.hoveredNodeId) {
        if (state.hoveredNodeId) {
          const oldEntry = state.nodeMeshMap.get(state.hoveredNodeId)
          if (oldEntry) { oldEntry.glowMesh.material.opacity = 0.18; oldEntry.glowMesh.scale.setScalar(1) }
        }
        state.hoveredNodeId = hitId
        if (hitId) {
          const entry = state.nodeMeshMap.get(hitId)
          if (entry) { entry.glowMesh.material.opacity = 0.55; entry.glowMesh.scale.setScalar(1.4) }
        }
        const hudSource = document.getElementById('connect-hud-source')
        const sourceName = getNode(state.connectSourceId)?.label || ''
        if (hitId) {
          hudSource.innerHTML = `${sourceName} <span style="color:var(--muted);font-weight:400;">→</span> ${getNode(hitId)?.label || ''}`
        } else {
          hudSource.textContent = sourceName
        }
        updateZoomLabelHighlights()
      }
    }
  })

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (isDragging) return
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    if (state.connectMode && state.connectPhase === 'pick-cluster') {
      const shellMeshes = getClusterShellMeshes()
      const hits = raycaster.intersectObjects(shellMeshes)
      if (hits.length) {
        const clusterId = hits[0].object.userData.clusterId
        const sourceNode = getNode(state.connectSourceId)
        if (clusterId && clusterId !== sourceNode?.clusterId) {
          connectZoomIntoCluster(clusterId)
        }
      }
      return
    }

    if (state.connectMode && state.connectPhase === 'pick-nodes') {
      const clusterNodes = state.project.nodes.filter((n) => n.clusterId === state.connectTargetClusterId)
      const meshes = clusterNodes.map((n) => state.nodeMeshMap.get(n.id)?.coreMesh).filter(Boolean)
      const hits = raycaster.intersectObjects(meshes)
      if (hits.length) {
        const targetId = hits[0].object.userData.nodeId
        if (targetId && targetId !== state.connectSourceId) {
          const exists = state.project.links.some(
            (l) => (l.source === state.connectSourceId && l.target === targetId) ||
                   (l.source === targetId && l.target === state.connectSourceId)
          )
          if (!exists) {
            const id = makeId('link')
            state.project.links.push({ id, source: state.connectSourceId, target: targetId, label: 'new relation', note: '' })
            showToast('Relation created')
            updateHud()
            updateZoomLabelHighlights()
          } else {
            showToast('Already connected')
          }
        }
      }
      return
    }

    if (state.povMode) {
      const connectedNodes = state.project.nodes.filter((n) => {
        return state.project.links.some(
          (l) => (l.source === state.povNodeId && l.target === n.id) ||
                 (l.target === state.povNodeId && l.source === n.id)
        )
      })
      const meshes = connectedNodes.map((n) => state.nodeMeshMap.get(n.id)?.coreMesh).filter(Boolean)
      const hits = raycaster.intersectObjects(meshes)
      if (hits.length) {
        const targetId = hits[0].object.userData.nodeId
        const link = state.project.links.find(
          (l) => (l.source === state.povNodeId && l.target === targetId) ||
                 (l.target === state.povNodeId && l.source === targetId)
        )
        if (link) {
          selectLink(link.id)
          refreshPanelsOnly()
          updateThreeSelection()
        }
      } else if (state.selectedLinkId) {
        state.selectedLinkId = null
        closeRelationEditCard()
        hideRelationOverlay()
        updateThreeSelection()
      }
      return
    }

    const hits = raycaster.intersectObjects(Array.from(state.nodeMeshMap.values()).map((entry) => entry.coreMesh))
    if (hits.length) {
      const nodeId = hits[0].object.userData.nodeId
      selectNode(nodeId)
      setAutoRotate(false)
      refreshPanelsOnly()
      updateThreeSelection()
    } else {
      const shellHits = raycaster.intersectObjects(getClusterShellMeshes())
      if (shellHits.length) {
        const clusterId = shellHits[0].object.userData.clusterId
        if (clusterId) {
          selectCluster(clusterId)
          refreshPanelsOnly()
          updateThreeSelection()
          enterClusterFocus(clusterId)
        }
      } else {
        clearSelection()
        refreshPanelsOnly()
        updateThreeSelection()
      }
    }
  })

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  window.addEventListener('keydown', (event) => {
    if (state.presentationMode) {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        advancePresentationStep(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        advancePresentationStep(-1)
      } else if (event.key === 'Escape') {
        exitPresentationMode()
      }
      return
    }
    if (event.key === 'Escape') {
      if (state.povMode) {
        exitPovMode()
      } else if (state.clusterFocusMode) {
        exitClusterFocus()
      } else if (state.connectMode) {
        if (state.connectPhase === 'pick-nodes') {
          connectZoomOut(false)
        } else {
          exitConnectMode()
        }
      }
    }
  })

  window.addEventListener('resize', resizeViewport)

  // Perspective switcher
  document.getElementById('add-perspective-btn')?.addEventListener('click', addPerspective)
}

// ── Helper: sync auto-rotate state across all UI controls ───────────────────

function setAutoRotate(value) {
  state.autoRotate = value
  controls.autoRotate = value
  ui.autoRotateToggle.checked = value
  document.getElementById('autorotate-toggle-btn')?.classList.toggle('active', value)
}

// ── Shared startup-screen helper ────────────────────────────────────────────

async function openStartupProjectBrowser() {
  state.startupView = 'projects'
  state.selectedStartupProjectPath = null
  ui.startupBackBtn.classList.add('hidden')
  ui.startupListHeading.textContent = 'Projects'
  const projects = await window.thesisApp.listProjects()
  renderStartupProjectList(projects || [])
}

// ── Project sanitisation & migration ────────────────────────────────────────

function sanitizeProject(project) {
  const safe = clone(defaultProject)
  safe.meta = {
    title: project?.meta?.title || safe.meta.title,
    subtitle: project?.meta?.subtitle || safe.meta.subtitle,
    autoRotate: project?.meta?.autoRotate !== undefined ? project.meta.autoRotate : true,
    showParticles: project?.meta?.showParticles !== undefined ? project.meta.showParticles : true
  }
  safe.clusters = Array.isArray(project?.clusters) ? project.clusters : safe.clusters
  safe.nodes = Array.isArray(project?.nodes) ? project.nodes : safe.nodes
  safe.links = Array.isArray(project?.links) ? project.links : safe.links
  if (Array.isArray(project?.perspectives) && project.perspectives.length > 0) {
    safe.perspectives = project.perspectives
    safe.activePerspectiveId = project.activePerspectiveId
  }
  if (Array.isArray(project?.presentations)) {
    safe.presentations = project.presentations
  } else if (Array.isArray(project?.presentation?.steps) && project.presentation.steps.length > 0) {
    safe.presentations = [{ id: makeId('pres'), name: 'Presentation 1', steps: project.presentation.steps }]
  } else {
    safe.presentations = []
  }
  return migrateProjectPerspectives(safe)
}

function migrateProjectPerspectives(project) {
  if (!Array.isArray(project.presentations)) project.presentations = []
  if (!Array.isArray(project.perspectives) || project.perspectives.length === 0) {
    const id = makeId('p')
    project.perspectives = [{
      id,
      name: 'Perspective 1',
      clusters: project.clusters || [],
      nodes: project.nodes || [],
      links: project.links || []
    }]
    project.activePerspectiveId = id
  }
  if (!project.perspectives.find((p) => p.id === project.activePerspectiveId)) {
    project.activePerspectiveId = project.perspectives[0].id
  }
  const active = project.perspectives.find((p) => p.id === project.activePerspectiveId)
  if (active) {
    project.clusters = active.clusters || []
    project.nodes = active.nodes || []
    project.links = active.links || []
  }
  return project
}

function getActivePerspective() {
  if (!state.project.perspectives) return null
  return state.project.perspectives.find((p) => p.id === state.project.activePerspectiveId)
    || state.project.perspectives[0]
    || null
}

function syncActivePerspective() {
  const active = getActivePerspective()
  if (active) {
    active.clusters = state.project.clusters
    active.nodes = state.project.nodes
    active.links = state.project.links
  }
}

// ── Theme ───────────────────────────────────────────────────────────────────

function setGroupShellOpacity(group, opacity) {
  group.children.forEach((child) => {
    if (child.isPoints && child.material) child.material.opacity = opacity
  })
}

function applySceneTheme() {
  if (state.darkMode) {
    scene.background = new THREE.Color(0x000000)
    scene.fog = new THREE.FogExp2(0x050505, 0.004)
    if (world.atmosphere?.material) world.atmosphere.material.opacity = 0.28
    world.floorGroup.children.forEach((child, index) => {
      if (child.material) {
        child.material.color.set(index === 0 ? 0x0a0a0a : 0x1f2a30)
        child.material.opacity = index === 0 ? 0.9 : 0.2
      }
    })
  } else {
    scene.background = new THREE.Color(0xe3e8ea)
    scene.fog = new THREE.FogExp2(0xd9e0e3, 0.006)
    if (world.atmosphere?.material) world.atmosphere.material.opacity = 0.18
    world.floorGroup.children.forEach((child, index) => {
      if (child.material) {
        child.material.color.set(index === 0 ? 0xf3f5f2 : 0xcfdade)
        child.material.opacity = index === 0 ? 0.94 : 0.42 - (index - 1) * 0.08
      }
    })
  }

  const occColor = state.darkMode ? 0x050505 : 0xe3e8ea
  state.occlusionMap.forEach((occ) => {
    occ.mesh.material.color.set(occColor)
  })

  updateClusterLabels()
  document.getElementById('viewport-shell').classList.toggle('light-bg', !state.darkMode)
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrapApp() {
  try {
    const bootstrap = await window.thesisApp.getBootstrap()
    state.currentProjectPath = bootstrap?.currentProjectPath || null
    state.startupView = 'projects'
    state.selectedStartupProjectPath = null

    ui.startupBackBtn.classList.add('hidden')
    ui.startupListHeading.textContent = 'Projects'
    renderStartupProjectList(bootstrap?.recentProjects || [])

    if (bootstrap?.lastProjectPath) {
      const recent = (bootstrap.recentProjects || []).find((p) => p.projectPath === bootstrap.lastProjectPath)
      ui.startupRecentMeta.textContent = recent
        ? `Most recent project: ${recent.title}`
        : 'Most recent project available'
    } else {
      ui.startupRecentMeta.textContent = 'No recent project found yet'
    }
  } catch {
    ui.startupRecentMeta.textContent = 'Could not load recent projects'
  }
}

function showWorkspace() {
  ui.startupScreen.classList.add('hidden')
  ui.appShell.classList.remove('hidden-app')
  autoResizeAllClusters()
  distributeAllClusters()
  refreshAll()

  // Restore saved toggle settings
  const meta = state.project.meta
  if (meta.autoRotate !== undefined) setAutoRotate(meta.autoRotate)
  if (meta.showParticles !== undefined) {
    state.showParticles = meta.showParticles
    if (world.atmosphere) world.atmosphere.visible = state.showParticles
    document.getElementById('particles-toggle-btn')?.classList.toggle('active', state.showParticles)
  }

  renderPerspectiveSwitcher()
  resizeViewport()
  markClean()
}

// ── Startup screen rendering ────────────────────────────────────────────────

function renderStartupProjectList(projects) {
  ui.startupProjectList.innerHTML = ''

  if (!projects.length) {
    ui.startupProjectList.innerHTML = `<div class="helper-text">No saved projects yet. Create a new project to begin.</div>`
    return
  }

  projects.slice(0, 24).forEach((project) => {
    const item = document.createElement('div')
    item.className = 'startup-project-item'

    const formatted = project.latestSaveModifiedAt
      ? new Date(project.latestSaveModifiedAt).toLocaleString()
      : 'No saves yet'

    const mainBtn = document.createElement('button')
    mainBtn.type = 'button'
    mainBtn.className = 'startup-project-main-btn'
    mainBtn.innerHTML = `
      <div class="startup-project-main">
        <div class="startup-project-title">${escapeHtml(project.title)}</div>
        <div class="startup-project-sub">${project.saveCount} save${project.saveCount === 1 ? '' : 's'}</div>
      </div>
      <div class="startup-project-date">${formatted}</div>
    `
    mainBtn.addEventListener('click', async () => {
      state.startupView = 'saves'
      state.selectedStartupProjectPath = project.projectPath
      ui.startupBackBtn.classList.remove('hidden')
      ui.startupListHeading.textContent = `${project.title} — Saves`
      const saves = await window.thesisApp.listProjectSaves(project.projectPath)
      renderStartupSaveList(project, saves || [])
    })

    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'startup-project-delete-btn'
    deleteBtn.title = 'Delete project'
    deleteBtn.textContent = '✕'
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (deleteBtn.dataset.confirming === 'true') return
      deleteBtn.dataset.confirming = 'true'
      deleteBtn.textContent = 'Delete?'
      deleteBtn.classList.add('confirming')

      const cancel = () => {
        deleteBtn.dataset.confirming = ''
        deleteBtn.textContent = '✕'
        deleteBtn.classList.remove('confirming')
        document.removeEventListener('click', onClickOutside)
      }

      const onClickOutside = (ev) => {
        if (!deleteBtn.contains(ev.target)) cancel()
      }
      document.addEventListener('click', onClickOutside)

      deleteBtn.onclick = async (ev) => {
        ev.stopPropagation()
        document.removeEventListener('click', onClickOutside)
        const result = await window.thesisApp.deleteProject(project.projectPath)
        if (result?.ok) {
          item.remove()
          showToast(`"${project.title}" deleted`)
          if (!ui.startupProjectList.querySelector('.startup-project-item')) {
            ui.startupProjectList.innerHTML = `<div class="helper-text">No saved projects yet. Create a new project to begin.</div>`
          }
        } else {
          showToast('Could not delete project')
          cancel()
        }
      }
    })

    item.appendChild(mainBtn)
    item.appendChild(deleteBtn)
    ui.startupProjectList.appendChild(item)
  })
}

function renderStartupSaveList(project, saves) {
  ui.startupProjectList.innerHTML = ''

  if (!saves.length) {
    ui.startupProjectList.innerHTML = `<div class="helper-text">This project does not have any saves yet.</div>`
    return
  }

  saves.forEach((save, index) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'startup-project-item'

    const formatted = save.modifiedAt ? new Date(save.modifiedAt).toLocaleString() : 'Unknown date'

    item.innerHTML = `
      <div class="startup-project-main">
        <div class="startup-project-title">${escapeHtml(save.title || `Save ${saves.length - index}`)}</div>
        <div class="startup-project-sub">${escapeHtml(save.name)}</div>
      </div>
      <div class="startup-project-date">${formatted}</div>
    `

    item.addEventListener('click', async () => {
      const result = await window.thesisApp.loadProjectByPath(save.filePath)
      if (!result?.ok || !result.data) {
        showToast('Could not open save')
        return
      }
      state.project = sanitizeProject(result.data)
      state.currentProjectPath = result.projectPath || null
      clearSelection()
      showWorkspace()
      renderPerspectiveSwitcher()
      showToast('Save loaded')
    })

    ui.startupProjectList.appendChild(item)
  })
}

// BUG FIX: simple HTML escaping to prevent XSS from project/save titles
function escapeHtml(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

async function handleLoadRecentProject() {
  const result = await window.thesisApp.loadRecentProject()
  if (!result?.ok || !result.data) {
    showToast('No recent project found')
    return
  }
  state.project = sanitizeProject(result.data)
  state.currentProjectPath = result.projectPath || null
  clearSelection()
  showWorkspace()
  renderPerspectiveSwitcher()
  showToast('Recent project loaded')
}

async function handleCreateNewProject() {
  state.project = migrateProjectPerspectives(clone(defaultProject))
  clearSelection()
  const result = await window.thesisApp.createProject(state.project)
  if (!result?.canceled) {
    state.currentProjectPath = result.projectPath || null
  }
  showWorkspace()
  showToast('New project created')
}

function openSaveVersionModal() {
  ui.saveVersionName.value = ''
  ui.saveVersionModal.classList.remove('hidden')
  requestAnimationFrame(() => ui.saveVersionName.focus())
}

function closeSaveVersionModal() {
  ui.saveVersionModal.classList.add('hidden')
  ui.saveVersionName.value = ''
}

// ── Refresh helpers ─────────────────────────────────────────────────────────

function markDirty() {
  const btn = document.getElementById('save-project-btn')
  btn.classList.remove('clean')
  btn.classList.add('dirty')
}

function markClean() {
  const btn = document.getElementById('save-project-btn')
  btn.classList.remove('dirty')
  btn.classList.add('clean')
}

function refreshAll() {
  syncProjectPath()
  syncSelectOptions()
  syncForms()
  updateHud()
  renderLists()
  rebuildScene()
  refreshPanelsOnly()
  markDirty()
}

function refreshPanelsOnly() {
  syncForms()
  renderLists()
  updateSelectionCard()
}

function syncProjectPath() {
  ui.projectPath.textContent = state.currentProjectPath || 'Unsaved project'
}

function updateHud() {
  const title = (state.project.meta.title || 'SYSTEM MAP').toUpperCase()
  ui.hudSubtitle.textContent = state.project.meta.subtitle || 'Research / presentation workspace'
  ui.hudTitleText.textContent = title
  const countStr = `${state.project.clusters.length} clusters · ${state.project.nodes.length} nodes · ${state.project.links.length} links`
  ui.hudCounts.textContent = countStr
  const countsEl = document.getElementById('hud-counts-sidebar')
  if (countsEl) countsEl.textContent = countStr
}

// ── Sidebar list rendering ──────────────────────────────────────────────────

function renderLists() {
  ui.clusterNodeTree.innerHTML = ''
  const query = state.sidebarSearchQuery.trim().toLowerCase()
  const isSearching = query.length > 0
  state.project.clusters.forEach((cluster) => {
    const clusterNodesAll = state.project.nodes.filter((n) => n.clusterId === cluster.id)
    const matchingNodes = isSearching
      ? clusterNodesAll.filter((n) => n.label.toLowerCase().includes(query))
      : clusterNodesAll
    const clusterNameMatches = isSearching && cluster.name.toLowerCase().includes(query)
    if (isSearching && matchingNodes.length === 0 && !clusterNameMatches) return

    const isExpanded = isSearching ? true : cluster.id === state.expandedClusterId
    const isActiveCluster = cluster.id === state.selectedClusterId && !state.selectedNodeId

    const wrapper = document.createElement('div')
    wrapper.className = 'accordion-cluster'

    const header = document.createElement('div')
    header.className = `accordion-header${isActiveCluster ? ' active' : ''}${isExpanded ? ' expanded' : ''}`

    // Color swatch
    const swatchWrap = document.createElement('div')
    swatchWrap.className = 'swatch-wrap'
    swatchWrap.style.cssText = `width:14px;height:14px;border-radius:50%;background:${cluster.color};flex-shrink:0;cursor:pointer;border:1px solid rgba(255,255,255,0.12);`
    swatchWrap.addEventListener('click', (e) => {
      e.stopPropagation()
      document.querySelectorAll('.swatch-popover').forEach(p => p.remove())
      const pop = document.createElement('div')
      pop.className = 'swatch-popover'
      pop.addEventListener('click', (e) => e.stopPropagation())
      CLUSTER_COLORS.forEach(({ hex }) => {
        const s = document.createElement('div')
        s.className = 'swatch-option'
        s.style.cssText = `width:22px;height:22px;border-radius:50%;background:${hex};cursor:pointer;flex-shrink:0;`
        if (cluster.color === hex) { s.style.outline = '2px solid rgba(255,255,255,0.6)'; s.style.outlineOffset = '2px' }
        s.addEventListener('click', (ev) => {
          ev.stopPropagation()
          cluster.color = hex
          pop.remove()
          rebuildScene()
          renderLists()
        })
        pop.appendChild(s)
      })
      swatchWrap.appendChild(pop)
      setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0)
    })

    header.innerHTML = `<span class="chevron">▶</span>`
    header.appendChild(swatchWrap)
    const nameText = document.createElement('span')
    nameText.className = 'accordion-label'
    nameText.textContent = cluster.name
    header.appendChild(nameText)
    const countSpan = document.createElement('span')
    countSpan.className = 'node-count'
    countSpan.textContent = countNodesInCluster(cluster.id)
    header.appendChild(countSpan)

    header.addEventListener('click', () => {
      state.expandedClusterId = state.expandedClusterId === cluster.id ? null : cluster.id
      selectCluster(cluster.id)
      refreshPanelsOnly()
      updateThreeSelection()
      enterClusterFocus(cluster.id)
    })
    wrapper.appendChild(header)

    const nodesContainer = document.createElement('div')
    nodesContainer.className = `accordion-nodes${isExpanded ? ' open' : ''}`

    const clusterNodes = isSearching ? matchingNodes : clusterNodesAll
    clusterNodes.forEach((node) => {
      const isActive = node.id === state.selectedNodeId
      const el = document.createElement('div')
      el.className = `list-item${isActive ? ' active' : ''}`
      if (isActive) {
        const hex = cluster.color || '#7ea9b6'
        const rgb = hexToRgb(hex)
        el.style.background = `rgba(${rgb},0.12)`
        el.style.setProperty('--node-color', hex)
      }
      el.innerHTML = `<div class="list-item-title" style="${isActive ? `color:${cluster.color};font-weight:500` : ''}">${escapeHtml(node.label)}</div>`
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        selectNode(node.id)
        state.expandedClusterId = cluster.id
        refreshPanelsOnly()
        updateThreeSelection()
      })
      nodesContainer.appendChild(el)
    })

    wrapper.appendChild(nodesContainer)
    ui.clusterNodeTree.appendChild(wrapper)
  })
}

function syncForms() {
  ui.brandTitle.textContent = state.project.meta.title || 'Thesis System Map'
  ui.autoRotateToggle.checked = state.autoRotate
  const countsEl = document.getElementById('hud-counts-sidebar')
  if (countsEl) countsEl.textContent = `${state.project.clusters.length} clusters · ${state.project.nodes.length} nodes · ${state.project.links.length} links`
}

function syncSelectOptions() {
  // Kept for refreshAll compatibility
}

// ── CRUD operations ─────────────────────────────────────────────────────────

function deleteSelectedCluster() {
  if (!state.selectedClusterId) return
  const removedNodes = new Set(state.project.nodes.filter((n) => n.clusterId === state.selectedClusterId).map((n) => n.id))
  state.project.clusters = state.project.clusters.filter((c) => c.id !== state.selectedClusterId)
  state.project.nodes = state.project.nodes.filter((n) => n.clusterId !== state.selectedClusterId)
  state.project.links = state.project.links.filter((l) => !removedNodes.has(l.source) && !removedNodes.has(l.target))
  clearSelection()
  refreshAll()
}

function deleteSelectedNode() {
  if (!state.selectedNodeId) return
  const node = getNode(state.selectedNodeId)
  const clusterId = node?.clusterId
  state.project.nodes = state.project.nodes.filter((n) => n.id !== state.selectedNodeId)
  state.project.links = state.project.links.filter((l) => l.source !== state.selectedNodeId && l.target !== state.selectedNodeId)
  clearSelection()
  if (clusterId) {
    autoResizeCluster(clusterId)
    distributeNodesInCluster(clusterId)
  }
  refreshAll()
}

function deleteSelectedLink() {
  if (!state.selectedLinkId) return
  state.project.links = state.project.links.filter((l) => l.id !== state.selectedLinkId)
  clearSelection()
  refreshAll()
}

function autoResizeCluster(clusterId) {
  const cluster = getCluster(clusterId)
  if (!cluster) return
  const count = countNodesInCluster(clusterId)
  cluster.radius = count === 0 ? 0.7 : clamp(1.0 + Math.sqrt(count) * 0.5, 1.0, 5)
}

function autoResizeAllClusters() {
  state.project.clusters.forEach((c) => autoResizeCluster(c.id))
}

// ── 3D scene rebuild ────────────────────────────────────────────────────────

function rebuildScene() {
  disposeGroup(world.nodesGroup)
  disposeGroup(world.linksGroup)

  // Save rotation state so staying clusters don't visually skip on rebuild
  const savedRotations = new Map()
  state.shellMap.forEach((entry, id) => {
    savedRotations.set(id, { rotY: entry.rotY, angle: entry.group.rotation.y })
  })

  // Dispose tracked shells (leaving groups stay for animation)
  state.shellMap.forEach((entry) => {
    world.shellsGroup.remove(entry.group)
    entry.group.traverse((obj) => {
      obj.geometry?.dispose?.()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
      else obj.material?.dispose?.()
    })
  })
  state.occlusionMap.forEach((occ) => {
    world.occlusionShellsGroup.remove(occ.mesh)
    occ.mesh.geometry?.dispose?.()
    occ.mesh.material?.dispose?.()
  })
  state.nodeMeshMap.clear()
  state.linkMeshMap.clear()
  state.shellMap.clear()
  state.occlusionMap.clear()
  state.signalMap.clear()

  // BUG FIX: clean up DOM labels on rebuild to prevent leaks
  removeZoomNodeLabels()
  removePovLabels()

  buildClusterShells()

  // Restore rotation state for clusters that were already visible
  state.shellMap.forEach((entry, id) => {
    const saved = savedRotations.get(id)
    if (saved) {
      entry.group.rotation.y = saved.angle
      entry.rotY = saved.rotY
    }
  })

  buildNodes()
  buildLinks()
  rebuildClusterLabels()
  updateThreeSelection()
}

function buildClusterShells() {
  state.project.clusters.forEach((cluster) => {
    const group = new THREE.Group()
    group.position.set(cluster.position.x, cluster.position.y, cluster.position.z)

    const shellPoints = createClusterSurfacePoints(cluster)
    group.add(shellPoints)

    const faintCore = new THREE.Mesh(
      new THREE.SphereGeometry(cluster.radius * 0.985, 28, 20),
      new THREE.MeshBasicMaterial({
        color: cluster.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    faintCore.userData.clusterId = cluster.id
    group.add(faintCore)

    world.shellsGroup.add(group)
    state.shellMap.set(cluster.id, {
      group,
      hitMesh: faintCore,
      rotY: 0.00042 + Math.random() * 0.00028
    })

    // Soft occlusion shell: hides clusters behind this one when camera looks through
    const occMesh = new THREE.Mesh(
      new THREE.SphereGeometry(cluster.radius * 0.92, 24, 16),
      new THREE.MeshBasicMaterial({
        color: state.darkMode ? 0x050505 : 0xe3e8ea,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    )
    occMesh.position.set(cluster.position.x, cluster.position.y, cluster.position.z)
    occMesh.renderOrder = -1
    world.occlusionShellsGroup.add(occMesh)
    state.occlusionMap.set(cluster.id, {
      mesh: occMesh,
      currentOpacity: 0,
      targetOpacity: 0
    })
  })
}

function createDotTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.45, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.7)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createClusterSurfacePoints(cluster) {
  const latSteps = 38
  const lonSteps = 62
  const positions = []
  const resolvedColor = new THREE.Color(cluster.color || '#c8dbe2')

  for (let lat = 1; lat < latSteps; lat++) {
    const phi = (lat / latSteps) * Math.PI
    for (let lon = 0; lon < lonSteps; lon++) {
      const theta = (lon / lonSteps) * Math.PI * 2
      positions.push(
        cluster.radius * Math.sin(phi) * Math.cos(theta),
        cluster.radius * Math.cos(phi),
        cluster.radius * Math.sin(phi) * Math.sin(theta)
      )
    }
  }

  // Equator ring
  for (let lon = 0; lon < lonSteps; lon++) {
    const theta = (lon / lonSteps) * Math.PI * 2
    positions.push(
      cluster.radius * Math.cos(theta),
      0,
      cluster.radius * Math.sin(theta)
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: resolvedColor,
    map: DOT_TEXTURE,
    alphaTest: 0.15,
    size: 0.075,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true
  })

  return new THREE.Points(geometry, material)
}

function buildNodes() {
  const coreGeo = new THREE.SphereGeometry(0.14, 28, 28)
  const glowGeo = new THREE.SphereGeometry(0.20, 24, 24)

  state.project.nodes.forEach((node) => {
    const cluster = getCluster(node.clusterId)
    const group = new THREE.Group()
    group.position.set(node.position.x, node.position.y, node.position.z)

    const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }))
    const glowMesh = new THREE.Mesh(
      glowGeo,
      new THREE.MeshBasicMaterial({
        color: cluster?.color || '#c7dce2',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    group.add(coreMesh, glowMesh)
    group.userData = {
      nodeId: node.id,
      basePosition: new THREE.Vector3(node.position.x, node.position.y, node.position.z),
      floatOffset: Math.random() * Math.PI * 2,
      coreMesh,
      glowMesh
    }
    coreMesh.userData.nodeId = node.id
    world.nodesGroup.add(group)
    state.nodeMeshMap.set(node.id, group.userData)
  })
}

function buildLinks() {
  state.project.links.forEach((link) => {
    const source = getNode(link.source)
    const target = getNode(link.target)
    if (!source || !target || source.id === target.id) return

    const curve = computeCurve(source.position, target.position)
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(44))
    const mat = new THREE.LineBasicMaterial({
      color: LINK_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    })
    const line = new THREE.Line(geo, mat)
    line.userData = { linkId: link.id, source: link.source, target: link.target, curve }
    world.linksGroup.add(line)
    state.linkMeshMap.set(link.id, line)

    // Flash overlay
    const flashLine = new THREE.Line(new THREE.BufferGeometry(), createFlashOverlayMaterial())
    flashLine.visible = false
    flashLine.userData = { progress: 0, speed: 0.42, direction: 1 }
    world.linksGroup.add(flashLine)
    state.signalMap.set(link.id, flashLine)
  })
}

// ── Cluster labels (HTML overlay) ───────────────────────────────────────────

function rebuildClusterLabels() {
  state.labelMap.forEach(({ element }) => element.remove())
  state.labelMap.clear()

  state.project.clusters.forEach((cluster) => {
    const wrap = document.createElement('div')
    wrap.className = 'system-label'
    wrap.innerHTML = `
      <div class="system-label-inner">
        <div class="system-label-line"></div>
        <div class="system-label-text" style="color:${cluster.color}">${escapeHtml(cluster.name).toUpperCase()}</div>
      </div>`
    document.getElementById('viewport-shell').appendChild(wrap)
    state.labelMap.set(cluster.id, {
      element: wrap,
      position: new THREE.Vector3(cluster.position.x, cluster.position.y + cluster.radius + 0.5, cluster.position.z)
    })
  })
  updateClusterLabels()
}

function updateClusterLabels() {
  const povEased = easeInOutCubic(state.povAnimProgress)
  const povClusterId = state.povMode ? getNode(state.povNodeId)?.clusterId : null
  const rect = ui.sceneRoot.getBoundingClientRect()
  const entries = []

  state.labelMap.forEach(({ element, position }, clusterId) => {
    if (state.povMode && (clusterId === povClusterId || !state.povRelevantClusterIds.has(clusterId))) {
      element.style.display = 'none'
      return
    }
    const pos = position.clone()
    if (state.povOffsets.size > 0) {
      const offset = state.povOffsets.get(clusterId)
      if (offset) {
        pos.x += offset.x * povEased
        pos.y += offset.y * povEased
        pos.z += offset.z * povEased
      }
    }
    const sp = pos.project(camera)
    if (sp.z > 1) { element.style.display = 'none'; return }
    const x = (sp.x * 0.5 + 0.5) * rect.width
    const y = (-sp.y * 0.5 + 0.5) * rect.height
    const cluster = getCluster(clusterId)
    const nameLen = cluster?.name?.length || 8
    const estW = nameLen * 7.5 + 32
    entries.push({ element, x, y, w: estW, h: 46 })
  })

  // Screen-space deconfliction
  entries.sort((a, b) => a.y - b.y)
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j]
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 8) {
        const minDist = (a.h + b.h) / 2 + 10
        if (b.y - a.y < minDist) b.y = a.y + minDist
      }
    }
  }

  entries.forEach(({ element, x, y }) => {
    element.style.display = 'block'
    element.style.transform = `translate(${x}px, ${y}px)`
  })
}

// ── 3D selection state ──────────────────────────────────────────────────────

function updateThreeSelection() {
  if (state.povMode) {
    dimNonConnected()
    removeSelectionSprite()

    if (state.selectedLinkId) {
      // Dim all other POV links
      state.linkMeshMap.forEach((line, linkId) => {
        const isPovLink = line.userData.source === state.povNodeId || line.userData.target === state.povNodeId
        if (isPovLink && linkId !== state.selectedLinkId) {
          line.material.opacity = 0.15
          const sig = state.signalMap.get(linkId)
          if (sig) { sig.visible = false; sig.material.uniforms.uFlashStrength.value = 0 }
        }
      })

      const line = state.linkMeshMap.get(state.selectedLinkId)
      if (line) {
        line.material.color.setHex(ACTIVE_LINK)
        line.material.opacity = 1
        line.material.linewidth = 2
      }

      const signal = state.signalMap.get(state.selectedLinkId)
      if (signal) {
        signal.visible = true
        signal.material.uniforms.uFlashStrength.value = 2
        signal.userData.progress = 0
        const selLine = state.linkMeshMap.get(state.selectedLinkId)
        if (selLine) signal.userData.direction = selLine.userData.source === state.povNodeId ? 1 : -1
      }
    }
    return
  }

  resetVisualState()
  removeSelectionSprite()

  if (state.selectedNodeId) {
    highlightNodeRelations(state.selectedNodeId)
    attachSelectionSprite(state.selectedNodeId)
    return
  }

  if (state.selectedClusterId) {
    state.project.nodes
      .filter((node) => node.clusterId === state.selectedClusterId)
      .forEach((node) => {
        const entry = state.nodeMeshMap.get(node.id)
        if (!entry) return
        entry.coreMesh.material.opacity = 1
        entry.glowMesh.material.opacity = 0.28
      })
  }

  if (state.selectedLinkId) {
    const line = state.linkMeshMap.get(state.selectedLinkId)
    if (line) {
      line.material.color.setHex(ACTIVE_LINK)
      line.material.opacity = 1
    }
  }
}

function resetVisualState() {
  state.nodeMeshMap.forEach((entry, nodeId) => {
    const node = getNode(nodeId)
    const cluster = getCluster(node?.clusterId)
    entry.coreMesh.material.color.setHex(0xffffff)
    entry.coreMesh.material.opacity = 0.92
    entry.glowMesh.material.color.set(cluster?.color || '#c7dce2')
    entry.glowMesh.material.opacity = 0.18
  })

  state.linkMeshMap.forEach((line) => {
    line.material.color.setHex(LINK_COLOR)
    line.material.opacity = 0.28
  })

  state.signalMap.forEach((signal) => {
    signal.visible = false
    signal.material.uniforms.uFlashStrength.value = 0
  })

  state.shellMap.forEach((entry) => {
    entry.group.visible = true
    entry.group.children.forEach((child) => {
      if (child.isPoints && child.material) child.material.opacity = 1
    })
  })
}

function highlightNodeRelations(nodeId) {
  const connected = new Set([nodeId])

  state.linkMeshMap.forEach((line, linkId) => {
    const active = line.userData.source === nodeId || line.userData.target === nodeId
    if (active) {
      line.material.color.setHex(ACTIVE_LINK)
      line.material.opacity = 1
      connected.add(line.userData.source)
      connected.add(line.userData.target)
      const signal = state.signalMap.get(linkId)
      if (signal) {
        signal.visible = true
        signal.material.uniforms.uFlashStrength.value = 1
        signal.userData.progress = 0
        signal.userData.direction = line.userData.source === nodeId ? 1 : -1
      }
    } else {
      line.material.color.setHex(INACTIVE_LINK)
      line.material.opacity = 0.04
    }
  })

  state.nodeMeshMap.forEach((entry, id) => {
    if (connected.has(id)) {
      const selected = id === nodeId
      entry.coreMesh.material.color.setHex(0xffffff)
      entry.coreMesh.material.opacity = selected ? 1 : 0.92
      entry.glowMesh.material.opacity = selected ? 0.34 : 0.22
    } else {
      entry.coreMesh.material.color.setHex(DIM_COLOR)
      entry.coreMesh.material.opacity = 0.38
      entry.glowMesh.material.opacity = 0.08
    }
  })

  state.shellMap.forEach((entry, clusterId) => {
    const hasConnected = state.project.nodes.some((n) => n.clusterId === clusterId && connected.has(n.id))
    if (!hasConnected) {
      entry.group.children.forEach((child) => {
        if (child.isPoints && child.material) child.material.opacity = 0.38
      })
    }
  })
}

function attachSelectionSprite(nodeId) {
  const node = getNode(nodeId)
  const cluster = getCluster(node?.clusterId)
  if (!node || !cluster) return
  const sprite = createTextSprite(node.label, cluster.color)
  sprite.userData.nodeId = nodeId
  sprite.position.set(node.position.x, node.position.y + 0.42, node.position.z)
  world.selectionSprite = sprite
  scene.add(sprite)
}

function removeSelectionSprite() {
  if (!world.selectionSprite) return
  scene.remove(world.selectionSprite)
  world.selectionSprite.material.map.dispose()
  world.selectionSprite.material.dispose()
  world.selectionSprite = null
}

function createTextSprite(text, hexColor) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = '600 21px "Inter", "Helvetica Neue", Arial, sans-serif'
  ctx.font = font
  const tw = ctx.measureText(text).width
  canvas.width = Math.ceil(tw + 48)
  canvas.height = 52
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillRect(8, 10, canvas.width - 16, canvas.height - 20)
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1
  ctx.strokeRect(8.5, 10.5, canvas.width - 17, canvas.height - 21)
  ctx.fillStyle = hexColor
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 0.5)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(canvas.width * 0.0058, canvas.height * 0.0058, 1)
  return sprite
}

// ── Relation overlay (POV mode) ─────────────────────────────────────────────

const OVERLAY_WIDTH_PX = 420
let _overlayAppliedShift = 0
let _overlayShiftActive = false

function _computeOverlayShiftAmount() {
  const canvasW = renderer.domElement.clientWidth
  if (!canvasW) return 0
  const camDist = camera.position.distanceTo(controls.target)
  const fovRad = (camera.fov * Math.PI) / 180
  const worldWidth = 2 * camDist * Math.tan(fovRad / 2) * camera.aspect
  return (OVERLAY_WIDTH_PX / canvasW) * worldWidth * 0.5
}

function povOverlayShift(show, dir) {
  if (!state.povMode) return
  const newTarget = controls.target.clone()

  if (show) {
    newTarget.x -= _overlayAppliedShift
    const shift = _computeOverlayShiftAmount()
    const delta = dir * shift
    newTarget.x += delta
    _overlayAppliedShift = delta
    _overlayShiftActive = true
    document.getElementById('relation-overlay').classList.toggle('panel-right', dir === 1)
  } else {
    newTarget.x -= _overlayAppliedShift
    _overlayAppliedShift = 0
    _overlayShiftActive = false
    document.getElementById('relation-overlay').classList.remove('panel-right')
  }

  animateCamera(camera.position.clone(), newTarget, 0.45)
}

function showRelationOverlay(link, source, target) {
  const overlay = document.getElementById('relation-overlay')
  overlay.classList.remove('visible')
  void overlay.offsetWidth

  document.getElementById('relation-overlay-label').textContent =
    `RELATION · ${source?.label || ''} → ${target?.label || ''}`
  document.getElementById('relation-overlay-name').textContent = link.label || 'Untitled relation'
  document.getElementById('relation-overlay-note').textContent = link.note || ''
  document.getElementById('relation-overlay-edit-btn').onclick = () => openRelationEditCard(link, source, target)
  overlay.classList.add('visible')

  const connectedNode = (source?.id === state.povNodeId) ? target : source
  let dir = -1
  if (connectedNode) {
    const entry = state.nodeMeshMap.get(connectedNode.id)
    if (entry) {
      const worldX = entry.coreMesh.parent.position.x
      const sceneCenterX = controls.target.x - _overlayAppliedShift
      if (worldX > sceneCenterX) dir = 1
    }
  }

  povOverlayShift(true, dir)
}

function hideRelationOverlay(skipShift = false) {
  const wasVisible = document.getElementById('relation-overlay').classList.contains('visible')
  document.getElementById('relation-overlay').classList.remove('visible')
  closeRelationEditCard()
  if (skipShift) return
  if (wasVisible && _overlayShiftActive) povOverlayShift(false)
  else { _overlayShiftActive = false; _overlayAppliedShift = 0 }
}

function openRelationEditCard(link, source, target) {
  const card = document.getElementById('relation-edit-card')
  card.innerHTML = `
    <div class="tag" style="margin-bottom:10px;">Edit relation</div>
    <div class="field">
      <span>Name</span>
      <input id="rec-name" type="text" value="${escapeHtml(link.label || '')}" placeholder="Relation name" />
    </div>
    <div class="field" style="margin-top:8px;">
      <span>Note</span>
      <textarea id="rec-note" rows="4">${escapeHtml(link.note || '')}</textarea>
    </div>
    <div class="toolbar-row" style="margin-top:10px;">
      <button id="rec-done-btn" class="small-btn">Done</button>
      <button id="rec-delete-btn" class="small-btn danger-btn">Delete</button>
    </div>`
  document.getElementById('rec-name').addEventListener('input', (e) => {
    link.label = e.target.value
    showRelationOverlay(link, source, target)
    document.getElementById('relation-overlay-edit-btn').onclick = () => openRelationEditCard(link, source, target)
  })
  document.getElementById('rec-note').addEventListener('input', (e) => {
    link.note = e.target.value
    document.getElementById('relation-overlay-note').textContent = link.note
  })
  document.getElementById('rec-done-btn').addEventListener('click', closeRelationEditCard)
  document.getElementById('rec-delete-btn').addEventListener('click', deleteSelectedLink)
  card.classList.add('visible')
}

function closeRelationEditCard() {
  document.getElementById('relation-edit-card').classList.remove('visible')
}

// ── Node / cluster indicators ───────────────────────────────────────────────

function showNodeIndicator(node) {
  // Exit cluster focus if active (mutually exclusive)
  if (state.clusterFocusMode) exitClusterFocus()

  const nodeCluster = getCluster(node.clusterId)
  const relations = state.project.links.filter((l) => l.source === node.id || l.target === node.id).length
  const inConnectMode = state.connectMode && state.connectSourceId === node.id

  document.getElementById('node-indicator-name').textContent = node.label
  document.getElementById('node-indicator-name').style.color = nodeCluster?.color || '#fff'
  document.getElementById('node-indicator-meta').textContent =
    `${nodeCluster?.name || 'Unknown'} · ${relations} relation${relations === 1 ? '' : 's'}`

  const nameEl = document.getElementById('node-indicator-name')
  const actionsEl = document.getElementById('node-indicator-actions')
  actionsEl.innerHTML = ''

  const makeBtn = (label, extraClass) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.className = `indicator-btn${extraClass ? ' ' + extraClass : ''}`
    actionsEl.appendChild(btn)
    return btn
  }

  makeBtn('Rename').onclick = () => {
    const current = node.label
    nameEl.contentEditable = 'true'
    nameEl.focus()
    const range = document.createRange()
    range.selectNodeContents(nameEl)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const finish = () => {
      nameEl.contentEditable = 'false'
      const newLabel = nameEl.textContent.trim() || current
      nameEl.textContent = newLabel
      node.label = newLabel
      renderLists()
      rebuildScene()
      refreshPanelsOnly()
    }
    nameEl.onblur = finish
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() } }
  }

  makeBtn(inConnectMode ? 'Exit connect' : 'Connect').onclick = () => {
    if (state.connectMode) { exitConnectMode() } else { enterConnectMode(node.id) }
    refreshPanelsOnly()
  }

  if (relations > 0) {
    makeBtn('View connections').onclick = () => enterPovMode(node.id)
  }

  makeBtn('Delete', 'danger-indicator').onclick = () => {
    const nodeId = node.id
    const cid = node.clusterId
    state.project.nodes = state.project.nodes.filter((n) => n.id !== nodeId)
    state.project.links = state.project.links.filter((l) => l.source !== nodeId && l.target !== nodeId)
    clearSelection()
    if (cid) { autoResizeCluster(cid); distributeNodesInCluster(cid) }
    refreshAll()
  }

  makeBtn('Exit focus').onclick = () => {
    clearSelection()
    refreshPanelsOnly()
    updateThreeSelection()
  }

  document.getElementById('node-indicator').classList.remove('hidden')
}

function hideNodeIndicator() {
  document.getElementById('node-indicator').classList.add('hidden')
}

function updateSelectionCard() {
  const cluster = selectedCluster()
  const node = selectedNode()
  const link = selectedLink()

  if (state.connectMode && state.connectPhase) {
    ui.selectionCard.classList.add('hidden')
    hideRelationOverlay()
    hideNodeIndicator()
    return
  }

  if (state.povMode && !link) {
    ui.selectionCard.classList.add('hidden')
    hideRelationOverlay()
    hideNodeIndicator()
    return
  }

  if (!cluster && !node && !link) {
    ui.selectionCard.classList.add('hidden')
    hideNodeIndicator()
    return
  }

  ui.selectionCard.classList.add('hidden')

  if (node) {
    showNodeIndicator(node)
    return
  }

  if (cluster) {
    hideNodeIndicator()
    return
  }

  if (link) {
    const source = getNode(link.source)
    const target = getNode(link.target)
    if (state.povMode) {
      ui.selectionCard.classList.add('hidden')
      showRelationOverlay(link, source, target)
      return
    } else {
      ui.selectionCard.classList.remove('hidden')
      ui.selectionCard.classList.remove('pov-link-focus')
      ui.selectionCard.innerHTML = `
        <div class="tag">Relation focus</div>
        <div class="card-title-row">
          <div class="title">${escapeHtml(link.label || 'Untitled relation')}</div>
          <button id="sc-rename-link-btn" class="icon-btn" title="Rename">✎</button>
        </div>
        <div id="sc-rename-link-field" class="card-edit-field hidden">
          <input id="sc-link-name-input" type="text" value="${escapeHtml(link.label || '')}" placeholder="Relation name" />
        </div>
        <div class="card-title-row" style="margin-top:8px;">
          <div class="text" style="margin:0;">${escapeHtml(link.note || 'No note yet.')}</div>
          <button id="sc-edit-link-note-btn" class="icon-btn" title="Edit note">✎</button>
        </div>
        <div id="sc-edit-link-note-field" class="card-edit-field hidden">
          <textarea id="sc-link-note-input" rows="3">${escapeHtml(link.note || '')}</textarea>
        </div>
        <div class="meta">
          <div class="meta-row"><span>Source</span><strong>${escapeHtml(source?.label || link.source)}</strong></div>
          <div class="meta-row"><span>Target</span><strong>${escapeHtml(target?.label || link.target)}</strong></div>
        </div>
        <div class="toolbar-row" style="margin-top:10px;">
          <button id="sc-delete-link-btn" class="small-btn danger-btn">Delete relation</button>
        </div>`
      document.getElementById('sc-edit-link-note-btn').addEventListener('click', () => {
        const field = document.getElementById('sc-edit-link-note-field')
        field.classList.toggle('hidden')
        if (!field.classList.contains('hidden')) document.getElementById('sc-link-note-input').focus()
      })
      document.getElementById('sc-rename-link-btn').addEventListener('click', () => {
        const field = document.getElementById('sc-rename-link-field')
        field.classList.toggle('hidden')
        if (!field.classList.contains('hidden')) document.getElementById('sc-link-name-input').focus()
      })
      document.getElementById('sc-link-name-input').addEventListener('input', (e) => { link.label = e.target.value })
      document.getElementById('sc-link-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sc-rename-link-field').classList.add('hidden'); updateSelectionCard() }
      })
      document.getElementById('sc-link-note-input').addEventListener('input', (e) => { link.note = e.target.value })
      document.getElementById('sc-delete-link-btn').addEventListener('click', deleteSelectedLink)
    }
  }
}

// ── Selection helpers ───────────────────────────────────────────────────────

function selectedCluster() { return state.project.clusters.find((c) => c.id === state.selectedClusterId) || null }
function selectedNode() { return state.project.nodes.find((n) => n.id === state.selectedNodeId) || null }
function selectedLink() { return state.project.links.find((l) => l.id === state.selectedLinkId) || null }
function getCluster(id) { return state.project.clusters.find((c) => c.id === id) || null }
function getNode(id) { return state.project.nodes.find((n) => n.id === id) || null }
function countNodesInCluster(clusterId) { return state.project.nodes.filter((n) => n.clusterId === clusterId).length }

function selectCluster(id) {
  state.selectedClusterId = id
  state.selectedNodeId = null
  state.selectedLinkId = null
}

function selectNode(id) {
  state.selectedNodeId = id
  state.selectedLinkId = null
  const node = getNode(id)
  state.selectedClusterId = node?.clusterId || null
  state.expandedClusterId = node?.clusterId || state.expandedClusterId
}

function selectLink(id) {
  state.selectedLinkId = id
  state.selectedNodeId = null
  state.selectedClusterId = null
  state.relationEditMode = false
}

function clearSelection() {
  if (state.clusterFocusMode) exitClusterFocus()
  state.selectedClusterId = null
  state.selectedNodeId = null
  state.selectedLinkId = null
  if (state.connectMode) exitConnectMode()
}

// ── Connect mode ────────────────────────────────────────────────────────────

function enterConnectMode(sourceId) {
  state.connectMode = true
  state.connectSourceId = sourceId
  state.connectPhase = 'pick-cluster'
  state.connectTargetClusterId = null
  state.hoveredNodeId = null
  state.hoveredClusterId = null
  renderer.domElement.style.cursor = 'crosshair'

  document.getElementById('connect-hud').classList.remove('hidden')
  document.getElementById('connect-hud-source').textContent = getNode(sourceId)?.label || sourceId
  document.getElementById('connect-hud-hint').textContent = 'Click a cluster to zoom in · Escape to exit'
  document.getElementById('connect-hud-back-btn').classList.add('hidden')

  state.savedCameraState = { pos: camera.position.clone(), target: controls.target.clone() }
}

function exitConnectMode() {
  const wasInNodes = state.connectPhase === 'pick-nodes'
  state.connectMode = false
  state.connectSourceId = null
  state.connectPhase = null
  state.connectTargetClusterId = null
  state.hoveredNodeId = null
  state.hoveredClusterId = null
  renderer.domElement.style.cursor = ''
  document.getElementById('connect-hud').classList.add('hidden')

  removeZoomNodeLabels()

  if (world.connectLine) {
    scene.remove(world.connectLine)
    world.connectLine.geometry.dispose()
    world.connectLine.material.dispose()
    world.connectLine = null
  }

  state.shellMap.forEach((entry) => { entry.hitMesh.material.opacity = 0 })
  controls.minDistance = 10

  if (wasInNodes && state.savedCameraState) {
    animateCamera(state.savedCameraState.pos, state.savedCameraState.target, 0.8, () => { state.savedCameraState = null })
  } else {
    state.savedCameraState = null
  }

  refreshAll()
}

// ── POV mode ────────────────────────────────────────────────────────────────

function enterPovMode(nodeId) {
  if (state.clusterFocusMode) exitClusterFocus()
  hideNodeIndicator()

  state.povMode = true
  state.povNodeId = nodeId
  state.selectedNodeId = null
  state.selectedLinkId = null
  removeSelectionSprite()

  // Collapse sidebar
  document.getElementById('sidebar').classList.add('collapsed')
  document.getElementById('app-shell').classList.add('sidebar-collapsed')

  state.povSavedCameraState = { pos: camera.position.clone(), target: controls.target.clone() }
  setAutoRotate(false)

  const povNode = getNode(nodeId)
  if (!povNode) return
  const povClusterId = povNode.clusterId

  const connectedNodeIds = new Set()
  state.project.links.forEach((l) => {
    if (l.source === nodeId) connectedNodeIds.add(l.target)
    if (l.target === nodeId) connectedNodeIds.add(l.source)
  })

  const relevantClusterIds = new Set()
  state.project.nodes.forEach((n) => {
    if (connectedNodeIds.has(n.id)) relevantClusterIds.add(n.clusterId)
  })
  relevantClusterIds.delete(povClusterId)
  state.povRelevantClusterIds = relevantClusterIds

  const relevantClusters = state.project.clusters.filter((c) => relevantClusterIds.has(c.id))
  const origin = new THREE.Vector3(povNode.position.x, povNode.position.y, povNode.position.z)

  // Arrange clusters
  state.povOffsets.clear()
  const count = relevantClusters.length
  const depth = 12
  const MIN_GAP = 2.2
  const sorted = [...relevantClusters].sort((a, b) => b.radius - a.radius)
  const targetPositions = new Map()

  if (count === 1) {
    targetPositions.set(sorted[0].id, origin.clone().add(new THREE.Vector3(0, 0, -depth)))
  } else if (count > 1) {
    targetPositions.set(sorted[0].id, origin.clone().add(new THREE.Vector3(0, 0, -depth)))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], curr = sorted[i]
      const prevPos = targetPositions.get(prev.id)
      const spacing = prev.radius + curr.radius + MIN_GAP
      const yDir = (i % 2 === 1) ? 1 : -1
      const angle = yDir * Math.PI / 5
      targetPositions.set(curr.id, new THREE.Vector3(
        prevPos.x + Math.cos(angle) * spacing,
        prevPos.y + Math.sin(angle) * spacing,
        prevPos.z
      ))
    }
    // Resolve overlaps
    for (let iter = 0; iter < 8; iter++) {
      let anyOverlap = false
      for (let a = 0; a < sorted.length; a++) {
        for (let b = a + 1; b < sorted.length; b++) {
          const ca = sorted[a], cb = sorted[b]
          const pa = targetPositions.get(ca.id), pb = targetPositions.get(cb.id)
          const needed = ca.radius + cb.radius + MIN_GAP
          const dx = pb.x - pa.x, dy = pb.y - pa.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < needed) {
            anyOverlap = true
            const push = (needed - dist) / 2 + 0.001
            const nx = dist > 0.0001 ? dx / dist : 1
            const ny = dist > 0.0001 ? dy / dist : 0
            pa.x -= nx * push; pa.y -= ny * push
            pb.x += nx * push; pb.y += ny * push
          }
        }
      }
      if (!anyOverlap) break
    }
    // Center arrangement
    let cx = 0, cy = 0
    targetPositions.forEach((pos) => { cx += pos.x; cy += pos.y })
    cx /= count; cy /= count
    const centerOffset = new THREE.Vector3(origin.x - cx, origin.y - cy, 0)
    targetPositions.forEach((pos) => pos.add(centerOffset))
  }

  relevantClusters.forEach((cluster) => {
    const targetPos = targetPositions.get(cluster.id)
    if (!targetPos) return
    state.povOffsets.set(cluster.id, new THREE.Vector3(
      targetPos.x - cluster.position.x,
      targetPos.y - cluster.position.y,
      targetPos.z - cluster.position.z
    ))
  })

  state.povAnimProgress = 0
  state.povAnimDirection = 1
  dimNonConnected()

  // Camera target
  let lookAt = new THREE.Vector3()
  let lookCount = 0
  relevantClusters.forEach((cluster) => {
    const offset = state.povOffsets.get(cluster.id) || new THREE.Vector3()
    lookAt.add(new THREE.Vector3(
      cluster.position.x + offset.x,
      cluster.position.y + offset.y,
      cluster.position.z + offset.z
    ))
    lookCount++
  })
  if (lookCount > 0) lookAt.divideScalar(lookCount)

  const dir = new THREE.Vector3().subVectors(origin, lookAt).normalize()
  const camPos = origin.clone().add(dir.multiplyScalar(6)).add(new THREE.Vector3(0, 3, 0))

  controls.minDistance = 1
  controls.enabled = false

  // POV indicator
  const povCluster = getCluster(povClusterId)
  const connectionCount = connectedNodeIds.size
  document.getElementById('pov-indicator-name').textContent = povNode.label
  document.getElementById('pov-indicator-name').style.color = povCluster?.color || 'var(--text)'
  document.getElementById('pov-indicator-meta').textContent = `${connectionCount} connection${connectionCount === 1 ? '' : 's'} · ${povCluster?.name || ''}`
  document.getElementById('pov-indicator-exit-btn').onclick = exitPovMode
  document.getElementById('pov-indicator').classList.remove('hidden')

  animateCamera(camPos, lookAt, 1.0, () => {
    buildPovLabels()
    updateSelectionCard()
  })
}

function resumePovMode(nodeId, { skipLabels = false } = {}) {
  const povNode = getNode(nodeId)
  if (!povNode) return
  const povClusterId = povNode.clusterId

  state.povMode = true
  state.povNodeId = nodeId
  state.povSavedCameraState = null

  const connectedNodeIds = new Set()
  state.project.links.forEach((l) => {
    if (l.source === nodeId) connectedNodeIds.add(l.target)
    if (l.target === nodeId) connectedNodeIds.add(l.source)
  })

  const relevantClusterIds = new Set()
  state.project.nodes.forEach((n) => {
    if (connectedNodeIds.has(n.id)) relevantClusterIds.add(n.clusterId)
  })
  relevantClusterIds.delete(povClusterId)
  state.povRelevantClusterIds = relevantClusterIds

  const relevantClusters = state.project.clusters.filter((c) => relevantClusterIds.has(c.id))
  const origin = new THREE.Vector3(povNode.position.x, povNode.position.y, povNode.position.z)

  state.povOffsets.clear()
  const count = relevantClusters.length
  const depth = 12
  const MIN_GAP = 2.2
  const sorted = [...relevantClusters].sort((a, b) => b.radius - a.radius)
  const targetPositions = new Map()

  if (count === 1) {
    targetPositions.set(sorted[0].id, origin.clone().add(new THREE.Vector3(0, 0, -depth)))
  } else if (count > 1) {
    targetPositions.set(sorted[0].id, origin.clone().add(new THREE.Vector3(0, 0, -depth)))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], curr = sorted[i]
      const prevPos = targetPositions.get(prev.id)
      const spacing = prev.radius + curr.radius + MIN_GAP
      const yDir = (i % 2 === 1) ? 1 : -1
      const angle = yDir * Math.PI / 5
      targetPositions.set(curr.id, new THREE.Vector3(
        prevPos.x + Math.cos(angle) * spacing,
        prevPos.y + Math.sin(angle) * spacing,
        prevPos.z
      ))
    }

    // Resolve overlaps
    for (let iter = 0; iter < 8; iter++) {
      let anyOverlap = false
      for (let a = 0; a < sorted.length; a++) {
        for (let b = a + 1; b < sorted.length; b++) {
          const ca = sorted[a], cb = sorted[b]
          const pa = targetPositions.get(ca.id), pb = targetPositions.get(cb.id)
          const needed = ca.radius + cb.radius + MIN_GAP
          const dx = pb.x - pa.x, dy = pb.y - pa.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < needed) {
            anyOverlap = true
            const push = (needed - dist) / 2 + 0.001
            const nx = dist > 0.0001 ? dx / dist : 1
            const ny = dist > 0.0001 ? dy / dist : 0
            pa.x -= nx * push; pa.y -= ny * push
            pb.x += nx * push; pb.y += ny * push
          }
        }
      }
      if (!anyOverlap) break
    }

    // Re-center
    let cx = 0, cy = 0
    targetPositions.forEach((pos) => { cx += pos.x; cy += pos.y })
    cx /= count; cy /= count
    const centerOffset = new THREE.Vector3(origin.x - cx, origin.y - cy, 0)
    targetPositions.forEach((pos) => pos.add(centerOffset))
  }

  relevantClusters.forEach((cluster) => {
    const targetPos = targetPositions.get(cluster.id)
    if (!targetPos) return
    state.povOffsets.set(cluster.id, new THREE.Vector3(
      targetPos.x - cluster.position.x,
      targetPos.y - cluster.position.y,
      targetPos.z - cluster.position.z
    ))
  })

  state.povAnimProgress = 1
  state.povAnimDirection = 0
  controls.minDistance = 1
  controls.enabled = false

  dimNonConnected()

  const povCluster = getCluster(povClusterId)
  const connectionCount = connectedNodeIds.size
  document.getElementById('pov-indicator-name').textContent = povNode.label
  document.getElementById('pov-indicator-name').style.color = povCluster?.color || 'var(--text)'
  document.getElementById('pov-indicator-meta').textContent = `${connectionCount} connection${connectionCount === 1 ? '' : 's'} · ${povCluster?.name || ''}`
  document.getElementById('pov-indicator-exit-btn').onclick = exitPovMode
  document.getElementById('pov-indicator').classList.remove('hidden')

  document.getElementById('sidebar').classList.add('collapsed')
  document.getElementById('app-shell').classList.add('sidebar-collapsed')
  setAutoRotate(false)

  if (!skipLabels) {
    buildPovLabels()
    updateSelectionCard()
  }
}

function exitPovMode() {
  state.selectedLinkId = null
  state.relationEditMode = false
  removePovLabels()
  hideRelationOverlay(true)
  document.getElementById('pov-indicator').classList.add('hidden')

  // Expand sidebar (but not during presentation mode — it stays collapsed there)
  if (!state.presentationMode) {
    document.getElementById('sidebar').classList.remove('collapsed')
    document.getElementById('app-shell').classList.remove('sidebar-collapsed')
  }

  state.povAnimDirection = -1

  state.shellMap.forEach((entry) => { entry.group.visible = true })
  world.floorGroup.visible = true
  if (world.atmosphere) world.atmosphere.visible = state.showParticles

  resetVisualState()
  controls.minDistance = 10
  // BUG FIX: re-enable orbit controls on POV exit
  controls.enabled = true

  const clusterCentroid = new THREE.Vector3()
  if (state.project.clusters.length > 0) {
    state.project.clusters.forEach((c) => {
      clusterCentroid.x += c.position.x
      clusterCentroid.y += c.position.y
      clusterCentroid.z += c.position.z
    })
    clusterCentroid.divideScalar(state.project.clusters.length)
  }

  const onDone = () => {
    state.povMode = false
    state.povNodeId = null
    state.povOffsets.clear()
    state.povRelevantClusterIds.clear()
    state.povAnimProgress = 0
    state.povAnimDirection = 0
    _overlayShiftActive = false
    _overlayAppliedShift = 0
  }

  if (state.povSavedCameraState) {
    animateCamera(state.povSavedCameraState.pos, state.povSavedCameraState.target, 1.0)
    state.povSavedCameraState = null
  } else {
    let maxDist = 0
    state.project.clusters.forEach((c) => {
      const dx = c.position.x - clusterCentroid.x
      const dy = c.position.y - clusterCentroid.y
      const dz = c.position.z - clusterCentroid.z
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + (c.radius || 2.4)
      if (r > maxDist) maxDist = r
    })
    const fovRad = (camera.fov * Math.PI) / 180
    const camDist = Math.max((maxDist / Math.tan(fovRad / 2)) * 1.3, 18)
    const toPos = clusterCentroid.clone().add(new THREE.Vector3(0, 0, camDist))
    animateCamera(toPos, clusterCentroid, 1.0)
  }

  state.povAnimDirection = -1
  const waitForExit = setInterval(() => {
    if (state.povAnimProgress <= 0) {
      clearInterval(waitForExit)
      onDone()
    }
  }, 16)

  clearSelection()
  refreshPanelsOnly()
}

// ── Cluster focus mode ──────────────────────────────────────────────────────

function enterClusterFocus(clusterId) {
  const cluster = getCluster(clusterId)
  if (!cluster) return
  if (state.clusterFocusMode && state.clusterFocusId === clusterId) return

  state.clusterFocusMode = true
  state.clusterFocusId = clusterId

  state.shellMap.forEach((entry, id) => {
    entry.group.children.forEach((child) => {
      if (child.isPoints && child.material) child.material.opacity = id === clusterId ? 1 : 0.25
    })
  })
  state.nodeMeshMap.forEach((entry, nodeId) => {
    const node = getNode(nodeId)
    const inFocus = node?.clusterId === clusterId
    entry.coreMesh.material.opacity = inFocus ? 0.92 : 0.06
    entry.glowMesh.material.opacity = inFocus ? 0.18 : 0.02
  })

  const nodeCount = countNodesInCluster(clusterId)
  const indicator = document.getElementById('cluster-indicator')
  const nameEl = document.getElementById('cluster-indicator-name')
  const metaEl = document.getElementById('cluster-indicator-meta')

  nameEl.textContent = cluster.name
  nameEl.style.color = cluster.color
  metaEl.textContent = `${nodeCount} node${nodeCount === 1 ? '' : 's'}`

  const actionsEl = document.getElementById('cluster-indicator-actions')
  actionsEl.innerHTML = ''
  const makeBtn = (label, extraClass) => {
    const btn = document.createElement('button')
    btn.className = `indicator-btn${extraClass ? ' ' + extraClass : ''}`
    btn.textContent = label
    actionsEl.appendChild(btn)
    return btn
  }

  makeBtn('Rename').onclick = () => {
    const current = cluster.name
    nameEl.contentEditable = 'true'
    nameEl.focus()
    const range = document.createRange()
    range.selectNodeContents(nameEl)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const finish = () => {
      nameEl.contentEditable = 'false'
      const newName = nameEl.textContent.trim() || current
      nameEl.textContent = newName
      cluster.name = newName
      renderLists()
      rebuildScene()
      refreshPanelsOnly()
    }
    nameEl.onblur = finish
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() } }
  }

  makeBtn('Add Node').onclick = () => {
    const id = makeId('node')
    const p = createNodePositionNearCluster(cluster)
    const existingCount = state.project.nodes.filter((n) => n.clusterId === cluster.id).length
    const label = `${cluster.name} ${existingCount + 1}`
    state.project.nodes.push({ id, clusterId: cluster.id, label, position: p, note: '' })
    autoResizeCluster(cluster.id)
    distributeNodesInCluster(cluster.id)
    rebuildScene()
    state.nodeMeshMap.forEach((entry, nodeId) => {
      const node = getNode(nodeId)
      const inFocus = node?.clusterId === clusterId
      entry.coreMesh.material.opacity = inFocus ? 0.92 : 0.06
      entry.glowMesh.material.opacity = inFocus ? 0.18 : 0.02
    })
    metaEl.textContent = `${countNodesInCluster(clusterId)} node${countNodesInCluster(clusterId) === 1 ? '' : 's'}`
    renderLists()
    refreshPanelsOnly()
  }

  makeBtn('Delete', 'danger-indicator').onclick = () => {
    const removedNodes = new Set(state.project.nodes.filter((n) => n.clusterId === clusterId).map((n) => n.id))
    state.project.clusters = state.project.clusters.filter((c) => c.id !== clusterId)
    state.project.nodes = state.project.nodes.filter((n) => n.clusterId !== clusterId)
    state.project.links = state.project.links.filter((l) => !removedNodes.has(l.source) && !removedNodes.has(l.target))
    exitClusterFocus()
    refreshAll()
  }

  document.getElementById('cluster-indicator-exit-btn').onclick = exitClusterFocus
  indicator.classList.remove('hidden')
}

function exitClusterFocus() {
  if (!state.clusterFocusMode) return
  state.clusterFocusMode = false
  state.clusterFocusId = null
  document.getElementById('cluster-indicator').classList.add('hidden')

  state.shellMap.forEach((entry) => {
    entry.group.children.forEach((child) => {
      if (child.isPoints && child.material) child.material.opacity = 1
    })
  })
  state.nodeMeshMap.forEach((entry) => {
    entry.coreMesh.material.opacity = 0.92
    entry.glowMesh.material.opacity = 0.18
  })

  clearSelection()
  refreshPanelsOnly()
}

// ── Perspective switching ───────────────────────────────────────────────────

function renderPerspectiveSwitcher() {
  const perspectives = state.project.perspectives || []
  const activeId = state.project.activePerspectiveId
  const listEl = document.getElementById('perspective-list')
  if (!listEl) return
  listEl.innerHTML = ''

  perspectives.forEach((p) => {
    const item = document.createElement('div')
    item.className = `perspective-pill${p.id === activeId ? ' active' : ''}`
    item.title = p.id !== activeId ? `Switch to ${p.name}` : ''

    const nameSpan = document.createElement('span')
    nameSpan.className = 'perspective-pill-name'
    nameSpan.textContent = p.name
    nameSpan.contentEditable = p.id === activeId ? 'true' : 'false'
    nameSpan.spellcheck = false
    nameSpan.addEventListener('blur', () => { p.name = nameSpan.textContent.trim() || p.name; renderPerspectiveSwitcher() })
    nameSpan.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur() } })
    nameSpan.addEventListener('click', (e) => {
      if (p.id === activeId) { e.stopPropagation(); return }
      switchPerspective(p.id)
    })
    item.addEventListener('click', () => {
      if (p.id !== activeId) switchPerspective(p.id)
    })
    item.appendChild(nameSpan)

    if (perspectives.length > 1) {
      const del = document.createElement('button')
      del.className = 'perspective-delete-btn'
      del.title = 'Delete perspective'
      del.textContent = '✕'
      del.addEventListener('click', (e) => { e.stopPropagation(); deletePerspective(p.id) })
      item.appendChild(del)
    }

    listEl.appendChild(item)
  })
}

function addPerspective() {
  syncActivePerspective()
  const id = makeId('p')
  const num = (state.project.perspectives?.length || 0) + 1
  state.project.perspectives = state.project.perspectives || []
  state.project.perspectives.push({
    id,
    name: `Perspective ${num}`,
    clusters: clone(state.project.clusters),
    nodes: clone(state.project.nodes),
    links: clone(state.project.links)
  })
  switchPerspective(id)
}

function deletePerspective(id) {
  if (!state.project.perspectives || state.project.perspectives.length <= 1) return
  const idx = state.project.perspectives.findIndex((p) => p.id === id)
  if (idx === -1) return
  state.project.perspectives.splice(idx, 1)
  if (state.project.activePerspectiveId === id) {
    const next = state.project.perspectives[0]
    state.project.activePerspectiveId = next.id
    state.project.clusters = clone(next.clusters)
    state.project.nodes = clone(next.nodes)
    state.project.links = clone(next.links)
    rebuildScene()
    refreshAll()
  }
  renderPerspectiveSwitcher()
}

function switchPerspective(newId) {
  if (state.project.activePerspectiveId === newId) return
  const newPerspective = state.project.perspectives?.find((p) => p.id === newId)
  if (!newPerspective) return

  // Finish any in-progress transition
  if (state.perspectiveTransition?.active) {
    const old = state.perspectiveTransition
    scene.remove(old.transitionGroup)
    disposeGroup(old.transitionGroup)
    state.perspectiveTransition = null
  }

  const wasInPov = state.povMode
  const savedPovNodeId = state.povNodeId
  const oldPovRelevantClusterIds = new Set(state.povRelevantClusterIds)

  const oldConnectedNodeIds = new Set()
  if (wasInPov && savedPovNodeId) {
    state.project.links.forEach((l) => {
      if (l.source === savedPovNodeId) oldConnectedNodeIds.add(l.target)
      if (l.target === savedPovNodeId) oldConnectedNodeIds.add(l.source)
    })
  }

  let savedLinkLabel = null
  if (state.povMode) {
    if (state.cameraAnim?.active) {
      state.cameraAnim.active = false
      state.cameraAnim.onComplete = null
    }
    removePovLabels()
    if (state.selectedLinkId) {
      const selLink = state.project.links.find((l) => l.id === state.selectedLinkId)
      savedLinkLabel = selLink?.label || null
    }
    hideRelationOverlay(true)
    state.selectedLinkId = null
    state.relationEditMode = false
  }

  if (state.connectMode) exitConnectMode()
  if (state.clusterFocusMode) exitClusterFocus()
  hideNodeIndicator()

  // Capture frozen POV positions for smooth transition
  const frozenPovPosByName = new Map()
  if (wasInPov) {
    const nextNames = new Set(newPerspective.clusters.map((c) => c.name))
    state.project.clusters.forEach((cluster) => {
      if (nextNames.has(cluster.name)) {
        const entry = state.shellMap.get(cluster.id)
        if (entry) frozenPovPosByName.set(cluster.name, entry.group.position.clone())
      }
    })
  }

  // Capture old positions
  const oldByName = new Map()
  const oldNodePos = new Map()
  state.project.clusters.forEach((cluster) => {
    const entry = state.shellMap.get(cluster.id)
    if (entry) {
      oldByName.set(cluster.name, {
        pos: new THREE.Vector3(cluster.position.x, cluster.position.y, cluster.position.z),
        radius: cluster.radius || 2.4
      })
    }
  })
  state.project.nodes.forEach((node) => {
    const meshEntry = state.nodeMeshMap.get(node.id)
    if (meshEntry) oldNodePos.set(node.id, meshEntry.coreMesh.parent.position.clone())
  })

  // Separate leaving clusters
  const newNames = new Set(newPerspective.clusters.map((c) => c.name))
  const leavingEntries = []
  const leavingOcclusions = []
  state.project.clusters.forEach((cluster) => {
    if (!newNames.has(cluster.name)) {
      const entry = state.shellMap.get(cluster.id)
      if (entry) {
        const labelEntry = state.labelMap.get(cluster.id)
        if (labelEntry) { labelEntry.element.remove(); state.labelMap.delete(cluster.id) }
        world.leavingShellsGroup.add(entry.group)
        leavingEntries.push({
          group: entry.group,
          basePos: new THREE.Vector3(cluster.position.x, cluster.position.y, cluster.position.z)
        })
        state.shellMap.delete(cluster.id)
      }
      // Preserve occlusion mesh so it can fade out without being disposed by rebuildScene
      const occ = state.occlusionMap.get(cluster.id)
      if (occ) {
        leavingOcclusions.push(occ)
        state.occlusionMap.delete(cluster.id)
      }
    }
  })

  // POV mode: clusters that were relevant but become non-relevant → animate out like leavingEntries
  if (wasInPov && savedPovNodeId) {
    const newConn = new Set()
    newPerspective.links.forEach((l) => {
      if (l.source === savedPovNodeId) newConn.add(l.target)
      if (l.target === savedPovNodeId) newConn.add(l.source)
    })
    const newPovNodeData = newPerspective.nodes.find((n) => n.id === savedPovNodeId)
    const newPovRelIds = new Set()
    newPerspective.nodes.forEach((n) => {
      if (newConn.has(n.id) && n.clusterId !== newPovNodeData?.clusterId) newPovRelIds.add(n.clusterId)
    })
    state.project.clusters.forEach((cluster) => {
      if (!newNames.has(cluster.name)) return // already in leavingEntries
      if (!oldPovRelevantClusterIds.has(cluster.id)) return // wasn't relevant in old POV
      if (newPovRelIds.has(cluster.id)) return // stays relevant in new POV
      // Loses relevance → animate out
      const entry = state.shellMap.get(cluster.id)
      if (entry) {
        const labelEntry = state.labelMap.get(cluster.id)
        if (labelEntry) { labelEntry.element.remove(); state.labelMap.delete(cluster.id) }
        world.leavingShellsGroup.add(entry.group)
        leavingEntries.push({ group: entry.group, basePos: entry.group.position.clone() })
        state.shellMap.delete(cluster.id)
      }
      const occ = state.occlusionMap.get(cluster.id)
      if (occ) { leavingOcclusions.push(occ); state.occlusionMap.delete(cluster.id) }
    })
  }

  const transitionGroup = new THREE.Group()
  scene.add(transitionGroup)

  // Switch data
  syncActivePerspective()
  state.project.activePerspectiveId = newId
  state.project.clusters = clone(newPerspective.clusters)
  state.project.nodes = clone(newPerspective.nodes)
  state.project.links = clone(newPerspective.links)

  separateClusters(state.project.clusters)
  rebuildScene()
  syncProjectPath()
  syncForms()
  updateHud()
  renderLists()
  refreshPanelsOnly()

  // Resume POV if needed
  let povOffsetFrozens = null
  let povOffsetTargets = null

  if (wasInPov && savedPovNodeId && getNode(savedPovNodeId)) {
    resumePovMode(savedPovNodeId, { skipLabels: true })

    povOffsetTargets = new Map()
    state.povOffsets.forEach((off, id) => povOffsetTargets.set(id, off.clone()))

    povOffsetFrozens = new Map()
    frozenPovPosByName.forEach((frozen, name) => {
      const cluster = state.project.clusters.find((c) => c.name === name)
      if (!cluster) return
      const frozenOffset = new THREE.Vector3(
        frozen.x - cluster.position.x,
        frozen.y - cluster.position.y,
        frozen.z - cluster.position.z
      )
      povOffsetFrozens.set(cluster.id, frozenOffset)
      state.povOffsets.set(cluster.id, frozenOffset)
      const entry = state.shellMap.get(cluster.id)
      if (entry) entry.group.position.copy(frozen)
    })

    let hasLayoutChange = false
    povOffsetTargets.forEach((target, id) => {
      if (!povOffsetFrozens.has(id)) { hasLayoutChange = true; return }
      if (povOffsetFrozens.get(id).distanceToSquared(target) > 0.1) hasLayoutChange = true
    })
    if (povOffsetFrozens.size !== povOffsetTargets.size) hasLayoutChange = true
    if (!hasLayoutChange) {
      povOffsetTargets = null
      povOffsetFrozens = null
    }

    state.signalMap.forEach((signal) => {
      signal.visible = false
      signal.material.uniforms.uFlashStrength.value = 0
    })
  }

  // Detect nodes changing POV connectivity (appear/disappear animation)
  const appearingNodeIds = new Set()
  const disappearingNodeIds = new Set()
  if (wasInPov && savedPovNodeId && getNode(savedPovNodeId)) {
    const newConnectedNodeIds = new Set()
    state.project.links.forEach((l) => {
      if (l.source === savedPovNodeId) newConnectedNodeIds.add(l.target)
      if (l.target === savedPovNodeId) newConnectedNodeIds.add(l.source)
    })
    state.project.nodes.forEach((node) => {
      if (node.id === savedPovNodeId) return
      const meshEntry = state.nodeMeshMap.get(node.id)
      if (!meshEntry) return
      const wasConnected = oldConnectedNodeIds.has(node.id)
      const isConnected = newConnectedNodeIds.has(node.id)
      if (!wasConnected && isConnected) {
        // Will animate from invisible → visible
        meshEntry.coreMesh.material.opacity = 0
        meshEntry.glowMesh.material.opacity = 0
        meshEntry.coreMesh.parent.scale.setScalar(0)
        appearingNodeIds.add(node.id)
      } else if (wasConnected && !isConnected) {
        // Will animate from visible → invisible
        meshEntry.coreMesh.material.opacity = 1
        meshEntry.glowMesh.material.opacity = 0.45
        disappearingNodeIds.add(node.id)
      }
    })
  }

  // Transition animation
  const clusterMoves = new Map()
  const enteringIds = new Set()
  const nodeMoves = new Map()

  state.project.clusters.forEach((cluster) => {
    const entry = state.shellMap.get(cluster.id)
    if (!entry) return
    const toPos = new THREE.Vector3(cluster.position.x, cluster.position.y, cluster.position.z)
    const old = oldByName.get(cluster.name)
    if (old) {
      const oldR = old.radius || 2.4
      const newR = cluster.radius || 2.4
      const fromScale = Math.abs(oldR - newR) > 0.05 ? oldR / newR : 1
      clusterMoves.set(cluster.id, { fromPos: old.pos.clone(), toPos: toPos.clone(), fromScale })
      entry.group.position.copy(old.pos)
      entry.group.scale.setScalar(fromScale)
    } else {
      enteringIds.add(cluster.id)
      entry.group.scale.setScalar(2.4)
      setGroupShellOpacity(entry.group, 0)
    }
  })

  // Clusters matched by name that are newly relevant in the new POV perspective:
  // they were hidden (visible=false) and now should fade in during the transition.
  const revealingClusterIds = new Set()
  if (wasInPov) {
    state.project.clusters.forEach((cluster) => {
      if (!clusterMoves.has(cluster.id)) return
      if (state.povRelevantClusterIds.has(cluster.id) && !oldPovRelevantClusterIds.has(cluster.id)) {
        const entry = state.shellMap.get(cluster.id)
        if (entry) { setGroupShellOpacity(entry.group, 0); entry.group.scale.setScalar(2.4) }
        revealingClusterIds.add(cluster.id)
      }
    })
  }

  const enteringNodeIds = new Map()
  let newNodeIndex = 0
  state.project.nodes.forEach((node) => {
    const meshEntry = state.nodeMeshMap.get(node.id)
    if (!meshEntry) return
    const oldPos = oldNodePos.get(node.id)
    if (oldPos) {
      if (!wasInPov) {
        const toPos = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
        if (oldPos.distanceToSquared(toPos) > 0.0001) {
          nodeMoves.set(node.id, { fromPos: oldPos.clone(), toPos: toPos.clone() })
          meshEntry.coreMesh.parent.position.copy(oldPos)
          meshEntry.basePosition = oldPos.clone()
        }
      }
    } else {
      const cluster = getCluster(node.clusterId)
      let clusterPos
      if (cluster) {
        const off = state.povOffsets.get(cluster.id)
        clusterPos = off
          ? new THREE.Vector3(cluster.position.x + off.x, cluster.position.y + off.y, cluster.position.z + off.z)
          : new THREE.Vector3(cluster.position.x, cluster.position.y, cluster.position.z)
      } else {
        clusterPos = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
      }
      enteringNodeIds.set(node.id, { clusterPos, delay: newNodeIndex * 0.045 })
      meshEntry.coreMesh.parent.position.copy(clusterPos)
      meshEntry.basePosition = clusterPos.clone()
      meshEntry.coreMesh.parent.scale.setScalar(0)
      meshEntry.coreMesh.material.opacity = 0
      meshEntry.glowMesh.material.opacity = 0
      newNodeIndex++
    }
  })

  // Link draw-on
  const enteringLinkIds = new Map()
  const enteringNodeSet = new Set(enteringNodeIds.keys())
  state.project.links.forEach((link) => {
    const sourceIsNew = enteringNodeSet.has(link.source)
    const targetIsNew = enteringNodeSet.has(link.target)
    if (!sourceIsNew && !targetIsNew && !(wasInPov && (link.source === savedPovNodeId || link.target === savedPovNodeId))) return
    const line = state.linkMeshMap.get(link.id)
    if (!line) return
    line.geometry.setDrawRange(0, 0)
    if (wasInPov && (link.source === savedPovNodeId || link.target === savedPovNodeId)) {
      enteringLinkIds.set(link.id, { reversed: link.target === savedPovNodeId })
    } else {
      enteringLinkIds.set(link.id, { reversed: sourceIsNew && !targetIsNew })
    }
  })

  state.perspectiveTransition = {
    active: true, progress: 0, duration: wasInPov ? 1.4 : 0.9,
    clusterMoves, enteringIds, leavingEntries, transitionGroup,
    nodeMoves, enteringNodeIds, enteringLinkIds, wasInPov, savedPovNodeId,
    povOffsetFrozens, povOffsetTargets, savedLinkLabel,
    appearingNodeIds, disappearingNodeIds, leavingOcclusions, revealingClusterIds
  }

  renderPerspectiveSwitcher()
}

function updatePerspectiveTransition(dt) {
  const tx = state.perspectiveTransition
  if (!tx?.active) return

  tx.progress = Math.min(1, tx.progress + dt / tx.duration)
  const t = easeInOutCubic(tx.progress)

  // POV layout rearrangement
  if (tx.wasInPov && tx.povOffsetFrozens && tx.povOffsetTargets) {
    tx.povOffsetFrozens.forEach((frozen, clusterId) => {
      const target = tx.povOffsetTargets.get(clusterId)
      if (target) state.povOffsets.set(clusterId, new THREE.Vector3().lerpVectors(frozen, target, t))
    })
  }

  // Matched clusters
  tx.clusterMoves.forEach((anim, clusterId) => {
    const entry = state.shellMap.get(clusterId)
    if (entry) {
      if (!tx.wasInPov) entry.group.position.lerpVectors(anim.fromPos, anim.toPos, t)
      if (anim.fromScale !== 1) entry.group.scale.setScalar(anim.fromScale + (1 - anim.fromScale) * t)
    }
  })

  // Node position interpolation
  tx.nodeMoves.forEach((anim, nodeId) => {
    const meshEntry = state.nodeMeshMap.get(nodeId)
    if (meshEntry) {
      const pos = new THREE.Vector3().lerpVectors(anim.fromPos, anim.toPos, t)
      meshEntry.basePosition = pos.clone()
      meshEntry.coreMesh.parent.position.copy(pos)
    }
  })

  // Link draw-on
  const linkStartProgress = 0.65
  const linkLocalT = Math.max(0, Math.min(1, (tx.progress - linkStartProgress) / (1 - linkStartProgress)))
  const linkT = easeInOutCubic(linkLocalT)
  const totalPoints = 45
  tx.enteringLinkIds.forEach(({ reversed }, linkId) => {
    const line = state.linkMeshMap.get(linkId)
    if (!line) return
    const count = Math.round(linkT * totalPoints)
    if (reversed) {
      line.geometry.setDrawRange(totalPoints - count, count)
    } else {
      line.geometry.setDrawRange(0, count)
    }
  })

  // Entering nodes
  tx.enteringNodeIds.forEach((anim, nodeId) => {
    const meshEntry = state.nodeMeshMap.get(nodeId)
    const node = getNode(nodeId)
    if (!meshEntry || !node) return
    const localT = Math.max(0, Math.min(1, (tx.progress - anim.delay / tx.duration) / (1 - anim.delay / tx.duration)))
    const et = easeInOutCubic(localT)
    const toPos = new THREE.Vector3(node.position.x, node.position.y, node.position.z)

    if (tx.wasInPov) {
      const isPovNode = nodeId === tx.savedPovNodeId
      const connectedToPov = state.project.links.some(
        (l) => (l.source === tx.savedPovNodeId && l.target === nodeId) ||
               (l.target === tx.savedPovNodeId && l.source === nodeId)
      )
      if (isPovNode || !connectedToPov) {
        meshEntry.coreMesh.parent.scale.setScalar(0)
        return
      }
      const NODE_START = 0.8
      const nodeLocalT = Math.max(0, Math.min(1, (tx.progress - NODE_START) / (1 - NODE_START)))
      const net = easeInOutCubic(nodeLocalT)
      meshEntry.coreMesh.parent.position.copy(toPos)
      meshEntry.basePosition = toPos.clone()
      meshEntry.coreMesh.parent.scale.setScalar(net)
      meshEntry.coreMesh.material.opacity = net
      meshEntry.glowMesh.material.opacity = 0.45 * net
      return
    }

    const floatY = 0.6 * (1 - et)
    const pos = new THREE.Vector3().lerpVectors(anim.clusterPos, toPos, et)
    pos.y += floatY * (1 - et)
    meshEntry.basePosition = pos.clone()
    meshEntry.coreMesh.parent.position.copy(pos)
    meshEntry.coreMesh.parent.scale.setScalar(et)
    meshEntry.coreMesh.material.opacity = et
    meshEntry.glowMesh.material.opacity = 0.5 * et
  })

  // Disappearing nodes (POV perspective switch: was connected, no longer is)
  if (tx.disappearingNodeIds?.size > 0) {
    const DISAPPEAR_END = 0.45
    tx.disappearingNodeIds.forEach((nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      if (!meshEntry) return
      const disappearT = 1 - Math.min(1, tx.progress / DISAPPEAR_END)
      const dt = easeInOutCubic(disappearT)
      meshEntry.coreMesh.material.opacity = dt
      meshEntry.glowMesh.material.opacity = 0.45 * dt
      meshEntry.coreMesh.parent.scale.setScalar(Math.max(0.001, dt))
    })
  }

  // Appearing nodes (POV perspective switch: newly connected)
  if (tx.appearingNodeIds?.size > 0) {
    const NODE_START = 0.55
    tx.appearingNodeIds.forEach((nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      if (!meshEntry) return
      const nodeLocalT = Math.max(0, Math.min(1, (tx.progress - NODE_START) / (1 - NODE_START)))
      const net = easeInOutCubic(nodeLocalT)
      meshEntry.coreMesh.parent.scale.setScalar(net)
      meshEntry.coreMesh.material.opacity = net
      meshEntry.glowMesh.material.opacity = 0.45 * net
    })
  }

  // Entering clusters (opacity curve clears alphaTest threshold quickly)
  tx.enteringIds.forEach((clusterId) => {
    const entry = state.shellMap.get(clusterId)
    if (entry) {
      entry.group.scale.setScalar(2.4 - 1.4 * t)
      const opacityT = t === 0 ? 0 : Math.pow(t, 0.35)
      setGroupShellOpacity(entry.group, opacityT)
    }
  })

  // Revealing clusters (matched by name, newly relevant in new POV perspective)
  if (tx.revealingClusterIds?.size > 0) {
    tx.revealingClusterIds.forEach((clusterId) => {
      const entry = state.shellMap.get(clusterId)
      if (entry) {
        entry.group.scale.setScalar(2.4 - 1.4 * t)
        const opacityT = tx.progress === 0 ? 0 : Math.pow(tx.progress, 0.35)
        setGroupShellOpacity(entry.group, opacityT)
      }
    })
  }

  // Leaving clusters (opacity stays above alphaTest longer)
  tx.leavingEntries.forEach((leaving) => {
    leaving.group.scale.setScalar(1 + 1.4 * t)
    const opacityT = t === 1 ? 0 : Math.pow(1 - t, 0.35)
    setGroupShellOpacity(leaving.group, opacityT)
  })

  // Leaving occlusions fade out without expanding scale
  if (tx.leavingOcclusions?.length > 0) {
    const occFade = 1 - Math.min(1, tx.progress / 0.5)
    tx.leavingOcclusions.forEach((occ) => {
      occ.currentOpacity = occ.currentOpacity * occFade
      occ.mesh.material.opacity = occ.currentOpacity
      occ.mesh.visible = occ.currentOpacity > 0.005
    })
  }

  // Transition complete
  if (tx.progress >= 1) {
    tx.clusterMoves.forEach((anim, clusterId) => {
      const entry = state.shellMap.get(clusterId)
      if (entry) {
        if (!tx.wasInPov) entry.group.position.copy(anim.toPos)
        entry.group.scale.setScalar(1)
      }
    })
    tx.enteringIds.forEach((clusterId) => {
      const cluster = getCluster(clusterId)
      const entry = state.shellMap.get(clusterId)
      if (entry && cluster) {
        if (!tx.wasInPov) entry.group.position.set(cluster.position.x, cluster.position.y, cluster.position.z)
        entry.group.scale.setScalar(1)
        setGroupShellOpacity(entry.group, 1)
      }
    })
    tx.nodeMoves.forEach((anim, nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      if (meshEntry) {
        meshEntry.basePosition = anim.toPos.clone()
        if (!tx.wasInPov) meshEntry.coreMesh.parent.position.copy(anim.toPos)
      }
    })
    tx.enteringNodeIds.forEach((_anim, nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      const node = getNode(nodeId)
      if (meshEntry && node) {
        const toPos = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
        meshEntry.basePosition = toPos.clone()
        if (!tx.wasInPov) meshEntry.coreMesh.parent.position.copy(toPos)
        meshEntry.coreMesh.parent.scale.setScalar(1)
        if (!tx.wasInPov) {
          meshEntry.coreMesh.material.opacity = 1
          meshEntry.glowMesh.material.opacity = 0.5
        }
      }
    })
    tx.enteringLinkIds.forEach((_anim, linkId) => {
      const line = state.linkMeshMap.get(linkId)
      if (line) line.geometry.setDrawRange(0, Infinity)
    })
    tx.revealingClusterIds?.forEach((clusterId) => {
      const entry = state.shellMap.get(clusterId)
      if (entry) { setGroupShellOpacity(entry.group, 1); entry.group.scale.setScalar(1) }
    })
    tx.appearingNodeIds?.forEach((nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      if (meshEntry) {
        meshEntry.coreMesh.material.opacity = 1
        meshEntry.glowMesh.material.opacity = 0.45
        meshEntry.coreMesh.parent.scale.setScalar(1)
      }
    })
    tx.disappearingNodeIds?.forEach((nodeId) => {
      const meshEntry = state.nodeMeshMap.get(nodeId)
      if (meshEntry) {
        meshEntry.coreMesh.material.opacity = 0
        meshEntry.glowMesh.material.opacity = 0
        meshEntry.coreMesh.parent.scale.setScalar(1)
      }
    })
    tx.leavingEntries.forEach(({ group }) => {
      world.leavingShellsGroup.remove(group)
      group.traverse((obj) => {
        obj.geometry?.dispose?.()
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
        else obj.material?.dispose?.()
      })
    })
    tx.leavingOcclusions?.forEach((occ) => {
      world.occlusionShellsGroup.remove(occ.mesh)
      occ.mesh.geometry?.dispose?.()
      occ.mesh.material?.dispose?.()
    })
    scene.remove(tx.transitionGroup)
    disposeGroup(tx.transitionGroup)

    const wasInPovTx = tx.wasInPov
    const enteringIdsTx = tx.enteringIds
    const savedPovNodeIdTx = tx.savedPovNodeId
    const savedLinkLabelTx = tx.savedLinkLabel
    state.perspectiveTransition = null

    if (wasInPovTx) {
      dimNonConnected()
      enteringIdsTx.forEach((clusterId) => {
        const labelEntry = state.labelMap.get(clusterId)
        if (labelEntry) labelEntry.element.style.display = ''
      })
      buildPovLabels()

      _overlayShiftActive = false
      _overlayAppliedShift = 0
      document.getElementById('relation-overlay').classList.remove('panel-right')

      const connectedNodeIds = new Set()
      state.project.links.forEach((l) => {
        if (l.source === savedPovNodeIdTx) connectedNodeIds.add(l.target)
        if (l.target === savedPovNodeIdTx) connectedNodeIds.add(l.source)
      })
      const relevantClusterIds = new Set()
      state.project.nodes.forEach((n) => {
        if (connectedNodeIds.has(n.id)) relevantClusterIds.add(n.clusterId)
      })
      let lookAt = new THREE.Vector3()
      let lookCount = 0
      relevantClusterIds.forEach((clusterId) => {
        const cluster = getCluster(clusterId)
        if (!cluster) return
        const offset = state.povOffsets.get(clusterId) || new THREE.Vector3()
        lookAt.add(new THREE.Vector3(cluster.position.x + offset.x, cluster.position.y + offset.y, cluster.position.z + offset.z))
        lookCount++
      })
      if (lookCount > 0) lookAt.divideScalar(lookCount)

      const restoredLink = savedLinkLabelTx
        ? state.project.links.find(
            (l) => l.label === savedLinkLabelTx &&
                   (l.source === savedPovNodeIdTx || l.target === savedPovNodeIdTx)
          )
        : null

      animateCamera(camera.position.clone(), lookAt, 0.6, () => {
        if (restoredLink) {
          selectLink(restoredLink.id)
          refreshPanelsOnly()
        } else {
          updateSelectionCard()
        }
      })
    }
  }
}

function dimNonConnected() {
  const connected = new Set([state.povNodeId])
  state.project.links.forEach((l) => {
    if (l.source === state.povNodeId) connected.add(l.target)
    if (l.target === state.povNodeId) connected.add(l.source)
  })

  const povNode = getNode(state.povNodeId)
  const povClusterId = povNode?.clusterId
  const relevantClusterIds = new Set()
  state.project.nodes.forEach((n) => {
    if (connected.has(n.id)) relevantClusterIds.add(n.clusterId)
  })

  state.nodeMeshMap.forEach((entry, id) => {
    if (id === state.povNodeId) {
      entry.coreMesh.material.opacity = 0
      entry.glowMesh.material.opacity = 0
    } else if (connected.has(id)) {
      entry.coreMesh.material.opacity = 1
      entry.glowMesh.material.opacity = 0.45
    } else {
      entry.coreMesh.material.opacity = 0
      entry.glowMesh.material.opacity = 0
    }
  })

  state.linkMeshMap.forEach((line, linkId) => {
    const active = line.userData.source === state.povNodeId || line.userData.target === state.povNodeId
    line.material.opacity = active ? 0.35 : 0
    const signal = state.signalMap.get(linkId)
    if (signal) {
      if (active && !state.perspectiveTransition) {
        signal.visible = true
        signal.material.uniforms.uFlashStrength.value = 2
        signal.userData.direction = line.userData.source === state.povNodeId ? 1 : -1
      } else {
        signal.visible = false
        signal.material.uniforms.uFlashStrength.value = 0
      }
    }
  })

  const enteringDuringTx = state.perspectiveTransition?.enteringIds
  state.shellMap.forEach((entry, clusterId) => {
    if (clusterId === povClusterId || !relevantClusterIds.has(clusterId)) {
      entry.group.visible = false
      const labelEntry = state.labelMap.get(clusterId)
      if (labelEntry) labelEntry.element.style.display = 'none'
    } else {
      const labelEntry = state.labelMap.get(clusterId)
      if (labelEntry && enteringDuringTx?.has(clusterId)) labelEntry.element.style.display = 'none'
    }
  })

  world.floorGroup.visible = false
  if (world.atmosphere) world.atmosphere.visible = false
}

// ── POV labels ──────────────────────────────────────────────────────────────

function buildPovLabels() {
  removePovLabels()
  const viewport = document.getElementById('viewport-shell')

  state.project.links.forEach((link) => {
    let targetId = null
    if (link.source === state.povNodeId) targetId = link.target
    if (link.target === state.povNodeId) targetId = link.source
    if (!targetId) return

    const node = getNode(targetId)
    const cluster = getCluster(node?.clusterId)
    const color = cluster?.color || '#aabbcc'
    const rgb = hexToRgb(color)
    const el = document.createElement('div')
    el.className = 'pov-label'
    el.innerHTML = `
      <div class="pov-label-box" style="
        background: rgba(8,8,16,0.78);
        border: 1px solid rgba(${rgb},0.45);
        border-radius: 20px;
        padding: 5px 13px;
      ">
        <div class="pov-label-name" style="color:${color};font-size:12px;font-weight:500;">${escapeHtml(node?.label || targetId)}</div>
      </div>`
    viewport.appendChild(el)
    state.povLabelMap.set(targetId, { element: el })
  })
}

function removePovLabels() {
  state.povLabelMap.forEach(({ element }) => element.remove())
  state.povLabelMap.clear()
}

function updatePovLabels() {
  if (state.povLabelMap.size === 0) return
  const rect = ui.sceneRoot.getBoundingClientRect()
  const GAP = 8
  const PAD = 6

  const entries = []
  state.povLabelMap.forEach(({ element }, nodeId) => {
    const entry = state.nodeMeshMap.get(nodeId)
    if (!entry) { element.style.display = 'none'; return }
    const sp = entry.coreMesh.parent.position.clone().project(camera)
    if (sp.z > 1) { element.style.display = 'none'; return }
    const nx = (sp.x * 0.5 + 0.5) * rect.width
    const ny = (-sp.y * 0.5 + 0.5) * rect.height
    const node = getNode(nodeId)
    const nameLen = (node?.label || '').length
    const w = Math.max(nameLen * 7 + 26, 70)
    const h = 40
    entries.push({ element, nx, ny, x: nx, y: ny - GAP, w, h })
  })

  // Deconfliction
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j]
        const overlapX = (a.w + b.w) / 2 + PAD - Math.abs(a.x - b.x)
        const overlapY = (a.h + b.h) / 2 + PAD - Math.abs(a.y - b.y)
        if (overlapX > 0 && overlapY > 0) {
          if (overlapY <= overlapX) {
            const dir = a.y <= b.y ? 1 : -1
            a.y -= dir * overlapY / 2
            b.y += dir * overlapY / 2
          } else {
            const dir = a.x <= b.x ? 1 : -1
            a.x -= dir * overlapX / 2
            b.x += dir * overlapX / 2
          }
        }
      }
    }
  }

  entries.forEach(({ element, x, y }) => {
    element.style.display = ''
    element.style.transform = `translate(${x}px, ${y}px)`
  })
}

// ── Connect mode zoom ───────────────────────────────────────────────────────

function connectZoomIntoCluster(clusterId) {
  state.connectPhase = 'pick-nodes'
  state.connectTargetClusterId = clusterId
  state.hoveredClusterId = null

  state.shellMap.forEach((entry) => { entry.hitMesh.material.opacity = 0 })

  const cluster = getCluster(clusterId)
  if (!cluster) return

  document.getElementById('connect-hud-hint').textContent = `In ${cluster.name} · Click nodes to link · Escape to go back`
  document.getElementById('connect-hud-back-btn').classList.remove('hidden')

  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
  const clusterPos = new THREE.Vector3(cluster.position.x, cluster.position.y, cluster.position.z)
  const zoomDist = cluster.radius * 2.8
  const toPos = clusterPos.clone().add(dir.multiplyScalar(zoomDist))

  setAutoRotate(false)
  controls.minDistance = 2

  animateCamera(toPos, clusterPos, 0.7, () => buildZoomNodeLabels(clusterId))
}

function connectZoomOut(exitFully) {
  removeZoomNodeLabels()
  state.hoveredNodeId = null

  if (exitFully || !state.savedCameraState) {
    exitConnectMode()
    return
  }

  state.connectPhase = 'pick-cluster'
  state.connectTargetClusterId = null
  document.getElementById('connect-hud-hint').textContent = 'Click a cluster to zoom in · Escape to exit'
  document.getElementById('connect-hud-source').textContent = getNode(state.connectSourceId)?.label || ''
  document.getElementById('connect-hud-back-btn').classList.add('hidden')
  controls.minDistance = 10

  animateCamera(state.savedCameraState.pos, state.savedCameraState.target, 0.7)
}

function getClusterShellMeshes() {
  const meshes = []
  state.shellMap.forEach((entry) => { if (entry.hitMesh) meshes.push(entry.hitMesh) })
  return meshes
}

// ── Camera animation ────────────────────────────────────────────────────────

function animateCamera(toPos, toTarget, duration, onComplete) {
  state.cameraAnim = {
    active: true,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: toPos.clone(),
    toTarget: toTarget.clone(),
    progress: 0,
    duration: duration || 0.7,
    onComplete: onComplete || null
  }
}

function updateCameraAnim(dt) {
  if (!state.cameraAnim?.active) return
  const anim = state.cameraAnim
  anim.progress += dt / anim.duration
  if (anim.progress >= 1) {
    anim.progress = 1
    anim.active = false
  }
  const t = easeInOutCubic(anim.progress)
  camera.position.lerpVectors(anim.fromPos, anim.toPos, t)
  controls.target.lerpVectors(anim.fromTarget, anim.toTarget, t)
  controls.update()

  if (!anim.active && anim.onComplete) {
    anim.onComplete()
    anim.onComplete = null
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ── Zoom-level node labels (connect mode) ───────────────────────────────────

function buildZoomNodeLabels(clusterId) {
  removeZoomNodeLabels()
  const viewport = document.getElementById('viewport-shell')
  const nodes = state.project.nodes.filter((n) => n.clusterId === clusterId)

  nodes.forEach((node) => {
    const cluster = getCluster(node.clusterId)
    const el = document.createElement('div')
    el.className = 'zoom-node-label'
    el.textContent = node.label
    if (cluster?.color) el.style.setProperty('--zoom-label-color', cluster.color)

    const isConnected = state.project.links.some(
      (l) => (l.source === state.connectSourceId && l.target === node.id) ||
             (l.source === node.id && l.target === state.connectSourceId)
    )
    if (isConnected) el.classList.add('zoom-node-connected')

    viewport.appendChild(el)
    state.zoomLabelMap.set(node.id, { element: el })
  })
}

function removeZoomNodeLabels() {
  state.zoomLabelMap.forEach(({ element }) => element.remove())
  state.zoomLabelMap.clear()
}

function updateZoomNodeLabels() {
  if (state.zoomLabelMap.size === 0) return
  const rect = ui.sceneRoot.getBoundingClientRect()

  state.zoomLabelMap.forEach(({ element }, nodeId) => {
    const entry = state.nodeMeshMap.get(nodeId)
    if (!entry) { element.style.display = 'none'; return }
    const pos = entry.coreMesh.parent.position.clone()
    pos.y += 0.32
    const sp = pos.project(camera)
    if (sp.z > 1) { element.style.display = 'none'; return }
    const x = (sp.x * 0.5 + 0.5) * rect.width
    const y = (-sp.y * 0.5 + 0.5) * rect.height
    element.style.display = ''
    element.style.transform = `translate(${x}px, ${y}px)`
  })
}

function updateZoomLabelHighlights() {
  state.zoomLabelMap.forEach(({ element }, nodeId) => {
    element.classList.toggle('zoom-node-hover', nodeId === state.hoveredNodeId)
    const isConnected = state.project.links.some(
      (l) => (l.source === state.connectSourceId && l.target === nodeId) ||
             (l.source === nodeId && l.target === state.connectSourceId)
    )
    element.classList.toggle('zoom-node-connected', isConnected)
  })
}

// ── Cluster layout ──────────────────────────────────────────────────────────

function distributeNodesInCluster(clusterId) {
  const cluster = getCluster(clusterId)
  if (!cluster) return
  const nodes = state.project.nodes.filter((n) => n.clusterId === clusterId)
  const count = nodes.length
  if (count === 0) return

  const r = cluster.radius * 0.65

  if (count === 1) {
    nodes[0].position = { x: cluster.position.x, y: cluster.position.y, z: cluster.position.z }
    return
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  nodes.forEach((node, i) => {
    const y = 1 - (i / (count - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = goldenAngle * i
    node.position = {
      x: cluster.position.x + Math.cos(theta) * radiusAtY * r,
      y: cluster.position.y + y * r,
      z: cluster.position.z + Math.sin(theta) * radiusAtY * r
    }
  })
}

function createNodePositionNearCluster(cluster) {
  return { x: cluster.position.x, y: cluster.position.y, z: cluster.position.z }
}

function distributeAllClusters() {
  state.project.clusters.forEach((cluster) => distributeNodesInCluster(cluster.id))
}

function separateClusters(clusters) {
  if (clusters.length < 2) return
  const MIN_GAP = 2.2

  let cx0 = 0, cy0 = 0, cz0 = 0
  clusters.forEach((c) => { cx0 += c.position.x; cy0 += c.position.y; cz0 += c.position.z })
  cx0 /= clusters.length; cy0 /= clusters.length; cz0 /= clusters.length

  for (let iter = 0; iter < 12; iter++) {
    let anyOverlap = false
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const ca = clusters[a], cb = clusters[b]
        const needed = (ca.radius || 2.4) + (cb.radius || 2.4) + MIN_GAP
        const dx = cb.position.x - ca.position.x
        const dy = cb.position.y - ca.position.y
        const dz = cb.position.z - ca.position.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < needed) {
          anyOverlap = true
          const push = (needed - dist) / 2 + 0.001
          const nx = dist > 0.0001 ? dx / dist : 1
          const ny = dist > 0.0001 ? dy / dist : 0
          const nz = dist > 0.0001 ? dz / dist : 0
          ca.position.x -= nx * push; ca.position.y -= ny * push; ca.position.z -= nz * push
          cb.position.x += nx * push; cb.position.y += ny * push; cb.position.z += nz * push
        }
      }
    }
    if (!anyOverlap) break
  }

  let cx1 = 0, cy1 = 0, cz1 = 0
  clusters.forEach((c) => { cx1 += c.position.x; cy1 += c.position.y; cz1 += c.position.z })
  cx1 /= clusters.length; cy1 /= clusters.length; cz1 /= clusters.length
  const ox = cx0 - cx1, oy = cy0 - cy1, oz = cz0 - cz1
  clusters.forEach((c) => { c.position.x += ox; c.position.y += oy; c.position.z += oz })
}

function getNewClusterPosition() {
  const existing = state.project.clusters
  if (existing.length === 0) return { x: 0, y: 0, z: 0 }

  const defaultRadius = 2.4
  const padding = 1.5

  for (let ring = 1; ring <= 10; ring++) {
    const ringRadius = ring * 4.5
    const steps = Math.max(6, ring * 6)
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2
      const yOffsets = [0, 1.5, -1.5, 2.5, -2.5]
      const y = yOffsets[i % yOffsets.length]
      const candidate = {
        x: Math.cos(angle) * ringRadius,
        y,
        z: Math.sin(angle) * ringRadius * 0.6
      }
      let overlaps = false
      for (const c of existing) {
        const dx = candidate.x - c.position.x
        const dy = candidate.y - c.position.y
        const dz = candidate.z - c.position.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < c.radius + defaultRadius + padding) { overlaps = true; break }
      }
      if (!overlaps) return candidate
    }
  }

  return { x: existing.length * 6, y: 0, z: 0 }
}

function computeCurve(start, end) {
  const s = new THREE.Vector3(start.x, start.y, start.z)
  const e = new THREE.Vector3(end.x, end.y, end.z)
  const midpoint = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5)
  midpoint.y += 0.6
  midpoint.z += 0.45
  return new THREE.QuadraticBezierCurve3(s, midpoint, e)
}

// ── Main animation loop ─────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate)
  const t = performance.now() * 0.001
  const dt = 1 / 60

  // POV animation tick
  if (state.povAnimDirection !== 0) {
    state.povAnimProgress += state.povAnimDirection * dt * 1.2
    state.povAnimProgress = clamp(state.povAnimProgress, 0, 1)
    if (state.povAnimDirection === 1 && state.povAnimProgress >= 1) state.povAnimDirection = 0
    if (state.povAnimDirection === -1 && state.povAnimProgress <= 0) state.povAnimDirection = 0
  }
  const povEased = easeInOutCubic(state.povAnimProgress)

  // Update node positions
  state.nodeMeshMap.forEach((entry, nodeId) => {
    const node = getNode(nodeId)
    if (!node) return

    if (!state.perspectiveTransition?.nodeMoves?.has(nodeId)) {
      entry.basePosition = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
    }

    if (state.povOffsets.size > 0) {
      const offset = state.povOffsets.get(node.clusterId)
      if (offset) {
        entry.basePosition.x += offset.x * povEased
        entry.basePosition.y += offset.y * povEased
        entry.basePosition.z += offset.z * povEased
      }
    }

    const isActive = state.selectedNodeId ? (node.id === state.selectedNodeId || state.project.links.some((l) =>
      (l.source === state.selectedNodeId || l.target === state.selectedNodeId) &&
      (l.source === node.id || l.target === node.id)
    )) : false
    const isSelected = node.id === state.selectedNodeId
    const floatScale = state.povMode ? 0 : 1
    entry.coreMesh.parent.position.y = entry.basePosition.y + Math.sin(t * 0.7 + entry.floatOffset) * 0.055 * floatScale
    entry.coreMesh.parent.position.x = entry.basePosition.x + Math.cos(t * 0.5 + entry.floatOffset) * 0.032 * floatScale
    entry.coreMesh.parent.position.z = entry.basePosition.z + Math.sin(t * 0.6 + entry.floatOffset) * 0.04 * floatScale
    const pulse = isActive ? (isSelected ? 1.34 + Math.sin(t * 3.4) * 0.05 : 1.16 + Math.sin(t * 2.6 + entry.floatOffset) * 0.03) : 1
    entry.coreMesh.parent.scale.setScalar(pulse)
  })

  // Update links
  state.linkMeshMap.forEach((line, linkId) => {
    const sourceEntry = state.nodeMeshMap.get(line.userData.source)
    const targetEntry = state.nodeMeshMap.get(line.userData.target)
    if (!sourceEntry || !targetEntry) return
    let start = sourceEntry.coreMesh.parent.position.clone()
    let end = targetEntry.coreMesh.parent.position.clone()

    if (state.povMode && state.povNodeId) {
      const isPovSource = line.userData.source === state.povNodeId
      const isPovTarget = line.userData.target === state.povNodeId
      if (isPovSource || isPovTarget) {
        const targetPos = isPovSource ? end.clone() : start.clone()
        const targetScreen = targetPos.clone().project(camera)
        const bottomScreen = new THREE.Vector3(targetScreen.x * 0.6, -1.3, 0.5)
        bottomScreen.unproject(camera)
        if (isPovSource) start.copy(bottomScreen)
        else end.copy(bottomScreen)
      }
    }

    const curve = computeCurve(start, end)
    line.userData.curve = curve
    const pts = curve.getPoints(44)
    line.geometry.dispose()
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts)

    const signal = state.signalMap.get(linkId)
    if (signal) {
      signal.geometry.dispose()
      const overlayGeo = new THREE.BufferGeometry().setFromPoints(pts)
      const tArr = new Float32Array(pts.length)
      for (let i = 0; i < pts.length; i++) tArr[i] = i / (pts.length - 1)
      overlayGeo.setAttribute('vT', new THREE.BufferAttribute(tArr, 1))
      signal.geometry = overlayGeo
      if (signal.visible) {
        const useSharedTime = state.povMode && !state.selectedLinkId
        if (useSharedTime) {
          const FLASH_PERIOD = 5.5
          signal.userData.progress = (t % FLASH_PERIOD) / FLASH_PERIOD
          signal.material.uniforms.uSigma.value = 0.009
        } else {
          signal.userData.progress += signal.userData.speed * 0.01
          if (signal.userData.progress > 1) signal.userData.progress = 0
          signal.material.uniforms.uSigma.value = 0.018
        }
        const t2 = signal.userData.direction === 1 ? signal.userData.progress : 1 - signal.userData.progress
        signal.material.uniforms.uFlashT.value = t2
      }
    }
  })

  // Rotate shells
  state.shellMap.forEach((entry, clusterId) => {
    if (!state.povMode) {
      entry.group.rotation.y += entry.rotY
    }
    if (state.povOffsets.size > 0) {
      const cluster = getCluster(clusterId)
      if (cluster) {
        const offset = state.povOffsets.get(clusterId)
        if (offset) {
          entry.group.position.set(
            cluster.position.x + offset.x * povEased,
            cluster.position.y + offset.y * povEased,
            cluster.position.z + offset.z * povEased
          )
        } else {
          entry.group.position.set(cluster.position.x, cluster.position.y, cluster.position.z)
        }
      }
    }
  })

  // Soft occlusion shells: follow cluster position, fade toward target opacity
  const OCC_TARGET = 0.14
  const OCC_LERP = 0.08
  const tx = state.perspectiveTransition
  state.occlusionMap.forEach((occ, clusterId) => {
    const entry = state.shellMap.get(clusterId)
    if (entry) {
      occ.mesh.position.copy(entry.group.position)
    }
    let target = OCC_TARGET
    if (state.povMode) target = 0
    else if (tx?.enteringIds?.has(clusterId) && tx.progress < 1) target = 0
    else if (state.clusterFocusMode && state.clusterFocusId !== clusterId) target = 0
    occ.targetOpacity = target
    occ.currentOpacity += (target - occ.currentOpacity) * OCC_LERP
    occ.mesh.material.opacity = occ.currentOpacity
    occ.mesh.visible = occ.currentOpacity > 0.005
  })

  // Selection sprite follows node
  if (world.selectionSprite) {
    const nodeEntry = state.nodeMeshMap.get(world.selectionSprite.userData.nodeId)
    if (nodeEntry) {
      world.selectionSprite.position.copy(nodeEntry.coreMesh.parent.position)
      world.selectionSprite.position.y += 0.42
    }
  }

  updateCameraAnim(dt)
  updatePerspectiveTransition(dt)
  updateZoomNodeLabels()
  updatePovLabels()

  const holdCamera = state.perspectiveTransition?.wasInPov
  if (!state.cameraAnim?.active && !holdCamera) {
    controls.autoRotate = state.autoRotate
    controls.update()
  } else if (holdCamera) {
    controls.autoRotate = false
  }
  updateClusterLabels()
  composer.render()
}

function resizeViewport() {
  const rect = ui.sceneRoot.getBoundingClientRect()
  camera.aspect = rect.width / rect.height
  camera.updateProjectionMatrix()
  renderer.setSize(rect.width, rect.height)
  composer.setSize(rect.width, rect.height)
}

function disposeGroup(group) {
  while (group.children.length) {
    const child = group.children[0]
    group.remove(child)
    child.traverse?.((obj) => {
      obj.geometry?.dispose?.()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
      else obj.material?.dispose?.()
    })
  }
}

// ── Presentation mode ───────────────────────────────────────────────────────

function getPresentationSteps() {
  const pres = state.project.presentations?.find((p) => p.id === state.activePresentationId)
  return pres?.steps || []
}

function getActivePresentation() {
  return state.project.presentations?.find((p) => p.id === state.activePresentationId) || null
}

function stepIcon(step) {
  if (step.selectedLinkId) return '↗'
  if (step.povNodeId) return '◎'
  if (step.selectedNodeId) return '●'
  return '⬡'
}

function stepLabel(step) {
  const persp = state.project.perspectives?.find((p) => p.id === step.perspectiveId)
  const perspName = persp?.name || 'Perspective'
  if (step.selectedLinkId) {
    const link = persp?.links?.find((l) => l.id === step.selectedLinkId)
    return link?.label || 'Relation'
  }
  if (step.povNodeId) {
    const node = persp?.nodes?.find((n) => n.id === step.povNodeId)
    return node?.label || 'Node view'
  }
  if (step.selectedNodeId) {
    const node = persp?.nodes?.find((n) => n.id === step.selectedNodeId)
    return node?.label || 'Node'
  }
  return perspName
}

function stepSub(step) {
  const persp = state.project.perspectives?.find((p) => p.id === step.perspectiveId)
  const perspName = persp?.name || 'Perspective'
  if (step.selectedLinkId) {
    const node = persp?.nodes?.find((n) => n.id === step.povNodeId)
    return `${perspName} · ${node?.label || 'node'} POV`
  }
  if (step.povNodeId) return perspName
  if (step.selectedNodeId) return perspName
  return ''
}

function captureStep() {
  return {
    id: makeId('step'),
    perspectiveId: state.project.activePerspectiveId,
    povNodeId: state.povMode ? state.povNodeId : null,
    selectedLinkId: state.selectedLinkId || null,
    selectedNodeId: (!state.povMode && state.selectedNodeId) ? state.selectedNodeId : null,
    camera: {
      pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    },
  }
}

function togglePresentationEditor() {
  const panel = document.getElementById('presentation-panel')
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden')
    renderPresentationEditor()
  } else {
    panel.classList.add('hidden')
  }
}

function renderPresentationEditor() {
  const panel = document.getElementById('presentation-panel')
  const presentations = state.project.presentations || []

  // ── Presentation list ────────────────────────────────────────────
  const listEl = document.getElementById('pres-list')
  listEl.innerHTML = presentations.length === 0
    ? '<div class="pres-step-empty" style="padding:12px 8px">No presentations yet.</div>'
    : presentations.map((p) => `
      <div class="pres-list-item ${p.id === state.activePresentationId ? 'selected' : ''}" data-pid="${p.id}">
        <span class="pres-list-name" contenteditable="true" spellcheck="false" data-pid="${p.id}">${escapeHtml(p.name)}</span>
        <button class="pres-list-play" data-action="play" data-pid="${p.id}" title="Present">▶</button>
        <button class="pres-list-del"  data-action="del"  data-pid="${p.id}" title="Delete">✕</button>
      </div>
    `).join('')

  listEl.querySelectorAll('.pres-list-item').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[contenteditable]') || e.target.closest('button')) return
      state.activePresentationId = row.dataset.pid
      renderPresentationEditor()
    })
  })

  listEl.querySelectorAll('[contenteditable]').forEach((nameEl) => {
    nameEl.addEventListener('blur', () => {
      const pid = nameEl.dataset.pid
      const pres = state.project.presentations.find((p) => p.id === pid)
      if (pres) pres.name = nameEl.textContent.trim() || 'Untitled'
    })
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() }
      e.stopPropagation()
    })
    nameEl.addEventListener('click', (e) => e.stopPropagation())
  })

  listEl.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const pid = btn.dataset.pid
      if (btn.dataset.action === 'del') {
        state.project.presentations = state.project.presentations.filter((p) => p.id !== pid)
        if (state.activePresentationId === pid) state.activePresentationId = null
        renderPresentationEditor()
      } else if (btn.dataset.action === 'play') {
        state.activePresentationId = pid
        panel.classList.add('hidden')
        enterPresentationMode()
      }
    })
  })

  // ── Steps section ────────────────────────────────────────────────
  const stepsSection = document.getElementById('pres-steps-section')
  const activePres = getActivePresentation()

  if (!activePres) {
    stepsSection.classList.add('hidden')
    return
  }
  stepsSection.classList.remove('hidden')

  document.getElementById('pres-steps-heading').textContent = activePres.name

  const steps = activePres.steps
  const stepList = document.getElementById('pres-step-list')
  const startBtn = document.getElementById('pres-start-btn')
  startBtn.disabled = steps.length === 0

  stepList.innerHTML = steps.length === 0
    ? '<div class="pres-step-empty">No steps yet.<br>Navigate to a view and click "+ Add state".</div>'
    : steps.map((step, i) => `
      <div class="pres-step-item" data-i="${i}">
        <span class="pres-step-num">${i + 1}</span>
        <span class="pres-step-icon">${stepIcon(step)}</span>
        <div class="pres-step-info">
          <div class="pres-step-label">${escapeHtml(stepLabel(step))}</div>
          ${stepSub(step) ? `<div class="pres-step-sub">${escapeHtml(stepSub(step))}</div>` : ''}
        </div>
        <div class="pres-step-actions">
          <button class="pres-step-btn" data-action="up"   data-i="${i}" title="Move up">↑</button>
          <button class="pres-step-btn" data-action="down" data-i="${i}" title="Move down">↓</button>
          <button class="pres-step-btn danger" data-action="del" data-i="${i}" title="Remove">✕</button>
        </div>
      </div>
    `).join('')

  stepList.querySelectorAll('.pres-step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.i)
      const arr = activePres.steps
      if (btn.dataset.action === 'del') arr.splice(idx, 1)
      else if (btn.dataset.action === 'up'   && idx > 0)              [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      else if (btn.dataset.action === 'down' && idx < arr.length - 1) [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      renderPresentationEditor()
    })
  })

  document.getElementById('pres-add-step-btn').onclick = () => {
    activePres.steps.push(captureStep())
    renderPresentationEditor()
  }

  document.getElementById('pres-start-btn').onclick = () => {
    panel.classList.add('hidden')
    enterPresentationMode()
  }

  document.getElementById('pres-panel-close-btn').onclick = () => panel.classList.add('hidden')
}

function enterPresentationMode() {
  const steps = getPresentationSteps()
  if (steps.length === 0) return
  state.presentationMode = true
  state.presentationStep = 0

  document.getElementById('sidebar').classList.add('collapsed')
  document.getElementById('app-shell').classList.add('sidebar-collapsed')
  document.getElementById('perspective-switcher').style.display = 'none'

  document.getElementById('presentation-hud').classList.remove('hidden')
  document.getElementById('pres-hud-exit-btn').onclick = exitPresentationMode
  document.getElementById('pres-hud-prev-btn').onclick = () => advancePresentationStep(-1)
  document.getElementById('pres-hud-next-btn').onclick = () => advancePresentationStep(1)

  executePresentationStep(steps[0])
  updatePresentationHud()
}

function exitPresentationMode() {
  state.presentationMode = false
  document.getElementById('presentation-hud').classList.add('hidden')
  document.getElementById('perspective-switcher').style.display = ''
  document.getElementById('sidebar').classList.remove('collapsed')
  document.getElementById('app-shell').classList.remove('sidebar-collapsed')
}

function advancePresentationStep(dir) {
  const steps = getPresentationSteps()
  const next = state.presentationStep + dir
  if (next < 0 || next >= steps.length) return
  state.presentationStep = next
  executePresentationStep(steps[next])
  updatePresentationHud()
}

function updatePresentationHud() {
  const steps = getPresentationSteps()
  const step = steps[state.presentationStep]
  document.getElementById('pres-hud-label').textContent = step ? stepLabel(step) : ''
  document.getElementById('pres-hud-counter').textContent = `${state.presentationStep + 1} / ${steps.length}`
  document.getElementById('pres-hud-prev-btn').disabled = state.presentationStep === 0
  document.getElementById('pres-hud-next-btn').disabled = state.presentationStep === steps.length - 1
}

function executePresentationStep(step) {
  const TRANSITION_DELAY = 1000

  const applyCameraIfNoMode = () => {
    if (!step.povNodeId && step.camera) {
      const p = step.camera.pos, tgt = step.camera.target
      animateCamera(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(tgt.x, tgt.y, tgt.z), 0.8)
    }
  }

  const applyState = () => {
    if (step.povNodeId) {
      if (!state.povMode || state.povNodeId !== step.povNodeId) {
        if (state.povMode) exitPovMode()
        setTimeout(() => {
          enterPovMode(step.povNodeId)
          if (step.selectedLinkId) {
            setTimeout(() => {
              selectLink(step.selectedLinkId)
              updateThreeSelection()
              refreshPanelsOnly()
            }, 600)
          }
        }, state.povMode ? 800 : 0)
      } else if (step.selectedLinkId && state.selectedLinkId !== step.selectedLinkId) {
        selectLink(step.selectedLinkId)
        updateThreeSelection()
        refreshPanelsOnly()
      } else if (!step.selectedLinkId && state.selectedLinkId) {
        state.selectedLinkId = null
        updateThreeSelection()
        refreshPanelsOnly()
        // Restore the captured camera position for this step. povOverlayShift(false)
        // (called inside refreshPanelsOnly via hideRelationOverlay) computes the
        // undo target from _overlayAppliedShift, which can be stale/wrong after a
        // perspective switch. Using the step's stored camera is always correct.
        if (step.camera) {
          const p = step.camera.pos, tgt = step.camera.target
          animateCamera(
            new THREE.Vector3(p.x, p.y, p.z),
            new THREE.Vector3(tgt.x, tgt.y, tgt.z),
            0.6
          )
        }
      }
    } else {
      const wasInPov = state.povMode
      if (wasInPov) exitPovMode()
      if (step.selectedLinkId) {
        selectLink(step.selectedLinkId)
        if (!wasInPov) updateThreeSelection()
        refreshPanelsOnly()
      } else if (step.selectedNodeId) {
        selectNode(step.selectedNodeId)
        if (!wasInPov) updateThreeSelection()
        refreshPanelsOnly()
      } else {
        clearSelection()
        if (!wasInPov) updateThreeSelection()
      }
      applyCameraIfNoMode()
    }
  }

  if (step.perspectiveId !== state.project.activePerspectiveId) {
    switchPerspective(step.perspectiveId)
    setTimeout(applyState, TRANSITION_DELAY)
  } else {
    applyState()
  }
}

// ── Toast ───────────────────────────────────────────────────────────────────

function showToast(message) {
  ui.toast.textContent = message
  ui.toast.classList.add('show')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800)
}