# Thesis System Map (Electron)

This project turns your Three.js concept into an Electron desktop app with:

- a 3D thesis / research map
- editable clusters
- editable nodes
- editable relations between nodes
- a local JSON save / open workflow
- a sidebar UI for manipulation while preserving the visual style of your current prototype

## Folder structure

- `package.json` — scripts and Electron packaging config
- `electron/main.cjs` — Electron main process
- `electron/preload.cjs` — safe bridge between Electron and the renderer
- `src/index.html` — application shell
- `src/styles.css` — UI styling
- `src/data.js` — default starting project data
- `src/renderer.js` — Three.js scene + editor logic

## What to install first

1. Install **Node.js LTS**
2. Create a new folder on your computer, for example:
   - Windows: `C:\Users\YOURNAME\Documents\thesis-system-map`
   - macOS: `~/Documents/thesis-system-map`
3. Copy all files from this project into that folder

## How to run it

Open a terminal in the project folder and run:

```bash
npm install
npm start
```

This will install Electron, Electron Builder, and Three.js, then launch the desktop app.

## How to save your work

Inside the app:

- **Save** stores to the current JSON file
- **Save as** creates a new JSON project file
- **Open JSON** opens an existing map file

Your project data is stored as plain JSON, so it is easy to back up or version control.

## How to build an executable

After `npm install`, run:

```bash
npm run dist
```

That creates a packaged desktop build for your current operating system.

## How to edit content in the app

### Clusters
- Add a cluster with **Add**
- Rename it
- Change its color
- Move it in 3D using X / Y / Z
- Change the shell radius

### Nodes
- Add a node to the selected cluster
- Rename it
- Move it in 3D using X / Y / Z
- Assign it to a different cluster
- Add notes for argument fragments, references, or presentation prompts

### Relations
- Add a relation between nodes
- Give it a label
- Change source and target
- Delete it when no longer needed

## Good next upgrades

Possible next steps for your research workflow:

1. add camera bookmarks for presentation mode
2. add image / PDF / citation attachments per node
3. add export to JSON + screenshot bundle
4. add search and filtering
5. add different link types with colors or line patterns
6. add an automatic layout mode
7. add thesis chapter tags and bibliography references

## Recommended workflow

- Use the app for **thinking spatially** about your dissertation system
- Use node notes for short interpretations or argument fragments
- Save multiple JSON versions for different chapters or presentation modes
- Keep one "presentation" file and one "research" file
trigger rebuild
