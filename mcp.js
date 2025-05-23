// mcp.js
import { makeAuthenticatedBackendRequest } from './utils/makeAuthenticatedBackendRequest.js';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Your existing backend server URL
const EXISTING_SERVER_URL = 'http://localhost:3000'; // Update this to your actual backend URL

// Store session data (since we can't use HTTP sessions with stdio)
let sessionToken = null;
let currentUser = null;


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

// Transform APP_TOOLS into the format required for capabilities
const toolCapabilities = {};
APP_TOOLS.forEach(tool => {
  toolCapabilities[tool.name] = {
    description: tool.description,
    inputSchema: tool.inputSchema,
    // outputSchema can also be defined here if known
  };
});




const server = new Server(
  {
    name: "cv-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: toolCapabilities,
    },
  }
);

// Define tools in simple MCP format
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  console.error('[MCP] Received tool call request:', JSON.stringify(request, null, 2));
  const { name, arguments: args } = request.params;
  console.error('[MCP] Tool name:', name);
  console.error('[MCP] Tool arguments:', JSON.stringify(args, null, 2));
    return {
    tools: APP_TOOLS,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case "loginToMcp":
        return await handleLogin(args);
      
      case "getCvOverview":
        return await handleGetCvOverview(args);
      
      case "triggerBackendAction":
        return await handleTriggerBackendAction(args);
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Tool handlers
async function handleLogin(args) {
  const { email, password } = args;
  
  if (!email || !password) {
    throw new Error("Missing email or password");
  }

  try {
    console.error('[LOGIN] Attempting login with email:', email);
    // IMPORTANT: Be very careful logging passwords, even in debug.
    // Consider logging only that a password was provided, or a hashed version if relevant.
    // For local debugging, logging the password itself might be acceptable TEMPORARILY.
    // console.debug('[LOGIN] Password provided (length):', password ? password.length : 0); // Safer
    console.error('[LOGIN] Password provided (DO NOT LOG IN PRODUCTION):', password);


    const requestUrl = `${EXISTING_SERVER_URL}/api/auth/login`;
    const requestBody = { email, password };

    console.error('[LOGIN] Sending request to:', requestUrl);
    console.error('[LOGIN] Request method: POST');
    console.error('[LOGIN] Request headers: Content-Type: application/json');
    console.error('[LOGIN] Request body:', JSON.stringify(requestBody));

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.error('[LOGIN] Received response object:', response);
    console.error('[LOGIN] Response status:', response.status);
    console.error('[LOGIN] Response status text:', response.statusText);
    console.error('[LOGIN] Response headers:', Object.fromEntries(response.headers.entries())); // See all headers

    if (!response.ok) {
      let errorData = `Backend responded with status ${response.status}`;
      try {
        // Attempt to parse error response from backend, it might contain useful info
        const backendError = await response.json(); // or response.text() if not JSON
        console.error('[LOGIN] Backend error response (parsed JSON):', backendError);
        errorData = backendError.message || JSON.stringify(backendError); // Adjust based on your backend's error structure
      } catch (parseError) {
        console.warn('[LOGIN] Could not parse backend error response as JSON. Trying as text.');
        try {
            const backendErrorText = await response.text();
            console.error('[LOGIN] Backend error response (text):', backendErrorText);
            errorData = backendErrorText || errorData;
        } catch (textParseError) {
            console.warn('[LOGIN] Could not read backend error response as text.');
        }
      }
      console.error(`[LOGIN] Backend login failed. Status: ${response.status}. Details: ${errorData}`);
      throw new Error(`Backend login failed: ${errorData}`);
    }

    console.error('[LOGIN] Response is OK. Attempting to parse JSON body...');
    const data = await response.json();
    console.error('[LOGIN] Parsed response data:', data);

    // Store session data
    sessionToken = data.accessToken; // Adjust based on your backend response
    currentUser = data.user?.id;   // Adjust based on your backend response (ensure data.user exists)

    console.error('[LOGIN] Session token stored:', sessionToken ? '****** (exists)' : 'NOT SET');
    console.error('[LOGIN] Current user ID stored:', currentUser);

    const displayName = data.user?.name || email; // Use name from user object if available, else fallback to email
    console.error(`[LOGIN] Login successful! Welcome ${displayName}.`);

    return {
      content: [
        {
          type: "text",
          text: `Login successful! Welcome ${displayName}.`
        }
      ]
    };
  } catch (error) {
    console.error('[LOGIN] An error occurred during the login process:', error);
    // Log the stack trace if available, it's very helpful for debugging
    if (error.stack) {
        console.error('[LOGIN] Error stack:', error.stack);
    }
    // The original error message might be more specific than the generic one
    throw new Error(`Login failed: ${error.message}`);
  }
}

async function handleGetCvOverview(args) {
  if (!sessionToken) {
    throw new Error("Please login first using the loginToMcp tool");
  }

  try {
    const response = await fetch(`${EXISTING_SERVER_URL}/api/cvs`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        sessionToken = null; // Clear invalid token
        throw new Error("Authentication expired. Please login again.");
      }
      throw new Error(`Failed to fetch CV overview: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  } catch (error) {
    throw new Error(`Failed to get CV overview: ${error.message}`);
  }
}

async function handleTriggerBackendAction(args) {
  if (!sessionToken) {
    throw new Error("Please login first using the loginToMcp tool");
  }

  const { actionName, payload } = args;
  
  if (!actionName) {
    throw new Error("actionName is required");
  }

  try {
    const response = await fetch(`${EXISTING_SERVER_URL}/action/${actionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {})
    });

    if (!response.ok) {
      if (response.status === 401) {
        sessionToken = null; // Clear invalid token
        throw new Error("Authentication expired. Please login again.");
      }
      throw new Error(`Action failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      content: [
        {
          type: "text",
          text: `Action '${actionName}' completed successfully:\n${JSON.stringify(data, null, 2)}`
        }
      ]
    };
  } catch (error) {
    throw new Error(`Failed to trigger action: ${error.message}`);
  }
}

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('MCP Server connected via stdio');
console.error('MCP Server connected via stdio');
console.error('Server capabilities:', JSON.stringify(server.getCapabilities(), null, 2));