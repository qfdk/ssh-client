// =============================================
// 第1部分：基础定义和工具函数
// =============================================

// 简单的路径工具函数
const path = {
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
    dirname: function (p) {
        return p.substring(0, p.lastIndexOf('/'));
    }
};

// DOM元素引用
const newConnectionBtn = document.getElementById('new-connection-btn');
const connectionDialog = document.getElementById('connection-dialog');
const connectionForm = document.getElementById('connection-form');
const cancelConnectionBtn = document.getElementById('cancel-connection');
const tabs = document.querySelectorAll('.tab');
const sidebarToggle = document.getElementById('toggle-sidebar');
const sidebar = document.querySelector('.sidebar');
const authTypeSelect = document.getElementById('auth-type');
const passwordAuthFields = document.querySelector('.auth-password');
const privateKeyAuthFields = document.querySelectorAll('.auth-key');
const browsePrivateKeyBtn = document.getElementById('browse-private-key');
const savePasswordCheckbox = document.getElementById('conn-save-password');
const terminalTab = document.querySelector('.tab[data-tab="terminal"]');
const fileManagerTab = document.querySelector('.tab[data-tab="file-manager"]');

// 全局变量
let activeTerminal = null;
let currentSessionId = null;
let isConnecting = false; // 连接中状态标志
let loadingOverlay = null; // 加载遮罩元素
let lastLocalDirectory = null; // 记住上次的本地目录
let fileManagerInitialized = false; // 文件管理器是否已初始化

console.log('Renderer script loaded');

// 创建加载遮罩
function createLoadingOverlay(text = '连接中...') {
    // 如果已存在加载遮罩，先移除
    removeLoadingOverlay();

    // 创建新的加载遮罩
    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';

    const spinner = document.createElement('div');
    spinner.className = 'spinner';

    const loadingText = document.createElement('div');
    loadingText.className = 'loading-text';
    loadingText.textContent = text;

    loadingOverlay.appendChild(spinner);
    loadingOverlay.appendChild(loadingText);

    document.body.appendChild(loadingOverlay);

    return loadingOverlay;
}

// 移除加载遮罩
function removeLoadingOverlay() {
    if (loadingOverlay && document.body.contains(loadingOverlay)) {
        document.body.removeChild(loadingOverlay);
        loadingOverlay = null;
    }
}

// 显示/隐藏文件管理器加载状态
function showFileManagerLoading(show) {
    const loadingOverlay = document.getElementById('file-manager-loading');
    if (loadingOverlay) {
        if (show) {
            loadingOverlay.classList.remove('hidden');
        } else {
            loadingOverlay.classList.add('hidden');
        }
    }
}

// 显示/隐藏传输状态栏
function showTransferStatus(show) {
    const transferStatus = document.querySelector('.transfer-status');
    if (transferStatus) {
        if (show) {
            transferStatus.classList.add('active');
        } else {
            transferStatus.classList.remove('active');
        }
    }
}

// 切换认证方式显示/隐藏相关字段
function toggleAuthFields() {
    const authType = authTypeSelect.value;

    if (authType === 'password') {
        passwordAuthFields.classList.remove('hidden');
        privateKeyAuthFields.forEach(field => field.classList.add('hidden'));
    } else {
        passwordAuthFields.classList.add('hidden');
        privateKeyAuthFields.forEach(field => field.classList.remove('hidden'));
    }
}

// 添加防抖函数，避免快速点击引起的卡顿
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 更新连接状态函数
function updateConnectionStatus(connected, name = '') {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');

    if (!statusIndicator || !statusText) {
        console.error('找不到状态指示器元素');
        return;
    }

    if (connected) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = `已连接: ${name}`;
    } else {
        statusIndicator.classList.remove('online');
        statusIndicator.classList.add('offline');
        statusText.textContent = '未连接';
    }
}

// 更新活跃连接项
function updateActiveConnectionItem(connectionId) {
    // 重置所有连接项状态
    document.querySelectorAll('.connection-item').forEach(item => {
        item.setAttribute('data-active', 'false');
        const indicator = item.querySelector('.connection-status-indicator');
        if (indicator) {
            indicator.classList.remove('online');
            indicator.classList.add('offline');
        }
    });

    // 设置当前活跃连接项
    const activeItem = document.querySelector(`.connection-item[data-id="${connectionId}"]`);
    if (activeItem) {
        activeItem.setAttribute('data-active', 'true');
        const indicator = activeItem.querySelector('.connection-status-indicator');
        if (indicator) {
            indicator.classList.remove('offline');
            indicator.classList.add('online');
        }
    }
}

// =============================================
// 第2部分：会话管理器
// =============================================

// 改进的会话管理器，支持多个活跃会话的维护和切换
const sessionManager = {
    // 存储所有活动会话
    sessions: new Map(),

    // 添加会话
    addSession(sessionId, connectionId, data) {
        console.log(`添加会话: ${sessionId}, 连接ID: ${connectionId}`);
        this.sessions.set(sessionId, {
            ...data,
            connectionId: connectionId,
            active: true,
            buffer: data.buffer || '',
            lastActive: Date.now(),
            currentRemotePath: '/' // 初始化远程工作目录为根目录
        });
    },

    // 获取会话
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    },

    // 根据连接ID获取会话
    getSessionByConnectionId(connectionId) {
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.connectionId === connectionId && session.active) {
                return {sessionId, session};
            }
        }
        return null;
    },

    // 更新会话
    updateSession(sessionId, data) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            this.sessions.set(sessionId, {...session, ...data});
        }
    },

    // 移除会话
    removeSession(sessionId) {
        console.log(`移除会话: ${sessionId}`);
        this.sessions.delete(sessionId);
    },

    // 会话是否存在且活跃
    hasActiveSession(sessionId) {
        return this.sessions.has(sessionId) && this.sessions.get(sessionId).active;
    },

    // 获取所有会话信息
    getAllSessions() {
        return Array.from(this.sessions.entries()).map(([id, session]) => ({
            id,
            ...session
        }));
    },

    // 设置会话为活跃或非活跃
    setSessionActive(sessionId, active) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.active = active;
            if (active) {
                session.lastActive = Date.now();
            }
            this.sessions.set(sessionId, session);
            console.log(`会话 ${sessionId} 状态设置为: ${active ? '活跃' : '非活跃'}`);
        }
    },

    // 记录终端数据到缓冲区
    addToBuffer(sessionId, data) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);

            // 防止缓冲区过大
            const maxBufferSize = 100000;
            session.buffer = (session.buffer || '') + data;

            if (session.buffer.length > maxBufferSize) {
                session.buffer = session.buffer.slice(-maxBufferSize);
            }

            this.sessions.set(sessionId, session);
        }
    },

    // 清除缓冲区
    clearBuffer(sessionId) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.buffer = '';
            this.sessions.set(sessionId, session);
        }
    },

    // 获取会话的远程工作目录
    getRemotePath(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.currentRemotePath || '/' : '/';
    },

    // 更新会话的远程工作目录
    updateRemotePath(sessionId, path) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.currentRemotePath = path;
            this.sessions.set(sessionId, session);
        }
    },

    // 调试: 输出所有会话状态
    dumpSessions() {
        console.log('当前会话状态:');
        for (const [sessionId, session] of this.sessions.entries()) {
            console.log(`- 会话ID: ${sessionId}, 连接ID: ${session.connectionId}, 活跃: ${session.active}`);
        }
    }
};

