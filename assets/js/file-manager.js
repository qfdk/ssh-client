// file-manager.js
// 文件管理器相关功能

// LRU缓存实现
class LRUCache {
    constructor(maxSize = 50) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    get(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value); // 移到最后
            return value;
        }
        return null;
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    has(key) {
        return this.cache.has(key);
    }
    
    clear() {
        this.cache.clear();
    }
}

class FileManager {
    constructor() {
        this.remoteFileCache = new LRUCache(50); // 增加缓存大小
        this.localFileCache = new LRUCache(50); // 增加缓存大小
        this.lastLocalDirectory = null; // 记住上次的本地目录
        this.fileManagerInitialized = false; // 文件管理器是否已初始化
        
        // DOM 元素缓存
        this.domCache = {
            remoteFilesTbody: null,
            localFilesTbody: null,
            remotePathInput: null,
            localPathInput: null
        };
        
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
            },
        };
    }
    
    // 获取缓存的 DOM 元素
    getCachedElement(key, selector) {
        if (!this.domCache[key]) {
            this.domCache[key] = document.querySelector(selector);
        }
        return this.domCache[key];
    }
    
    // 清除 DOM 缓存
    clearDOMCache() {
        this.domCache = {
            remoteFilesTbody: null,
            localFilesTbody: null,
            remotePathInput: null,
            localPathInput: null
        };
    }
    
    // 初始化文件管理器
    async initFileManager(sessionId) {
        if (!sessionId) {
            console.error('无法初始化文件管理器：未连接到服务器');
            return;
        }
        
        console.log(`开始初始化文件管理器，会话ID: ${sessionId}`);

        try {
            // 显示加载指示器
            window.uiManager.showFileManagerLoading(true);

            // 清除现有远程文件列表（使用缓存）
            const remoteFilesTbody = this.getCachedElement('remoteFilesTbody', '#remote-files tbody');
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
        } catch (error) {
            console.error('初始化文件管理器失败:', error);
        } finally {
            // 隐藏加载指示器
            window.uiManager.showFileManagerLoading(false);
        }
    }
    
    // 加载远程文件
    async loadRemoteFiles(path) {
        if (!window.currentSessionId) {
            console.error('无法加载远程文件：未连接到服务器');
            window.uiManager.showFileManagerLoading(false);
            return;
        }

        // 调试：检查 currentSessionId 的类型
        console.log('loadRemoteFiles - currentSessionId:', window.currentSessionId, 'type:', typeof window.currentSessionId);

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

            // 确保传递字符串类型的sessionId
            const sessionId = String(window.currentSessionId);

            // 更新会话的远程工作目录
            window.sessionManager.updateRemotePath(sessionId, path);

            // 记录请求
            console.log(`请求远程文件列表: 会话ID ${sessionId}, 路径 ${path}`);

            // 在读取文件前先验证会话是否有效
            const session = window.sessionManager.getSession(sessionId);
            if (!session || !session.active) {
                throw new Error('会话已失效，请重新连接');
            }

            // 发起请求
            const result = await window.api.file.list(sessionId, path);

            if (result.success) {
                // 更新缓存
                const cacheKey = `${sessionId}:${path}`;
                this.remoteFileCache.set(cacheKey, result.files);
                console.log('更新远程文件缓存:', cacheKey);

                // 显示文件
                this.displayRemoteFiles(result.files, path);
            } else {
                console.error('获取远程文件失败:', result.error);
                
                // 检查是否是连接错误
                if (result.error && (result.error.includes('not connected') ||
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

        // 使用DocumentFragment批量插入，避免多次重排
        const fragment = document.createDocumentFragment();

        // 添加返回上级目录的条目
        if (currentPath !== '/') {
            const parentRow = document.createElement('tr');
            parentRow.className = 'directory';
            parentRow.dataset.type = 'directory';
            parentRow.dataset.name = '..';

            // 文件名列
            const nameCell = document.createElement('td');
            nameCell.innerHTML = '<span class="file-icon"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span> ..';
            parentRow.appendChild(nameCell);

            // 空列
            for (let i = 0; i < 4; i++) {
                const cell = document.createElement('td');
                cell.textContent = '-';
                parentRow.appendChild(cell);
            }

            fragment.appendChild(parentRow);
        }

        // 批量创建行
        files.forEach(file => {
            const row = document.createElement('tr');
            row.className = file.isDirectory ? 'directory' : 'file';
            row.dataset.type = file.isDirectory ? 'directory' : 'file';
            row.dataset.name = file.name;
            row.dataset.path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;

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

            // 所有者列
            const ownerCell = document.createElement('td');
            ownerCell.textContent = file.owner || 'unknown';
            ownerCell.classList.add('owner-cell');
            row.appendChild(ownerCell);

            // 权限列
            const permCell = document.createElement('td');
            permCell.textContent = this.formatPermissions(file.permissions);
            permCell.classList.add('permissions-cell');
            permCell.style.cursor = 'pointer';
            permCell.title = '点击修改权限';
            row.appendChild(permCell);

            fragment.appendChild(row);
        });

        // 清空并一次性插入所有行
        tbody.innerHTML = '';
        tbody.appendChild(fragment);

        // 使用事件委托处理所有行的点击事件
        if (!tbody.dataset.delegated) {
            tbody.dataset.delegated = 'true';
            tbody.addEventListener('dblclick', async (e) => {
                const row = e.target.closest('tr');
                if (!row || row.dataset.type !== 'directory') return;

                const name = row.dataset.name;
                let newPath;
                if (name === '..') {
                    // 从DOM获取当前路径，而不是使用可能过期的currentPath变量
                    const currentPath = document.getElementById('remote-path').value || '/';
                    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
                    newPath = parentPath === '' ? '/' : parentPath;
                } else {
                    newPath = row.dataset.path.replace(/\/+/g, '/');
                }
                await this.loadRemoteFiles(newPath);
            });

            // 权限点击事件
            tbody.addEventListener('click', (e) => {
                if (e.target.classList.contains('permissions-cell')) {
                    const row = e.target.closest('tr');
                    if (!row || row.dataset.name === '..') return;
                    
                    this.showPermissionsDialog(row.dataset.path, e.target.textContent);
                }
            });
        }
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

    // 显示权限修改对话框
    showPermissionsDialog(filePath, currentPermissions) {
        // 创建对话框 HTML
        const dialogHtml = `
            <div id="permissions-dialog" class="dialog active">
                <div class="dialog-content permissions-dialog-content">
                    <h3>修改文件权限 <code class="current-perm-badge">${currentPermissions}</code></h3>
                    
                    <div class="file-info">
                        <div class="file-path">
                            <span class="path-label">文件路径:</span>
                            <span class="path-value">${filePath}</span>
                        </div>
                    </div>
                    
                    <div class="permissions-editor">
                        <div class="octal-input-section">
                            <div class="input-with-preview">
                                <label for="new-permissions">八进制权限</label>
                                <input type="text" id="new-permissions" value="${this.parsePermissions(currentPermissions)}" placeholder="755" maxlength="3">
                                <span class="preview-separator">=</span>
                                <div class="preview-text" id="permissions-preview">rwxr-xr-x</div>
                            </div>
                            <div class="common-permissions">
                                <span class="label">常用权限:</span>
                                <button type="button" class="perm-preset" data-perm="755">755</button>
                                <button type="button" class="perm-preset" data-perm="644">644</button>
                                <button type="button" class="perm-preset" data-perm="777">777</button>
                                <button type="button" class="perm-preset" data-perm="600">600</button>
                            </div>
                        </div>
                        
                        <div class="permissions-visual">
                            <div class="permission-group">
                                <div class="group-header">
                                    <span>所有者</span>
                                </div>
                                <div class="permission-checkboxes">
                                    <label class="checkbox-item read">
                                        <input type="checkbox" id="owner-read">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">读取</span>
                                        <code>r</code>
                                    </label>
                                    <label class="checkbox-item write">
                                        <input type="checkbox" id="owner-write">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">写入</span>
                                        <code>w</code>
                                    </label>
                                    <label class="checkbox-item exec">
                                        <input type="checkbox" id="owner-exec">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">执行</span>
                                        <code>x</code>
                                    </label>
                                </div>
                            </div>
                            
                            <div class="permission-group">
                                <div class="group-header">
                                    <span>组</span>
                                </div>
                                <div class="permission-checkboxes">
                                    <label class="checkbox-item read">
                                        <input type="checkbox" id="group-read">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">读取</span>
                                        <code>r</code>
                                    </label>
                                    <label class="checkbox-item write">
                                        <input type="checkbox" id="group-write">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">写入</span>
                                        <code>w</code>
                                    </label>
                                    <label class="checkbox-item exec">
                                        <input type="checkbox" id="group-exec">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">执行</span>
                                        <code>x</code>
                                    </label>
                                </div>
                            </div>
                            
                            <div class="permission-group">
                                <div class="group-header">
                                    <span>其他用户</span>
                                </div>
                                <div class="permission-checkboxes">
                                    <label class="checkbox-item read">
                                        <input type="checkbox" id="other-read">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">读取</span>
                                        <code>r</code>
                                    </label>
                                    <label class="checkbox-item write">
                                        <input type="checkbox" id="other-write">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">写入</span>
                                        <code>w</code>
                                    </label>
                                    <label class="checkbox-item exec">
                                        <input type="checkbox" id="other-exec">
                                        <span class="checkmark"></span>
                                        <span class="perm-label">执行</span>
                                        <code>x</code>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="dialog-buttons">
                        <button type="button" id="cancel-permissions">取消</button>
                        <button type="button" id="apply-permissions">应用更改</button>
                    </div>
                </div>
            </div>
        `;

        // 移除现有对话框
        const existingDialog = document.getElementById('permissions-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        // 添加对话框到页面
        document.body.insertAdjacentHTML('beforeend', dialogHtml);

        // 设置初始权限状态
        this.setPermissionCheckboxes(currentPermissions);

        // 权限输入框变化事件
        const permInput = document.getElementById('new-permissions');
        permInput.addEventListener('input', () => {
            this.updateCheckboxesFromOctal(permInput.value);
            this.updatePermissionPreview(permInput.value);
        });

        // 复选框变化事件
        const checkboxes = document.querySelectorAll('#permissions-dialog input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateOctalFromCheckboxes();
            });
        });

        // 常用权限预设按钮
        const presetButtons = document.querySelectorAll('.perm-preset');
        presetButtons.forEach(button => {
            button.addEventListener('click', () => {
                const perm = button.dataset.perm;
                permInput.value = perm;
                this.updateCheckboxesFromOctal(perm);
                this.updatePermissionPreview(perm);
            });
        });

        // 按钮事件
        document.getElementById('cancel-permissions').addEventListener('click', () => {
            document.getElementById('permissions-dialog').remove();
        });

        document.getElementById('apply-permissions').addEventListener('click', () => {
            this.applyPermissions(filePath, permInput.value);
        });

        // 初始化权限预览
        this.updatePermissionPreview(permInput.value);
    }


    // 应用权限修改
    async applyPermissions(filePath, permissions) {
        if (!window.currentSessionId) {
            alert('请先连接到服务器');
            return;
        }

        // 调试：检查 currentSessionId 的类型
        console.log('applyPermissions - currentSessionId:', window.currentSessionId, 'type:', typeof window.currentSessionId);

        // 验证权限格式
        if (!/^[0-7]{3}$/.test(permissions)) {
            alert('权限格式错误，请输入3位八进制数字 (例如: 755)');
            return;
        }

        try {
            // 确保传递字符串类型的sessionId
            const sessionId = String(window.currentSessionId);
            const result = await window.api.file.changePermissions(
                sessionId,
                filePath,
                permissions
            );

            if (result.success) {
                // 关闭对话框
                document.getElementById('permissions-dialog').remove();
                
                // 刷新文件列表
                const currentPath = document.getElementById('remote-path').value || '/';
                await this.loadRemoteFiles(currentPath);
                
                console.log('权限修改成功');
            } else {
                alert(`权限修改失败: ${result.error || '未知错误'}`);
            }
        } catch (error) {
            console.error('权限修改失败:', error);
            alert(`权限修改失败: ${error.message}`);
        }
    }

    // 解析权限字符串为八进制
    parsePermissions(permStr) {
        if (permStr.length === 10) {
            // 从 -rwxrwxrwx 格式解析
            let octal = '';
            for (let i = 1; i < 10; i += 3) {
                let digit = 0;
                if (permStr[i] === 'r') digit += 4;
                if (permStr[i + 1] === 'w') digit += 2;
                if (permStr[i + 2] === 'x') digit += 1;
                octal += digit;
            }
            return octal;
        }
        return permStr;
    }

    // 设置权限复选框
    setPermissionCheckboxes(permStr) {
        const octal = this.parsePermissions(permStr);
        this.updateCheckboxesFromOctal(octal);
    }

    // 根据八进制更新复选框
    updateCheckboxesFromOctal(octal) {
        if (!/^[0-7]{3}$/.test(octal)) return;

        const perms = octal.split('').map(d => parseInt(d));
        const groups = ['owner', 'group', 'other'];

        groups.forEach((group, i) => {
            const perm = perms[i];
            document.getElementById(`${group}-read`).checked = !!(perm & 4);
            document.getElementById(`${group}-write`).checked = !!(perm & 2);
            document.getElementById(`${group}-exec`).checked = !!(perm & 1);
        });
    }

    // 根据复选框更新八进制
    updateOctalFromCheckboxes() {
        const groups = ['owner', 'group', 'other'];
        let octal = '';

        groups.forEach(group => {
            let digit = 0;
            if (document.getElementById(`${group}-read`).checked) digit += 4;
            if (document.getElementById(`${group}-write`).checked) digit += 2;
            if (document.getElementById(`${group}-exec`).checked) digit += 1;
            octal += digit;
        });

        document.getElementById('new-permissions').value = octal;
        this.updatePermissionPreview(octal);
    }

    // 更新权限预览文本
    updatePermissionPreview(octal) {
        const preview = document.getElementById('permissions-preview');
        if (!preview) return;

        if (!/^[0-7]{3}$/.test(octal)) {
            preview.textContent = 'Invalid';
            preview.className = 'preview-text invalid';
            return;
        }

        let permStr = '';
        const digits = octal.split('').map(d => parseInt(d));

        digits.forEach(digit => {
            permStr += (digit & 4) ? 'r' : '-';
            permStr += (digit & 2) ? 'w' : '-';
            permStr += (digit & 1) ? 'x' : '-';
        });

        preview.textContent = permStr;
        preview.className = 'preview-text valid';
    }

    // 八进制转换为可读权限字符串
    octalToReadable(octal) {
        if (!/^[0-7]{3}$/.test(octal)) return 'Invalid';
        
        let result = '';
        const digits = octal.split('').map(d => parseInt(d));
        
        digits.forEach(digit => {
            result += (digit & 4) ? 'r' : '-';
            result += (digit & 2) ? 'w' : '-';
            result += (digit & 1) ? 'x' : '-';
        });
        
        return result;
    }
}

// 导出单例实例
const fileManager = new FileManager();
export default fileManager;