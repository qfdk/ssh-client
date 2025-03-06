// DOM元素
const newConnectionBtn = document.getElementById('new-connection-btn');
const connectionDialog = document.getElementById('connection-dialog');
const connectionForm = document.getElementById('connection-form');
const cancelConnectionBtn = document.getElementById('cancel-connection');
const tabs = document.querySelectorAll('.tab');
const sidebarToggle = document.querySelector('.toggle-btn');
const sidebar = document.querySelector('.sidebar');

// 全局变量
let activeTerminal = null;
let currentSessionId = null;
let connectionStore = new Map(); // 存储已连接的会话信息

console.log('Renderer script loaded');

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
                    fontSize: 14,
                    fontFamily: 'Menlo, monospace',
                    theme: {
                        background: '#1e1e1e',
                        foreground: '#f0f0f0'
                    },
                    ...options
                });

                // 创建fit插件
                const fitAddon = new FitAddon.FitAddon();
                term.loadAddon(fitAddon);

                term.open(container);
                fitAddon.fit();

                resolve({ term, fitAddon });
            } catch (error) {
                reject(error);
            }
        };

        xtermScript.onerror = reject;
        fitScript.onerror = reject;
    });
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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    const placeholder = document.getElementById('terminal-placeholder');
    if (placeholder) {
        placeholder.classList.add('hidden');
    }

    // 标签切换
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');

            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });

    // 侧边栏折叠/展开
    sidebarToggle?.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

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
    connectionForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        try {
            const connectionDetails = {
                name: document.getElementById('conn-name').value,
                host: document.getElementById('conn-host').value,
                port: parseInt(document.getElementById('conn-port').value),
                username: document.getElementById('conn-username').value,
                password: document.getElementById('conn-password').value
            };

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

                const savedConnection = await window.api.config.saveConnection({
                    ...connectionDetails,
                    password: '',
                    sessionId: result.sessionId,
                    id: generatedId
                });

                // 更新状态
                updateConnectionStatus(true, connectionDetails.name);

                // 关闭对话框
                connectionDialog.classList.add('hidden');
                connectionForm.reset();

                // 初始化终端
                initSimpleTerminal(result.sessionId);

                // 更新连接列表
                await loadConnections();

                // 切换到终端标签
                const terminalTab = document.querySelector('.tab[data-tab="terminal"]');
                if (terminalTab) {
                    terminalTab.click();
                }
            } else {
                alert(`连接失败: ${result.error}`);
            }
        } catch (error) {
            console.error('连接错误:', error);
            alert(`连接错误: ${error.message}`);
        }
    });

    // 加载连接列表
    loadConnections();

    // 设置SSH数据处理
    setupSSHDataHandler();
});

// 设置SSH数据处理
function setupSSHDataHandler() {
    if (!window.api || !window.api.ssh) {
        console.error('API未初始化，无法设置SSH数据处理');
        return;
    }

    window.api.ssh.onData((event, data) => {
        if (activeTerminal && data.sessionId === currentSessionId) {
            console.log('收到数据:', data.data.length);
            activeTerminal.write(data.data);
        }
    });
}

// 加载连接列表
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
                const item = document.createElement('div');
                item.className = 'connection-item';
                item.setAttribute('data-id', connection.id);

                item.innerHTML = `
          <div class="connection-status-indicator ${connection.sessionId ? 'online' : 'offline'}"></div>
          <div class="connection-name">${connection.name}</div>
          <div class="connection-actions">
            <button class="icon-button delete-connection" data-id="${connection.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        `;

                connectionList.appendChild(item);
            });
        } else {
            connectionList.innerHTML = '<div class="no-connections">没有保存的连接</div>';
        }
    } catch (error) {
        console.error('加载连接失败:', error);
    }
}

// 简化版终端初始化
async function initSimpleTerminal(sessionId) {
    try {
        const container = document.getElementById('terminal-container');
        if (!container) {
            console.error('找不到终端容器');
            return;
        }

        container.innerHTML = '';

        // 使用动态加载xterm.js的方式创建终端
        const { term } = await createXterm('terminal-container');
        activeTerminal = term;

        // 终端接收输入并发送
        activeTerminal.onData(data => {
            if (window.api && window.api.ssh) {
                window.api.ssh.sendData(sessionId, data)
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
    } catch (error) {
        console.error('初始化终端失败:', error);
    }
}

// 创建终端标签
function createTerminalTab(sessionId) {
    const tabsContainer = document.getElementById('terminal-tabs');
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
}

// 添加连接项点击事件委托
document.addEventListener('click', async function(event) {
    // 点击连接项
    if (event.target.closest('.connection-item')) {
        const item = event.target.closest('.connection-item');
        const id = item.getAttribute('data-id');
        connectToSaved(id);
    }

    // 点击删除按钮
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

        event.stopPropagation();
    }

    // 点击关闭终端
    if (event.target.closest('.close-tab')) {
        const closeBtn = event.target.closest('.close-tab');
        const sessionId = closeBtn.getAttribute('data-session-id');

        if (sessionId) {
            try {
                await window.api.ssh.disconnect(sessionId);
                activeTerminal = null;
                currentSessionId = null;

                const terminalContainer = document.getElementById('terminal-container');
                if (terminalContainer) {
                    terminalContainer.innerHTML = '';
                }

                const placeholder = document.getElementById('terminal-placeholder');
                if (placeholder) {
                    placeholder.classList.remove('hidden');
                }

                updateConnectionStatus(false);
            } catch (error) {
                console.error('断开连接失败:', error);
            }
        }
    }
});

// 连接到已保存的服务器
async function connectToSaved(id) {
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

        const result = await window.api.ssh.connect(connection);
        if (result.success) {
            currentSessionId = result.sessionId;

            // 更新连接信息
            await window.api.config.saveConnection({
                ...connection,
                sessionId: result.sessionId
            });

            // 初始化终端
            initSimpleTerminal(result.sessionId);

            // 更新状态
            updateConnectionStatus(true, connection.name);

            // 更新连接列表
            await loadConnections();

            // 切换到终端标签
            const terminalTab = document.querySelector('.tab[data-tab="terminal"]');
            if (terminalTab) {
                terminalTab.click();
            }
        } else {
            alert(`连接失败: ${result.error}`);
        }
    } catch (error) {
        console.error('连接错误:', error);
        alert(`连接错误: ${error.message}`);
    }
}
