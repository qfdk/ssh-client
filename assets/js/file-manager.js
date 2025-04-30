// file-manager.js
// 文件管理器相关功能

class FileManager {
    constructor() {
        this.remoteFileCache = new Map(); // 远程文件缓存
        this.localFileCache = new Map(); // 本地文件缓存
        this.lastLocalDirectory = null; // 记住上次的本地目录
        this.fileManagerInitialized = false; // 文件管理器是否已初始化
        
        // 简单的路径工具函数
        this.path = {
            basename: function (p) {
                return p.split('/').pop();
            },
            join: function (dir, file) {
                if (dir.endsWith('/')) {
                    return dir + file;
                } else {
                    return dir + '/' + file;
                }
            }
        };
    }
    
    // 初始化文件管理器
    async initFileManager(sessionId) {
        if (!sessionId) {
            console.error('无法初始化文件管理器：未连接到服务器');
            return;
        }

        // 清除现有远程文件列表
        const remoteFilesTbody = document.querySelector('#remote-files tbody');
        if (remoteFilesTbody) {
            remoteFilesTbody.innerHTML = '';
        }

        // 获取会话的远程工作目录或设置为根目录
        let remotePath = '/';

        // 尝试从会话管理器获取路径
        const session = window.sessionManager.getSession(sessionId);
        if (session && session.currentRemotePath) {
            remotePath = session.currentRemotePath;
        } else {
            // 在会话管理器中初始化远程路径
            window.sessionManager.updateRemotePath(sessionId, remotePath);
        }

        console.log(`初始化文件管理器，使用会话 ${sessionId} 的远程工作目录: ${remotePath}`);

        // 更新远程路径输入
        const remotePathInput = document.getElementById('remote-path');
        if (remotePathInput) {
            remotePathInput.value = remotePath;
        }

        // 加载远程文件
        await this.loadRemoteFiles(remotePath);

        // 清除现有本地文件列表
        const localFilesTbody = document.querySelector('#local-files tbody');
        if (localFilesTbody) {
            localFilesTbody.innerHTML = '';
        }

        // 加载本地文件
        if (this.lastLocalDirectory) {
            await this.loadLocalFiles(this.lastLocalDirectory);
        } else {
            // 默认为用户主目录
            try {
                const homeDir = await window.api.file.getHomeDir();
                await this.loadLocalFiles(homeDir);
            } catch (error) {
                console.error('获取用户主目录失败:', error);
            }
        }

        // 隐藏加载指示器
        window.uiManager.showFileManagerLoading(false);
    }
    
