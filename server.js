import express from 'express'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saves (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      at BIGINT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT INTO app_state (key, value) VALUES ('last_pid', NULL), ('last_sid', NULL)
      ON CONFLICT (key) DO NOTHING;
  `)
}

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

async function projectSummaries() {
  const { rows: projects } = await pool.query('SELECT * FROM projects ORDER BY created_at DESC')
  const result = []
  for (const p of projects) {
    const { rows: saves } = await pool.query(
      'SELECT at FROM saves WHERE project_id = $1 ORDER BY at DESC LIMIT 1',
      [p.id]
    )
    const { rows: countRow } = await pool.query(
      'SELECT COUNT(*) AS c FROM saves WHERE project_id = $1',
      [p.id]
    )
    result.push({
      title: p.title,
      projectPath: p.id,
      saveCount: Number(countRow[0].c),
      latestSaveModifiedAt: saves[0]?.at ? Number(saves[0].at) : null
    })
  }
  return result
}

async function getLast() {
  const { rows } = await pool.query("SELECT key, value FROM app_state WHERE key IN ('last_pid','last_sid')")
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return { pid: map.last_pid || null, sid: map.last_sid || null }
}

async function setLast(pid, sid) {
  await pool.query("UPDATE app_state SET value = $1 WHERE key = 'last_pid'", [pid])
  await pool.query("UPDATE app_state SET value = $1 WHERE key = 'last_sid'", [sid])
}

async function updateProjectTitle(pid, project) {
  if (project?.meta?.title) {
    await pool.query('UPDATE projects SET title = $1 WHERE id = $2', [project.meta.title, pid])
  }
}

async function ensureProject(project) {
  const last = await getLast()
  if (last?.pid) return last.pid
  const id = uid()
  const title = project?.meta?.title || 'Untitled Project'
  await pool.query('INSERT INTO projects (id, title, created_at) VALUES ($1, $2, $3)', [id, title, Date.now()])
  await setLast(id, null)
  return id
}

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(express.static(join(__dirname, 'src')))

app.get('/api/bootstrap', async (req, res) => {
  try {
    const last = await getLast()
    const recentProjects = await projectSummaries()
    res.json({
      currentProjectPath: last?.pid || null,
      lastProjectPath: last?.pid || null,
      recentProjects
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/projects', async (req, res) => {
  try { res.json(await projectSummaries()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/projects', async (req, res) => {
  try {
    const { project } = req.body
    const id = uid()
    const title = project?.meta?.title || 'Untitled Project'
    await pool.query('INSERT INTO projects (id, title, created_at) VALUES ($1, $2, $3)', [id, title, Date.now()])
    await setLast(id, null)
    res.json({ canceled: false, projectPath: id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/projects/:pid', async (req, res) => {
  try {
    const { pid } = req.params
    await pool.query('DELETE FROM projects WHERE id = $1', [pid])
    const last = await getLast()
    if (last?.pid === pid) await setLast(null, null)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/projects/:pid/saves', async (req, res) => {
  try {
    const { pid } = req.params
    const { rows } = await pool.query(
      'SELECT id, label, at FROM saves WHERE project_id = $1 ORDER BY at DESC',
      [pid]
    )
    res.json(rows.map(s => ({
      title: s.label || 'Auto-save',
      name: new Date(Number(s.at)).toLocaleString(),
      modifiedAt: Number(s.at),
      filePath: `${pid}::${s.id}`
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/save', async (req, res) => {
  try {
    const { project } = req.body
    const pid = await ensureProject(project)
    await updateProjectTitle(pid, project)
    const now = Date.now()
    await pool.query(`
      INSERT INTO saves (id, project_id, label, data, at) VALUES ('autosave', $1, 'Auto-save', $2, $3)
      ON CONFLICT (project_id, id) DO UPDATE SET data = EXCLUDED.data, at = EXCLUDED.at
    `, [pid, project, now])
    await setLast(pid, 'autosave')
    res.json({ canceled: false, filePath: pid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/save-version', async (req, res) => {
  try {
    const { project, label } = req.body
    const pid = await ensureProject(project)
    await updateProjectTitle(pid, project)
    const sid = uid()
    await pool.query(
      'INSERT INTO saves (id, project_id, label, data, at) VALUES ($1, $2, $3, $4, $5)',
      [sid, pid, label || '', project, Date.now()]
    )
    await setLast(pid, sid)
    res.json({ canceled: false, projectPath: pid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/load', async (req, res) => {
  try {
    const { filePath } = req.query
    const sep = filePath.lastIndexOf('::')
    if (sep === -1) return res.json({ ok: false })
    const pid = filePath.slice(0, sep)
    const sid = filePath.slice(sep + 2)
    const { rows } = await pool.query(
      'SELECT data FROM saves WHERE project_id = $1 AND id = $2',
      [pid, sid]
    )
    if (!rows[0]) return res.json({ ok: false })
    await setLast(pid, sid)
    res.json({ ok: true, data: rows[0].data, projectPath: pid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/load-recent', async (req, res) => {
  try {
    const last = await getLast()
    if (!last?.pid || !last?.sid) return res.json({ ok: false })
    const { rows } = await pool.query(
      'SELECT data FROM saves WHERE project_id = $1 AND id = $2',
      [last.pid, last.sid]
    )
    if (!rows[0]) return res.json({ ok: false })
    res.json({ ok: true, data: rows[0].data, projectPath: last.pid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Catch-all: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'src', 'index.html'))
})

const PORT = process.env.PORT || 8080
initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
}).catch(e => { console.error('DB init failed:', e); process.exit(1) })
