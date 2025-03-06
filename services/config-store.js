const Store = require('electron-store');

class ConfigStore {
  constructor() {
    this.store = new Store({
      name: 'ssh-client-config',
      defaults: {
        connections: []
      }
    });
  }

  getConnections() {
    return this.store.get('connections') || [];
  }

  saveConnection(connection) {
    const connections = this.getConnections();

    // If the connection has an ID, update it
    if (connection.id) {
      const index = connections.findIndex(c => c.id === connection.id);
      if (index !== -1) {
        // 保存密码，如果新连接没有密码但是旧连接有密码，保留旧密码
        if (!connection.password && connections[index].password) {
          connection.password = connections[index].password;
        }
        // 同样处理私钥密码
        if (!connection.passphrase && connections[index].passphrase) {
          connection.passphrase = connections[index].passphrase;
        }
        connections[index] = connection;
      } else {
        connections.push(connection);
      }
    } else {
      // New connection - assign an ID
      connection.id = Date.now().toString();
      connections.push(connection);
    }

    this.store.set('connections', connections);
    return connection;
  }

  deleteConnection(id) {
    if (!id) {
      console.error('无效的连接ID');
      return false;
    }

    try {
      const connections = this.getConnections();
      if (!connections || !Array.isArray(connections)) {
        console.error('无法获取连接列表');
        return false;
      }

      const filtered = connections.filter(c => c && c.id !== id);
      this.store.set('connections', filtered);
      return true;
    } catch (error) {
      console.error('删除连接失败:', error);
      return false;
    }
  }
}

module.exports = ConfigStore;