// =============================================
// 第3部分：终端功能
// =============================================

// 手动创建终端
function createXterm(containerId, options = {}) {
    // 获取xterm.js脚本
    const xtermScript = document.createElement('script');
    xtermScript.src = 'node_modules/xterm/lib/xterm.js';
    document.head.appendChild(xtermScript);

    // 获取fit插件脚本
    const fitScript = document.createElement('script');
    fitScript.src = 'node_modules/xterm-addon-fit/lib/xterm-addon-fit.js';
    document.head.appendChild(fitScript);

    // 创建终端
    const container = document.getElementById(containerId);

    // 等待脚本加载完成
    return new Promise((resolve, reject) => {
        fitScript.onload = () => {
            try {
                // 创建终端实例
                const term = new Terminal({
                    cursorBlink: true,
                    cursorStyle: 'bar',    // 设置为竖线光标
                    fontSize: 14,
                    fontFamily: 'monospace',
                    theme: {
                        background: '#1e1e1e',
                        foreground: '#f0f0f0',
                        cursor: '#ffffff'  // 添加光标颜色
                    },
                    allowTransparency: false,
                    rendererType: 'dom',   // 使用DOM渲染器可能更好地支持自定义样式
                    ...options
                });

                // 创建fit插件
                const fitAddon = new FitAddon.FitAddon();
                term.loadAddon(fitAddon);

                term.open(container);
                fitAddon.fit();

                // 添加窗口大小变化事件监听
                window.addEventListener('resize', () => {
                    fitAddon.fit();
                });

                // 强制延迟重新调整大小，确保正确渲染
                setTimeout(() => {
                    fitAddon.fit();
                }, 100);

                resolve({term, fitAddon});
            } catch (error) {
                reject(error);
            }
        };

        xtermScript.onerror = reject;
        fitScript.onerror = reject;
    });
}

// 初始化终端函数，支持恢复已有终端
async function initSimpleTerminal(sessionId, existingSession = null) {
    try {
        console.log(`初始化终端 - 会话ID: ${sessionId}, 是否存在会话: ${!!existingSession}`);

        const container = document.getElementById('terminal-container');
        if (!container) {
            console.error('找不到终端容器');
            return null;
        }

        // 清空容器
        container.innerHTML = '';

        let term, fitAddon;

        // 基本终端选项
        const termOptions = {
            cursorBlink: true,
            cursorStyle: 'bar',
            fontSize: 14,
            fontFamily: 'monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#f0f0f0',
                cursor: '#ffffff'  // 添加光标颜色
            },
            allowTransparency: false,
            rendererType: 'dom'    // 使用DOM渲染器可能更好地支持自定义样式
        };

        // 创建新的终端实例
        const result = await createXterm('terminal-container', termOptions);
        term = result.term;
        fitAddon = result.fitAddon;

        // 如果是恢复已有会话，显示缓冲区数据
        if (existingSession && existingSession.buffer) {
            console.log(`恢复终端缓冲区，长度: ${existingSession.buffer.length}`);
            term.write(existingSession.buffer);
        }

        // 设置全局活动终端
        activeTerminal = term;
        window.terminalFitAddon = fitAddon;

        // 终端接收输入并发送
        term.onData(data => {
            if (window.api && window.api.ssh && currentSessionId) {
                window.api.ssh.sendData(currentSessionId, data)
                    .catch(err => console.error('发送数据失败:', err));
            }
        });

        // 创建标签
        createTerminalTab(sessionId);

        // 隐藏placeholder
        const placeholder = document.getElementById('terminal-placeholder');
        if (placeholder) {
            placeholder.classList.add('hidden');
        }

        // 确保终端填满空间并发送初始端始终端大小
        setTimeout(() => {
            if (fitAddon) {
                fitAddon.fit();

                // 获取并发送终端尺寸
                const dimensions = fitAddon.proposeDimensions();
                if (dimensions && window.api && window.api.ssh) {
                    window.api.ssh.resize(sessionId, dimensions.cols, dimensions.rows)
                        .catch(err => console.error('初始化调整终端大小失败:', err));
                }
            }
        }, 200);

        return {term, fitAddon};
    } catch (error) {
        console.error('初始化终端失败:', error);
        throw error;
    }
}

// 创建终端标签
function createTerminalTab(sessionId) {
    const tabsContainer = document.getElementById('terminal-tabs-left');
    if (!tabsContainer) {
        return;
    }

    tabsContainer.innerHTML = '';

    const tab = document.createElement('div');
    tab.className = 'terminal-tab active';
    tab.innerHTML = `
    <span>终端</span>
    <button class="close-tab" data-session-id="${sessionId}">×</button>
  `;

    tabsContainer.appendChild(tab);

    // 为关闭按钮添加事件监听
    const closeBtn = tab.querySelector('.close-tab');
    if (closeBtn) {
        closeBtn.addEventListener('click', async function () {
            try {
                await window.api.ssh.disconnect(sessionId);

                // 移除会话
                sessionManager.removeSession(sessionId);

                activeTerminal = null;
                currentSessionId = null;
                window.terminalFitAddon = null;

                const terminalContainer = document.getElementById('terminal-container');
                if (terminalContainer) {
                    terminalContainer.innerHTML = '';
                }

                const placeholder = document.getElementById('terminal-placeholder');
                if (placeholder) {
                    placeholder.classList.remove('hidden');
                }

                // 更新连接状态和服务器信息
                updateConnectionStatus(false);
                updateServerInfo(false);
                await loadConnections();
            } catch (error) {
                console.error('断开连接失败:', error);
            }
        });
    }
}

