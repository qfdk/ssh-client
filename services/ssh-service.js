const {Client} = require('ssh2');
const {EventEmitter} = require('events');
const fs = require('fs');

class SshService extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.sharedConnections = new Map(); // 存储共享的SSH连接
        this.connectionToSession = new Map(); // 存储连接ID到会话ID的映射
    }

    // 根据连接ID获取会话ID
    getSessionByConnectionId(connectionId) {
        if (!connectionId) return null;

        const sessionId = this.connectionToSession.get(connectionId);
        if (!sessionId) return null;

        // 检查会话是否仍然存在
        const session = this.sessions.get(sessionId);
        if (!session) {
            // 如果会话不存在，清理映射
            this.connectionToSession.delete(connectionId);
            return null;
        }

        return {
            sessionId,
            session
        };
    }

    // 根据连接ID获取连接对象
    getConnection(connectionId) {
        const sessionInfo = this.getSessionByConnectionId(connectionId);
        if (!sessionInfo) return null;

        return sessionInfo.session;
    }

    async connect(connectionDetails) {
        return new Promise((resolve, reject) => {
            try {
                if (!connectionDetails || !connectionDetails.host || !connectionDetails.username) {
                    return reject(new Error('缺少必要的连接参数'));
                }

                // 检查是否已经存在与该connectionId关联的会话
                if (connectionDetails.id) {
                    const existingSessionInfo = this.getSessionByConnectionId(connectionDetails.id);
                    if (existingSessionInfo && existingSessionInfo.session) {
                        console.log(`复用现有会话: ${existingSessionInfo.sessionId}, 连接ID: ${connectionDetails.id}`);
                        // 标记会话为活跃
                        existingSessionInfo.session.active = true;
                        this.sessions.set(existingSessionInfo.sessionId, existingSessionInfo.session);

                        // 如果存在stream，使用更可靠的方式刷新命令提示符
                        if (existingSessionInfo.session.stream) {
                            console.log(`[connect] 复用会话时刷新命令提示符, 会话ID: ${existingSessionInfo.sessionId}`);
                        } else {
                            console.warn(`[connect] 复用会话 ${existingSessionInfo.sessionId} 没有可用的stream`);
                        }

                        return resolve({sessionId: existingSessionInfo.sessionId});
                    }
                }

                // 生成连接唯一标识
                const connectionKey = `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port || 22}`;

                // 检查是否存在可共享的连接
                const existingConnection = this.sharedConnections.get(connectionKey);
                const conn = existingConnection ? existingConnection.conn : new Client();

                conn.on('ready', () => {
                    const sessionId = Date.now().toString();

                    // 创建shell会话
                    conn.shell({term: 'xterm-color', rows: 24, cols: 80}, (err, stream) => {
                        if (err) {
                            conn.end();
                            reject(err);
                            return;
                        }

                        // 设置数据处理
                        stream.on('data', (data) => {
                            // 将Buffer转为字符串，避免数据类型问题
                            const dataStr = data.toString('utf8');

                            // 检查会话是否活跃，只有活跃会话才发送数据
                            const session = this.sessions.get(sessionId);
                            if (session && session.active) {
                                this.emit('data', sessionId, dataStr);
                            } else {
                                console.log(`[SshService] 会话 ${sessionId} 不活跃，不发送数据`);
                            }
                        });

                        stream.stderr.on('data', (data) => {
                            const dataStr = data.toString('utf8');

                            // 同样检查会话活跃状态
                            const session = this.sessions.get(sessionId);
                            if (session && session.active) {
                                this.emit('data', sessionId, dataStr);
                            } else {
                                console.log(`[SshService] 会话 ${sessionId} 不活跃，不发送stderr数据`);
                            }
                        });

                        stream.on('close', () => {
                            this.emit('close', sessionId);

                            // 获取会话信息
                            const session = this.sessions.get(sessionId);
                            if (session) {
                                // 标记会话为非活跃，但不删除会话
                                session.active = false;
                                // 将stream设置为null，以便后续重新连接
                                session.stream = null;
                                // 清理连接资源
                                if (session.conn) {
                                    session.conn.end();
                                    session.conn = null;
                                }
                                // 清理共享连接
                                const connectionKey = session.connectionKey;
                                const sharedConnection = this.sharedConnections.get(connectionKey);
                                if (sharedConnection) {
                                    sharedConnection.refCount--;
                                    if (sharedConnection.refCount <= 0) {
                                        this.sharedConnections.delete(connectionKey);
                                    }
                                }
                                // 清理连接ID映射
                                if (session.connectionId) {
                                    this.connectionToSession.delete(session.connectionId);
                                }
                                this.sessions.set(sessionId, session);
                                console.log(`会话 ${sessionId} 已关闭，标记为非活跃，stream已设为null`);
                            }
                        });

                        // 存储会话和共享连接信息
                        this.sessions.set(sessionId, {
                            conn,
                            stream,
                            details: connectionDetails,
                            connectionKey,
                            connectionId: connectionDetails.id, // 保存连接ID
                            active: true // 添加活跃状态标志
                        });

                        // 保存连接ID到会话ID的映射
                        if (connectionDetails.id) {
                            this.connectionToSession.set(connectionDetails.id, sessionId);
                        }

                        // 更新或创建共享连接记录
                        if (!existingConnection) {
                            this.sharedConnections.set(connectionKey, {
                                conn,
                                refCount: 1,
                                lastUsed: Date.now()
                            });
                        } else {
                            existingConnection.refCount++;
                            existingConnection.lastUsed = Date.now();
                        }

                        resolve({sessionId});
                    });
                });

                conn.on('error', (err) => {
                    console.error('SSH连接错误:', err.message);
                    reject(err);
                });

                // 连接配置
                const connectOptions = {
                    host: connectionDetails.host,
                    port: connectionDetails.port || 22,
                    username: connectionDetails.username,
                    // 设置终端类型，以确保正确的shell环境
                    term: 'xterm-color', // 改为xterm-color以提高兼容性
                    // 添加连接超时设置
                    readyTimeout: 30000,
                    keepaliveInterval: 10000
                };

                // 根据认证类型选择认证方式
                if (connectionDetails.authType === 'privateKey' && connectionDetails.privateKey) {
                    try {
                        connectOptions.privateKey = fs.readFileSync(connectionDetails.privateKey);
                        if (connectionDetails.passphrase) {
                            connectOptions.passphrase = connectionDetails.passphrase;
                        }
                    } catch (err) {
                        return reject(new Error(`读取密钥文件失败: ${err.message}`));
                    }
                } else if (connectionDetails.password) {
                    connectOptions.password = connectionDetails.password;
                } else {
                    return reject(new Error('需要提供密码或私钥'));
                }

                // 连接
                conn.connect(connectOptions);
            } catch (error) {
                console.error('初始化SSH连接失败:', error);
                reject(error);
            }
        });
    }

    async disconnect(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        // 获取连接键并查找共享连接
        const connectionKey = session.connectionKey;
        const sharedConnection = this.sharedConnections.get(connectionKey);

        // 标记会话为非活跃，但不删除会话和映射
        if (session) {
            session.active = false;
            this.sessions.set(sessionId, session);
            console.log(`会话 ${sessionId} 已断开，标记为非活跃`);
        }

        // 如果存在共享连接，减少引用计数
        if (sharedConnection) {
            sharedConnection.refCount--;

            // 只有当引用计数为0时才真正关闭连接
            if (sharedConnection.refCount <= 0) {
                session.conn.end();
                this.sharedConnections.delete(connectionKey);
                console.log(`关闭共享连接: ${connectionKey}`);
            } else {
                console.log(`保持共享连接: ${connectionKey}, 剩余引用: ${sharedConnection.refCount}`);
            }
        } else {
            // 如果没有共享连接记录，直接关闭
            session.conn.end();
        }

        return true;
    }

    async sendData(sessionId, data) {
        console.log(`[sendData] 向会话 ${sessionId} 发送数据`);
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[sendData] 会话 ${sessionId} 未找到`);
            // 尝试查找是否有相关的连接ID
            for (const [connId, sessId] of this.connectionToSession.entries()) {
                if (sessId === sessionId) {
                    console.log(`[sendData] 尝试通过连接ID ${connId} 重新激活会话`);
                    try {
                        const result = await this.activateSession(sessionId);
                        if (result.success) {
                            return this.sendData(result.sessionId, data);
                        }
                    } catch (err) {
                        console.error(`[sendData] 尝试重新激活会话失败:`, err);
                    }
                    break;
                }
            }
            return {success: false, error: '会话未找到'};
        }

        if (!session.stream) {
            console.error(`[sendData] 会话 ${sessionId} 的shell未启动`);
            try {
                // 尝试重新激活会话
                const result = await this.activateSession(sessionId);
                if (result.success) {
                    return this.sendData(result.sessionId, data);
                }
                return {success: false, error: 'shell未启动且无法重新激活会话'};
            } catch (err) {
                console.error(`[sendData] 尝试重新激活会话失败:`, err);
                return {success: false, error: '重新激活会话失败: ' + err.message};
            }
        }

        if (!session.active) {
            console.warn(`[sendData] 会话 ${sessionId} 不活跃，但仍然尝试发送数据`);
        }

        // 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');

        try {
            session.stream.write(dataStr);
            return {success: true};
        } catch (err) {
            console.error(`[sendData] 向会话 ${sessionId} 发送数据失败:`, err);
            return {success: false, error: '发送数据失败: ' + err.message};
        }
    }

    // 新增方法：激活会话
    async activateSession(sessionId) {
        console.log(`[activateSession] 开始激活会话 ${sessionId}`);
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[activateSession] 会话 ${sessionId} 未找到`);
            throw new Error('会话未找到');
        }

        // 标记会话为活跃
        session.active = true;
        this.sessions.set(sessionId, session);
        console.log(`[activateSession] 会话 ${sessionId} 已标记为活跃`);

        // 如果存在stream，刷新命令提示符
        if (session.stream) {
            return {success: true, sessionId};
        } else {
            console.warn(`[activateSession] 会话 ${sessionId} 没有可用的stream，需要重新建立连接`);

            // 如果没有可用的stream，尝试重新建立连接
            try {
                if (!session.details) {
                    console.error(`[activateSession] 会话 ${sessionId} 没有连接详情，无法重新连接`);
                    return {success: false};
                }

                // 使用原有的连接详情重新连接
                console.log(`[activateSession] 尝试为会话 ${sessionId} 重新建立连接`);
                const result = await this.connect(session.details);

                // 连接成功后，删除旧会话，保留新会话的映射关系
                if (result && result.sessionId) {
                    const newSessionId = result.sessionId;
                    console.log(`[activateSession] 重新连接成功，新会话ID: ${newSessionId}`);

                    // 如果存在连接ID，更新映射关系
                    if (session.connectionId) {
                        this.connectionToSession.set(session.connectionId, newSessionId);
                    }

                    // 在删除旧会话之前，确保所有引用都已更新
                    // 复制旧会话的所有属性到新会话
                    const oldSession = this.sessions.get(sessionId);
                    const newSession = this.sessions.get(newSessionId);
                    if (oldSession && newSession) {
                        // 保留新会话的conn和stream，但复制其他属性
                        const conn = newSession.conn;
                        const stream = newSession.stream;
                        Object.assign(newSession, oldSession);
                        newSession.conn = conn;
                        newSession.stream = stream;
                        newSession.active = true;
                        this.sessions.set(newSessionId, newSession);
                    }

                    // 删除旧会话
                    this.sessions.delete(sessionId);

                    return {success: true, sessionId: newSessionId};
                }
                return {success: false};
            } catch (error) {
                console.error(`[activateSession] 重新连接失败:`, error);
                return {success: false};
            }
        }
    }

    // 修改refreshPrompt方法，增加实际发送命令的功能

    async refreshPrompt(sessionId) {
        console.log(`[refreshPrompt] 开始刷新会话 ${sessionId} 的命令提示符`);
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[refreshPrompt] 会话 ${sessionId} 未找到`);
            // 检查是否有连接ID可以用来重新激活会话
            for (const [connId, sessId] of this.connectionToSession.entries()) {
                if (sessId === sessionId) {
                    console.log(`[refreshPrompt] 尝试通过连接ID ${connId} 重新激活会话`);
                    try {
                        // 查找连接详情
                        for (const [sid, sess] of this.sessions.entries()) {
                            if (sess.connectionId === connId) {
                                console.log(`[refreshPrompt] 找到相关会话 ${sid}，尝试使用其连接详情`);
                                if (sess.details) {
                                    const result = await this.activateSession(sid);
                                    if (result.success) {
                                        return this.refreshPrompt(result.sessionId);
                                    }
                                }
                                break;
                            }
                        }
                    } catch (err) {
                        console.error(`[refreshPrompt] 尝试重新激活会话失败:`, err);
                    }
                    break;
                }
            }
            return {success: false, error: '会话未找到'};
        }

        if (!session.stream) {
            console.error(`[refreshPrompt] 会话 ${sessionId} 的shell未启动`);
            try {
                // 尝试重新激活会话
                const result = await this.activateSession(sessionId);
                if (result.success) {
                    return this.refreshPrompt(result.sessionId);
                }
                return {success: false, error: 'shell未启动且无法重新激活会话'};
            } catch (err) {
                console.error(`[refreshPrompt] 尝试重新激活会话失败:`, err);
                return {success: false, error: '重新激活会话失败: ' + err.message};
            }
        }

        try {
            // 发送一个正确格式的clear命令，确保包含回车符
            session.stream.write('clear\r');

            console.log(`[refreshPrompt] 已发送clear命令到会话 ${sessionId}`);
            return {success: true};
        } catch (err) {
            console.error(`[refreshPrompt] 发送clear命令失败:`, err);
            return {success: false, error: '发送clear命令失败: ' + err.message};
        }
    }

    // 新增方法：调整终端大小
    async resize(sessionId, cols, rows) {
        console.log(`[resize] 调整会话 ${sessionId} 的终端大小为 ${cols}x${rows}`);
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[resize] 会话 ${sessionId} 未找到`);
            return {success: false, error: '会话未找到'};
        }

        if (!session.stream) {
            console.error(`[resize] 会话 ${sessionId} 的shell未启动`);
            try {
                // 尝试重新激活会话
                const result = await this.activateSession(sessionId);
                if (result.success) {
                    return this.resize(result.sessionId, cols, rows);
                }
                return {success: false, error: 'shell未启动且无法重新激活会话'};
            } catch (err) {
                console.error(`[resize] 尝试重新激活会话失败:`, err);
                return {success: false, error: '重新激活会话失败: ' + err.message};
            }
        }

        try {
            session.stream.setWindow(rows, cols, 0, 0);
            return {success: true};
        } catch (err) {
            console.error(`[resize] 调整终端大小失败:`, err);
            return {success: false, error: '调整终端大小失败: ' + err.message};
        }
    }

    async executeCommand(sessionId, command) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        return new Promise((resolve, reject) => {
            session.conn.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let data = '';
                stream.on('data', (chunk) => {
                    data += chunk.toString('utf8');
                });

                stream.stderr.on('data', (chunk) => {
                    data += chunk.toString('utf8');
                });

                stream.on('close', () => {
                    resolve(data);
                });
            });
        });
    }

    async listFiles(sessionId, remotePath) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        return new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.readdir(remotePath, (err, list) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(list.map(item => ({
                        name: item.filename,
                        fullPath: `${remotePath}/${item.filename}`,
                        isDirectory: item.attrs.isDirectory(),
                        size: item.attrs.size,
                        modifyTime: new Date(item.attrs.mtime * 1000),
                        permissions: item.attrs.mode
                    })));
                });
            });
        });
    }

    async uploadFile(sessionId, localPath, remotePath) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        return new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.fastPut(localPath, remotePath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    async downloadFile(remotePath, localFilePath) {
        if (!currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // Get current local directory path
            const localPathInput = document.getElementById('local-path');
            if (!localPathInput || !localPathInput.value) {
                alert('请先选择本地目录');
                return;
            }

            // Create local file path using the filename from remote path
            const fileName = path.basename(remotePath);
            localFilePath = path.join(localPathInput.value, fileName);

            // Show transfer status bar
            showTransferStatus(true);

            // Set progress bar
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在下载: ${fileName}`;

            const result = await window.api.file.download(currentSessionId, remotePath, localFilePath);

            // Update progress regardless of result
            progressBar.style.width = '100%';

            if (result.success) {
                transferInfo.textContent = '下载完成';

                // Refresh local file list
                await loadLocalFiles(localPathInput.value);
            } else {
                transferInfo.textContent = `下载失败: ${result.error || '未知错误'}`;
                alert(`下载失败: ${result.error || '未知错误'}`);
            }

            // Always hide progress bar after a delay
            setTimeout(() => {
                progressBar.style.width = '0%';
                showTransferStatus(false);
            }, 3000);
        } catch (error) {
            console.error('下载文件失败:', error);
            alert(`下载文件失败: ${error.message}`);
            showTransferStatus(false);
        }
    }

    async createDirectory(sessionId, remotePath) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        return new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.mkdir(remotePath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    async uploadDirectory(sessionId, localPath, remotePath) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        const fs = require('fs');
        const path = require('path');

        // Get SFTP instance once for the entire operation
        const sftp = await new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) reject(err);
                else resolve(sftp);
            });
        });

        // Create remote directory
        try {
            await new Promise((resolve, reject) => {
                sftp.mkdir(remotePath, err => {
                    // Ignore if directory already exists (code 4)
                    if (err && err.code !== 4) {
                        console.warn(`Warning creating dir ${remotePath}:`, err);
                    }
                    resolve(); // Continue anyway
                });
            });
        } catch (error) {
            console.warn(`Warning creating base dir:`, error);
            // Continue regardless of error - directory may exist
        }

        // Process files and directories
        const processItem = async (localItemPath, remoteItemPath) => {
            const stats = fs.statSync(localItemPath);

            if (stats.isDirectory()) {
                // Create directory on remote
                try {
                    await new Promise((resolve, reject) => {
                        sftp.mkdir(remoteItemPath, err => {
                            // Ignore if directory already exists
                            if (err && err.code !== 4) {
                                console.warn(`Warning creating dir ${remoteItemPath}:`, err);
                            }
                            resolve(); // Continue anyway
                        });
                    });
                } catch (error) {
                    console.warn(`Warning creating dir:`, error);
                    // Continue regardless of error
                }

                // Process all items in directory
                const items = fs.readdirSync(localItemPath);
                for (const item of items) {
                    await processItem(
                        path.join(localItemPath, item),
                        `${remoteItemPath}/${item}`
                    );
                }
            } else {
                // Upload file
                await new Promise((resolve, reject) => {
                    sftp.fastPut(localItemPath, remoteItemPath, err => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
        };

        // Start recursive upload operation
        await processItem(localPath, remotePath);
        return true;
    }

    async downloadDirectory(remoteDirPath) {
        if (!currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // Get current local directory path from the UI
            const localPathInput = document.getElementById('local-path');
            if (!localPathInput || !localPathInput.value) {
                alert('请先选择本地目录');
                return;
            }

            // Get directory name from remote path
            const dirName = path.basename(remoteDirPath);
            // Join with the current local directory
            const localDirPath = path.join(localPathInput.value, dirName);

            // Show transfer status bar
            showTransferStatus(true);

            // Set progress bar
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在下载文件夹: ${dirName}`;

            const downloadResult = await window.api.file.downloadDirectory(currentSessionId, remoteDirPath, localDirPath);

            // Update progress regardless of result
            progressBar.style.width = '100%';

            if (downloadResult.success) {
                transferInfo.textContent = '文件夹下载完成';

                // Refresh local file list
                await loadLocalFiles(localPathInput.value);
            } else {
                transferInfo.textContent = `下载失败: ${downloadResult.error || '未知错误'}`;
                alert(`下载文件夹失败: ${downloadResult.error || '未知错误'}`);
            }

            // Always hide progress bar after a delay
            setTimeout(() => {
                progressBar.style.width = '0%';
                showTransferStatus(false);
            }, 3000);

        } catch (error) {
            console.error('下载文件夹失败:', error);
            alert(`下载文件夹失败: ${error.message}`);
            showTransferStatus(false);
        }
    }
}


module.exports = new SshService();
