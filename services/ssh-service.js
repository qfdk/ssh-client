const {Client} = require('ssh2');
const {EventEmitter} = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * SSH服务类 - 使用单例模式管理SSH连接
 */
class SshService extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map(); // 存储会话信息
        this.connectionPool = new Map(); // 存储连接池
        this.connectionToSession = new Map(); // 存储连接ID到会话ID的映射
        
        // 设置定期清理过期连接
        setInterval(() => this.cleanExpiredConnections(), 60000); // 每分钟清理一次
    }

    /**
     * 清理过期的连接
     * @private
     */
    cleanExpiredConnections() {
        const now = Date.now();
        const expireTime = 10 * 60 * 1000; // 10分钟过期时间

        for (const [key, conn] of this.connectionPool.entries()) {
            if (now - conn.lastUsed > expireTime && conn.refCount <= 0) {
                console.log(`清理过期连接: ${key}`);
                if (conn.client && conn.client.end) {
                    conn.client.end();
                }
                this.connectionPool.delete(key);
            }
        }
    }

    /**
     * 根据连接ID获取会话信息
     * @param {string} connectionId - 连接ID
     * @returns {Object|null} - 会话信息
     */
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

    /**
     * 根据连接详情获取或创建连接
     * @param {Object} connectionDetails - 连接详情
     * @returns {Promise<Object>} - 连接对象和相关信息
     */
    async getOrCreateConnection(connectionDetails) {
        const connectionKey = `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port || 22}`;
        
        // 检查连接池中是否已存在此连接
        if (this.connectionPool.has(connectionKey)) {
            const conn = this.connectionPool.get(connectionKey);
            // 检查连接是否仍然活跃
            if (conn.isConnected) {
                console.log(`复用现有连接: ${connectionKey}`);
                conn.lastUsed = Date.now(); // 更新最后使用时间
                return { conn: conn.client, isNew: false, connectionKey };
            }
        }
        
        // 创建新连接
        const client = new Client();
        const conn = {
            client,
            isConnected: false,
            refCount: 0,
            lastUsed: Date.now()
        };
        
        // 创建连接配置
        const connectOptions = this.createConnectOptions(connectionDetails);
        
        // 返回连接前不等待连接成功，将在后续connect中等待
        return { conn: client, connectionObj: conn, isNew: true, connectionKey, connectOptions };
    }

    /**
     * 创建连接配置
     * @param {Object} connectionDetails - 连接详情
     * @returns {Object} - 连接配置
     * @private
     */
    createConnectOptions(connectionDetails) {
        // 连接配置
        const connectOptions = {
            host: connectionDetails.host,
            port: connectionDetails.port || 22,
            username: connectionDetails.username,
            // 设置终端类型，以确保正确的shell环境
            term: 'xterm-color',
            // 添加连接超时设置
            readyTimeout: 30000,
            keepaliveInterval: 10000
        };

        // 检测本地网络连接并应用特殊设置
        if (/^(192\.168\.|10\.|172\.16\.)/.test(connectionDetails.host)) {
            console.log('本地网络连接，添加特殊连接选项');
            connectOptions.forceIPv4 = true;
            connectOptions.localHostname = '0.0.0.0';
            connectOptions.hostVerifier = () => true;
            connectOptions.readyTimeout = 60000; // 增加超时时间到60秒

            // 设置本地IP绑定
            try {
                const interfaces = require('os').networkInterfaces();
                const localIPs = Object.values(interfaces)
                    .flat()
                    .filter(iface => !iface.internal && iface.family === 'IPv4')
                    .map(iface => iface.address);

                if (localIPs.length > 0) {
                    console.log(`可用的本地IP: ${localIPs.join(', ')}`);
                    // 默认使用第一个非内部IPv4地址
                    connectOptions.localAddress = localIPs[0];
                    console.log(`使用本地地址: ${connectOptions.localAddress}`);
                }
            } catch (err) {
                console.warn('获取本地IP地址失败:', err);
            }
        }

        // 根据认证类型选择认证方式
        if (connectionDetails.authType === 'privateKey' && connectionDetails.privateKey) {
            try {
                connectOptions.privateKey = fs.readFileSync(connectionDetails.privateKey);
                if (connectionDetails.passphrase) {
                    connectOptions.passphrase = connectionDetails.passphrase;
                }
            } catch (err) {
                throw new Error(`读取密钥文件失败: ${err.message}`);
            }
        } else if (connectionDetails.password) {
            connectOptions.password = connectionDetails.password;
        } else {
            throw new Error('需要提供密码或私钥');
        }

        return connectOptions;
    }

    /**
     * 建立连接并初始化事件监听
     * @param {Object} conn - SSH连接客户端
     * @param {Object} connectionObj - 连接对象
     * @param {Object} connectOptions - 连接配置
     * @param {string} connectionKey - 连接唯一标识
     * @returns {Promise<void>}
     * @private
     */
    setupConnection(conn, connectionObj, connectOptions, connectionKey) {
        return new Promise((resolve, reject) => {
            // 设置事件监听
            conn.on('ready', () => {
                // 连接成功，加入连接池
                connectionObj.isConnected = true;
                connectionObj.refCount++;
                this.connectionPool.set(connectionKey, connectionObj);
                console.log(`连接成功: ${connectionKey}, 当前引用计数: ${connectionObj.refCount}`);
                resolve();
            });
            
            conn.on('error', (err) => {
                // 连接失败处理
                console.error(`连接错误: ${connectionKey}`, err);
                connectionObj.isConnected = false;
                // 移除失败的连接
                if (this.connectionPool.get(connectionKey) === connectionObj) {
                    this.connectionPool.delete(connectionKey);
                }
                reject(err);
            });
            
            conn.on('end', () => {
                // 连接结束处理
                console.log(`连接结束: ${connectionKey}`);
                connectionObj.isConnected = false;
                connectionObj.refCount = 0;
                // 移除已结束的连接
                if (this.connectionPool.get(connectionKey) === connectionObj) {
                    this.connectionPool.delete(connectionKey);
                }
            });
            
            conn.on('close', () => {
                // 连接关闭处理
                console.log(`连接关闭: ${connectionKey}`);
                connectionObj.isConnected = false;
                connectionObj.refCount = 0;
                // 移除已关闭的连接
                if (this.connectionPool.get(connectionKey) === connectionObj) {
                    this.connectionPool.delete(connectionKey);
                }
            });
            
            // 连接
            conn.connect(connectOptions);
        });
    }

    /**
     * 创建shell会话
     * @param {string} sessionId - 会话ID
     * @param {Object} conn - SSH连接客户端
     * @returns {Promise<Object>} - shell流
     * @private
     */
    createShellSession(sessionId, conn) {
        return new Promise((resolve, reject) => {
            console.log(`创建shell会话: ${sessionId}`);
            conn.shell({term: 'xterm-color', rows: 24, cols: 80}, (err, stream) => {
                if (err) {
                    console.error(`创建shell失败: ${sessionId}`, err);
                    reject(err);
                    return;
                }

                // 设置数据处理
                this.setupStreamHandlers(sessionId, stream);
                resolve(stream);
            });
        });
    }

    /**
     * 设置流事件处理
     * @param {string} sessionId - 会话ID
     * @param {Object} stream - shell流
     * @private
     */
    setupStreamHandlers(sessionId, stream) {
        // 处理数据事件
        stream.on('data', (data) => {
            const dataStr = data.toString('utf8');
            const session = this.sessions.get(sessionId);
            if (session) {
                // 追加到缓冲区
                session.buffer = (session.buffer || '') + dataStr;
                this.sessions.set(sessionId, session);

                // 只有活跃会话才发送数据
                if (session.active) {
                    this.emit('data', sessionId, dataStr);
                }
            }
        });

        // 处理stderr数据
        stream.stderr.on('data', (data) => {
            const dataStr = data.toString('utf8');
            const session = this.sessions.get(sessionId);
            if (session) {
                session.buffer = (session.buffer || '') + dataStr;
                this.sessions.set(sessionId, session);

                if (session.active) {
                    this.emit('data', sessionId, dataStr);
                }
            }
        });

        // 处理流关闭事件
        stream.on('close', () => {
            console.log(`Stream关闭: ${sessionId}`);
            this.handleStreamClose(sessionId);
        });
    }

    /**
     * 处理流关闭事件
     * @param {string} sessionId - 会话ID
     * @private
     */
    handleStreamClose(sessionId) {
        this.emit('close', sessionId);

        const session = this.sessions.get(sessionId);
        if (!session) return;

        // 标记会话为非活跃
        session.active = false;
        session.stream = null;
        this.sessions.set(sessionId, session);
        
        // 更新连接池引用计数
        const connectionKey = session.connectionKey;
        const connectionObj = this.connectionPool.get(connectionKey);
        if (connectionObj) {
            connectionObj.refCount--;
            if (connectionObj.refCount <= 0) {
                console.log(`引用计数归零，准备清理连接: ${connectionKey}`);
                // 不立即清理，允许复用
                connectionObj.lastUsed = Date.now();
            }
        }

        console.log(`会话 ${sessionId} 已关闭，标记为非活跃`);
    }

    /**
     * 建立SSH连接
     * @param {Object} connectionDetails - 连接详情
     * @returns {Promise<Object>} - 会话信息
     */
    async connect(connectionDetails) {
        try {
            if (!connectionDetails || !connectionDetails.host || !connectionDetails.username) {
                throw new Error('缺少必要的连接参数');
            }

            // 检查是否有可复用的会话
            if (connectionDetails.id) {
                const existingSessionInfo = this.getSessionByConnectionId(connectionDetails.id);
                if (existingSessionInfo && existingSessionInfo.session) {
                    const { sessionId, session } = existingSessionInfo;
                    console.log(`复用现有会话: ${sessionId}, 连接ID: ${connectionDetails.id}`);
                    
                    // 标记会话为活跃
                    session.active = true;
                    this.sessions.set(sessionId, session);
                    
                    // 更新连接最后使用时间
                    const connectionKey = session.connectionKey;
                    const connectionObj = this.connectionPool.get(connectionKey);
                    if (connectionObj) {
                        connectionObj.lastUsed = Date.now();
                    }
                    
                    // 如果会话有流但没有连接，尝试重新创建
                    if (!session.stream) {
                        try {
                            const result = await this.activateSession(sessionId);
                            return result.success ? { sessionId: result.sessionId } : { sessionId };
                        } catch (err) {
                            console.warn(`重新激活会话 ${sessionId} 失败，继续使用现有会话`);
                        }
                    }
                    
                    return { sessionId };
                }
            }

            // 创建会话ID
            const sessionId = Date.now().toString();

            // 获取或创建连接
            const { conn, connectionObj, isNew, connectionKey, connectOptions } = 
                await this.getOrCreateConnection(connectionDetails);
            
            // 创建会话对象
            this.sessions.set(sessionId, {
                conn,
                stream: null,
                details: connectionDetails,
                connectionKey,
                connectionId: connectionDetails.id,
                active: true,
                buffer: ''
            });
            
            // 保存连接ID到会话ID的映射
            if (connectionDetails.id) {
                this.connectionToSession.set(connectionDetails.id, sessionId);
            }
            
            // 如果是新连接，需要连接
            if (isNew) {
                await this.setupConnection(conn, connectionObj, connectOptions, connectionKey);
                // 加入连接池
                this.connectionPool.set(connectionKey, connectionObj);
            } else {
                // 增加引用计数
                connectionObj.refCount++;
                // 更新最后使用时间
                connectionObj.lastUsed = Date.now();
            }
            
            // 创建shell会话
            const stream = await this.createShellSession(sessionId, conn);
            
            // 更新会话，设置stream
            const session = this.sessions.get(sessionId);
            if (session) {
                session.stream = stream;
                this.sessions.set(sessionId, session);
            }
            
            return { sessionId };
        } catch (error) {
            console.error('SSH连接失败:', error);
            throw error;
        }
    }

    /**
     * 断开SSH连接
     * @param {string} sessionId - 会话ID
     * @returns {Promise<boolean>} - 断开结果
     */
    async disconnect(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('会话未找到');
        }

        // 标记会话为非活跃
        session.active = false;
        this.sessions.set(sessionId, session);
        
        // 更新连接池引用计数
        const connectionKey = session.connectionKey;
        const connectionObj = this.connectionPool.get(connectionKey);
        
        if (connectionObj) {
            connectionObj.refCount--;
            connectionObj.lastUsed = Date.now();
            
            console.log(`断开会话 ${sessionId}, 连接 ${connectionKey} 引用计数: ${connectionObj.refCount}`);
            
            // 如果引用计数为0，但不立即关闭连接，允许后续复用
            if (connectionObj.refCount <= 0) {
                console.log(`连接 ${connectionKey} 引用计数为0，但保留连接以便复用`);
            }
        } else {
            // 如果连接对象已不存在，但会话仍然保留连接对象，关闭它
            if (session.conn && session.conn.end) {
                session.conn.end();
            }
        }
        
        return true;
    }

    /**
     * 确保会话处于活跃状态
     * @param {string} sessionId - 会话ID
     * @param {string} operationName - 操作名称
     * @returns {Promise<Object>} - 会话状态
     */
    async ensureActiveSession(sessionId, operationName = '操作') {
        console.log(`[${operationName}] 检查会话 ${sessionId} 状态`);
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            console.error(`[${operationName}] 会话 ${sessionId} 未找到`);
            // 尝试通过连接ID查找
            for (const [connId, sessId] of this.connectionToSession.entries()) {
                if (sessId === sessionId) {
                    console.log(`[${operationName}] 尝试通过连接ID ${connId} 重新激活会话`);
                    try {
                        const result = await this.activateSession(sessionId);
                        if (result.success) {
                            return { 
                                success: true, 
                                session: this.sessions.get(result.sessionId), 
                                sessionId: result.sessionId 
                            };
                        }
                    } catch (err) {
                        console.error(`[${operationName}] 尝试重新激活会话失败:`, err);
                    }
                    break;
                }
            }
            return { success: false, error: '会话未找到' };
        }

        if (!session.stream) {
            console.error(`[${operationName}] 会话 ${sessionId} 的shell未启动`);
            try {
                // 尝试重新激活会话
                const result = await this.activateSession(sessionId);
                if (result.success) {
                    return { 
                        success: true, 
                        session: this.sessions.get(result.sessionId), 
                        sessionId: result.sessionId 
                    };
                }
                return { success: false, error: 'shell未启动且无法重新激活会话' };
            } catch (err) {
                console.error(`[${operationName}] 尝试重新激活会话失败:`, err);
                return { success: false, error: '重新激活会话失败: ' + err.message };
            }
        }

        if (!session.active) {
            console.warn(`[${operationName}] 会话 ${sessionId} 不活跃，重新激活`);
            session.active = true;
            this.sessions.set(sessionId, session);
        }

        return { success: true, session, sessionId };
    }

    /**
     * 向会话发送数据
     * @param {string} sessionId - 会话ID
     * @param {string} data - 发送的数据
     * @returns {Promise<Object>} - 发送结果
     */
    async sendData(sessionId, data) {
        console.log(`[sendData] 向会话 ${sessionId} 发送数据`);
        
        const sessionResult = await this.ensureActiveSession(sessionId, 'sendData');
        if (!sessionResult.success) {
            return { success: false, error: sessionResult.error };
        }
        
        const session = sessionResult.session;

        // 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');

        try {
            session.stream.write(dataStr);
            return { success: true };
        } catch (err) {
            console.error(`[sendData] 向会话 ${sessionId} 发送数据失败:`, err);
            return { success: false, error: '发送数据失败: ' + err.message };
        }
    }

    /**
     * 激活会话
     * @param {string} sessionId - 会话ID
     * @returns {Promise<Object>} - 激活结果
     */
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

        // 如果存在流，直接返回成功
        if (session.stream) {
            return {success: true, sessionId};
        } 
        
        console.warn(`[activateSession] 会话 ${sessionId} 没有可用的stream，尝试重新建立连接`);

        // 如果没有连接详情，无法重连
        if (!session.details) {
            console.error(`[activateSession] 会话 ${sessionId} 没有连接详情，无法重新连接`);
            return {success: false, error: '无法重新连接：缺少连接详情'};
        }

        try {
            // 使用原有的连接详情重新连接
            console.log(`[activateSession] 尝试为会话 ${sessionId} 重新建立连接`);
            const result = await this.connect(session.details);

            // 连接成功后，迁移会话数据
            if (result && result.sessionId) {
                const newSessionId = result.sessionId;
                console.log(`[activateSession] 重新连接成功，新会话ID: ${newSessionId}`);

                // 如果存在连接ID，更新映射关系
                if (session.connectionId) {
                    this.connectionToSession.set(session.connectionId, newSessionId);
                }

                // 复制旧会话的属性到新会话
                const oldSession = this.sessions.get(sessionId);
                const newSession = this.sessions.get(newSessionId);
                if (oldSession && newSession) {
                    // 保留新会话的conn和stream，复制其他属性
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
            return {success: false, error: '重新连接失败'};
        } catch (error) {
            console.error(`[activateSession] 重新连接失败:`, error);
            return {success: false, error: error.message};
        }
    }

    /**
     * 刷新命令提示符
     * @param {string} sessionId - 会话ID
     * @returns {Promise<Object>} - 操作结果
     */
    async refreshPrompt(sessionId) {
        console.log(`[refreshPrompt] 开始刷新会话 ${sessionId} 的命令提示符`);
        
        const sessionResult = await this.ensureActiveSession(sessionId, 'refreshPrompt');
        if (!sessionResult.success) {
            return { success: false, error: sessionResult.error };
        }
        
        const session = sessionResult.session;

        try {
            // 发送一个无输出的echo命令来刷新提示符
            session.stream.write('echo -n ""\r');
            console.log(`[refreshPrompt] 已发送刷新命令到会话 ${sessionId}`);
            return { success: true };
        } catch (err) {
            console.error(`[refreshPrompt] 发送命令失败:`, err);
            return { success: false, error: '发送命令失败: ' + err.message };
        }
    }

    /**
     * 调整终端大小
     * @param {string} sessionId - 会话ID
     * @param {number} cols - 列数
     * @param {number} rows - 行数
     * @returns {Promise<Object>} - 操作结果
     */
    async resize(sessionId, cols, rows) {
        console.log(`[resize] 调整会话 ${sessionId} 的终端大小为 ${cols}x${rows}`);
        
        const sessionResult = await this.ensureActiveSession(sessionId, 'resize');
        if (!sessionResult.success) {
            return { success: false, error: sessionResult.error };
        }
        
        const session = sessionResult.session;

        try {
            session.stream.setWindow(rows, cols, 0, 0);
            return { success: true };
        } catch (err) {
            console.error(`[resize] 调整终端大小失败:`, err);
            return { success: false, error: '调整终端大小失败: ' + err.message };
        }
    }

    /**
     * 执行命令
     * @param {string} sessionId - 会话ID
     * @param {string} command - 命令
     * @returns {Promise<string>} - 执行结果
     */
    async executeCommand(sessionId, command) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'executeCommand');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

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

    /**
     * 列出远程文件
     * @param {string} sessionId - 会话ID
     * @param {string} remotePath - 远程路径
     * @returns {Promise<Array>} - 文件列表
     */
    async listFiles(sessionId, remotePath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'listFiles');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

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

    /**
     * 上传文件
     * @param {string} sessionId - 会话ID
     * @param {string} localPath - 本地路径
     * @param {string} remotePath - 远程路径
     * @returns {Promise<void>}
     */
    async uploadFile(sessionId, localPath, remotePath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'uploadFile');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

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

    /**
     * 创建远程目录
     * @param {string} sessionId - 会话ID
     * @param {string} remotePath - 远程路径
     * @returns {Promise<void>}
     */
    async createDirectory(sessionId, remotePath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'createDirectory');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

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

    /**
     * 上传目录
     * @param {string} sessionId - 会话ID
     * @param {string} localPath - 本地路径
     * @param {string} remotePath - 远程路径
     * @returns {Promise<boolean>}
     */
    async uploadDirectory(sessionId, localPath, remotePath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'uploadDirectory');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

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

    /**
     * 下载文件
     * @param {string} sessionId - 会话ID
     * @param {string} remotePath - 远程路径
     * @param {string} localPath - 本地路径
     * @returns {Promise<void>}
     */
    async downloadFile(sessionId, remotePath, localPath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'downloadFile');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

        return new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Create parent directory if it doesn't exist
                const parentDir = path.dirname(localPath);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, {recursive: true});
                }

                // Use fastGet to download the file
                sftp.fastGet(remotePath, localPath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    /**
     * 下载目录
     * @param {string} sessionId - 会话ID 
     * @param {string} remotePath - 远程路径
     * @param {string} localPath - 本地路径
     * @returns {Promise<boolean>}
     */
    async downloadDirectory(sessionId, remotePath, localPath) {
        const sessionResult = await this.ensureActiveSession(sessionId, 'downloadDirectory');
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        
        const session = sessionResult.session;

        // 创建本地目录
        if (!fs.existsSync(localPath)) {
            fs.mkdirSync(localPath, { recursive: true });
        }

        // 获取SFTP
        const sftp = await new Promise((resolve, reject) => {
            session.conn.sftp((err, sftp) => {
                if (err) reject(err);
                else resolve(sftp);
            });
        });

        // 读取远程目录
        const list = await new Promise((resolve, reject) => {
            sftp.readdir(remotePath, (err, list) => {
                if (err) reject(err);
                else resolve(list);
            });
        });

        // 处理目录内容
        for (const item of list) {
            const remoteItemPath = `${remotePath}/${item.filename}`;
            const localItemPath = path.join(localPath, item.filename);

            if (item.attrs.isDirectory()) {
                // 如果是目录，递归下载
                await this.downloadDirectory(sessionId, remoteItemPath, localItemPath);
            } else {
                // 如果是文件，下载文件
                await new Promise((resolve, reject) => {
                    sftp.fastGet(remoteItemPath, localItemPath, (err) => {
                        if (err) reject(err);
                        else {
                            this.emit('download-progress', {
                                sessionId,
                                file: item.filename,
                                current: item.attrs.size,
                                total: item.attrs.size,
                                percent: 100
                            });
                            resolve();
                        }
                    });
                });
            }
        }

        return true;
    }

    /**
     * 获取会话缓冲区
     * @param {string} sessionId - 会话ID
     * @returns {Promise<Object>} - 缓冲区内容
     */
    async getSessionBuffer(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return {success: false, error: '会话未找到'};
        }

        return {
            success: true,
            buffer: session.buffer || ''
        };
    }
}

// 导出单例
module.exports = new SshService();
