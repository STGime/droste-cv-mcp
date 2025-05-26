// inMemoryTransport.js
import { EventEmitter } from 'events';

export class InMemoryTransport extends EventEmitter {
    constructor() {
        super();
        this.serverMessageHandler = null; // Handler provided by MCP Server via onMessage
        this.pendingRequests = new Map(); // To correlate requests and responses
        this.isStarted = false;
        console.log('InMemoryTransport: constructor()');
    }

    // Called by MCP Server to initialize the connection with this transport.
    async connect(serverInstance) {
        // serverInstance is the MCP Server itself.
        // We don't do much here for in-memory, but it's part of the interface.
        console.log('InMemoryTransport: connect() called by MCP Server.');
        // The server will subsequently call onMessage() to register its handler.
        return Promise.resolve();
    }

    // Called by MCP Server to tell the transport to "start listening/processing".
    // For stdio, this might mean starting to read stdin.
    // For WebSocket, it means the WebSocket server is ready.
    // For us, it just means we are ready to receive requests via sendRequestToMCP.
    async start() {
        if (this.isStarted) {
            console.warn('InMemoryTransport: start() called but already started.');
            return Promise.resolve();
        }
        console.log('InMemoryTransport: start() called by MCP Server.');
        this.isStarted = true;
        // No actual "listening" needs to happen here for in-memory,
        // as messages will be pushed via sendRequestToMCP.
        return Promise.resolve();
    }

    async stop() {
        console.log('InMemoryTransport: stop() called.');
        this.isStarted = false;
        this.pendingRequests.clear();
        // Potentially notify any pending requests with an error
        return Promise.resolve();
    }

    // Called by MCP Server to disconnect. (Often called stop() or close() in other SDKs)
    async disconnect() {
        console.log('InMemoryTransport: disconnect() called by MCP Server.');
        await this.stop(); // Ensure we also stop if disconnect is called.
        return Promise.resolve();
    }

    // Called by MCP Server to register ITS message handler with THIS transport.
    // When this transport "receives" a message (via sendRequestToMCP),
    // it will pass it to this handler.
    onMessage(handler) {
        console.log('InMemoryTransport: onMessage() handler registered by MCP Server.');
        this.serverMessageHandler = handler;
    }

    // Called by MCP Server when IT wants to send a message (e.g., a response to a tool call).
    // This transport needs to route this message back to the original HTTP request.
    sendMessage(message) {
        console.log('InMemoryTransport: sendMessage() called by MCP Server with:', JSON.stringify(message));
        if (!message) {
            console.error('InMemoryTransport: sendMessage received null or undefined message from MCP Server.');
            return;
        }

        const requestId = message.id;
        if (requestId && this.pendingRequests.has(requestId)) {
            const { resolve, reject } = this.pendingRequests.get(requestId);
            if (message.error) {
                // Construct a proper error object if possible
                const error = new Error(message.error.message || 'MCP Server Error');
                error.code = message.error.code;
                error.data = message.error.data;
                reject(error);
            } else {
                resolve(message.result !== undefined ? message.result : message);
            }
            this.pendingRequests.delete(requestId);
        } else if (!requestId && message.method) {
            // This is likely a notification from the server (e.g., log, progress)
            console.warn('InMemoryTransport: Received notification (unhandled in this example):', message);
            this.emit('notification', message); // For potential subscribers
        } else if (requestId && !this.pendingRequests.has(requestId)) {
            console.error(`InMemoryTransport: Received message for unknown request ID '${requestId}':`, message);
        } else {
            console.warn('InMemoryTransport: Received message with no matching pending request or ID:', message);
        }
    }

    // ---- Custom method for our HTTP wrapper ----
    // This is called by the HTTP request handler to send a request TO the MCP Server.
    async sendRequestToMCP(mcpRequestPayload) {
        if (!this.isStarted) {
            return Promise.reject(new Error("InMemoryTransport: Transport not started. Cannot send request."));
        }
        if (!this.serverMessageHandler) {
            return Promise.reject(new Error("InMemoryTransport: MCP Server message handler not registered. Cannot send request."));
        }

        // Ensure payload has method; jsonrpc and id will be added
        if (!mcpRequestPayload.method) {
             return Promise.reject(new Error("InMemoryTransport: mcpRequestPayload must have a 'method' property."));
        }

        const messageId = mcpRequestPayload.id || `http-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const fullMcPRequest = {
            jsonrpc: "2.0",
            id: messageId,
            method: mcpRequestPayload.method,
            params: mcpRequestPayload.params || {}, // Ensure params is at least an empty object
        };

        console.log(`InMemoryTransport: sendRequestToMCP() [ID: ${messageId}] sending to MCP Server:`, JSON.stringify(fullMcPRequest));

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(messageId, { resolve, reject, timestamp: Date.now() });

            // Simulate the transport "receiving" a message from the "outside world" (i.e., our HTTP handler)
            // and passing it to the MCP Server's registered handler.
            // The MCP Server will process it and eventually call this.sendMessage() (implemented above)
            // with the response, which will then resolve/reject this promise.
            try {
                // The serverMessageHandler expects the raw JSON-RPC message string or object.
                // Let's assume it can handle an object directly.
                this.serverMessageHandler(fullMcPRequest);
            } catch (e) {
                console.error(`InMemoryTransport: Error directly invoking serverMessageHandler for ID ${messageId}:`, e);
                this.pendingRequests.delete(messageId);
                reject(e);
            }

            // Optional: Timeout for pending requests
            setTimeout(() => {
                if (this.pendingRequests.has(messageId)) {
                    const { reject: rejectTimeout } = this.pendingRequests.get(messageId);
                    this.pendingRequests.delete(messageId);
                    console.error(`InMemoryTransport: Request ID ${messageId} timed out.`);
                    rejectTimeout(new Error(`Request timed out for ID ${messageId}`));
                }
            }, 30000); // 30-second timeout
        });
    }
}