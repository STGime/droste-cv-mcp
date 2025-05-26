// mcp_http_server.js
import express from 'express';
import bodyParser from 'body-parser';
import { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js';
import cors from 'cors'; // Import CORS for cross-origin requests
import { InMemoryTransport } from './inMemoryTransport.js';
import { handleLogin, handleGetCvOverview, handleGetCvFields, handleGetFieldVersions, handleGetMedia, handleTriggerBackendAction} from './mcp_core.js'; // Import shared tools

const app = express();
app.use(bodyParser.json());

// Define your tools with their schemas
const APP_TOOLS = [
  {
    name: "loginToMcp",
    description: "Logs the current session into the MCP server to enable access to protected tools.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User's email address." },
        password: { type: "string", description: "User's password." }
      },
      required: ["email", "password"]
    }
  },
  {
    name: "getCvOverview",
    description: "Fetches an overview of the user's CVs and their fields.",
    inputSchema: {
      type: "object",
      properties: {}, // No specific input args needed beyond authentication
      required: []
    }
  },
  {
        name: "getCvFields",
        description: "Fetches all fields for a specific CV by CV ID.",
        inputSchema: {
          type: "object",
          properties: {
            cvId: { type: "string", description: "The CV ID to get fields for." }
          },
          required: ["cvId"]
        }
      },
      {
        name: "getFieldVersions",
        description: "Fetches all versions for a specific field by field ID.",
        inputSchema: {
          type: "object",
          properties: {
            fieldId: { type: "string", description: "The field ID to get versions for." }
          },
          required: ["fieldId"]
        }
      },
      
  {
  name: "getMedia",
  description: "Gets a secure time-limited URL for media files stored in the system.",
  inputSchema: {
    type: "object",
    properties: {
      key: { 
        type: "string", 
        description: "The media key from field details (e.g., 'uploads/user-id/file-id.png')" 
      }
    },
    required: ["key"]
  }
},
  {
    name: "triggerBackendAction",
    description: "Triggers a generic action on the backend server.",
    inputSchema: {
      type: "object",
      properties: {
        actionName: { type: "string", description: "The name of the action to perform." },
        payload: { type: "object", description: "Data payload for the action.", additionalProperties: true } // Allow any object for payload
      },
      required: ["actionName"]
    }
  }
];

app.use(cors());

const mcpServer = new MCPServer({
    tools: APP_TOOLS,
});

const inMemoryTransport = new InMemoryTransport();

// HTTP Auth Middleware
app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    let sessionToken = null;
    let currentUser = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionToken = authHeader.substring(7);
        // Example: Basic token validation
        if (sessionToken === "VALID_TOKEN_123") {
            currentUser = { id: 'user123', name: 'Alice', roles: ['user'] };
        } else if (sessionToken === "ADMIN_TOKEN_789") {
            currentUser = { id: 'admin456', name: 'AdminBob', roles: ['admin', 'user'] };
        }
    }
    // req.mcpContextData will be an object like { sessionToken, currentUser }
    req.mcpContextData = { sessionToken, currentUser };
    next();
});

app.get('/mcp/capabilities', (req, res) => {
    try {
        const capabilities = mcpServer.getCapabilities();
        res.json(capabilities);
    } catch (error) {
        console.error("Error getting capabilities:", error);
        res.status(500).json({ error: 'Failed to get capabilities' });
    }
});

app.post('/', async (req, res) => {
    const mcpRequestPayload = req.body;

    if (!mcpRequestPayload || !mcpRequestPayload.method) {
        return res.status(400).json({ error: "Invalid MCP request payload. 'method' is required." });
    }

    try {
        // This is the plain JavaScript object for your custom context data
        const customContextData = req.mcpContextData; // e.g., { sessionToken, currentUser }

        let actualPayload = { ...mcpRequestPayload };

        // For methods that accept a context (like callTool, and potentially listTools)
        // we pass the context data as a plain object under the 'context' key.
        // The MCP Server will make this available to the tool handlers.
        // Tool handlers often expect custom data under `context.custom`.
        if (mcpRequestPayload.method === 'callTool' && mcpRequestPayload.params) {
            actualPayload.params = {
                ...mcpRequestPayload.params,
                context: { custom: customContextData }, // Pass as plain object
            };
        } else if (mcpRequestPayload.method === 'listTools' && mcpRequestPayload.params) {
            // If your listTools implementation or server uses context for filtering
            actualPayload.params = {
                ...mcpRequestPayload.params,
                context: { custom: customContextData }, // Pass as plain object
            };
        }
        // For other MCP methods, they might not use a 'context' param, or the SDK handles it differently.

        console.log("HTTP Wrapper: Sending to InMemoryTransport:", actualPayload);
        const mcpResponse = await inMemoryTransport.sendRequestToMCP(actualPayload);
        res.json(mcpResponse);
    } catch (error) {
        console.error("Error processing MCP request via HTTP:", error);
        res.status(500).json({
            jsonrpc: "2.0",
            id: mcpRequestPayload.id || null,
            error: { code: -32000, message: error.message || 'Internal Server Error' }
        });
    }
});

const PORT = process.env.PORT || 3001;

async function startHttpServer() {
    try {
        await mcpServer.connect(inMemoryTransport);
        console.log('MCP Server (for HTTP) connected via InMemoryTransport.');
        console.log('MCP Server capabilities:', JSON.stringify(mcpServer.getCapabilities(), null, 2));

        app.listen(PORT, () => {
            console.log(`HTTP wrapper for MCP server listening on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start MCP HTTP server:", error);
        process.exit(1);
    }
}

startHttpServer();