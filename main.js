const {app, BrowserWindow, ipcMain, dialog, protocol} = require('electron');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const os = require('os');

// Import services
const sshService = require('./services/ssh-service');
const ConfigStore = require('./services/config-store');

// 延迟初始化服务
let configStore;
let mainWindow;
let tempHtmlPath;

// 将协议注册逻辑分离到单独的函数
function registerProtocols() {
    protocol.registerFileProtocol('app', (request, callback) => {
        const url = request.url.replace('app://', '');
        try {
            return callback(path.normalize(`${__dirname}/${url}`));
        } catch (error) {
            console.error('Protocol error:', error);
        }
    });
}

// 将命令行参数设置逻辑分离到单独的函数
function setupCommandLineArgs() {
    app.allowRendererProcessReuse = false;
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
    app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // 先不显示窗口，等最大化后再显示
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // 允许加载本地文件
            allowRunningInsecureContent: true
        }
    });

    // 创建临时目录确保存在
    const tempDir = path.join(os.tmpdir(), 'sshl-temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, {recursive: true});
    }

    // 使用系统临时目录生成临时文件
    tempHtmlPath = path.join(tempDir, `index-${Date.now()}.html`);

    // 先加载加载页面
    mainWindow.loadFile(path.join(__dirname, 'views', 'loading.html'));

    // 窗口准备好后最大化并显示
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
        
        // 窗口显示后再初始化服务和渲染主界面
        setTimeout(() => {
            initializeServices();
            renderMainInterface();
        }, 100);
    });

    // 窗口关闭时删除临时文件
    mainWindow.on('closed', () => {
        try {
            if (fs.existsSync(tempHtmlPath)) {
                fs.unlinkSync(tempHtmlPath);
            }
        } catch (e) {
            console.error('删除临时文件失败:', e);
        }
    });

    // 打开开发者工具帮助调试
    // mainWindow.webContents.openDevTools();
}

// 初始化服务
function initializeServices() {
    // 延迟初始化配置存储
    configStore = new ConfigStore();
}

// 将EJS渲染逻辑分离到单独的函数
function renderMainInterface() {
    // 使用EJS渲染HTML内容
    ejs.renderFile(
        path.join(__dirname, 'views', 'index.ejs'),
        {
            title: 'SSHL客户端',
            connections: configStore.getConnections() || [],
            basePath: __dirname
        },
        {root: path.join(__dirname, 'views')},
        (err, html) => {
            if (err) {
                console.error('EJS渲染错误:', err);
                return;
            }

            // 替换相对路径为app://路径
            let modifiedHtml = html.replace(
                /(href|src)=['"]([^"']+)['"]/g,
                (match, attr, url) => {
                    // 忽略已经是绝对路径或http/https的链接
                    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('app://')) {
                        return match;
                    }

                    // 转换到app://协议
                    return `${attr}="app://${url}"`;
                }
            );

            // 写入临时文件
            fs.writeFileSync(tempHtmlPath, modifiedHtml);

            // 加载文件
            mainWindow.loadURL(`file://${tempHtmlPath}`);
        }
    );
}

app.whenReady().then(() => {
    // 注册协议处理器
    registerProtocols();
    
    // 设置命令行参数
    setupCommandLineArgs();
    
    // 创建窗口
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

/**
 * 通用IPC处理函数创建器 - 简化错误处理
 * @param {Function} handler - 实际处理逻辑
 * @returns {Function} - 包装了错误处理的处理函数
 */
function createIpcHandler(handler) {
    return async (event, ...args) => {
        try {
            return await handler(event, ...args);
        } catch (error) {
            console.error('IPC处理错误:', error);
            return { success: false, error: error.message || '操作失败' };
        }
    };
}

// 使用这个函数来重构文件操作处理程序
const fileOperationHandlers = {
    // 获取主目录
    'file:get-home-dir': createIpcHandler(async () => {
        return os.homedir();
    }),
    
    // 列出远程文件
    'file:list': createIpcHandler(async (event, { sessionId, path }) => {
        const files = await sshService.listFiles(sessionId, path);
        return { success: true, files };
    }),

    // 列出本地文件
    'file:list-local': createIpcHandler(async (event, directory) => {
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

        // 添加父目录条目（如果不在根目录）
        if (path.dirname(directory) !== directory) {
            fileDetails.unshift({
                name: '..',
                isDirectory: true,
                size: 0,
                modifyTime: new Date()
            });
        }

        return { success: true, files: fileDetails };
    }),

    // 上传文件
    'file:upload': createIpcHandler(async (event, { sessionId, localPath, remotePath }) => {
        await sshService.uploadFile(sessionId, localPath, remotePath);
        return { success: true };
    }),

    // 下载文件
    'file:download': createIpcHandler(async (event, { sessionId, remotePath, localPath }) => {
        await sshService.downloadFile(sessionId, remotePath, localPath);
        return { success: true };
    })
};

// 注册所有文件操作处理器
Object.entries(fileOperationHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
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
        const result = await sshService.sendData(sessionId, dataStr);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[sendData] 发送数据失败: ${result.error}`);
            return {success: false, error: result.error || '发送数据失败'};
        }

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
        // 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');

        // 增加数据标识，帮助调试
        const timestamp = Date.now();
        const shortId = `${timestamp % 10000}`;

        console.log(`[${shortId}] 向渲染进程发送数据，会话ID: ${sessionId}, 数据长度: ${dataStr.length}`);

        mainWindow.webContents.send('ssh:data', {
            sessionId,
            data: dataStr,
            timestamp,
            id: shortId
        });
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

        const result = await sshService.resize(sessionId, cols, rows);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[resize] 调整终端大小失败: ${result.error}`);
            return {success: false, error: result.error || '调整终端大小失败'};
        }

        return {success: true};
    } catch (error) {
        console.error('调整终端大小错误:', error);
        return {success: false, error: error.message};
    }
});

