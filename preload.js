const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    ssh: {
        connect: (connectionDetails) => ipcRenderer.invoke('ssh:connect', connectionDetails),
        disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
        execute: (sessionId, command) => ipcRenderer.invoke('ssh:execute', { sessionId, command }),
        sendData: (sessionId, data) => ipcRenderer.invoke('ssh:send-data', { sessionId, data }),
        onData: (callback) => {
            ipcRenderer.on('ssh:data', callback);
            return () => ipcRenderer.removeListener('ssh:data', callback);
        }
    },
    file: {
        list: (sessionId, path) => ipcRenderer.invoke('file:list', { sessionId, path }),
        upload: (sessionId, localPath, remotePath) => ipcRenderer.invoke('file:upload', { sessionId, localPath, remotePath }),
        download: (sessionId, remotePath, localPath) => ipcRenderer.invoke('file:download', { sessionId, remotePath, localPath })
    },
    config: {
        getConnections: () => ipcRenderer.invoke('config:get-connections'),
        saveConnection: (connection) => ipcRenderer.invoke('config:save-connection', connection),
        deleteConnection: (id) => ipcRenderer.invoke('config:delete-connection', id)
    },
    dialog: {
        selectFile: () => ipcRenderer.invoke('dialog:select-file'),
        selectDirectory: () => ipcRenderer.invoke('dialog:select-directory')
    }
});