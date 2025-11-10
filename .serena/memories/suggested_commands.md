# Development Commands

## Package Management
```bash
# Install dependencies (uses pnpm as per user preference)
pnpm install
```

## Development
```bash
# Run development server
pnpm start

# Alternative way to start
electron .
```

## Building
```bash
# Build for macOS (creates zip distribution)
pnpm run build:mac
```

## Utility Commands (macOS)
```bash
# List files and directories
ls -la

# Find files
find . -name "*.js" -type f

# Search in files (using ripgrep for better performance)
rg "pattern" --type js

# Check running processes
ps aux | grep electron

# Kill processes
pkill -f electron
```

## Git Commands
```bash
# Check status
git status

# View commits
git log --oneline -10

# Create branches
git checkout -b feature/new-feature
```

## Development Notes
- No test framework is currently configured
- No linting/formatting tools are set up in package.json
- Building only supports macOS target (zip format)
- Uses context isolation and security best practices