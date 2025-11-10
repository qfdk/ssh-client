# Code Style and Conventions

## JavaScript Style
- **ES6+ modules**: Uses import/export syntax
- **Class-based architecture**: Manager classes with clear responsibilities
- **camelCase naming**: For variables, functions, and methods
- **PascalCase**: For class names (SessionManager, TerminalManager, etc.)
- **Descriptive method names**: `addSession`, `updateRemotePath`, `setSessionActive`

## File Organization
- **Modular CSS**: Separate files for each component (terminal.css, file-manager.css)
- **Manager pattern**: Each major functionality has its own manager class
- **Service layer**: Separate services directory for core functionality
- **Asset separation**: CSS and JS files organized in separate directories

## Code Patterns
- **Singleton pattern**: Used for SSH service and configuration store
- **Event-driven**: Uses EventEmitter for service communication
- **Lazy loading**: Heavy services loaded on demand
- **Error handling**: Comprehensive try-catch blocks in IPC handlers
- **Defensive programming**: Null checks and validation before operations

## Comments and Documentation
- **Chinese comments**: Code includes Chinese language comments
- **Descriptive logging**: Console logging with meaningful messages
- **Method documentation**: Clear parameter and return value handling

## Performance Considerations
- **Debouncing**: Terminal resize operations debounced to 100ms
- **Batching**: Terminal data batched at 16ms intervals (60fps)
- **Caching**: LRU cache for file listings (30 items)
- **Virtual scrolling**: For large file lists
- **Buffer management**: Limited to 100KB to prevent memory growth

## Security Practices
- **Path sanitization**: File paths sanitized before operations
- **Encrypted storage**: Credentials stored with encryption
- **Context isolation**: Renderer process security enabled