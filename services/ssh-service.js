const {Client} = require('ssh2');
const {EventEmitter} = require('events');
const fs = require('fs');

class SshService extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
    }

    async connect(connectionDetails) {
        return new Promise((resolve, reject) => {
            try {
                if (!connectionDetails || !connectionDetails.host || !connectionDetails.username) {
                    return reject(new Error('缺少必要的连接参数'));
                }

                const conn = new Client();

                conn.on('ready', () => {
                    const sessionId = Date.now().toString();

                    // 创建shell会话
                    conn.shell((err, stream) => {
                        if (err) {
                            conn.end();
                            reject(err);
                            return;
                        }

                        // 设置数据处理
                        stream.on('data', (data) => {
                            // 将Buffer转为字符串，避免数据类型问题
                            const dataStr = data.toString('utf8');
                            this.emit('data', sessionId, dataStr);
                        });

                        stream.stderr.on('data', (data) => {
                            const dataStr = data.toString('utf8');
                            this.emit('data', sessionId, dataStr);
                        });

                        stream.on('close', () => {
                            this.emit('close', sessionId);
                            this.sessions.delete(sessionId);
                        });

                        // 存储会话
                        this.sessions.set(sessionId, {
                            conn,
                            stream,
                            details: connectionDetails
                        });

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
                    term: 'xterm-256color',
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

        session.conn.end();
        this.sessions.delete(sessionId);
        return true;
    }

    async sendData(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.stream) {
            throw new Error('会话未找到或shell未启动');
        }

        // 确保data是字符串格式
        const dataStr = typeof data === 'string' ? data : data.toString('utf8');
        session.stream.write(dataStr);
        return true;
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

    async downloadFile(sessionId, remotePath, localPath) {
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
}

module.exports = new SshService();
