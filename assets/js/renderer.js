// DOM Elements
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const newConnectionBtn = document.getElementById('new-connection-btn');
const connectionDialog = document.getElementById('connection-dialog');
const connectionForm = document.getElementById('connection-form');
const connectionList = document.getElementById('connection-list');
const tabs = document.querySelectorAll('.tab');
const connectionSearchInput = document.getElementById('connection-search');
const useKeyCheckbox = document.getElementById('connection-use-key');
const keyFileGroup = document.querySelector('.key-file-group');
const browseKeyFileBtn = document.getElementById('browse-key-file');
const connectStatusText = document.querySelector('.status-text');
const connectStatusIndicator = document.querySelector('.status-indicator');

// Terminal elements
const terminalTabs = document.getElementById('terminal-tabs');
const terminalPanels = document.getElementById('terminal-panels');

// File manager elements
const localPathInput = document.getElementById('local-path');
const remotePathInput = document.getElementById('remote-path');
const localFilesList = document.getElementById('local-files').querySelector('tbody');
const remoteFilesList = document.getElementById('remote-files').querySelector('tbody');
const browseLocalBtn = document.getElementById('browse-local');
const localRefreshBtn = document.getElementById('local-refresh');
const remoteRefreshBtn = document.getElementById('remote-refresh');
const goRemotePathBtn = document.getElementById('go-remote-path');
const transferProgressBar = document.getElementById('transfer-progress-bar');
const transferInfo = document.getElementById('transfer-info');

// State
let activeSessionId = null;
let terminals = {};
let localCurrentPath = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  loadConnections();
  setupEventListeners();
});

