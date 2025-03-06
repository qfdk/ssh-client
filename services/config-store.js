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