    // 加载远程文件
    async loadRemoteFiles(path) {
        if (!window.currentSessionId) {
            console.error('无法加载远程文件：未连接到服务器');
            window.uiManager.showFileManagerLoading(false);
            return;
        }

        try {
            // 规范化路径
            path = path.replace(/\/+/g, '/');
            if (!path.startsWith('/')) {
                path = '/' + path;
            }

            // 显示加载状态
            window.uiManager.showFileManagerLoading(true);

            // 更新路径输入
            const remotePathInput = document.getElementById('remote-path');
            if (remotePathInput) {
                remotePathInput.value = path;
            }

            // 更新会话的远程工作目录
            window.sessionManager.updateRemotePath(window.currentSessionId, path);

            // 记录请求
            console.log(`请求远程文件列表: 会话ID ${window.currentSessionId}, 路径 ${path}`);

            // 在读取文件前先验证会话是否有效
            const session = window.sessionManager.getSession(window.currentSessionId);
            if (!session || !session.active) {
                throw new Error('会话已失效，请重新连接');
            }

            // 发起请求
            const result = await window.api.file.list(window.currentSessionId, path);

            if (result.success) {
                // 更新缓存
                const cacheKey = `${window.currentSessionId}:${path}`;
                this.remoteFileCache.set(cacheKey, result.files);
                console.log('更新远程文件缓存:', cacheKey);

                // 显示文件
                this.displayRemoteFiles(result.files, path);
            } else {
                console.error('获取远程文件失败:', result.error);

                // 检查特定SFTP错误
                if (result.error && result.error.includes('Channel open failure')) {
                    // 这可能是SFTP子系统问题，显示一个更明确的错误
                    console.log('尝试使用SSH命令代替SFTP获取文件列表');

                    try {
                        // 尝试使用普通SSH命令列出文件（作为备用方案）
                        const lsResult = await window.api.ssh.execute(window.currentSessionId, `ls -la "${path}"`);
                        if (lsResult && lsResult.trim && lsResult.trim().length > 0) {
                            // 如果命令成功但我们只是不能使用SFTP
                            alert('SFTP访问失败，但SSH连接仍然有效。文件管理功能可能受限。');

                            // 简单地显示空目录，用户至少能看到提示
                            this.displayRemoteFiles([], path);
                        } else {
                            throw new Error('无法访问远程文件系统');
                        }
                    } catch (cmdError) {
                        console.error('执行SSH命令也失败:', cmdError);
                        alert(`无法访问SFTP，可能是此服务器未启用SFTP功能或您没有足够权限。`);
                    }
                }
                // 检查是否是连接错误
                else if (result.error && (result.error.includes('not connected') ||
                    result.error.includes('connection closed') ||
                    result.error.includes('会话未找到'))) {
                    alert(`连接已断开，请重新连接服务器`);

                    // 可能需要切换到终端模式
                    const terminalTab = document.querySelector('.tab[data-tab="terminal"]');
                    if (terminalTab) {
                        terminalTab.click();
                    }
                } else {
                    alert(`无法访问目录 ${path}: ${result.error}`);
                }

                // 如果是根目录错误，尝试重置到根目录
                if (path !== '/') {
                    console.log('尝试重置到根目录');
                    await this.loadRemoteFiles('/');
                }
            }
        } catch (error) {
            console.error('加载远程文件失败:', error);
            alert(`加载远程文件失败: ${error.message}`);

            // 如果是致命错误，切换到终端标签
            const terminalTab = document.querySelector('.tab[data-tab="terminal"]');
            if (terminalTab) {
                terminalTab.click();
            }
        } finally {
            // 隐藏加载状态
            window.uiManager.showFileManagerLoading(false);
        }
    }
    
    // 加载本地文件
    async loadLocalFiles(directory) {
        try {
            // 如果没有指定目录，则始终请求用户选择新的目录
            if (!directory) {
                const result = await window.api.dialog.selectDirectory();
                if (result.canceled) {
                    // 如果用户取消了选择，但之前有使用过的目录，继续使用上一次的目录
                    if (this.lastLocalDirectory) {
                        directory = this.lastLocalDirectory;
                    } else {
                        // 如果之前没有使用过目录，则退出函数
                        return;
                    }
                } else {
                    directory = result.directoryPath;
                }
            }

            // 记住这个目录供下次使用
            this.lastLocalDirectory = directory;

            // 更新路径输入框
            const localPathInput = document.getElementById('local-path');
            if (localPathInput) {
                localPathInput.value = directory;
            }

            // 使用真实文件列表API获取文件
            const result = await window.api.file.listLocal(directory);
            if (result && result.success) {
                // 更新缓存
                this.localFileCache.set(directory, result.files);
                console.log('更新本地文件缓存:', directory);

                this.displayLocalFiles(result.files, directory);
            } else {
                console.error('获取本地文件失败:', result ? result.error : '未知错误');

                // 使用模拟数据作为备用
                const dummyFiles = [];
                this.displayLocalFiles(dummyFiles, directory);
            }

        } catch (error) {
            console.error('加载本地文件失败:', error);
        }
    }
    
    // 显示本地文件
    displayLocalFiles(files, currentPath) {
        const tbody = document.querySelector('#local-files tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        files.forEach(file => {
            const row = document.createElement('tr');
            row.className = file.isDirectory ? 'directory' : 'file';

            // 文件名列
            const nameCell = document.createElement('td');
            const icon = file.isDirectory ?
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';

            nameCell.innerHTML = `<span class="file-icon">${icon}</span> ${file.name}`;
            row.appendChild(nameCell);

            // 大小列
            const sizeCell = document.createElement('td');
            sizeCell.textContent = file.isDirectory ? '-' : this.formatFileSize(file.size);
            row.appendChild(sizeCell);

            // 修改日期列
            const dateCell = document.createElement('td');
            dateCell.textContent = this.formatDate(file.modifyTime);
            row.appendChild(dateCell);

            // 添加行点击事件
            if (file.isDirectory) {
                row.addEventListener('dblclick', async () => {
                    const newPath = file.name === '..' ?
                        currentPath.substring(0, currentPath.lastIndexOf('/')) || currentPath.substring(0, currentPath.lastIndexOf('\\')) || '/' :
                        `${currentPath}/${file.name}`.replace(/\/\//g, '/');

                    await this.loadLocalFiles(newPath);
                });
            }

            tbody.appendChild(row);
        });
    }
    