// Set up event listeners
function setupEventListeners() {
  // Sidebar toggle
  toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      
      // Remove active class from all tabs and panes
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      // Add active class to selected tab and pane
      tab.classList.add('active');
      document.getElementById(`${tabId}-tab`).classList.add('active');
    });
  });

  // New connection button
  newConnectionBtn.addEventListener('click', () => {
    // Reset form
    connectionForm.reset();
    document.getElementById('connection-name').focus();
    
    // Show dialog
    connectionDialog.classList.add('active');
  });

  // Close dialog buttons
  document.querySelectorAll('.close-dialog').forEach(btn => {
    btn.addEventListener('click', () => {
      connectionDialog.classList.remove('active');
    });
  });

  // Connection form submit
  connectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const connectionDetails = {
      name: document.getElementById('connection-name').value,
      host: document.getElementById('connection-host').value,
      port: parseInt(document.getElementById('connection-port').value, 10),
      username: document.getElementById('connection-username').value,
      password: document.getElementById('connection-password').value,
    };
    
    if (useKeyCheckbox.checked) {
      const keyFilePath = document.getElementById('connection-key-file').value;
      if (keyFilePath) {
        try {
          connectionDetails.privateKey = require('fs').readFileSync(keyFilePath, 'utf8');
          delete connectionDetails.password; // Don't use password when using key
        } catch (error) {
          showNotification('读取密钥文件失败', 'error');
          return;
        }
      } else {
        showNotification('请选择密钥文件', 'error');
        return;
      }
    }
    
    try {
      // Save the connection
      const savedConnection = await window.api.config.saveConnection(connectionDetails);
      
      // Try to connect
      const result = await window.api.ssh.connect(connectionDetails);
      
      if (result.success) {
        activeSessionId = result.sessionId;
        
        // Update saved connection with session ID
        savedConnection.sessionId = result.sessionId;
        await window.api.config.saveConnection(savedConnection);
        
        // Update UI
        updateConnectionStatus('online');
        createTerminal(result.sessionId, connectionDetails.name);
        loadConnections(); // Refresh connection list
        
        // Hide dialog
        connectionDialog.classList.remove('active');
        
        // Switch to terminal tab
        document.querySelector('.tab[data-tab="terminal"]').click();
      } else {
        showNotification(`连接失败: ${result.error}`, 'error');
      }
    } catch (error) {
      showNotification(`连接失败: ${error.message}`, 'error');
    }
  });

  // Toggle key file input visibility
  useKeyCheckbox.addEventListener('change', () => {
    keyFileGroup.style.display = useKeyCheckbox.checked ? 'block' : 'none';
  });

  // Browse key file
  browseKeyFileBtn.addEventListener('click', async () => {
    const result = await window.api.dialog.selectFile();
    if (!result.canceled) {
      document.getElementById('connection-key-file').value = result.filePath;
    }
  });

  // Connection search
  connectionSearchInput.addEventListener('input', () => {
    const searchText = connectionSearchInput.value.toLowerCase();
    const connectionItems = connectionList.querySelectorAll('.connection-item');
    
    connectionItems.forEach(item => {
      const name = item.querySelector('.connection-name').textContent.toLowerCase();
      if (name.includes(searchText)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  });

  // Delete connection buttons
  connectionList.addEventListener('click', async (e) => {
    if (e.target.closest('.delete-connection')) {
      const button = e.target.closest('.delete-connection');
      const id = button.getAttribute('data-id');
      
      if (confirm('确定要删除这个连接吗?')) {
        await window.api.config.deleteConnection(id);
        loadConnections();
      }
      
      e.stopPropagation();
    } else if (e.target.closest('.connection-item')) {
      const item = e.target.closest('.connection-item');
      const id = item.getAttribute('data-id');
      
      // Get connection details and connect
      const connections = await window.api.config.getConnections();
      const connection = connections.find(c => c.id === id);
      
      if (connection) {
        try {
          const result = await window.api.ssh.connect(connection);
          
          if (result.success) {
            activeSessionId = result.sessionId;
            
            // Update connection in list
            connection.sessionId = result.sessionId;
            await window.api.config.saveConnection(connection);
            
            // Update UI
            updateConnectionStatus('online');
            createTerminal(result.sessionId, connection.name);
            loadConnections();
            
            // Switch to terminal tab
            document.querySelector('.tab[data-tab="terminal"]').click();
          } else {
            showNotification(`连接失败: ${result.error}`, 'error');
          }
        } catch (error) {
          showNotification(`连接失败: ${error.message}`, 'error');
        }
      }
    }
  });

  // File manager event listeners
  browseLocalBtn.addEventListener('click', async () => {
    const result = await window.api.dialog.selectDirectory();
    if (!result.canceled) {
      localCurrentPath = result.directoryPath;
      localPathInput.value = localCurrentPath;
      loadLocalFiles(localCurrentPath);
    }
  });

  localRefreshBtn.addEventListener('click', () => {
    if (localCurrentPath) {
      loadLocalFiles(localCurrentPath);
    }
  });

  remoteRefreshBtn.addEventListener('click', () => {
    if (activeSessionId) {
      loadRemoteFiles(remotePathInput.value);
    }
  });

  goRemotePathBtn.addEventListener('click', () => {
    if (activeSessionId) {
      loadRemoteFiles(remotePathInput.value);
    }
  });

  // File list click handlers
  localFilesList.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row) {
      const isDir = row.getAttribute('data-is-directory') === 'true';
      const filePath = row.getAttribute('data-path');
      
      if (isDir) {
        localCurrentPath = filePath;
        localPathInput.value = localCurrentPath;
        loadLocalFiles(localCurrentPath);
      }
    }
  });

  remoteFilesList.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row) {
      const isDir = row.getAttribute('data-is-directory') === 'true';
      const filePath = row.getAttribute('data-path');
      
      if (isDir) {
        remotePathInput.value = filePath;
        loadRemoteFiles(filePath);
      }
    }
  });

  // Drag and drop file transfer
  localFilesList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr');
    if (row) {
      const isDir = row.getAttribute('data-is-directory') === 'true';
      if (!isDir) { // Only allow file transfers
        const filePath = row.getAttribute('data-path');
        e.dataTransfer.setData('text/plain', filePath);
        e.dataTransfer.setData('source', 'local');
      }
    }
  });

  remoteFilesList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr');
    if (row) {
      const isDir = row.getAttribute('data-is-directory') === 'true';
      if (!isDir) { // Only allow file transfers
        const filePath = row.getAttribute('data-path');
        e.dataTransfer.setData('text/plain', filePath);
        e.dataTransfer.setData('source', 'remote');
      }
    }
  });

  remoteFilesList.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  localFilesList.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  remoteFilesList.addEventListener('drop', async (e) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData('text/plain');
    const source = e.dataTransfer.getData('source');
    
    if (source === 'local' && filePath && activeSessionId) {
      const fileName = filePath.split(/[/\\]/).pop();
      const remotePath = `${remotePathInput.value}/${fileName}`;
      
      await uploadFile(activeSessionId, filePath, remotePath);
    }
  });

  localFilesList.addEventListener('drop', async (e) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData('text/plain');
    const source = e.dataTransfer.getData('source');
    
    if (source === 'remote' && filePath && localCurrentPath && activeSessionId) {
      const fileName = filePath.split('/').pop();
      const localPath = `${localCurrentPath}/${fileName}`;
      
      await downloadFile(activeSessionId, filePath, localPath);
    }
  });
}