// 手动触发终端大小调整
function resizeTerminal() {
    if (window.terminalFitAddon && activeTerminal && currentSessionId) {
        window.terminalFitAddon.fit();

        // 获取并发送更新的终端尺寸
        const dimensions = window.terminalFitAddon.proposeDimensions();
        if (dimensions && window.api && window.api.ssh) {
            window.api.ssh.resize(currentSessionId, dimensions.cols, dimensions.rows)
                .catch(err => console.error('调整终端大小失败:', err));
        }
    }
}

// =============================================
// 第4部分：SSH和会话连接功能
// =============================================

// 改进会话切换功能
async function switchToSession(connectionId) {
    console.log(`尝试切换到连接ID: ${connectionId}的会话`);

    // 获取当前所有会话信息
    sessionManager.dumpSessions();

    // 根据连接ID查找会话
    const sessionInfo = sessionManager.getSessionByConnectionId(connectionId);
    if (!sessionInfo) {
        console.error(`找不到连接ID: ${connectionId}的会话`);
        return false;
    }

    console.log(`找到会话，会话ID: ${sessionInfo.sessionId}`);

    try {
        // 保存当前会话状态（如果有）
        if (currentSessionId && activeTerminal) {
            console.log(`保存当前会话: ${currentSessionId}的状态`);
            // 可以在这里保存额外的状态信息
        }

        // 更新当前会话ID
        const previousSessionId = currentSessionId;
        currentSessionId = sessionInfo.sessionId;

        console.log(`会话ID已切换: ${previousSessionId} -> ${currentSessionId}`);

        // 清空终端容器
        const container = document.getElementById('terminal-container');
        if (container) {
            container.innerHTML = '';
        }

        // 恢复终端
        console.log(`恢复会话: ${sessionInfo.sessionId}的终端`);
        const terminalResult = await initSimpleTerminal(sessionInfo.sessionId, sessionInfo.session);

        if (!terminalResult) {
            console.error('终端初始化失败');
            return false;
        }

        activeTerminal = terminalResult.term;

        // 获取连接信息以更新UI
        const connections = await window.api.config.getConnections();
        const connection = connections.find(c => c.id === connectionId);

        if (connection) {
            // 更新UI状态
            updateConnectionStatus(true, connection.name);
            // 更新服务器信息
            updateServerInfo(true, {
                name: connection.name,
                host: connection.host
            });
            updateActiveConnectionItem(connectionId);

            // 切换到终端标签
            if (terminalTab) {
                terminalTab.click();
            }

            // 确保终端大小正确
            setTimeout(resizeTerminal, 100);
            
            // 重新初始化文件管理器
            if (fileManagerInitialized) {
                console.log('重新初始化文件管理器，会话ID:', sessionInfo.sessionId);
                initFileManager(sessionInfo.sessionId);
            }

            console.log(`成功切换到连接: ${connection.name}的会话`);
            return true;
        } else {
            console.error('找不到连接信息');
            return false;
        }
    } catch (error) {
        console.error('切换会话失败:', error);
        return false;
    }
}

// 修改connectToSaved函数，使用新的切换功能
async function connectToSaved(id) {
    // 如果已经在连接中，则忽略
    if (isConnecting) return;

    try {
        if (!window.api) {
            alert('API未初始化，请重启应用');
            return;
        }

        const connections = await window.api.config.getConnections();
        const connection = connections.find(c => c.id === id);

        if (!connection) {
            console.error('找不到连接信息');
            return;
        }

        // 尝试切换到现有会话
        const sessionInfo = sessionManager.getSessionByConnectionId(connection.id);

        if (sessionInfo && sessionInfo.session.active) {
            console.log(`尝试切换到现有会话, 连接ID: ${connection.id}`);

            // 使用新的切换功能
            const switchResult = await switchToSession(connection.id);

            if (switchResult) {
                console.log('会话切换成功');
                // 更新服务器信息显示
                updateServerInfo(true, {
                    name: connection.name,
                    host: connection.host
                });
                return;
            } else {
                console.warn('会话切换失败，尝试建立新连接');
            }
        }

        // 如果没有现有会话或切换失败，建立新连接
        console.log(`建立新连接: ${connection.name}`);
        isConnecting = true;
        createLoadingOverlay('正在连接服务器...');

        const result = await window.api.ssh.connect(connection);
        if (result.success) {
            currentSessionId = result.sessionId;

            // 更新连接信息，包括会话ID
            await window.api.config.saveConnection({
                ...connection,
                sessionId: result.sessionId
            });

            // 初始化终端
            const terminalInfo = await initSimpleTerminal(result.sessionId);

            // 保存到会话管理器
            if (terminalInfo) {
                sessionManager.addSession(result.sessionId, connection.id, {
                    term: terminalInfo.term,
                    buffer: '',
                    name: connection.name
                });
            }

            // 更新状态
            updateConnectionStatus(true, connection.name);
            // 更新服务器信息
            updateServerInfo(true, {
                name: connection.name,
                host: connection.host
            });
            updateActiveConnectionItem(connection.id);

            // 更新连接列表
            await loadConnections();

            // 切换到终端标签
            if (terminalTab) {
                terminalTab.click();
            }
        } else {
            alert(`连接失败: ${result.error}`);
        }
    } catch (error) {
        console.error('连接错误:', error);
        alert(`连接错误: ${error.message}`);
    } finally {
        isConnecting = false;
        removeLoadingOverlay();
    }
}

// 在renderer.js文件中添加这两个函数

// 处理连接项鼠标悬停
function handleItemHover(event) {
    // 只有当侧边栏处于折叠状态时才显示工具提示
    if (!sidebar.classList.contains('collapsed')) {
        return;
    }

    // 获取连接名称
    const connectionName = event.currentTarget.getAttribute('data-name');
    if (!connectionName) return;

    // 创建工具提示元素
    let tooltip = document.getElementById('connection-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'connection-tooltip';
        tooltip.className = 'custom-tooltip';
        document.body.appendChild(tooltip);
    }

    // 设置工具提示内容和位置
    tooltip.textContent = connectionName;

    // 计算位置 - 获取连接项的位置信息
    const rect = event.currentTarget.getBoundingClientRect();
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
    tooltip.style.left = `${rect.right + 10}px`; // 距离连接项右侧10px

    // 显示工具提示
    setTimeout(() => {
        tooltip.classList.add('visible');
    }, 10); // 短暂延迟，确保CSS过渡效果生效
}

