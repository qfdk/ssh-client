// DOM元素
const newConnectionBtn = document.getElementById('new-connection-btn');
const connectionDialog = document.getElementById('connection-dialog');
const connectionForm = document.getElementById('connection-form');
const cancelConnectionBtn = document.getElementById('cancel-connection');
const tabs = document.querySelectorAll('.tab');
const sidebarToggle = document.querySelector('.toggle-btn');
const sidebar = document.querySelector('.sidebar');
console.log('Renderer script loaded');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('terminal-placeholder').classList.add('hidden');
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

        const connectionDetails = {
            name: document.getElementById('conn-name').value,
            host: document.getElementById('conn-host').value,
            port: parseInt(document.getElementById('conn-port').value),
            username: document.getElementById('conn-username').value,
            password: document.getElementById('conn-password').value
        };

        try {
            const result = await window.api.ssh.connect(connectionDetails);
            if (result.success) {
                // 保存连接
                await window.api.config.saveConnection({
                    ...connectionDetails,
                    password: '' // 不存储明文密码
                });

                // 初始化终端
                initTerminal(result.sessionId, connectionDetails.name);

                // 更新状态
                updateConnectionStatus(true, connectionDetails.name);

                // 关闭对话框
                connectionDialog.classList.add('hidden');
                connectionForm.reset();
            } else {
                alert(`连接失败: ${result.error}`);
            }
        } catch (error) {
            alert(`连接错误: ${error.message}`);
        }
    });
});

// 添加连接项点击事件委托
document.addEventListener('click', function (event) {
    // 点击连接项
    if (event.target.closest('.connection-item')) {
        const connectionItem = event.target.closest('.connection-item');
        const connectionId = connectionItem.dataset.id;
        const connectionName = connectionItem.querySelector('.connection-name').textContent;

        // 连接到服务器
        connectToSavedServer(connectionId, connectionName);
    }

    // 点击删除按钮
    if (event.target.closest('.delete-connection')) {
        const deleteBtn = event.target.closest('.delete-connection');
        const connectionId = deleteBtn.dataset.id;

        if (confirm('确定要删除这个连接吗?')) {
            window.api.config.deleteConnection(connectionId)
                .then(() => {
                    // 从DOM中移除
                    deleteBtn.closest('.connection-item').remove();
                })
                .catch(err => console.error('删除连接失败:', err));
        }

        // 阻止事件冒泡到连接项
        event.stopPropagation();
    }
});

// 连接到已保存的服务器
async function connectToSavedServer(connectionId, connectionName) {
    try {
        // 获取连接详情
        const connections = await window.api.config.getConnections();
        const connectionDetails = connections.find(conn => conn.id === connectionId);

        if (!connectionDetails) {
            console.error('找不到连接详情');
            return;
        }

        // 连接到服务器
        const result = await window.api.ssh.connect(connectionDetails);
        if (result.success) {
            initTerminal(result.sessionId, connectionName);
            updateConnectionStatus(true, connectionName);
        } else {
            alert(`连接失败: ${result.error}`);
        }
    } catch (error) {
        alert(`连接错误: ${error.message}`);
    }
}
window.api.ssh.onData((event, data) => {
    console.log("收到数据:", data);
    if (activeTerminal && data.sessionId === currentSessionId) {
        activeTerminal.write(data.data);
    }
});
// 全局终端实例
let activeTerminal = null;

// 终端初始化函数
function initTerminal(sessionId, name) {
    try {
        // 导入xterm
        const Terminal = require('xterm').Terminal;
        const FitAddon = require('xterm-addon-fit').FitAddon;

        // 隐藏placeholder
        document.getElementById('terminal-placeholder').classList.add('hidden');

        // 获取容器
        const terminalContainer = document.getElementById('terminal-container');
        terminalContainer.innerHTML = '';

        // 创建终端
        activeTerminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#f0f0f0'
            }
        });

        // 添加自适应插件
        const fitAddon = new FitAddon();
        activeTerminal.loadAddon(fitAddon);

        // 打开终端
        activeTerminal.open(terminalContainer);
        fitAddon.fit();

        // 终端数据发送
        activeTerminal.onData(data => {
            window.api.ssh.sendData(sessionId, data)
                .catch(err => console.error('发送数据失败:', err));
        });

        // 创建终端标签
        createTerminalTab(sessionId, name);

        // 监听接收数据
        window.api.ssh.onData((event, data) => {
            if (data.sessionId === sessionId && activeTerminal) {
                activeTerminal.write(data.data);
            }
        });

        // 窗口大小调整时自适应终端
        window.addEventListener('resize', () => fitAddon.fit());

        return activeTerminal;
    } catch (error) {
        console.error('终端初始化失败:', error);
        return null;
    }
}

// 创建终端标签
function createTerminalTab(sessionId, name) {
    const tabsContainer = document.getElementById('terminal-tabs');

    // 清除其他标签的active状态
    document.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // 创建新标签
    const tabElement = document.createElement('div');
    tabElement.className = 'terminal-tab active';
    tabElement.dataset.sessionId = sessionId;
    tabElement.innerHTML = `
    <span>${name}</span>
    <button class="close-tab" data-session-id="${sessionId}">×</button>
  `;

    tabsContainer.appendChild(tabElement);
}

// 更新连接状态
function updateConnectionStatus(connected, name = '') {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');

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