    // 显示远程文件
    displayRemoteFiles(files, currentPath) {
        const tbody = document.querySelector('#remote-files tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        // 添加返回上级目录的条目
        if (currentPath !== '/') {
            const parentRow = document.createElement('tr');
            parentRow.className = 'directory';

            // 文件名列
            const nameCell = document.createElement('td');
            nameCell.innerHTML = '<span class="file-icon"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span> ..';
            parentRow.appendChild(nameCell);

            // 空列
            for (let i = 0; i < 3; i++) {
                const cell = document.createElement('td');
                cell.textContent = '-';
                parentRow.appendChild(cell);
            }

            parentRow.addEventListener('dblclick', async () => {
                const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                await this.loadRemoteFiles(parentPath);
            });

            tbody.appendChild(parentRow);
        }

        files.forEach(file => {
            const row = document.createElement('tr');
            row.className = file.isDirectory ? 'directory' : 'file';

            // 文件名列
            const nameCell = document.createElement('td');
            const icon = file.isDirectory ?
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';

            nameCell.innerHTML = `<span class="file-icon">${icon}</span> ${file.name}`;
            row.appendChild(nameCell);

            // 大小列
            const sizeCell = document.createElement('td');
            sizeCell.textContent = file.isDirectory ? '-' : this.formatFileSize(file.size);
            row.appendChild(sizeCell);

            // 修改日期列
            const dateCell = document.createElement('td');
            dateCell.textContent = this.formatDate(file.modifyTime);
            row.appendChild(dateCell);

            // 权限列
            const permCell = document.createElement('td');
            permCell.textContent = this.formatPermissions(file.permissions);
            row.appendChild(permCell);

            // 添加行点击事件
            if (file.isDirectory) {
                row.addEventListener('dblclick', async () => {
                    let newPath;
                    if (file.name === '..') {
                        newPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                    } else {
                        newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                        newPath = newPath.replace(/\/+/g, '/');
                    }
                    await this.loadRemoteFiles(newPath);
                });
            }

            tbody.appendChild(row);
        });
    }
    
    // 上传文件
    async uploadFile(localFilePath, remotePath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // 显示传输状态栏
            window.uiManager.showTransferStatus(true);

            // 设置进度条
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在上传: ${this.path.basename(localFilePath)}`;

            const result = await window.api.file.upload(window.currentSessionId, localFilePath, remotePath);

            if (result.success) {
                // 上传成功，更新远程文件列表
                progressBar.style.width = '100%';
                transferInfo.textContent = '上传完成';

                // 刷新远程文件列表
                const remotePathInput = document.getElementById('remote-path');
                if (remotePathInput) {
                    this.loadRemoteFiles(remotePathInput.value);
                }

                setTimeout(() => {
                    progressBar.style.width = '0%';
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            } else {
                alert(`上传失败: ${result.error}`);
                transferInfo.textContent = '上传失败';

                setTimeout(() => {
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            }
        } catch (error) {
            console.error('上传文件失败:', error);
            alert(`上传文件失败: ${error.message}`);
            window.uiManager.showTransferStatus(false);
        }
    }
    
    // 下载文件
    async downloadFile(remotePath, localFilePath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // 如果未指定本地路径，请求用户选择保存位置
            if (!localFilePath) {
                const result = await window.api.dialog.selectDirectory();
                if (result.canceled) {
                    return;
                }

                // 拼接完整路径（目录+文件名）
                const fileName = this.path.basename(remotePath);
                localFilePath = this.path.join(result.directoryPath, fileName);
            }

            // 显示传输状态栏
            window.uiManager.showTransferStatus(true);

            // 设置进度条
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在下载: ${this.path.basename(remotePath)}`;

            const result = await window.api.file.download(window.currentSessionId, remotePath, localFilePath);

            if (result.success) {
                // 下载成功
                progressBar.style.width = '100%';
                transferInfo.textContent = '下载完成';

                // 刷新本地文件列表
                const localPathInput = document.getElementById('local-path');
                if (localPathInput && localPathInput.value) {
                    await this.loadLocalFiles(localPathInput.value);
                }

                setTimeout(() => {
                    progressBar.style.width = '0%';
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            } else {
                alert(`下载失败: ${result.error}`);
                transferInfo.textContent = '下载失败';

                setTimeout(() => {
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            }
        } catch (error) {
            console.error('下载文件失败:', error);
            alert(`下载文件失败: ${error.message}`);
            window.uiManager.showTransferStatus(false);
        }
    }
    
    // 删除远程文件
    async deleteRemoteFile(filePath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        if (!confirm(`确定要删除文件 "${this.path.basename(filePath)}" 吗？此操作不可恢复！`)) {
            return;
        }

        try {
            window.uiManager.showFileManagerLoading(true);

            // 执行删除命令
            const result = await window.api.ssh.execute(window.currentSessionId, `rm -f "${filePath}"`);

            if (result.success) {
                // 刷新远程文件列表
                const remotePathInput = document.getElementById('remote-path');
                if (remotePathInput) {
                    await this.loadRemoteFiles(remotePathInput.value);
                }
            } else {
                alert(`删除文件失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('删除远程文件失败:', error);
            alert(`删除文件失败: ${error.message}`);
        } finally {
            window.uiManager.showFileManagerLoading(false);
        }
    }
    
    // 删除远程目录
    async deleteRemoteDirectory(dirPath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        if (!confirm(`确定要删除目录 "${this.path.basename(dirPath)}" 及其所有内容吗？此操作不可恢复！`)) {
            return;
        }

        try {
            window.uiManager.showFileManagerLoading(true);

            // 执行删除命令
            const result = await window.api.ssh.execute(window.currentSessionId, `rm -rf "${dirPath}"`);

            if (result.success) {
                // 刷新远程文件列表
                const remotePathInput = document.getElementById('remote-path');
                if (remotePathInput) {
                    await this.loadRemoteFiles(remotePathInput.value);
                }
            } else {
                alert(`删除目录失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('删除远程目录失败:', error);
            alert(`删除目录失败: ${error.message}`);
        } finally {
            window.uiManager.showFileManagerLoading(false);
        }
    }
    
    // 创建远程目录
    async createRemoteDirectory(parentPath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        const dirName = prompt('请输入文件夹名称');
        if (!dirName) return;

        // 验证目录名称
        if (dirName.includes('/') || dirName.includes('\\')) {
            alert('文件夹名称不能包含斜杠');
            return;
        }

        // 创建完整路径
        const fullPath = parentPath === '/' ? `/${dirName}` : `${parentPath}/${dirName}`;

        try {
            window.uiManager.showFileManagerLoading(true);

            const result = await window.api.file.createRemoteDirectory(window.currentSessionId, fullPath);

            if (result.success) {
                // 刷新远程文件列表
                const remotePathInput = document.getElementById('remote-path');
                if (remotePathInput) {
                    await this.loadRemoteFiles(remotePathInput.value);
                }
            } else {
                alert(`创建文件夹失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('创建远程文件夹失败:', error);
            alert(`创建文件夹失败: ${error.message}`);
        } finally {
            window.uiManager.showFileManagerLoading(false);
        }
    }
    
    // 上传目录
    async uploadDirectory(localDirPath, remoteDirPath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // 显示传输状态栏
            window.uiManager.showTransferStatus(true);

            // 设置进度条
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在上传文件夹: ${this.path.basename(localDirPath)}`;

            const result = await window.api.file.uploadDirectory(window.currentSessionId, localDirPath, remoteDirPath);

            // 无论结果如何都更新进度
            progressBar.style.width = '100%';

            if (result.success) {
                transferInfo.textContent = '文件夹上传完成';

                // 刷新远程文件列表
                const remotePathInput = document.getElementById('remote-path');
                if (remotePathInput) {
                    await this.loadRemoteFiles(remotePathInput.value);
                }
            } else {
                transferInfo.textContent = `上传失败: ${result.error || '未知错误'}`;
                alert(`上传文件夹失败: ${result.error || '未知错误'}`);
            }

            // 延迟后隐藏进度条
            setTimeout(() => {
                progressBar.style.width = '0%';
                window.uiManager.showTransferStatus(false);
            }, 3000);

        } catch (error) {
            console.error('上传文件夹失败:', error);
            alert(`上传文件夹失败: ${error.message}`);

            // 出错立即隐藏进度条
            window.uiManager.showTransferStatus(false);
        }
    }
    
    // 选择并上传目录
    async selectAndUploadDirectory(remotePath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            const result = await window.api.dialog.selectDirectory();
            if (result.canceled) {
                return;
            }

            const localDirPath = result.directoryPath;
            const dirName = this.path.basename(localDirPath);
            const remoteDirPath = remotePath === '/' ? `/${dirName}` : `${remotePath}/${dirName}`;

            await this.uploadDirectory(localDirPath, remoteDirPath);
        } catch (error) {
            console.error('选择目录失败:', error);
            alert(`选择目录失败: ${error.message}`);
        }
    }
    
    // 下载目录
    async downloadDirectory(remoteDirPath) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        try {
            // 请求用户选择保存位置
            const result = await window.api.dialog.selectDirectory();
            if (result.canceled) {
                return;
            }

            // 获取目录名称
            const dirName = this.path.basename(remoteDirPath);
            // 与选择的路径连接
            const localDirPath = this.path.join(result.directoryPath, dirName);

            // 显示传输状态栏
            window.uiManager.showTransferStatus(true);

            // 设置进度条
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            progressBar.style.width = '0%';
            transferInfo.textContent = `正在下载文件夹: ${dirName}`;

            const downloadResult = await window.api.file.downloadDirectory(window.currentSessionId, remoteDirPath, localDirPath);

            if (downloadResult.success) {
                // 下载成功
                progressBar.style.width = '100%';
                transferInfo.textContent = '文件夹下载完成';

                // 刷新本地文件列表
                const localPathInput = document.getElementById('local-path');
                if (localPathInput && localPathInput.value) {
                    await this.loadLocalFiles(localPathInput.value);
                }

                setTimeout(() => {
                    progressBar.style.width = '0%';
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            } else {
                alert(`下载文件夹失败: ${downloadResult.error}`);
                transferInfo.textContent = '下载失败';

                setTimeout(() => {
                    window.uiManager.showTransferStatus(false);
                }, 3000);
            }
        } catch (error) {
            console.error('下载文件夹失败:', error);
            alert(`下载文件夹失败: ${error.message}`);
            window.uiManager.showTransferStatus(false);
        }
    }
    
    // 删除本地文件
    async deleteLocalFile(filePath) {
        if (!confirm(`确定要删除文件 "${this.path.basename(filePath)}" 吗？此操作不可恢复！`)) {
            return;
        }

        try {
            const result = await window.api.file.deleteLocal(filePath);

            if (result.success) {
                // 刷新本地文件列表
                const localPathInput = document.getElementById('local-path');
                if (localPathInput && localPathInput.value) {
                    await this.loadLocalFiles(localPathInput.value);
                }
            } else {
                alert(`删除文件失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('删除本地文件失败:', error);
            alert(`删除文件失败: ${error.message}`);
        }
    }
    
    // 删除本地目录
    async deleteLocalDirectory(dirPath) {
        if (!confirm(`确定要删除目录 "${this.path.basename(dirPath)}" 及其所有内容吗？此操作不可恢复！`)) {
            return;
        }

        try {
            const result = await window.api.file.deleteLocalDirectory(dirPath);

            if (result.success) {
                // 刷新本地文件列表
                const localPathInput = document.getElementById('local-path');
                if (localPathInput && localPathInput.value) {
                    await this.loadLocalFiles(localPathInput.value);
                }
            } else {
                alert(`删除目录失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('删除本地目录失败:', error);
            alert(`删除目录失败: ${error.message}`);
        }
    }
    
    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));

        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    // 格式化日期
    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString();
    }

    // 格式化权限
    formatPermissions(mode) {
        // 简单实现，实际应根据需求定制
        return mode ? mode.toString(8).slice(-3) : '-';
    }

    // 清除文件管理器缓存
    clearFileManagerCache() {
        // 清除远程文件缓存
        this.remoteFileCache.clear();

        // 重置文件管理器初始化标志
        this.fileManagerInitialized = false;

        // 清除远程文件列表显示
        const remoteFilesTbody = document.querySelector('#remote-files tbody');
        if (remoteFilesTbody) {
            remoteFilesTbody.innerHTML = '';
        }

        console.log('已清除文件管理器缓存');
    }
    
    // 设置文件传输监听
    setupFileTransferListeners() {
        // 右键菜单处理
        const remoteFilesTable = document.getElementById('remote-files');

        if (remoteFilesTable) {
            remoteFilesTable.addEventListener('contextmenu', (e) => {
                // 检查是否点击在文件行上
                const row = e.target.closest('tr');
                if (!row) {
                    // 如果点击在行外，显示目录操作
                    const remotePath = document.getElementById('remote-path').value;
                    e.preventDefault();
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '新建文件夹',
                            action: () => this.createRemoteDirectory(remotePath),
                            className: 'create-directory'
                        }
                    ]);
                    return;
                }

                // 获取文件名和路径
                const fileName = row.querySelector('td:first-child').textContent.trim().replace(/^.+\s/, '');
                const remotePath = document.getElementById('remote-path').value;
                const fullPath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`;

                // 跳过父目录
                if (fileName === '..') return;

                e.preventDefault();

                if (row.classList.contains('directory')) {
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '下载文件夹',
                            action: () => this.downloadDirectory(fullPath),
                            className: 'download'
                        },
                        {
                            label: '删除目录',
                            action: () => this.deleteRemoteDirectory(fullPath),
                            className: 'delete'
                        }
                    ]);
                } else {
                    // 修改文件上下文菜单以直接下载
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '下载文件',
                            action: () => this.downloadFile(fullPath), // 不需要第二个参数，将使用当前本地目录
                            className: 'download'
                        },
                        {
                            label: '删除文件',
                            action: () => this.deleteRemoteFile(fullPath),
                            className: 'delete'
                        }
                    ]);
                }
            });
        }
        
        // 更新本地文件的上下文菜单处理
        const localFilesTable = document.getElementById('local-files');

        if (localFilesTable) {
            localFilesTable.addEventListener('contextmenu', (e) => {
                // 检查是否点击在文件行上
                const row = e.target.closest('tr');
                if (!row) {
                    // 如果点击在行外，显示目录操作
                    const localPath = document.getElementById('local-path').value;
                    const remotePath = document.getElementById('remote-path').value;
                    e.preventDefault();
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '选择文件夹上传',
                            action: () => this.selectAndUploadDirectory(remotePath),
                            className: 'upload'
                        }
                    ]);
                    return;
                }

                // 文件名和路径
                const fileName = row.querySelector('td:first-child').textContent.trim().replace(/^.+\s/, '');
                if (fileName === '..') return;

                const localPath = document.getElementById('local-path').value;
                const fullPath = this.path.join(localPath, fileName);

                const remotePath = document.getElementById('remote-path').value;
                const remoteFilePath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`;

                e.preventDefault();

                if (row.classList.contains('directory')) {
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '上传文件夹',
                            action: () => this.uploadDirectory(fullPath, remoteFilePath),
                            className: 'upload'
                        },
                        {
                            label: '删除目录',
                            action: () => this.deleteLocalDirectory(fullPath),
                            className: 'delete'
                        }
                    ]);
                } else {
                    // 保留现有文件上下文菜单
                    window.uiManager.showContextMenu(e.clientX, e.clientY, [
                        {
                            label: '上传文件',
                            action: () => this.uploadFile(fullPath, remoteFilePath),
                            className: 'upload'
                        },
                        {
                            label: '删除文件',
                            action: () => this.deleteLocalFile(fullPath),
                            className: 'delete'
                        }
                    ]);
                }
            });
        }
    }
}

// 导出单例实例
const fileManager = new FileManager();
export default fileManager;