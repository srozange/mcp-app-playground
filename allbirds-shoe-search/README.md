# Allbirds Shoe Search - MCP App

An MCP App that lets you search for shoes on [allbirds.com](https://www.allbirds.com/) with an interactive card-grid UI.

## Architecture

- **Tool**: `search-allbirds-shoes` — fetches products via the Allbirds Shopify JSON API and filters client-side
- **UI**: React app displayed as a card grid with shoe name, price, available sizes, image, and link
- **Transport**: Streamable HTTP on `http://localhost:3001/mcp` (or stdio via `--stdio`)
- **Size conversion**: EU sizes (e.g. 42) are automatically converted to US sizes (e.g. 9)

## Standard Setup (Windows / Linux / macOS)

```bash
npm install
npm run build
npm run serve
```

## Setup (WSL with Windows Node in PATH)

> **WSL note**: This project requires Linux node. Use the VSCode server node or install node via nvm.

```bash
LINUX_NODE="/home/$USER/.vscode-server/bin/<hash>/node"
export PATH="$(dirname $LINUX_NODE):$PATH"

npm install --ignore-scripts
npm install --ignore-scripts --force "@esbuild/linux-x64@$(node -p "require('./node_modules/esbuild/package.json').version")"
npm install --ignore-scripts --force "@rollup/rollup-linux-x64-gnu@$(node -p "require('./node_modules/rollup/package.json').version")"
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild
INPUT=mcp-app.html node node_modules/vite/bin/vite.js build
node node_modules/tsx/dist/cli.mjs main.ts
```

## Claude Desktop config

Copy in window : `rsync -a --exclude=node_modules allbirds-shoe-search /mnt/c/dev/workspace`

In `C:\Users\user.name\AppData\Roaming\Claude\claude_desktop_config.json` :

```json
"allbirds-shoe-search": {
  "command": "node",
  "args": [
    "c:/dev/workspace/allbirds-shoe-search/node_modules/tsx/dist/cli.mjs",
    "c:/dev/workspace/allbirds-shoe-search/main.ts",
    "--stdio"
  ]
}
```

## Usage

The server starts at `http://localhost:3001/mcp`.

Ask the LLM: *"trouve moi des chaussures pour hommes en taille 9 sur allbirds"*

## Project Structure

```
allbirds-shoe-search/
├── server.ts          # MCP tool + Allbirds Shopify API logic
├── main.ts            # HTTP / stdio server entry point
├── mcp-app.html       # HTML entry point for Vite
├── src/
│   ├── mcp-app.tsx    # React UI (card grid, search bar, size filter)
│   └── mcp-app.module.css
├── vite.config.ts     # Vite + vite-plugin-singlefile
├── tsconfig.json      # Frontend TypeScript config
└── tsconfig.server.json  # Server TypeScript config
```