// Load saved connections
async function loadConnections() {
  try {
    const connections = await window.api.config.getConnections();
    
    // Clear the list
    connectionList.innerHTML = '';
    
    if (connections && connections.length > 0) {
      connections.forEach(connection => {
        const item = document.createElement('div');
        item.className = 'connection-item';
        item.setAttribute('data-id', connection.id);
        
        item.innerHTML = `
          <div class="connection-status-indicator ${connection.sessionId ? 'online' : 'offline'}"></div>
          <div class="connection-name">${connection.name}</div>
          <div class="connection-actions">
            <button class="icon-button delete-connection" data-id="${connection.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        `;
        
        connectionList.appendChild(item);
      });
    } else {
      connectionList.innerHTML = '<div class="no-connections">没有保存的连接</div>';
    }
  } catch (error) {
    showNotification(`加载连接失败: ${error.message}`, 'error');
  }
}

// Create a new terminal
function createTerminal(sessionId, name) {
  // Create tab
  const tabId = `terminal-${sessionId}`;
  const existingTab = document.getElementById(`tab-${tabId}`);
  
  if (existingTab) {
    // Terminal already exists, just activate it
    activateTerminal(tabId);
    return;
  }
  
  // Create new terminal tab
  const tab = document.createElement('div');
  tab.className = 'terminal-tab';
  tab.id = `tab-${tabId}`;
  tab.innerHTML = `
    ${name}
    <span class="close-tab">×</span>
  `;
  terminalTabs.appendChild(tab);
  
  // Create terminal panel
  const panel = document.createElement('div');
  panel.className = 'terminal-panel';
  panel.id = tabId;
  terminalPanels.appendChild(panel);
  
  // Initialize xterm.js
  const terminal = new Terminal({
    theme: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#c8c8c8',
      cursorAccent: '#282c34',
      selection: 'rgba(171, 178, 191, 0.3)',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    }
  });
  
  // Use fit addon to resize terminal
  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  
  // Open terminal in the panel
  terminal.open(panel);
  fitAddon.fit();
  
  // Handle terminal resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });
  
  // Handle input
  terminal.onData(async (data) => {
    try {
      await window.api.ssh.execute(sessionId, data);
    } catch (error) {
      terminal.write(`\r\n${error.message}\r\n`);
    }
  });
  
  // Store the terminal instance
  terminals[tabId] = {
    terminal,
    fitAddon,
    sessionId
  };
  
  // Tab click event to switch between terminals
  tab.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-tab')) {
      closeTerminal(tabId);
    } else {
      activateTerminal(tabId);
    }
  });
  
  // Activate this terminal
  activateTerminal(tabId);
  
  // Hide empty terminal message
  const emptyMessage = document.querySelector('.empty-terminal-message');
  if (emptyMessage) {
    emptyMessage.style.display = 'none';
  }
  
  // Welcome message
  terminal.write(`连接到 ${name}\r\n`);
  
  // Initial command - get working directory
  window.api.ssh.execute(sessionId, 'pwd\r\n');
  
  // Also load remote files if in file manager tab
  if (document.querySelector('.tab[data-tab="file-manager"]').classList.contains('active')) {
    loadRemoteFiles('/');
  }
}

