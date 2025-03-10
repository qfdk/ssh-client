const {contextBridge, ipcRenderer} = require('electron');

// 只暴露基本IPC通信功能
contextBridge.exposeInMainWorld('api', {
    ssh: {
        connect: (connectionDetails) => ipcRenderer.invoke('ssh:connect', connectionDetails),
        disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
        execute: (sessionId, command) => ipcRenderer.invoke('ssh:execute', {sessionId, command}),
        sendData: (sessionId, data) => ipcRenderer.invoke('ssh:send-data', {sessionId, data}),
        resize: (sessionId, cols, rows) => ipcRenderer.invoke('ssh:resize', {sessionId, cols, rows}),
        refreshPrompt: (sessionId) => ipcRenderer.invoke('ssh:refresh-prompt', sessionId),
        activateSession: (sessionId) => ipcRenderer.invoke('ssh:activate-session', sessionId),
        onData: (callback) => {
            const listener = (event, data) => callback(event, data);
            ipcRenderer.on('ssh:data', listener);
            return () => ipcRenderer.removeListener('ssh:data', listener);
        },
        onClosed: (callback) => {
            const listener = (event, data) => callback(event, data);
            ipcRenderer.on('ssh:closed', listener);
            return () => ipcRenderer.removeListener('ssh:closed', listener);
        }
    },
    file: {
        list: (sessionId, path) => ipcRenderer.invoke('file:list', {sessionId, path}),
        listLocal: (directory) => ipcRenderer.invoke('file:list-local', directory),
        getHomeDir: () => ipcRenderer.invoke('file:get-home-dir'),
        upload: (sessionId, localPath, remotePath) => ipcRenderer.invoke('file:upload', {
            sessionId,
            localPath,
            remotePath
        }),
        download: (sessionId, remotePath, localPath) => ipcRenderer.invoke('file:download', {
            sessionId,
            remotePath,
            localPath
        }),
        deleteLocal: (filePath) => ipcRenderer.invoke('file:delete-local', filePath),
        deleteLocalDirectory: (dirPath) => ipcRenderer.invoke('file:delete-local-directory', dirPath),
        createRemoteDirectory: (sessionId, remotePath) => ipcRenderer.invoke('file:create-remote-directory', {
            sessionId,
            remotePath
        }),
        uploadDirectory: (sessionId, localPath, remotePath) => ipcRenderer.invoke('file:upload-directory', {
            sessionId,
            localPath,
            remotePath
        }),
        downloadDirectory: (sessionId, remotePath, localPath) => ipcRenderer.invoke('file:download-directory', {
            sessionId,
            remotePath,
            localPath
        })
    },
    config: {
        getConnections: () => ipcRenderer.invoke('config:get-connections'),
        saveConnection: (connection) => ipcRenderer.invoke('config:save-connection', connection),
        deleteConnection: (id) => ipcRenderer.invoke('config:delete-connection', id),
        onConnectionsUpdated: (callback) => {
            const listener = () => callback();
            ipcRenderer.on('connections:updated', listener);
            return () => ipcRenderer.removeListener('connections:updated', listener);
        }
    },
    dialog: {
        selectFile: () => ipcRenderer.invoke('dialog:select-file'),
        selectDirectory: () => ipcRenderer.invoke('dialog:select-directory')
    }
});
