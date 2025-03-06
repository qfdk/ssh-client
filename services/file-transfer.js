const fs = require('fs');
const path = require('path');

class FileTransferService {
  constructor(sshService) {
    this.sshService = sshService;
    this.transfers = new Map();
  }

  async uploadFile(params) {
    const { connectionId, localPath, remotePath } = params;
    const connection = this.sshService.getConnection(connectionId);
    
    if (!connection) {
      return { success: false, error: '连接不存在' };
    }
    
    const transferId = Date.now().toString();
    
    try {
      const sftp = await this.getSftpSession(connection);
      
      const readStream = fs.createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      
      this.transfers.set(transferId, {
        type: 'upload',
        status: 'in-progress',
        progress: 0,
        localPath,
        remotePath
      });
      
      // 处理上传进度
      const fileSize = fs.statSync(localPath).size;
      let uploaded = 0;
      
      readStream.on('data', (chunk) => {
        uploaded += chunk.length;
        const progress = Math.round((uploaded / fileSize) * 100);
        this.updateTransferProgress(transferId, progress);
      });
      
      // 完成上传
      writeStream.on('close', () => {
        this.transfers.set(transferId, {
          ...this.transfers.get(transferId),
          status: 'completed',
          progress: 100
        });
      });
      
      readStream.pipe(writeStream);
      
      return {
        success: true,
        transferId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async downloadFile(params) {
    // 类似uploadFile的实现
  }
  
  async getSftpSession(connection) {
    return new Promise((resolve, reject) => {
      connection.conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
        } else {
          resolve(sftp);
        }
      });
    });
  }
  
  updateTransferProgress(id, progress) {
    const transfer = this.transfers.get(id);
    if (transfer) {
      this.transfers.set(id, {
        ...transfer,
        progress
      });
    }
  }
  
  getTransfer(id) {
    return this.transfers.get(id);
  }
  
  getAllTransfers() {
    return Array.from(this.transfers.values());
  }
}

module.exports = FileTransferService;