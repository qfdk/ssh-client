# Project Overview

**SSHL** is an Electron-based SSH client desktop application with terminal emulation and file transfer capabilities.

## Purpose
- Provides a fast SSH client with modern GUI interface
- Enables terminal emulation using xterm.js
- Supports SFTP file transfer with drag-and-drop functionality
- Stores encrypted credentials for secure connection management

## Tech Stack
- **Framework**: Electron (v28.2.3)
- **Frontend**: Vanilla JavaScript with ES6 modules
- **Terminal**: xterm.js with fit addon
- **SSH**: ssh2 library for connections
- **Templates**: EJS for dynamic view rendering
- **Storage**: electron-store for encrypted credentials
- **Package Manager**: pnpm (as specified in user preferences)
- **Build Tool**: electron-builder for macOS packaging

## Key Features
- Terminal session management with connection pooling
- SFTP file operations with progress tracking
- Encrypted credential storage in `~/.sshl/` directory
- Context isolation and security features
- Lazy loading for improved startup performance
- Virtual scrolling for large file lists
- Performance optimizations with debouncing and batching