// Activate a terminal tab
function activateTerminal(tabId) {
  // Hide all terminal panels
  document.querySelectorAll('.terminal-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.terminal-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show the selected terminal panel
  const panel = document.getElementById(tabId);
  panel.classList.add('active');
  panel.style.display = 'block';
  
  // Add active class to the tab
  const tab = document.getElementById(`tab-${tabId}`);
  tab.classList.add('active');
  
  // Focus the terminal
  if (terminals[tabId]) {
    terminals[tabId].terminal.focus();
    terminals[tabId].fitAddon.fit();
  }
}

// Close a terminal tab
async function closeTerminal(tabId) {
  if (terminals[tabId]) {
    const sessionId = terminals[tabId].sessionId;
    
    // Try to disconnect
    try {
      await window.api.ssh.disconnect(sessionId);
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
    
    // Remove the tab and panel
    const tab = document.getElementById(`tab-${tabId}`);
    const panel = document.getElementById(tabId);
    
    if (tab) tab.remove();
    if (panel) panel.remove();
    
    // Clean up
    delete terminals[tabId];
    
    // Show empty message if no terminals left
    const remainingTerminals = document.querySelectorAll('.terminal-panel');
    if (remainingTerminals.length === 0) {
      const emptyMessage = document.querySelector('.empty-terminal-message');
      if (emptyMessage) {
        emptyMessage.style.display = 'flex';
      }
      
      // Update status
      updateConnectionStatus('offline');
      activeSessionId = null;
    } else {
      // Activate the first remaining terminal
      const firstTerminal = remainingTerminals[0];
      if (firstTerminal) {
        activateTerminal(firstTerminal.id);
      }
    }
    
    // Update connections list
    loadConnections();
  }
}

// Update connection status in the status bar
function updateConnectionStatus(status) {
  connectStatusIndicator.className = `status-indicator ${status}`;
  connectStatusText.textContent = status === 'online' ? '已连接' : '未连接';
}

// Show notification
function showNotification(message, type = 'info') {
  // You could implement a proper notification system here
  alert(message);
}

// Load local files
async function loadLocalFiles(dirPath) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    
    // Clear the list
    localFilesList.innerHTML = '';
    
    // Add parent directory if not at root
    if (dirPath !== '') {
      const parentPath = path.dirname(dirPath);
      
      const row = document.createElement('tr');
      row.setAttribute('data-path', parentPath);
      row.setAttribute('data-is-directory', 'true');
      
      row.innerHTML = `
        <td>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
          </svg>
          ..
        </td>
        <td></td>
        <td></td>
      `;
      
      localFilesList.appendChild(row);
    }
    
    // Add directories first
    files
      .filter(file => file.isDirectory())
      .forEach(file => {
        const fullPath = path.join(dirPath, file.name);
        
        const row = document.createElement('tr');
        row.setAttribute('data-path', fullPath);
        row.setAttribute('data-is-directory', 'true');
        
        row.innerHTML = `
          <td>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
            </svg>
            ${file.name}
          </td>
          <td>目录</td>
          <td>${new Date(fs.statSync(fullPath).mtime).toLocaleString()}</td>
        `;
        
        localFilesList.appendChild(row);
      });
    
    // Then add files
    files
      .filter(file => file.isFile())
      .forEach(file => {
        const fullPath = path.join(dirPath, file.name);
        const stats = fs.statSync(fullPath);
        
        const row = document.createElement('tr');
        row.setAttribute('data-path', fullPath);
        row.setAttribute('data-is-directory', 'false');
        row.draggable = true;
        
        row.innerHTML = `
          <td>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
            ${file.name}
          </td>
          <td>${formatFileSize(stats.size)}</td>
          <td>${new Date(stats.mtime).toLocaleString()}</td>
        `;
        
        localFilesList.appendChild(row);
      });
  } catch (error) {
    showNotification(`加载本地文件失败: ${error.message}`, 'error');
  }
}