// 处理连接项鼠标离开
function handleItemLeave(event) {
    const tooltip = document.getElementById('connection-tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

// 在加载连接列表中使用这个新的切换函数
async function loadConnections() {
    try {
        if (!window.api || !window.api.config) {
            console.error('API未初始化，无法加载连接');
            return;
        }

        const connections = await window.api.config.getConnections();
        const connectionList = document.getElementById('connection-list');

        connectionList.innerHTML = '';

        if (connections && connections.length > 0) {
            connections.forEach(connection => {
                // 检查连接是否有活跃会话
                const existingSessionInfo = sessionManager.getSessionByConnectionId(connection.id);
                const isActive = existingSessionInfo !== null &&
                    existingSessionInfo.sessionId === currentSessionId;

                const statusClass = isActive ? 'online' : 'offline';

                const item = document.createElement('div');
                item.className = 'connection-item';
                item.setAttribute('data-id', connection.id);
                item.setAttribute('data-active', isActive ? 'true' : 'false');
                // 储存名称，但不使用title属性（会显示原生工具提示）
                item.setAttribute('data-name', connection.name);

                item.innerHTML = `
      <div class="connection-status-indicator ${statusClass}"></div>
      <div class="connection-name">${connection.name}</div>
      <div class="connection-actions">
        <button class="icon-button delete-connection" data-id="${connection.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    `;

                // 添加双击事件
                item.addEventListener('dblclick', () => {
                    console.log(`双击连接: ${connection.id}, 名称: ${connection.name}`);
                    connectToSaved(connection.id);
                });

                // 添加鼠标悬停事件，用于显示自定义工具提示
                item.addEventListener('mouseenter', handleItemHover);
                item.addEventListener('mouseleave', handleItemLeave);

                connectionList.appendChild(item);
            });
        } else {
            connectionList.innerHTML = '<div class="no-connections">没有保存的连接</div>';
        }

        // 调试输出
        console.log('加载了', connections.length, '个连接');
    } catch (error) {
        console.error('加载连接失败:', error);
    }
}

// 处理连接表单提交
async function handleConnectionFormSubmit(e) {
    e.preventDefault();

    // 如果已经在连接中，则忽略
    if (isConnecting) return;

    try {
        isConnecting = true;
        createLoadingOverlay('正在连接服务器...');

        const authType = document.getElementById('auth-type').value;
        const savePassword = document.getElementById('conn-save-password').checked;

        const connectionDetails = {
            name: document.getElementById('conn-name').value,
            host: document.getElementById('conn-host').value,
            port: parseInt(document.getElementById('conn-port').value),
            username: document.getElementById('conn-username').value,
            authType: authType
        };

        // 根据认证方式添加相应字段
        if (authType === 'password') {
            connectionDetails.password = document.getElementById('conn-password').value;
        } else {
            connectionDetails.privateKey = document.getElementById('conn-private-key-path').value;
            const passphrase = document.getElementById('conn-passphrase').value;
            if (passphrase) {
                connectionDetails.passphrase = passphrase;
            }
        }

        console.log('尝试连接...');

        if (!window.api || !window.api.ssh) {
            alert('API未正确初始化，请重启应用');
            return;
        }

        const result = await window.api.ssh.connect(connectionDetails);
        if (result.success) {
            // 生成ID并保存会话
            const generatedId = Date.now().toString();
            currentSessionId = result.sessionId;

            // 如果不保存密码，则从保存的连接信息中清除密码
            const savedConnectionDetails = {...connectionDetails};
            if (!savePassword) {
                if (authType === 'password') {
                    savedConnectionDetails.password = '';
                } else if (authType === 'privateKey' && savedConnectionDetails.passphrase) {
                    savedConnectionDetails.passphrase = '';
                }
            }

            const savedConnection = await window.api.config.saveConnection({
                ...savedConnectionDetails,
                id: generatedId,
                sessionId: result.sessionId
            });

            // 更新状态
            updateConnectionStatus(true, connectionDetails.name);
            // 更新服务器信息
            updateServerInfo(true, {
                name: connectionDetails.name,
                host: connectionDetails.host
            });

            // 关闭对话框
            connectionDialog.classList.add('hidden');
            connectionForm.reset();

            // 初始化终端
            const terminalInfo = await initSimpleTerminal(result.sessionId);

            // 保存到会话管理器
            if (terminalInfo) {
                sessionManager.addSession(result.sessionId, generatedId, {
                    term: terminalInfo.term,
                    buffer: '',
                    name: connectionDetails.name
                });
            }

            // 更新连接列表
            await loadConnections();

            // 切换到终端标签
            if (terminalTab) {
                terminalTab.click();
            }
        } else {
            alert(`连接失败: ${result.error}`);
        }
    } catch (error) {
        console.error('连接错误:', error);
        alert(`连接错误: ${error.message}`);
    } finally {
        isConnecting = false;
        removeLoadingOverlay();
    }
}

// 设置SSH数据处理
function setupSSHDataHandler() {
    if (!window.api || !window.api.ssh) {
        console.error('API未初始化，无法设置SSH数据处理');
        return;
    }

    window.api.ssh.onData((event, data) => {
        const dataStr = data.data;
        const sessionId = data.sessionId;

        // 向缓冲区添加数据
        sessionManager.addToBuffer(sessionId, dataStr);

        // 如果是当前会话，更新终端显示
        if (sessionId === currentSessionId && activeTerminal) {
            activeTerminal.write(dataStr);
        }
    });
}

// 设置SSH关闭处理
function setupSSHClosedHandler() {
    if (!window.api || !window.api.ssh || !window.api.ssh.onClosed) {
        console.error('API未初始化，无法设置SSH关闭处理');
        return;
    }

    window.api.ssh.onClosed(async (event, data) => {
        const sessionId = data.sessionId;

        console.log(`SSH连接关闭: ${sessionId}`);

        // 标记为非活跃
        sessionManager.setSessionActive(sessionId, false);

        // 如果是当前活跃会话，清理终端显示
        if (sessionId === currentSessionId) {
            activeTerminal = null;
            currentSessionId = null;
            window.terminalFitAddon = null;

            const terminalContainer = document.getElementById('terminal-container');
            if (terminalContainer) {
                terminalContainer.innerHTML = '';
            }

            const placeholder = document.getElementById('terminal-placeholder');
            if (placeholder) {
                placeholder.classList.remove('hidden');
            }

            updateConnectionStatus(false);
            // 更新服务器信息
            updateServerInfo(false);
        }

        // 更新连接列表
        await loadConnections();
    });
}

// =============================================
// 第5部分：文件管理器功能
// =============================================

// 初始化文件管理器
let remoteFileCache = new Map(); // 远程文件缓存
let localFileCache = new Map(); // 本地文件缓存

async function initFileManager(sessionId) {
    if (!sessionId) {
        console.error('无法初始化文件管理器：未连接到服务器');
        return;
    }

    // 获取会话的远程工作目录
    const remotePath = sessionManager.getRemotePath(sessionId);
    console.log(`初始化文件管理器，使用会话 ${sessionId} 的远程工作目录: ${remotePath}`);

    // 加载远程文件
    loadRemoteFiles(remotePath);

    // 加载本地文件
    if (lastLocalDirectory) {
        loadLocalFiles(lastLocalDirectory);
    } else {
        // 默认加载用户主目录
        window.api.file.getHomeDir().then(homeDir => {
            loadLocalFiles(homeDir);
        });
    }
}

// 加载本地文件
async function loadLocalFiles(directory) {
    try {
        // 如果没有指定目录，则始终请求用户选择新的目录
        if (!directory) {
            const result = await window.api.dialog.selectDirectory();
            if (result.canceled) {
                // 如果用户取消了选择，但之前有使用过的目录，继续使用上一次的目录
                if (lastLocalDirectory) {
                    directory = lastLocalDirectory;
                } else {
                    // 如果之前没有使用过目录，则退出函数
                    return;
                }
            } else {
                directory = result.directoryPath;
            }
        }

        // 记住这个目录供下次使用
        lastLocalDirectory = directory;

        // 更新路径输入框
        const localPathInput = document.getElementById('local-path');
        if (localPathInput) {
            localPathInput.value = directory;
        }

        // 使用真实文件列表API获取文件
        const result = await window.api.file.listLocal(directory);
        if (result && result.success) {
            // 更新缓存
            localFileCache.set(directory, result.files);
            console.log('更新本地文件缓存:', directory);
            
            displayLocalFiles(result.files, directory);
        } else {
            console.error('获取本地文件失败:', result ? result.error : '未知错误');

            // 使用模拟数据作为备用
            const dummyFiles = [
                {name: '..', isDirectory: true, size: 0, modifyTime: new Date()},
                {name: 'Documents', isDirectory: true, size: 0, modifyTime: new Date()},
                {name: 'Downloads', isDirectory: true, size: 0, modifyTime: new Date()},
                {name: 'example.txt', isDirectory: false, size: 1024, modifyTime: new Date()},
                {name: 'image.jpg', isDirectory: false, size: 30720, modifyTime: new Date()}
            ];
            displayLocalFiles(dummyFiles, directory);
        }

    } catch (error) {
        console.error('加载本地文件失败:', error);
    }
}

// 显示本地文件
function displayLocalFiles(files, currentPath) {
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
        sizeCell.textContent = file.isDirectory ? '-' : formatFileSize(file.size);
        row.appendChild(sizeCell);

        // 修改日期列
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(file.modifyTime);
        row.appendChild(dateCell);

        // 添加行点击事件
        if (file.isDirectory) {
            row.addEventListener('dblclick', async () => {
                const newPath = file.name === '..' ?
                    currentPath.substring(0, currentPath.lastIndexOf('/')) || currentPath.substring(0, currentPath.lastIndexOf('\\')) || '/' :
                    `${currentPath}/${file.name}`.replace(/\/\//g, '/');

                await loadLocalFiles(newPath);
            });
        }

        tbody.appendChild(row);
    });
}

// 显示远程文件
function displayRemoteFiles(files, currentPath) {
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

        parentRow.addEventListener('dblclick', () => {
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
            loadRemoteFiles(parentPath);
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
        sizeCell.textContent = file.isDirectory ? '-' : formatFileSize(file.size);
        row.appendChild(sizeCell);

        // 修改日期列
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(file.modifyTime);
        row.appendChild(dateCell);

        // 权限列
        const permCell = document.createElement('td');
        permCell.textContent = formatPermissions(file.permissions);
        row.appendChild(permCell);

        // 添加行点击事件
        if (file.isDirectory) {
            row.addEventListener('dblclick', () => {
                let newPath;
                if (file.name === '..') {
                    newPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                } else {
                    newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                    newPath = newPath.replace(/\/+/g, '/');
                }
                loadRemoteFiles(newPath);
            });
        }

        tbody.appendChild(row);
    });
}

// 加载远程文件
async function loadRemoteFiles(path) {
    if (!currentSessionId) {
        console.error('无法加载远程文件：未连接到服务器');
        return;
    }

    try {
        // 规范化路径
        path = path.replace(/\/+/g, '/');
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        // 显示加载状态
        showFileManagerLoading(true);

        // 更新路径输入框
        const remotePathInput = document.getElementById('remote-path');
        if (remotePathInput) {
            remotePathInput.value = path;
        }

        // 更新会话的远程工作目录
        sessionManager.updateRemotePath(currentSessionId, path);

        const result = await window.api.file.list(currentSessionId, path);
        if (result.success) {
            // 更新缓存
            const cacheKey = `${currentSessionId}:${path}`;
            remoteFileCache.set(cacheKey, result.files);
            console.log('更新远程文件缓存:', cacheKey);
            
            displayRemoteFiles(result.files, path);
        } else {
            console.error('获取远程文件失败:', result.error);
            alert(`无法访问目录 ${path}: ${result.error}`);
        }
    } catch (error) {
        console.error('加载远程文件失败:', error);
        alert(`加载远程文件失败: ${error.message}`);
    } finally {
        // 隐藏加载状态
        showFileManagerLoading(false);
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

// 格式化日期
function formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString();
}

// 格式化权限
function formatPermissions(mode) {
    // 简单实现，实际应根据需求定制
    return mode ? mode.toString(8).slice(-3) : '-';
}

// =============================================
// 第6部分：文件传输功能
// =============================================

// 上传文件
async function uploadFile(localFilePath, remotePath) {
    if (!currentSessionId) {
        alert('请先连接到服务器');
        return;
    }

    try {
        // 显示传输状态栏
        showTransferStatus(true);

        // 设置进度条
        const progressBar = document.getElementById('transfer-progress-bar');
        const transferInfo = document.getElementById('transfer-info');

        progressBar.style.width = '0%';
        transferInfo.textContent = `正在上传: ${path.basename(localFilePath)}`;

        const result = await window.api.file.upload(currentSessionId, localFilePath, remotePath);

        if (result.success) {
            // 上传成功，更新远程文件列表
            progressBar.style.width = '100%';
            transferInfo.textContent = '上传完成';

            // 刷新远程文件列表
            const remotePathInput = document.getElementById('remote-path');
            if (remotePathInput) {
                loadRemoteFiles(remotePathInput.value);
            }

            setTimeout(() => {
                progressBar.style.width = '0%';
                showTransferStatus(false);
            }, 3000);
        } else {
            alert(`上传失败: ${result.error}`);
            transferInfo.textContent = '上传失败';

            setTimeout(() => {
                showTransferStatus(false);
            }, 3000);
        }
    } catch (error) {
        console.error('上传文件失败:', error);
        alert(`上传文件失败: ${error.message}`);
        showTransferStatus(false);
    }
}

// 下载文件
async function downloadFile(remotePath, localFilePath) {
    if (!currentSessionId) {
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
            const fileName = path.basename(remotePath);
            localFilePath = path.join(result.directoryPath, fileName);
        }

        // 显示传输状态栏
        showTransferStatus(true);

        // 设置进度条
        const progressBar = document.getElementById('transfer-progress-bar');
        const transferInfo = document.getElementById('transfer-info');

        progressBar.style.width = '0%';
        transferInfo.textContent = `正在下载: ${path.basename(remotePath)}`;

        const result = await window.api.file.download(currentSessionId, remotePath, localFilePath);

        if (result.success) {
            // 下载成功
            progressBar.style.width = '100%';
            transferInfo.textContent = '下载完成';

            // 刷新本地文件列表
            const localPathInput = document.getElementById('local-path');
            if (localPathInput && localPathInput.value) {
                await loadLocalFiles(localPathInput.value);
            }

            setTimeout(() => {
                progressBar.style.width = '0%';
                showTransferStatus(false);
            }, 3000);
        } else {
            alert(`下载失败: ${result.error}`);
            transferInfo.textContent = '下载失败';

            setTimeout(() => {
                showTransferStatus(false);
            }, 3000);
        }
    } catch (error) {
        console.error('下载文件失败:', error);
        alert(`下载文件失败: ${error.message}`);
        showTransferStatus(false);
    }
}

// 删除远程文件
async function deleteRemoteFile(filePath) {
    if (!currentSessionId) {
        alert('请先连接到服务器');
        return;
    }

    if (!confirm(`确定要删除文件 "${path.basename(filePath)}" 吗？此操作不可恢复！`)) {
        return;
    }

    try {
        showFileManagerLoading(true);

        // 执行删除命令
        const result = await window.api.ssh.execute(currentSessionId, `rm -f "${filePath}"`);

        if (result.success) {
            // 刷新远程文件列表
            const remotePathInput = document.getElementById('remote-path');
            if (remotePathInput) {
                await loadRemoteFiles(remotePathInput.value);
            }
        } else {
            alert(`删除文件失败: ${result.error || '未知错误'}`);
        }
    } catch (error) {
        console.error('删除远程文件失败:', error);
        alert(`删除文件失败: ${error.message}`);
    } finally {
        showFileManagerLoading(false);
    }
}

// 删除远程目录
async function deleteRemoteDirectory(dirPath) {
    if (!currentSessionId) {
        alert('请先连接到服务器');
        return;
    }

    if (!confirm(`确定要删除目录 "${path.basename(dirPath)}" 及其所有内容吗？此操作不可恢复！`)) {
        return;
    }

    try {
        showFileManagerLoading(true);

        // 执行删除命令
        const result = await window.api.ssh.execute(currentSessionId, `rm -rf "${dirPath}"`);

        if (result.success) {
            // 刷新远程文件列表
            const remotePathInput = document.getElementById('remote-path');
            if (remotePathInput) {
                await loadRemoteFiles(remotePathInput.value);
            }
        } else {
            alert(`删除目录失败: ${result.error || '未知错误'}`);
        }
    } catch (error) {
        console.error('删除远程目录失败:', error);
        alert(`删除目录失败: ${error.message}`);
    } finally {
        showFileManagerLoading(false);
    }
}

// 添加文件传输按钮监听
function setupFileTransferListeners() {
    // 右键菜单处理
    const remoteFilesTable = document.getElementById('remote-files');

    if (remoteFilesTable) {
        remoteFilesTable.addEventListener('contextmenu', function (e) {
            // 检查是否点击在文件行上
            const row = e.target.closest('tr');
            if (!row) return;

            // 获取文件名和路径
            const fileName = row.querySelector('td:first-child').textContent.trim().replace(/^.+\s/, '');
            const remotePath = document.getElementById('remote-path').value;
            const fullPath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`;

            // 跳过上级目录
            if (fileName === '..') return;

            // 根据是否为目录创建不同的菜单
            e.preventDefault();

            if (row.classList.contains('directory')) {
                showContextMenu(e.clientX, e.clientY, [
                    {
                        label: '删除目录',
                        action: () => deleteRemoteDirectory(fullPath),
                        className: 'delete'
                    }
                ]);
            } else {
                showContextMenu(e.clientX, e.clientY, [
                    {
                        label: '下载文件',
                        action: () => downloadFile(fullPath),
                        className: 'download'
                    },
                    {
                        label: '删除文件',
                        action: () => deleteRemoteFile(fullPath),
                        className: 'delete'
                    }
                ]);
            }
        });
    }

    const localFilesTable = document.getElementById('local-files');

    if (localFilesTable) {
        localFilesTable.addEventListener('contextmenu', function (e) {
            // 检查是否点击在文件行上
            const row = e.target.closest('tr');
            if (!row) return;

            // 跳过上级目录
            const fileName = row.querySelector('td:first-child').textContent.trim().replace(/^.+\s/, '');
            if (fileName === '..') return;

            // 不处理目录
            if (row.classList.contains('directory')) return;

            // 文件名和路径
            const localPath = document.getElementById('local-path').value;
            const fullPath = path.join(localPath, fileName);

            const remotePath = document.getElementById('remote-path').value;
            const remoteFilePath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`;

            // 创建右键菜单
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, [
                {
                    label: '上传文件',
                    action: () => uploadFile(fullPath, remoteFilePath),
                    className: 'upload'
                }
            ]);
        });
    }
}

