class ConnectionStatus {
	constructor() {
		//
	}

	online(callback) {
		network.onHandleConnect(callback);
		window.addEventListener('online', callback);
	}

	offline(callback) {
		network.onHandleDisconnect(callback);
		window.addEventListener('offline', callback);
	}
}


const connectionStatus = new ConnectionStatus();