// 添加刷新命令提示符的处理程序
ipcMain.handle('ssh:refresh-prompt', async (event, sessionId) => {
    console.log('刷新命令提示符请求:', sessionId);
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        const result = await sshService.refreshPrompt(sessionId);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[refreshPrompt] 刷新命令提示符失败: ${result.error}`);
            return {success: false, error: result.error || '刷新命令提示符失败'};
        }

        return {success: true};
    } catch (error) {
        console.error('刷新命令提示符错误:', error);
        return {success: false, error: error.message};
    }
});

// 添加激活会话的处理程序
ipcMain.handle('ssh:activate-session', async (event, sessionId) => {
    console.log('激活会话请求:', sessionId);
    try {
        if (!sshService) {
            return {success: false, error: 'SSH服务未初始化'};
        }

        const result = await sshService.activateSession(sessionId);
        if (result.success) {
            // 确保返回更新的会话ID，即使它与原始会话ID相同
            console.log(`会话激活成功，返回会话ID: ${result.sessionId || sessionId}`);
            return {success: true, sessionId: result.sessionId || sessionId};
        } else {
            console.error('会话激活失败:', result.error || '未知错误');
            return {success: false, error: result.error || '会话激活失败'};
        }
    } catch (error) {
        console.error('激活会话错误:', error);
        return {success: false, error: error.message};
    }
});

// 扩展文件操作处理程序
const additionalFileHandlers = {
    // 删除本地文件
    'file:delete-local': createIpcHandler(async (event, filePath) => {
        fs.unlinkSync(filePath);
        return { success: true };
    }),

    // 删除本地目录
    'file:delete-local-directory': createIpcHandler(async (event, dirPath) => {
        try {
            // 首先尝试删除空目录
            fs.rmdirSync(dirPath);
            return { success: true };
        } catch (error) {
            // 如果目录非空，则递归删除
            if (error.code === 'ENOTEMPTY') {
                const removeDir = (dir) => {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            removeDir(fullPath);
                        } else {
                            fs.unlinkSync(fullPath);
                        }
                    }
                    fs.rmdirSync(dir);
                };

                removeDir(dirPath);
                return { success: true };
            }
            throw error; // 重新抛出其他错误
        }
    }),

    // 创建远程目录
    'file:create-remote-directory': createIpcHandler(async (event, { sessionId, remotePath }) => {
        await sshService.createDirectory(sessionId, remotePath);
        return { success: true };
    }),

    // 上传目录
    'file:upload-directory': createIpcHandler(async (event, { sessionId, localPath, remotePath }) => {
        await sshService.uploadDirectory(sessionId, localPath, remotePath);
        return { success: true };
    }),

    // 下载目录
    'file:download-directory': createIpcHandler(async (event, { sessionId, remotePath, localPath }) => {
        await sshService.downloadDirectory(sessionId, remotePath, localPath);
        return { success: true };
    })
};

// 注册额外的文件操作处理器
Object.entries(additionalFileHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
});

sshService.on('download-progress', (progressData) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        mainWindow.webContents.send('file:download-progress', progressData);
    } catch (error) {
        console.error('处理下载进度事件时出错:', error);
    }
});

ipcMain.handle('ssh:get-session-buffer', async (event, sessionId) => {
    try {
        return await sshService.getSessionBuffer(sessionId);
    } catch (error) {
        console.error('获取会话缓冲区失败:', error);
        return {success: false, error: error.message};
    }
});

// 添加在 main.js 中
const { spawn } = require('child_process');

ipcMain.handle('ssh:connect-alternative', async (event, connectionDetails) => {
    // 使用系统级网络命令测试连接
    console.log(`尝试连接: ${connectionDetails.host}`);

    // 首先测试端口是否可达
    return new Promise((resolve) => {
        // 使用底层系统网络操作代替 Node.js 网络 API
        const process = spawn('nc', ['-G', '5', '-z', connectionDetails.host, connectionDetails.port || '22']);

        process.on('close', (code) => {
            const portOpen = code === 0;

            if (portOpen) {
                // 端口可达，正常进行 SSH 连接
                sshService.connect(connectionDetails)
                    .then(result => resolve(result))
                    .catch(err => resolve({success: false, error: err.message}));
            } else {
                // 如果系统级网络测试失败，尝试用备用方法
                resolve({
                    success: false,
                    error: `网络连接不可达: ${connectionDetails.host}:${connectionDetails.port || 22}`,
                    needsAlternativeMethod: true
                });
            }
        });
    });
});