// 显示上下文菜单
function showContextMenu(x, y, items) {
    // 删除任何现有菜单
    const oldMenu = document.getElementById('context-menu');
    if (oldMenu) {
        document.body.removeChild(oldMenu);
    }

    // 创建新菜单
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.backgroundColor = '#ffffff';
    menu.style.border = '1px solid #ddd';
    menu.style.borderRadius = '4px';
    menu.style.padding = '5px 0';
    menu.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    menu.style.zIndex = '1000';

    // 添加菜单项
    items.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.textContent = item.label;
        menuItem.style.padding = '8px 12px';
        menuItem.style.cursor = 'pointer';
        menuItem.style.color = '#333';

        if (item.className) {
            menuItem.classList.add(item.className);
        }

        menuItem.addEventListener('click', () => {
            document.body.removeChild(menu);
            item.action();
        });

        menu.appendChild(menuItem);
    });

    // 添加到文档
    document.body.appendChild(menu);

    // 点击其他地方关闭菜单
    document.addEventListener('click', function closeMenu() {
        if (document.body.contains(menu)) {
            document.body.removeChild(menu);
        }
        document.removeEventListener('click', closeMenu);
    });
}

// =============================================
// 第7部分：样式定义
// =============================================

// 终端相关CSS
const terminalCSS = `
.terminal-view {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: #1e1e1e;
    color: #f0f0f0;
    overflow: hidden;
}

.terminal-content {
    position: relative;
    flex: 1;
    overflow: hidden;
    min-height: 0; /* Critical for proper flex sizing */
    display: flex; /* Ensure it fills space */
}

.terminal-container {
    width: 100%;
    height: 100%;
    background-color: #1e1e1e !important;
    flex: 1; /* Fill available space */
    display: flex;
    flex-direction: column;
}

.terminal-container .xterm {
    height: 100%;
    flex: 1;
}

/* Fix terminal layers */
.terminal-container .xterm-screen,
.terminal-container .xterm-viewport {
    width: 100% !important;
    height: 100% !important;
}

/* Remove absolute positioning causing overlays */
.terminal-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #1e1e1e;
    z-index: 10;
}

/* Hide overlays */
.terminal-content > div:not(#terminal-container):not(#terminal-placeholder) {
    display: none !important;
}

/* Terminal tab style fixes */
.terminal-tabs {
    background-color: #252526;
    padding: 4px 4px 0;
    border-bottom: 1px solid #333;
}

.terminal-tab {
    background-color: #2d2d2d;
    color: #ccc;
    border-radius: 4px 4px 0 0;
    padding: 6px 12px;
    font-size: 13px;
}

.terminal-tab.active {
    background-color: #1e1e1e;
    color: #fff;
}

/* Remove any padding in the terminal that might cause gray spaces */
.tab-pane.active {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 0;
    margin: 0;
    overflow: hidden;
}

/* Fix the app-container height */
.app-container {
    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* Ensure main-content is properly sized */
.main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* Fix tab-content height */
.tab-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
`;

