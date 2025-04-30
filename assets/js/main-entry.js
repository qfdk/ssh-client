// main-entry.js
// 应用程序入口文件，导入所有模块并初始化应用

// 导入所有管理器模块
import sessionManager from './session-manager.js';
import terminalManager from './terminal-manager.js';
import fileManager from './file-manager.js';
import connectionManager from './connection-manager.js';
import uiManager from './ui-manager.js';

// 添加自定义样式
function addCustomStyles() {
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
    #context-menu div.create-directory::before {
        content: "";
        display: inline-block;
        width: 16px;
        height: 16px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23374151' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z'/%3E%3Cline x1='12' y1='11' x2='12' y2='17'/%3E%3Cline x1='9' y1='14' x2='15' y2='14'/%3E%3C/svg%3E");
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

    const tooltipCSS = `
    /* Tooltip styles */
    .custom-tooltip {
        position: fixed;
        background-color: #333;
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        max-width: 200px;
        overflow: visible; /* Changed to allow arrow to be visible outside the box */
        margin: 0;
    }

    .custom-tooltip.visible {
        opacity: 1;
    }

    /* Dedicated arrow element */
    .tooltip-arrow {
        position: absolute;
        left: -5px;
        top: 50%;
        width: 0;
        height: 0;
        transform: translateY(-50%);
        border-style: solid;
        border-width: 5px 5px 5px 0;
        border-color: transparent #333 transparent transparent;
    }
    `;
    
    // 添加所有样式
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
      ${tooltipCSS}
    `;
    document.head.appendChild(customStyle);
}

// 初始化应用程序
function initializeApp() {
    console.log('应用初始化开始');
    
    // 添加自定义样式
    addCustomStyles();
    
    // 设置全局变量和引用，使模块能够相互访问
    window.sessionManager = sessionManager;
    window.terminalManager = terminalManager;
    window.fileManager = fileManager;
    window.connectionManager = connectionManager;
    window.uiManager = uiManager;
    window.activeTabId = 'terminal';  // 默认活动标签
    window.currentSessionId = null;   // 当前会话ID
    
    // 初始化UI事件监听
    uiManager.initUIEvents();
    
    // 设置路径输入框的回车键处理
    uiManager.setupEnterKeyHandler('remote-path', path => fileManager.loadRemoteFiles(path));
    uiManager.setupEnterKeyHandler('local-path', path => fileManager.loadLocalFiles(path));
    
    // 设置文件传输监听
    fileManager.setupFileTransferListeners();
    
    // 设置SSH数据处理和连接关闭处理
    connectionManager.setupSSHHandlers();
    
    // 加载连接列表
    connectionManager.loadConnections();
    
    // 设置连接更新监听
    if (window.api && window.api.config && window.api.config.onConnectionsUpdated) {
        window.api.config.onConnectionsUpdated(() => {
            connectionManager.loadConnections();
        });
    }
    
    // 下载进度监听
    if (window.api && window.api.file) {
        window.api.file.onDownloadProgress((event, progressData) => {
            // 更新进度条
            const progressBar = document.getElementById('transfer-progress-bar');
            const transferInfo = document.getElementById('transfer-info');

            if (progressBar && transferInfo) {
                // 显示传输状态
                uiManager.showTransferStatus(true);

                // 更新进度条宽度
                progressBar.style.width = `${progressData.progress}%`;

                // 更新信息文本
                const fileName = fileManager.path.basename(progressData.remotePath);
                const downloadedSize = fileManager.formatFileSize(progressData.downloadedBytes || progressData.completedSize);
                const totalSize = fileManager.formatFileSize(progressData.fileSize || progressData.totalSize);

                transferInfo.textContent = `正在下载: ${fileName} (${progressData.progress}% - ${downloadedSize}/${totalSize})`;

                // 完成后隐藏状态（带延迟）
                if (progressData.progress >= 100) {
                    transferInfo.textContent = '下载完成';
                    setTimeout(() => {
                        progressBar.style.width = '0%';
                        uiManager.showTransferStatus(false);
                    }, 3000);
                }
            }
        });
    }
    
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
                            await connectionManager.loadConnections();
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
    
    // 初始化终端占位符
    const placeholder = document.getElementById('terminal-placeholder');
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }
    
    console.log('应用初始化完成');
}

// 检测es模块兼容性
function isEsModulesSupported() {
    try {
        new Function('import("")');
        return true;
    } catch (err) {
        return false;
    }
}

// 如果不支持ES模块，显示一个错误信息
if (!isEsModulesSupported()) {
    document.body.innerHTML = `
        <div style="padding: 20px; text-align: center; font-family: sans-serif;">
            <h2>浏览器不支持</h2>
            <p>您的浏览器不支持现代JavaScript模块系统，请升级到最新版本的浏览器。</p>
        </div>
    `;
} else {
    // 当文档加载完成时执行初始化
    document.addEventListener('DOMContentLoaded', initializeApp);
}

export {
    sessionManager,
    terminalManager,
    fileManager,
    connectionManager,
    uiManager
};