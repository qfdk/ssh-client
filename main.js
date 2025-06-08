const {app, BrowserWindow, ipcMain, dialog, protocol} = require('electron');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const os = require('os');

// 惰性加载服务 - 仅在需要时才加载模块
let _sshService = null;
let _configStore = null;
let mainWindow;
let tempHtmlPath;

/**
 * 获取SSH服务实例 - 惰性加载
 * @returns {Object} SSH服务实例
 */
function getSshService() {
    if (!_sshService) {
        console.log('惰性加载SSH服务');
        _sshService = require('./services/ssh-service');
        
        // 设置SSH数据监听
        _sshService.on('data', handleSshData);
        
        // 处理SSH连接关闭
        _sshService.on('close', handleSshClose);
        
        // 处理下载进度事件
        _sshService.on('download-progress', handleDownloadProgress);
    }
    return _sshService;
}

/**
 * 获取配置存储实例 - 惰性加载
 * @returns {Object} 配置存储实例
 */
function getConfigStore() {
    if (!_configStore) {
        console.log('惰性加载配置存储');
        const ConfigStore = require('./services/config-store');
        _configStore = new ConfigStore();
    }
    return _configStore;
}

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

/**
 * 创建主窗口
 */
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
            // 惰性加载服务 - 仅初始化配置存储
            getConfigStore();
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

}

/**
 * 渲染主界面
 */
function renderMainInterface() {
    // 使用EJS渲染HTML内容
    ejs.renderFile(
        path.join(__dirname, 'views', 'index.ejs'),
        {
            title: 'SSHL客户端',
            connections: getConfigStore().getConnections() || [],
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

/**
 * 处理SSH数据事件
 * @param {string} sessionId - 会话ID
 * @param {string|Buffer} data - 数据
 */
function handleSshData(sessionId, data) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        // 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');

        // 直接发送数据，减少元数据开销
        mainWindow.webContents.send('ssh:data', {
            sessionId,
            data: dataStr
        });
    } catch (error) {
        console.error('处理SSH数据时出错:', error);
    }
}

/**
 * 处理SSH连接关闭事件
 * @param {string} sessionId - 会话ID
 */
function handleSshClose(sessionId) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        // 更新保存的连接状态
        const configStore = getConfigStore();
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
}

/**
 * 处理下载进度事件
 * @param {Object} progressData - 进度数据
 */
function handleDownloadProgress(progressData) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        mainWindow.webContents.send('file:download-progress', progressData);
    } catch (error) {
        console.error('处理下载进度事件时出错:', error);
    }
}

// 应用初始化
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

// 文件操作处理程序
const fileOperationHandlers = {
    // 获取主目录
    'file:get-home-dir': createIpcHandler(async () => {
        return os.homedir();
    }),
    
    // 列出远程文件
    'file:list': createIpcHandler(async (event, { sessionId, path }) => {
        const files = await getSshService().listFiles(sessionId, path);
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
        await getSshService().uploadFile(sessionId, localPath, remotePath);
        return { success: true };
    }),

    // 下载文件
    'file:download': createIpcHandler(async (event, { sessionId, remotePath, localPath }) => {
        await getSshService().downloadFile(sessionId, remotePath, localPath);
        return { success: true };
    }),
    
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
        await getSshService().createDirectory(sessionId, remotePath);
        return { success: true };
    }),

    // 上传目录
    'file:upload-directory': createIpcHandler(async (event, { sessionId, localPath, remotePath }) => {
        await getSshService().uploadDirectory(sessionId, localPath, remotePath);
        return { success: true };
    }),

    // 下载目录
    'file:download-directory': createIpcHandler(async (event, { sessionId, remotePath, localPath }) => {
        await getSshService().downloadDirectory(sessionId, remotePath, localPath);
        return { success: true };
    })
};

// 配置操作处理程序
const configOperationHandlers = {
    // 获取连接列表
    'config:get-connections': createIpcHandler(async () => {
        return getConfigStore().getConnections();
    }),
    
    // 保存连接
    'config:save-connection': createIpcHandler(async (event, connection) => {
        return getConfigStore().saveConnection(connection);
    }),
    
    // 删除连接
    'config:delete-connection': createIpcHandler(async (event, id) => {
        return getConfigStore().deleteConnection(id);
    })
};

