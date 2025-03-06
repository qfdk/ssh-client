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
    return this.store.get('connections');
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
    const connections = this.getConnections();
    const filtered = connections.filter(c => c.id !== id);
    this.store.set('connections', filtered);
    return true;
  }
}

module.exports = ConfigStore;