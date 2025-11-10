# Architecture

## Application Structure

### Main Process (`main.js`)
- Handles Electron app lifecycle and window management
- Lazy loading pattern for heavy services (SSH, config)
- IPC handlers for all SSH operations
- Protocol registration for serving local assets
- Connection pooling for SSH sessions

### Renderer Process (Frontend)
Uses a manager pattern with clear separation of concerns:

- **SessionManager**: Manages SSH session states and UI updates
- **TerminalManager**: Handles xterm.js terminal instances with debouncing
- **FileManager**: SFTP operations with drag-and-drop support and LRU cache
- **ConnectionManager**: SSH connection lifecycle management
- **UIManager**: General UI event handling and initialization

### Services
- **ssh-service.js**: Singleton service with EventEmitter for SSH operations
- **config-store.js**: Encrypted credential storage using electron-store

### Views & Assets
- **views/**: EJS templates for dynamic rendering
- **assets/css/**: Modular CSS files (main, terminal, file-manager, etc.)
- **assets/js/**: ES6 modules for each manager component

## IPC Communication Pattern
All SSH operations go through IPC:
```javascript
// Renderer → Main
ipcRenderer.invoke('ssh:connect', config)
ipcRenderer.invoke('ssh:execute', { sessionId, command })

// Main → Renderer  
mainWindow.webContents.send('ssh:data', { sessionId, data })
```

## Security Features
- Context isolation enabled
- Encrypted credential storage
- Path traversal protection in file operations
- No direct Node.js access from renderer