# Performance Optimizations

## Current Optimizations Implemented

### DOM Optimization
- **DocumentFragment**: Batch DOM insertions in file listings
- **Event delegation**: Reduced event listener count
- **requestAnimationFrame**: Smooth UI updates
- **Cached DOM queries**: Connection manager uses cached queries

### Terminal Performance
- **Debouncing**: Terminal resize operations debounced to 100ms
- **Data batching**: Terminal output batched at 16ms intervals (60fps)
- **Buffer management**: Limited to 100KB to prevent memory growth
- **Preserved DOM**: Terminal DOM preserved instead of recreating on session switch

### File Transfer
- **SFTP concurrency**: Increased to 64 connections
- **Progress events**: Real-time upload progress tracking
- **Optimized chunk size**: 32KB for optimal performance
- **Virtual scrolling**: Handles large file lists efficiently (virtual-scroll.js)

### Session Management
- **Early returns**: Same-session switches return early
- **Reduced IPC overhead**: Minimized metadata in IPC communication
- **Session persistence**: Terminal instances preserved between switches

### Memory Management
- **LRU Cache**: 30-item cache for file listings
- **Automatic buffer trimming**: Terminal data automatically trimmed
- **Session buffer limits**: 100KB limit per session
- **Garbage collection**: Proper cleanup of terminated sessions

### Configuration
- **Centralized config**: `/config/app-config.js` for performance settings
- **Connection validation**: Efficient connection state checking
- **Batch processing**: Terminal data processed in batches

### Security with Performance
- **Path sanitization**: Efficient path validation
- **Encrypted storage**: Optimized credential storage access