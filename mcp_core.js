// mcp.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';

// Your existing backend server URL
const EXISTING_SERVER_URL = 'http://localhost:3000';

// Helper function to get API key from environment
function getApiKey() {
    const apiKey = process.env.DROSTE_CV_API_KEY;
    if (!apiKey) {
        throw new Error('CV_API_KEY environment variable not set. Please add your API key to the Claude Desktop configuration.');
    }
    return apiKey;
}

// Helper function to make authenticated requests
async function makeAuthenticatedRequest(url, options = {}) {
    const apiKey = getApiKey();
    
    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    const response = await fetch(url, { ...options, ...defaultOptions });
    
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('API key is invalid or expired. Please check your CV_API_KEY in the Claude Desktop configuration.');
        }
        if (response.status === 403) {
            throw new Error('Insufficient permissions for this operation.');
        }
        throw new Error(`Request failed: ${response.statusText}`);
    }

    return response;
}

// Core functions that make HTTP requests
async function getCvOverview() {
    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/cvs`);
    return await response.json();
}

async function getCvFields(cvId) {
    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/cvs/${cvId}/fields`);
    return await response.json();
}

async function getFieldVersions(fieldId) {
    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/fields/${fieldId}/versions`);
    return await response.json();
}

async function getMedia(key) {
    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/media/secure-url?key=${encodeURIComponent(key)}`);
    const data = await response.json();
    return data.url; // Return the URL directly
}

async function searchCvs(query, type, dateRange) {
    const body = { query };
    if (type) body.fieldType = type;
    if (dateRange) body.dateRange = dateRange;

    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/search/cvs`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    
    return await response.json();
}

async function triggerBackendAction(actionName, payload) {
    const response = await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/action/${actionName}`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
    });
    
    return await response.json();
}

// Define your tools (removed authenticateWithApiKey)
const APP_TOOLS = [
  {
    name: "getCvOverview",
    description: "Fetches an overview of the user's CVs and their fields.",
    inputSchema: {
      type: "object",
      properties: {},
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
    name: "searchCvs",
    description: "Search across all CVs for specific information like companies, skills, certifications, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "Search query (e.g., 'AWS certifications', 'Mercedes', 'Python skills')" 
        },
        type: { 
          type: "string", 
          enum: ["job", "skill", "certification", "education", "all"],
          description: "Filter by field type (optional)"
        },
        dateRange: {
          type: "object",
          properties: {
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" }
          },
          description: "Filter by date range (optional)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "triggerBackendAction",
    description: "Triggers a generic action on the backend server.",
    inputSchema: {
      type: "object",
      properties: {
        actionName: { type: "string", description: "The name of the action to perform." },
        payload: { type: "object", description: "Data payload for the action.", additionalProperties: true }
      },
      required: ["actionName"]
    }
  },
  {
    name: "testTool",
    description: "A simple test tool that just returns a message",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Test message" }
      },
      required: []
    }
  }
];

// Transform APP_TOOLS into the format required for capabilities
const toolCapabilities = {};
APP_TOOLS.forEach(tool => {
  toolCapabilities[tool.name] = {
    description: tool.description,
    inputSchema: tool.inputSchema,
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
  console.error('[MCP] Received list tools request');
  console.error('[MCP] Available tools:', APP_TOOLS.map(t => t.name));
  return {
    tools: APP_TOOLS,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const logMessage = `[${new Date().toISOString()}] Tool call: ${request.params.name} with args: ${JSON.stringify(request.params.arguments)}\n`;
    
    // Write to file
    fs.appendFileSync('/tmp/mcp-debug.log', logMessage);
    
    console.error('[MCP] Tool call received:', request.params.name, 'with args:', JSON.stringify(request.params.arguments));

    const { name, arguments: args } = request.params;
  
    try {
        switch (name) {
            case "getCvOverview":
                return await handleGetCvOverview(args);

            case "getCvFields":
                return await handleGetCvFields(args);
          
            case "getFieldVersions":
                return await handleGetFieldVersions(args);
          
            case "getMedia":
                return await handleGetMedia(args);

            case "triggerBackendAction":
                return await handleTriggerBackendAction(args);

            case "searchCvs":
                return await handleSearchCvs(args);

            case "testTool":
                return await handleTestTool(args);

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

// Simplified handler functions (no auth checks needed)
async function handleGetCvOverview(args) {
    try {
        const data = await getCvOverview();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ data }, null, 2)
                }
            ]
        };
    } catch (error) {
        throw new Error(`Failed to get CV overview: ${error.message}`);
    }
}

async function handleGetCvFields(args) {
    const { cvId } = args;
    
    if (!cvId) {
        throw new Error("cvId is required");
    }

    try {
        console.error('[GET_CV_FIELDS] Fetching fields for CV ID:', cvId);
        const data = await getCvFields(cvId);
        console.error('[GET_CV_FIELDS] Received data:', JSON.stringify(data, null, 2));
        
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(data, null, 2)
                }
            ]
        };
    } catch (error) {
        console.error('[GET_CV_FIELDS] Error:', error);
        throw new Error(`Failed to get CV fields: ${error.message}`);
    }
}

