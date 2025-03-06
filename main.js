const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

// Import services
const sshService = require('./services/ssh-service');
const ConfigStore = require('./services/config-store');

// Initialize services
const configStore = new ConfigStore();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // 允许加载本地文件
        }
    });

    // 创建临时HTML文件
    const tempHtmlPath = path.join(__dirname, 'temp.html');

    ejs.renderFile(
        path.join(__dirname, 'views', 'index.ejs'),
        {
            title: '快速SSH客户端',
            connections: configStore.getConnections() || []
        },
        { root: path.join(__dirname, 'views') },
        (err, html) => {
            if (err) {
                console.error('EJS渲染错误:', err);
                return;
            }

            // 写入临时文件
            fs.writeFileSync(tempHtmlPath, html);

            // 加载文件
            mainWindow.loadFile(tempHtmlPath);
        }
    );
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers for SSH operations
ipcMain.handle('ssh:connect', async (event, connectionDetails) => {
    try {
        const result = await sshService.connect(connectionDetails);
        return { success: true, sessionId: result.sessionId };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ssh:disconnect', async (event, sessionId) => {
    try {
        await sshService.disconnect(sessionId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ssh:execute', async (event, { sessionId, command }) => {
    try {
        const result = await sshService.executeCommand(sessionId, command);
        return { success: true, output: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC Handlers for file operations
ipcMain.handle('file:list', async (event, { sessionId, path }) => {
    try {
        const files = await sshService.listFiles(sessionId, path);
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file:upload', async (event, { sessionId, localPath, remotePath }) => {
    try {
        await sshService.uploadFile(sessionId, localPath, remotePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file:download', async (event, { sessionId, remotePath, localPath }) => {
    try {
        await sshService.downloadFile(sessionId, remotePath, localPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC Handlers for configuration
ipcMain.handle('config:get-connections', () => {
    return configStore.getConnections();
});

ipcMain.handle('config:save-connection', (event, connection) => {
    return configStore.saveConnection(connection);
});

ipcMain.handle('config:delete-connection', (event, id) => {
    return configStore.deleteConnection(id);
});

ipcMain.handle('dialog:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile']
    });

    if (result.canceled) {
        return { canceled: true };
    }

    return {
        canceled: false,
        filePath: result.filePaths[0]
    };
});

ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (result.canceled) {
        return { canceled: true };
    }

    return {
        canceled: false,
        directoryPath: result.filePaths[0]
    };
});

// 确保main.js中有这段代码
ipcMain.handle('ssh:send-data', async (event, { sessionId, data }) => {
    try {
      console.log("发送数据:", sessionId, data);
      await sshService.sendData(sessionId, data);
      return { success: true };
    } catch (error) {
      console.error("发送数据失败:", error);
      return { success: false, error: error.message };
    }
  });
  
  // 添加SSH数据监听
  sshService.on('data', (sessionId, data) => {
    console.log("SSH数据:", sessionId, data.length);
    mainWindow.webContents.send('ssh:data', { sessionId, data });
  });