// Load remote files
async function loadRemoteFiles(dirPath) {
  if (!activeSessionId) {
    showNotification('请先连接到SSH服务器', 'error');
    return;
  }
  
  try {
    const result = await window.api.file.list(activeSessionId, dirPath);
    
    if (result.success) {
      const files = result.files;
      
      // Clear the list
      remoteFilesList.innerHTML = '';
      
      // Add parent directory if not at root
      if (dirPath !== '/') {
        const parentPath = dirPath.split('/').slice(0, -1).join('/') || '/';
        
        const row = document.createElement('tr');
        row.setAttribute('data-path', parentPath);
        row.setAttribute('data-is-directory', 'true');
        
        row.innerHTML = `
          <td>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
            </svg>
            ..
          </td>
          <td></td>
          <td></td>
          <td></td>
        `;
        
        remoteFilesList.appendChild(row);
      }
      
      // Add directories first
      files
        .filter(file => file.isDirectory)
        .forEach(file => {
          const row = document.createElement('tr');
          row.setAttribute('data-path', file.fullPath);
          row.setAttribute('data-is-directory', 'true');
          
          row.innerHTML = `
            <td>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
              </svg>
              ${file.name}
            </td>
            <td>目录</td>
            <td>${new Date(file.modifyTime).toLocaleString()}</td>
            <td>${formatPermissions(file.permissions)}</td>
          `;
          
          remoteFilesList.appendChild(row);
        });
      
      // Then add files
      files
        .filter(file => !file.isDirectory)
        .forEach(file => {
          const row = document.createElement('tr');
          row.setAttribute('data-path', file.fullPath);
          row.setAttribute('data-is-directory', 'false');
          row.draggable = true;
          
          row.innerHTML = `
            <td>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
              ${file.name}
            </td>
            <td>${formatFileSize(file.size)}</td>
            <td>${new Date(file.modifyTime).toLocaleString()}</td>
            <td>${formatPermissions(file.permissions)}</td>
          `;
          
          remoteFilesList.appendChild(row);
        });
    } else {
      showNotification(`加载远程文件失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`加载远程文件失败: ${error.message}`, 'error');
  }
}

// Upload file
async function uploadFile(sessionId, localPath, remotePath) {
  try {
    // Show transfer progress
    transferProgressBar.style.width = '0%';
    transferInfo.textContent = `上传中: ${localPath.split(/[/\\]/).pop()}`;
    
    // Start upload
    const result = await window.api.file.upload(sessionId, localPath, remotePath);
    
    if (result.success) {
      // Complete
      transferProgressBar.style.width = '100%';
      transferInfo.textContent = `上传完成: ${localPath.split(/[/\\]/).pop()}`;
      
      // Refresh remote files
      loadRemoteFiles(remotePathInput.value);
    } else {
      transferProgressBar.style.width = '0%';
      transferInfo.textContent = `上传失败: ${result.error}`;
    }
  } catch (error) {
    transferProgressBar.style.width = '0%';
    transferInfo.textContent = `上传失败: ${error.message}`;
  }
}

// Download file
async function downloadFile(sessionId, remotePath, localPath) {
  try {
    // Show transfer progress
    transferProgressBar.style.width = '0%';
    transferInfo.textContent = `下载中: ${remotePath.split('/').pop()}`;
    
    // Start download
    const result = await window.api.file.download(sessionId, remotePath, localPath);
    
    if (result.success) {
      // Complete
      transferProgressBar.style.width = '100%';
      transferInfo.textContent = `下载完成: ${remotePath.split('/').pop()}`;
      
      // Refresh local files
      loadLocalFiles(localCurrentPath);
    } else {
      transferProgressBar.style.width = '0%';
      transferInfo.textContent = `下载失败: ${result.error}`;
    }
  } catch (error) {
    transferProgressBar.style.width = '0%';
    transferInfo.textContent = `下载失败: ${error.message}`;
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to format file permissions
function formatPermissions(mode) {
  if (typeof mode !== 'number') return '';
  
  let permissions = '';
  
  // Owner
  permissions += (mode & 0o400) ? 'r' : '-';
  permissions += (mode & 0o200) ? 'w' : '-';
  permissions += (mode & 0o100) ? 'x' : '-';
  
  // Group
  permissions += (mode & 0o040) ? 'r' : '-';
  permissions += (mode & 0o020) ? 'w' : '-';
  permissions += (mode & 0o010) ? 'x' : '-';
  
  // Others
  permissions += (mode & 0o004) ? 'r' : '-';
  permissions += (mode & 0o002) ? 'w' : '-';
  permissions += (mode & 0o001) ? 'x' : '-';
  
  return permissions;
}