async function handleGetFieldVersions(args) {
    const { fieldId } = args;
    
    if (!fieldId) {
        throw new Error("fieldId is required");
    }

    try {
        console.error('[GET_FIELD_VERSIONS] Fetching versions for field ID:', fieldId);
        const data = await getFieldVersions(fieldId);
        console.error('[GET_FIELD_VERSIONS] Received data:', JSON.stringify(data, null, 2));
        
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(data, null, 2)
                }
            ]
        };
    } catch (error) {
        console.error('[GET_FIELD_VERSIONS] Error:', error);
        throw new Error(`Failed to get field versions: ${error.message}`);
    }
}

async function handleGetMedia(args) {
    console.error('[GET_MEDIA] Function called with args:', JSON.stringify(args, null, 2));

    try {
        if (!args.key) {
            throw new Error("Missing required parameter: key");
        }

        const url = await getMedia(args.key);
        console.error('[GET_MEDIA] Received secure download URL:', url);
        
        return {
            content: [{
                type: "text", 
                text: url
            }]
        };
    } catch (error) {
        throw new Error(`Failed to get media: ${error.message}`);
    }
}

async function handleSearchCvs(args) {
    try {
        if (!args.query) {
            throw new Error("Missing required parameter: query");
        }

        const { query, type, dateRange } = args;
        console.error('[SEARCH_CVS] Search parameters:', { query, type, dateRange });

        const data = await searchCvs(query, type, dateRange);
        console.error('[SEARCH_CVS] Received search results:', JSON.stringify(data, null, 2));
        
        // Format results for better readability
        let formattedResults;
        
        if (Array.isArray(data) && data.length > 0) {
            console.error('[SEARCH_CVS] Formatting results - found', data.length, 'CVs with matches');
            
            formattedResults = {
                searchQuery: query,
                totalResults: data.reduce((sum, cv) => sum + cv.matches.length, 0),
                cvsWithMatches: data.length,
                results: data.map(cv => ({
                    cvTitle: cv.cvTitle,
                    cvId: cv.cvId,
                    matchCount: cv.matches.length,
                    matches: cv.matches.map(match => ({
                        fieldName: match.fieldName,
                        fieldType: match.fieldType,
                        relevanceScore: match.relevanceScore?.toFixed(3),
                        data: match.data
                    }))
                }))
            };
        } else {
            console.error('[SEARCH_CVS] No results found or empty array');
            formattedResults = {
                searchQuery: query,
                totalResults: 0,
                message: "No matches found for your search query."
            };
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(formattedResults, null, 2)
            }]
        };
    } catch (error) {
        console.error('[SEARCH_CVS] ERROR OCCURRED:', error.message);
        throw new Error(`Search failed: ${error.message}`);
    }
}

async function handleTriggerBackendAction(args) {
    const { actionName, payload } = args;
    
    if (!actionName) {
        throw new Error("actionName is required");
    }

    try {
        const data = await triggerBackendAction(actionName, payload);
        
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

async function handleTestTool(args) {
    const message = args.message || "Test successful!";
    return {
        content: [
            {
                type: "text",
                text: message
            }
        ]
    };
}

// Validate setup on startup
async function validateSetup() {
    try {
        const apiKey = getApiKey();
        console.error('✅ API key found in environment');
        
        // Test the API key by making a simple request
        await makeAuthenticatedRequest(`${EXISTING_SERVER_URL}/api/cvs`);
        console.error('✅ API key validation successful');
    } catch (error) {
        console.error('❌ Setup validation failed:', error.message);
        console.error('Please check your CV_API_KEY in Claude Desktop configuration');
    }
}

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[STARTUP] MCP Server starting with automatic API key authentication - VERSION 3.0');
console.error('Server capabilities:', JSON.stringify(server.getCapabilities(), null, 2));

// Validate setup on startup
validateSetup();