// 右键菜单样式
const menuCSS = `
#context-menu {
    position: fixed;
    background-color: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 5px 0;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    z-index: 1000;
}

#context-menu div {
    padding: 8px 12px;
    cursor: pointer;
    color: #333;
    display: flex;
    align-items: center;
    gap: 8px;
}

#context-menu div:hover {
    background-color: #f3f4f6;
}

#context-menu div.download::before {
    content: "";
    display: inline-block;
    width: 16px;
    height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23333333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4'/%3E%3Cpolyline points='7 10 12 15 17 10'/%3E%3Cline x1='12' y1='15' x2='12' y2='3'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
}

#context-menu div.upload::before {
    content: "";
    display: inline-block;
    width: 16px;
    height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23333333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4'/%3E%3Cpolyline points='17 8 12 3 7 8'/%3E%3Cline x1='12' y1='3' x2='12' y2='15'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
}

#context-menu div.delete::before {
    content: "";
    display: inline-block;
    width: 16px;
    height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23333333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='3 6 5 6 21 6'/%3E%3Cpath d='M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2'/%3E%3Cline x1='10' y1='11' x2='10' y2='17'/%3E%3Cline x1='14' y1='11' x2='14' y2='17'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
}
`;

// 额外CSS修复
const extraCSS = `
/* Fix xterm sizing */
.xterm {
    padding: 0;
    margin: 0;
}

/* Remove scrollbar padding */
.xterm-viewport::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}

.xterm-viewport::-webkit-scrollbar-track {
    background: #1e1e1e;
}

.xterm-viewport::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 5px;
}

/* Fix terminal fullscreen issue */
#terminal-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0;
    margin: 0;
    overflow: hidden;
}

/* Override any potential padding from parent elements */
.tab-pane#terminal-tab {
    padding: 0 !important;
    margin: 0 !important;
}

/* Ensure the terminal background color matches */
.tab-pane#terminal-tab, .terminal-view, .terminal-content, .terminal-container {
    background-color: #1e1e1e;
}

/* Make text white in file manager */
.file-manager {
    color: #333;
}

/* Ensure the dropdown menu and search contexts are readable */
.search-box input {
    color: #333;
}
`;

