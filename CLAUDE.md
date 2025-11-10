# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron-based SSH client desktop application with terminal emulation and file transfer capabilities. The application uses a modular architecture with separate managers for different concerns.

## Common Development Commands

```bash
# Install dependencies
pnpm install

# Run development server (uses EJS templates, does not use dist/)
pnpm start
# or
pnpm run dev

# Build renderer (Vite bundles JS, then generates optimized HTML)
# This creates dist/index.html with bundled dist/assets/js/renderer.js
pnpm run build:renderer

# Build for macOS (runs build:renderer first, output to release/)
pnpm run build:mac
```

**Important Notes:**
- Development mode (`pnpm start`) uses EJS templates and ignores `dist/` folder
- Production mode (`app.isPackaged` or `NODE_ENV=production`) loads pre-built `dist/index.html`
- Build process: Vite bundles JS first → build-renderer.js generates HTML referencing the bundle
- Packaged app output goes to `release/` directory (not `dist/`)

## Architecture

### Main Process (/main.js)
- Lazy loading pattern for heavy services (SSH, config)
- IPC handlers for all SSH operations
- Protocol registration for serving local assets
- Connection pooling for SSH sessions
- Dual mode: development (EJS templates) and production (pre-built static HTML)
- Single window load (no loading page + main interface double load)
- Background color set to reduce white flashes

### Frontend Architecture
The renderer process uses a manager pattern with clear separation of concerns:
- **SessionManager**: Manages SSH session states and UI updates
- **TerminalManager**: Handles xterm.js terminal instances
- **FileManager**: SFTP operations with drag-and-drop support
- **ConnectionManager**: SSH connection lifecycle management
- **UIManager**: General UI event handling and initialization

### Services
- **ssh-service.js**: Singleton service with EventEmitter for SSH operations
- **config-store.js**: Encrypted credential storage using electron-store

### IPC Communication Pattern
All SSH operations go through IPC:
```javascript
// Renderer → Main
ipcRenderer.invoke('ssh:connect', config)
ipcRenderer.invoke('ssh:execute', { sessionId, command })

// Main → Renderer  
mainWindow.webContents.send('ssh:data', { sessionId, data })
```

## Key Technical Details

- **Terminal**: Uses xterm.js with fit addon for responsive terminals
- **Security**: Context isolation enabled, encrypted credential storage
- **Templates**: EJS for dynamic view rendering
- **Styling**: Modular CSS with separate files per component
- **Error Handling**: Comprehensive try-catch blocks in all IPC handlers

## Important Notes

- No test framework is currently configured
- Credentials are stored encrypted in `~/.sshl/` directory
- The app uses lazy loading to improve startup performance
- Connection pooling is implemented for SSH sessions

## Recent Optimizations

### Startup Performance Improvements
- **Removed deprecated settings**: Removed `allowRendererProcessReuse = false` to enable process reuse (Electron 28+)
- **Single window load**: Eliminated loading.html + main interface double load pattern
- **Static HTML generation**: Pre-compile EJS templates to static HTML for production builds
- **Deferred config loading**: Connection data now loaded in renderer process via IPC instead of blocking main process startup
- **Background color**: Set window background color to reduce white flash on startup
- **Build optimization**: Added Vite bundling for renderer process JavaScript modules into single bundle
- **Environment detection**: Uses `app.isPackaged` and `NODE_ENV` to properly distinguish dev/prod modes
- **Proper packaging**: `dist/` directory explicitly included in build, output moved to `release/` directory

### Performance Improvements
- **DOM Optimization**: 
  - Implemented DocumentFragment for batch DOM insertions in file listings
  - Added event delegation to reduce event listener count
  - Added requestAnimationFrame for smooth UI updates
  - Cached DOM queries in connection manager
  
- **Terminal Performance**:
  - Added debouncing (100ms) to terminal resize operations
  - Implemented data batching (16ms/60fps) for terminal output
  - Limited buffer size to 100KB to prevent memory growth
  
- **File Transfer**:
  - Increased SFTP concurrency to 64 connections
  - Added progress events for file uploads
  - Optimized chunk size to 32KB
  
- **Session Management**:
  - Preserved terminal DOM instead of recreating on switch
  - Added early return for same-session switches
  - Reduced IPC metadata overhead
  
- **Virtual Scrolling**:
  - Created virtual-scroll.js for handling large file lists
  - Renders only visible items with configurable buffer

### Memory Improvements
- Implemented LRU cache (30 items) for file listings
- Added automatic buffer trimming for terminal data
- Limited session buffer to 100KB

### Architecture
- Created centralized configuration in `/config/app-config.js`
- Added connection validation method in SSH service
- Implemented batch processing for terminal data

### Security
- Added path traversal protection in file operations
- Sanitize file paths before operations