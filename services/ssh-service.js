const { Client } = require('ssh2');
const { EventEmitter } = require('events');
const fs = require('fs');

class SshService extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  async connect(connectionDetails) {
    return new Promise((resolve, reject) => {
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
            this.emit('data', sessionId, data.toString());
          });
          
          stream.stderr.on('data', (data) => {
            this.emit('data', sessionId, data.toString());
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
          
          resolve({ sessionId });
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      // 连接配置
      const connectOptions = {
        host: connectionDetails.host,
        port: connectionDetails.port || 22,
        username: connectionDetails.username
      };

      if (connectionDetails.privateKey) {
        connectOptions.privateKey = fs.readFileSync(connectionDetails.privateKey);
        if (connectionDetails.passphrase) {
          connectOptions.passphrase = connectionDetails.passphrase;
        }
      } else if (connectionDetails.password) {
        connectOptions.password = connectionDetails.password;
      }

      conn.connect(connectOptions);
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
    
    session.stream.write(data);
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
          data += chunk.toString();
        });

        stream.stderr.on('data', (chunk) => {
          data += chunk.toString();
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