// =============================================
// 第8部分：事件监听和初始化
// =============================================

// 添加连接项点击事件委托
document.addEventListener('click', async function (event) {
    // 删除连接按钮 (必须放在连接项处理前)
    if (event.target.closest('.delete-connection')) {
        const btn = event.target.closest('.delete-connection');
        const id = btn.getAttribute('data-id');

        try {
            if (confirm('确定要删除这个连接吗?')) {
                if (window.api && window.api.config) {
                    const result = await window.api.config.deleteConnection(id);
                    if (result) {
                        loadConnections();
                    }
                }
            }
        } catch (error) {
            console.error('删除连接失败:', error);
        }

        event.stopPropagation();  // 阻止事件冒泡，不触发连接项的事件
        return;
    }
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 添加自定义样式
    const customStyle = document.createElement('style');
    customStyle.textContent = `
      /* 初始化时隐藏终端选项卡内容 */
      #terminal-tab:not(.active) {
        display: none;
      }
      /* 确保终端容器和终端背景颜色一致 */
      .terminal-container, .terminal-container .terminal {
        background-color: #1e1e1e !important;
      }
      
      ${terminalCSS}
      ${menuCSS}
      ${extraCSS}
    `;
    document.head.appendChild(customStyle);

    const placeholder = document.getElementById('terminal-placeholder');
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }

    // 认证方式切换
    if (authTypeSelect) {
        authTypeSelect.addEventListener('change', toggleAuthFields);
        toggleAuthFields(); // 初始设置
    }

    // 浏览私钥文件
    if (browsePrivateKeyBtn) {
        browsePrivateKeyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const result = await window.api.dialog.selectFile();
            if (!result.canceled) {
                document.getElementById('conn-private-key-path').value = result.filePath;
            }
        });
    }

    // 当前活动标签
    let activeTabId = 'terminal';

    // 标签切换 (添加防抖处理)
    tabs.forEach(tab => {
        tab.addEventListener('click', debounce(function () {
            const tabId = tab.getAttribute('data-tab');

            // 避免重复切换到同一个标签
            if (tabId === activeTabId) {
                return;
            }

            // 只有连接成功后才能切换到终端或文件管理
            if ((tabId === 'terminal' || tabId === 'file-manager') && !currentSessionId) {
                alert('请先连接到服务器');
                return;
            }

            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');

            // 更新当前活动标签
            activeTabId = tabId;

            // 如果切换到文件管理，初始化文件列表
            if (tabId === 'file-manager' && currentSessionId) {
                // 检查是否需要重新初始化文件管理器
                const needInit = !fileManagerInitialized || sessionManager.getSessionByConnectionId(currentSessionId)?.sessionId !== currentSessionId;
                
                if (needInit) {
                    // 显示文件管理器的加载中状态
                    showFileManagerLoading(true);
                    // 延迟一点初始化，确保UI更新完成
                    setTimeout(() => {
                        initFileManager(currentSessionId);
                        fileManagerInitialized = true;
                    }, 100);
                }
            }

            // 如果切换到终端标签，调整终端大小
            if (tabId === 'terminal' && activeTerminal) {
                setTimeout(resizeTerminal, 50);
            }
        }, 300)); // 添加300ms的防抖延迟
    });

    // 侧边栏折叠/展开
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            // 侧边栏展开时，隐藏任何可能显示的工具提示
            if (!sidebar.classList.contains('collapsed')) {
                const tooltip = document.getElementById('connection-tooltip');
                if (tooltip) {
                    tooltip.classList.remove('visible');
                }
            }
            // 侧边栏变化后调整终端大小
            setTimeout(resizeTerminal, 300);
        });
    }

    // 新建连接
    newConnectionBtn?.addEventListener('click', () => {
        connectionDialog.classList.remove('hidden');
    });

    // 取消连接
    cancelConnectionBtn?.addEventListener('click', () => {
        connectionDialog.classList.add('hidden');
        connectionForm.reset();
    });

    // 提交连接表单
    connectionForm?.addEventListener('submit', handleConnectionFormSubmit);

    // 加载连接列表
    loadConnections();

    // 设置SSH数据处理
    setupSSHDataHandler();

    // 设置SSH连接关闭处理
    setupSSHClosedHandler();

    // 设置文件传输监听
    setupFileTransferListeners();

    // 设置连接更新监听
    if (window.api && window.api.config && window.api.config.onConnectionsUpdated) {
        window.api.config.onConnectionsUpdated(() => {
            loadConnections();
        });
    }

    // 本地文件浏览按钮
    const browseLocalBtn = document.getElementById('browse-local');
    if (browseLocalBtn) {
        browseLocalBtn.addEventListener('click', async () => {
            await loadLocalFiles(null); // 传递 null 会触发目录选择对话框
        });
    }

    // 远程路径导航按钮
    const goRemotePathBtn = document.getElementById('go-remote-path');
    if (goRemotePathBtn) {
        goRemotePathBtn.addEventListener('click', function () {
            const path = document.getElementById('remote-path').value;
            if (path) {
                // 防止重复点击
                this.disabled = true;
                loadRemoteFiles(path).finally(() => {
                    this.disabled = false;
                });
            }
        });
    }

    // 本地刷新按钮
    const localRefreshBtn = document.getElementById('local-refresh');
    if (localRefreshBtn) {
        localRefreshBtn.addEventListener('click', function () {
            const path = document.getElementById('local-path').value;
            if (path) {
                // 防止重复点击
                this.disabled = true;
                loadLocalFiles(path).finally(() => {
                    this.disabled = false;
                });
            }
        });
    }

    // 远程刷新按钮
    const remoteRefreshBtn = document.getElementById('remote-refresh');
    if (remoteRefreshBtn) {
        remoteRefreshBtn.addEventListener('click', function () {
            const path = document.getElementById('remote-path').value;
            if (path) {
                // 防止重复点击
                this.disabled = true;
                loadRemoteFiles(path).finally(() => {
                    this.disabled = false;
                });
            }
        });
    }

    // 初始化时隐藏传输状态栏
    showTransferStatus(false);

    console.log('应用初始化完成');
});

function updateServerInfo(connected, serverInfo = {}) {
    // 更新主界面中的服务器信息
    const mainServerInfo = document.getElementById('main-server-info');
    if (mainServerInfo) {
        const indicator = mainServerInfo.querySelector('.server-indicator');
        const nameElement = mainServerInfo.querySelector('.server-name');

        if (connected && serverInfo.name) {
            indicator.classList.add('online');
            nameElement.textContent = `${serverInfo.name} (${serverInfo.host})`;
        } else {
            indicator.classList.remove('online');
            nameElement.textContent = '未连接';
        }
    }

    // 更新终端标签中的服务器信息
    const terminalServerInfo = document.getElementById('terminal-server-info');
    if (terminalServerInfo) {
        const indicator = terminalServerInfo.querySelector('.server-indicator');
        const nameElement = terminalServerInfo.querySelector('.server-name');

        if (connected && serverInfo.name) {
            indicator.classList.add('online');
            nameElement.textContent = `${serverInfo.name} (${serverInfo.host})`;
        } else {
            indicator.classList.remove('online');
            nameElement.textContent = '未连接';
        }
    }
}
