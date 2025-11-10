# Task Completion Workflow

## Important Notes
- **No test framework**: Currently no automated testing is configured
- **No linting tools**: No ESLint or similar tools in package.json
- **No formatting tools**: No Prettier or similar tools configured
- **Manual verification**: Testing requires manual verification by running the app

## When Task is Completed

### 1. Manual Testing
Since no automated testing framework is available:
```bash
# Start the application to verify changes
pnpm start
```

### 2. Build Verification (if applicable)
```bash
# Test that the build still works
pnpm run build:mac
```

### 3. Code Review Checklist
- Ensure ES6+ syntax is used consistently
- Verify error handling is in place
- Check that IPC communication follows existing patterns
- Ensure security practices are maintained
- Validate that changes follow the manager pattern architecture

### 4. Git Operations (Manual)
**Important**: Based on user preferences:
- Do NOT auto-commit changes
- Do NOT include Claude information in commit messages
- Do NOT include user information (qfdk) in commits
- Always use pnpm for package management

### 5. Performance Considerations
- Check if changes affect startup performance
- Verify memory usage hasn't increased significantly
- Ensure UI remains responsive
- Test with multiple SSH sessions if relevant

### 6. User Instructions
Since no automated validation exists, recommend the user:
1. Test core SSH connection functionality
2. Verify terminal operations work correctly
3. Test file transfer operations if modified
4. Check that credentials are properly encrypted and stored