// 对话框操作处理程序
const dialogOperationHandlers = {
    // 选择文件
    'dialog:select-file': createIpcHandler(async () => {
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
    }),
    
    // 选择目录
    'dialog:select-directory': createIpcHandler(async () => {
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
    })
};

// SSH操作处理程序
const sshOperationHandlers = {
    // SSH连接
    'ssh:connect': createIpcHandler(async (event, connectionDetails) => {
        console.log('收到连接请求:', connectionDetails ?
            `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port || 22}` :
            'undefined');

        if (!connectionDetails) {
            return {success: false, error: '连接详情不能为空'};
        }

        const sshService = getSshService();
        const result = await sshService.connect(connectionDetails);
        console.log('连接成功, 会话ID:', result.sessionId);
        return {success: true, sessionId: result.sessionId};
    }),
    
    // SSH断开连接
    'ssh:disconnect': createIpcHandler(async (event, sessionId) => {
        console.log('断开连接请求:', sessionId);
        
        const sshService = getSshService();
        await sshService.disconnect(sessionId);

        // 更新保存的连接状态
        const configStore = getConfigStore();
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
    }),
    
    // 发送数据
    'ssh:send-data': createIpcHandler(async (event, {sessionId, data}) => {
        if (!sessionId) {
            return {success: false, error: '会话ID不能为空'};
        }

        if (data === undefined || data === null) {
            return {success: false, error: '数据不能为空'};
        }

        // 确保data是字符串
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');
        const result = await getSshService().sendData(sessionId, dataStr);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[sendData] 发送数据失败: ${result.error}`);
            return {success: false, error: result.error || '发送数据失败'};
        }

        return {success: true};
    }),
    
    // 执行命令
    'ssh:execute': createIpcHandler(async (event, {sessionId, command}) => {
        console.log('执行命令:', sessionId, command);
        
        const result = await getSshService().executeCommand(sessionId, command);
        return {success: true, output: result};
    }),
    
    // 调整大小
    'ssh:resize': createIpcHandler(async (event, {sessionId, cols, rows}) => {
        const result = await getSshService().resize(sessionId, cols, rows);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[resize] 调整终端大小失败: ${result.error}`);
            return {success: false, error: result.error || '调整终端大小失败'};
        }

        return {success: true};
    }),
    
    // 刷新提示符
    'ssh:refresh-prompt': createIpcHandler(async (event, sessionId) => {
        console.log('刷新命令提示符请求:', sessionId);
        
        const result = await getSshService().refreshPrompt(sessionId);

        // 检查结果是否成功
        if (result && result.success === false) {
            console.log(`[refreshPrompt] 刷新命令提示符失败: ${result.error}`);
            return {success: false, error: result.error || '刷新命令提示符失败'};
        }

        return {success: true};
    }),
    
    // 激活会话
    'ssh:activate-session': createIpcHandler(async (event, sessionId) => {
        console.log('激活会话请求:', sessionId);
        
        const result = await getSshService().activateSession(sessionId);
        if (result.success) {
            // 确保返回更新的会话ID，即使它与原始会话ID相同
            console.log(`会话激活成功，返回会话ID: ${result.sessionId || sessionId}`);
            return {success: true, sessionId: result.sessionId || sessionId};
        } else {
            console.error('会话激活失败:', result.error || '未知错误');
            return {success: false, error: result.error || '会话激活失败'};
        }
    }),
    
    // 获取会话缓冲区
    'ssh:get-session-buffer': createIpcHandler(async (event, sessionId) => {
        return await getSshService().getSessionBuffer(sessionId);
    }),
    
};

// 注册所有IPC处理程序
function registerAllHandlers() {
    // 文件操作处理程序
    Object.entries(fileOperationHandlers).forEach(([channel, handler]) => {
        ipcMain.handle(channel, handler);
    });
    
    // 配置操作处理程序
    Object.entries(configOperationHandlers).forEach(([channel, handler]) => {
        ipcMain.handle(channel, handler);
    });
    
    // 对话框操作处理程序
    Object.entries(dialogOperationHandlers).forEach(([channel, handler]) => {
        ipcMain.handle(channel, handler);
    });
    
    // SSH操作处理程序
    Object.entries(sshOperationHandlers).forEach(([channel, handler]) => {
        ipcMain.handle(channel, handler);
    });
}

// 注册所有IPC处理程序
registerAllHandlers();
