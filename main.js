const {app, BrowserWindow, ipcMain, dialog} = require('electron');
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
            title: 'SSHL客户端',
            connections: configStore.getConnections() || []
        },
        {root: path.join(__dirname, 'views')},
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

// IPC Handlers for file operations
ipcMain.handle('file:list', async (event, {sessionId, path}) => {
    try {
        const files = await sshService.listFiles(sessionId, path);
        return {success: true, files};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

// Add this to your existing IPC handlers
ipcMain.handle('file:list-local', async (event, directory) => {
    try {
        const files = fs.readdirSync(directory);
        const fileDetails = files.map(file => {
            const filePath = path.join(directory, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                isDirectory: stats.isDirectory(),
                size: stats.size,
                modifyTime: stats.mtime
            };
        });

        // Add parent directory entry if not at root
        if (path.dirname(directory) !== directory) {
            fileDetails.unshift({
                name: '..',
                isDirectory: true,
                size: 0,
                modifyTime: new Date()
            });
        }

        return {success: true, files: fileDetails};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('file:upload', async (event, {sessionId, localPath, remotePath}) => {
    try {
        await sshService.uploadFile(sessionId, localPath, remotePath);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('file:download', async (event, {sessionId, remotePath, localPath}) => {
    try {
        await sshService.downloadFile(sessionId, remotePath, localPath);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
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
        return {canceled: true};
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
        return {canceled: true};
    }

    return {
        canceled: false,
        directoryPath: result.filePaths[0]
    };
});

// SSH连接处理
ipcMain.handle('ssh:connect', async (event, connectionDetails) => {
    console.log('收到连接请求:', connectionDetails ?
        `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port || 22}` :
        'undefined');

    try {
        if (!connectionDetails) {
            return {success: false, error: '连接详情不能为空'};
        }

        if (!sshService) {
            console.error('SSH服务未初始化');
            return {success: false, error: 'SSH服务未初始化'};
        }

        const result = await sshService.connect(connectionDetails);
        console.log('连接成功, 会话ID:', result.sessionId);
        return {success: true, sessionId: result.sessionId};
    } catch (error) {
        console.error('SSH连接错误:', error);
        return {success: false, error: error.message || '连接失败'};
    }
});

ipcMain.handle('ssh:disconnect', async (event, sessionId) => {
    console.log('断开连接请求:', sessionId);
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        await sshService.disconnect(sessionId);

        // 更新保存的连接状态
        const connections = configStore.getConnections();
        const updatedConnections = connections.map(conn => {
            if (conn.sessionId === sessionId) {
                return {...conn, sessionId: null};
            }
            return conn;
        });

        if (JSON.stringify(connections) !== JSON.stringify(updatedConnections)) {
            configStore.store.set('connections', updatedConnections);
        }

        return {success: true};
    } catch (error) {
        console.error('断开连接错误:', error);
        return {success: false, error: error.message};
    }
});

ipcMain.handle('ssh:send-data', async (event, {sessionId, data}) => {
    //console.log('发送数据:', sessionId, data);
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        if (!sessionId) {
            return {success: false, error: '会话ID不能为空'};
        }

        if (data === undefined || data === null) {
            return {success: false, error: '数据不能为空'};
        }

        // 确保data是字符串
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');
        await sshService.sendData(sessionId, dataStr);
        return {success: true};
    } catch (error) {
        console.error('发送数据错误:', error);
        return {success: false, error: error.message};
    }
});

ipcMain.handle('ssh:execute', async (event, {sessionId, command}) => {
    console.log('执行命令:', sessionId, command);
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        const result = await sshService.executeCommand(sessionId, command);
        return {success: true, output: result};
    } catch (error) {
        console.error('执行命令错误:', error);
        return {success: false, error: error.message};
    }
});

// 添加SSH数据监听
sshService.on('data', (sessionId, data) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        // console.log('SSH数据:', sessionId, data.length);
        // 修改: 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');
        mainWindow.webContents.send('ssh:data', {sessionId, data: dataStr});
    } catch (error) {
        console.error('处理SSH数据时出错:', error);
    }
});

// 处理SSH连接关闭
sshService.on('close', (sessionId) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        // 更新保存的连接状态
        const connections = configStore.getConnections();
        const updatedConnections = connections.map(conn => {
            if (conn.sessionId === sessionId) {
                return {...conn, sessionId: null};
            }
            return conn;
        });

        if (JSON.stringify(connections) !== JSON.stringify(updatedConnections)) {
            configStore.store.set('connections', updatedConnections);
            mainWindow.webContents.send('connections:updated');
        }

        mainWindow.webContents.send('ssh:closed', {sessionId});
    } catch (error) {
        console.error('处理SSH关闭事件时出错:', error);
    }
});
ipcMain.handle('ssh:resize', async (event, {sessionId, cols, rows}) => {
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        await sshService.resize(sessionId, cols, rows);
        return {success: true};
    } catch (error) {
        console.error('调整终端大小错误:', error);
        return {success: false, error: error.message};
    }
});
