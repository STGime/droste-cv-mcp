// mcp.js
const express = require('express');
const session = require('express-session'); 
const cors = require('cors'); 


// If using Node.js < v18, uncomment the next line:
// const fetch = require('node-fetch');

const app = express();
const MCP_PORT = 3001; // Make sure this is different from your existing server's port
const EXISTING_SERVER_URL = 'http://localhost:3000';


// --- CORS Configuration ---
// Allow requests specifically from the Cloudflare Playground origin
const corsOptions = {
    origin: 'https://playground.ai.cloudflare.com', // <--- IMPORTANT: Be specific for security
    credentials: true, // <--- IMPORTANT: Allow cookies to be sent and received
    optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions)); // <--- USE THE MIDDLEWARE *BEFORE* YOUR ROUTES

// --- Session Configuration ---
app.use(session({
    secret: 'your-very-strong-mcp-secret-key', // Change this to a random, strong secret
    resave: false,
    saveUninitialized: false, // Don't create session until something stored
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
        httpOnly: true, // Prevents client-side JS from reading the cookie
        maxAge: 24 * 60 * 60 * 1000 // 24 hours, for example
    }
    // For production, you'd configure a session store here, e.g., RedisStore
}));

// Middleware to parse JSON request bodies (if your MCP tools will accept JSON input)
app.use(express.json());

// --- Define your MCP Tool Endpoints Here ---
// --- MCP Authentication Endpoints ---

// ASSUMPTION: Your backend has a POST /auth/login endpoint that accepts
// { username, password } and returns { accessToken, refreshToken, message }
// mcp.js
// ...
app.post('/mcp/auth/login', async (req, res) => {
    const { email, password } = req.body; // CHANGED: Expect email, password

    if (!email || !password) { // CHANGED: Check for email
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        console.log(`MCP: Attempting login to backend: ${EXISTING_SERVER_URL}/auth/login with email: ${email}`);
        const loginResponse = await fetch(`${EXISTING_SERVER_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }) // CHANGED: Send email, password to backend
        });

        const responseContentType = loginResponse.headers.get('content-type');
        let loginData;

        if (responseContentType && responseContentType.includes('application/json')) {
            loginData = await loginResponse.json();
        } else {
            const responseText = await loginResponse.text();
            console.error('Backend did not return JSON. Status:', loginResponse.status);
            console.error('Backend Content-Type:', responseContentType);
            console.error('Backend raw response:', responseText.substring(0, 500) + '...');
            return res.status(loginResponse.status || 500).json({
                error: 'MCP login process failed: Backend returned non-JSON response.',
                details: `Backend status: ${loginResponse.status}. Response type: ${responseContentType}. Check MCP server logs for more details.`,
                backendResponseSnippet: responseText.substring(0, 200) + '...'
            });
        }

        if (!loginResponse.ok) {
            console.error('Backend login failed:', loginData || 'No JSON body parsed');
            return res.status(loginResponse.status).json({
                error: 'Backend login failed',
                details: (loginData && loginData.message) ? loginData.message : `Status: ${loginResponse.statusText} - Check backend response details.`
            });
        }

        // Store backend tokens in the MCP session
        req.session.accessToken = loginData.accessToken;
        req.session.refreshToken = loginData.refreshToken;
        req.session.user = loginData.user || { email }; // Store user info from backend if available

        console.log(`User ${email} logged into MCP and backend successfully.`); // CHANGED
        res.json({ message: 'MCP login successful', user: req.session.user });

    } catch (error) {
        console.error('Error during MCP login (fetch or other critical error):', error.message);
        console.error(error.stack);
        res.status(500).json({ error: 'MCP login process failed', details: error.message });
    }
});
// ...

app.post('/mcp/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.clearCookie('connect.sid'); // Default session cookie name
        res.json({ message: 'MCP logout successful' });
    });
});

// Middleware to protect MCP tool endpoints
const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.accessToken) {
        return next();
    }
    res.status(401).json({ error: 'MCP authentication required. Please login via /mcp/auth/login.' });
};



// Example Tool 1: Get some data from the existing server and process it
app.get('/mcp/tools/data-summary', ensureAuthenticated, async (req, res) => { // Added ensureAuthenticated
    try {
        // Use the helper function
        const response = await makeAuthenticatedBackendRequest(req, 'GET', '/api/some-data'); // Replace with your actual endpoint

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching from existing server: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();

        const summary = {
            itemCount: data.length,
            firstItemName: data.length > 0 ? data[0].name : 'N/A',
        };
        res.json(summary);
    } catch (error) {
        console.error('Error in /mcp/tools/data-summary:', error.message);
        // Distinguish between MCP auth errors and backend errors
        if (error.message.includes("MCP user not authenticated")) {
            res.status(401).json({ error: 'MCP authentication required.', details: error.message });
        } else if (error.message.includes("Backend token refresh failed")) {
            res.status(401).json({ error: 'Backend authentication failed. Please try logging in to MCP again.', details: error.message });
        }
         else {
            res.status(500).json({ error: 'Failed to process data summary', details: error.message });
        }
    }
});

// Example Tool 2: Trigger an action on the existing server (e.g., a POST request)
app.post('/mcp/tools/trigger-action', ensureAuthenticated, async (req, res) => { // Added ensureAuthenticated
    try {
        const actionPayload = req.body;

        // Use the helper function
        const response = await makeAuthenticatedBackendRequest(req, 'POST', '/api/perform-action', actionPayload); // Replace with your actual endpoint

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Error triggering action on existing server: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const result = await response.json();
        res.json({ message: 'Action triggered successfully', result });

    } catch (error) {
        console.error('Error in /mcp/tools/trigger-action:', error.message);
        if (error.message.includes("MCP user not authenticated")) {
            res.status(401).json({ error: 'MCP authentication required.', details: error.message });
        } else if (error.message.includes("Backend token refresh failed")) {
            res.status(401).json({ error: 'Backend authentication failed. Please try logging in to MCP again.', details: error.message });
        }
         else {
            res.status(500).json({ error: 'Failed to trigger action', details: error.message });
        }
    }
});

// --- NEW TOOL: Get CV Overview ---
app.get('/mcp/tools/cv-overview', ensureAuthenticated, async (req, res) => {
    try {
        console.log('MCP: User requesting CV overview.');

        // 1. Fetch the list of CVs for the user
        // Backend endpoint: GET {{baseURL}}/cvs where baseURL is http://localhost:3000/api
        // So the path for makeAuthenticatedBackendRequest will be '/api/cvs'
        console.log('MCP: Fetching CVs list from backend.');
        const cvsListResponse = await makeAuthenticatedBackendRequest(req, 'GET', '/api/cvs');

        if (!cvsListResponse.ok) {
            const errorText = await cvsListResponse.text();
            throw new Error(`Error fetching CVs list from backend: ${cvsListResponse.status} ${cvsListResponse.statusText} - ${errorText}`);
        }
        const cvsList = await cvsListResponse.json();

        if (!Array.isArray(cvsList)) {
            console.error("Backend /api/cvs did not return an array:", cvsList);
            throw new Error('Unexpected data format for CV list from backend. Expected an array.');
        }
        console.log(`MCP: Received ${cvsList.length} CVs from backend.`);

        // 2. For each CV, fetch its fields
        const cvsWithFieldsPromises = cvsList.map(async (cv) => {
            if (!cv || typeof cv.id !== 'string') {
                console.warn('MCP: Skipping CV due to missing or invalid ID:', cv);
                return { ...cv, fields: [], error: 'CV object missing or has invalid ID' };
            }
            try {
                // Backend endpoint: GET {{baseURL}}/cvs/{{userCvId}}/fields
                // Path for makeAuthenticatedBackendRequest: `/api/cvs/${cv.id}/fields`
                console.log(`MCP: Fetching fields for CV ID: ${cv.id}`);
                const fieldsResponse = await makeAuthenticatedBackendRequest(req, 'GET', `/api/cvs/${cv.id}/fields`);

                if (!fieldsResponse.ok) {
                    const errorText = await fieldsResponse.text();
                    console.error(`MCP: Error fetching fields for CV ${cv.id}: ${fieldsResponse.status} ${fieldsResponse.statusText} - Snippet: ${errorText.substring(0,100)}`);
                    // Return the CV info with an error message for its fields
                    return { ...cv, fields: [], error_fetching_fields: `Failed: ${fieldsResponse.statusText}` };
                }
                const fieldsData = await fieldsResponse.json();
                return { ...cv, fields: Array.isArray(fieldsData) ? fieldsData : [] }; // Ensure fields is an array
            } catch (fieldError) {
                console.error(`MCP: Exception while fetching fields for CV ${cv.id}:`, fieldError.message);
                return { ...cv, fields: [], error_fetching_fields: `Exception: ${fieldError.message}` };
            }
        });

        // Wait for all field fetching promises to resolve
        const cvsWithDetails = await Promise.all(cvsWithFieldsPromises);

        res.json(cvsWithDetails);

    } catch (error) {
        console.error('Error in /mcp/tools/cv-overview:', error.message, error.stack);
        if (error.message.includes("MCP user not authenticated")) {
            res.status(401).json({ error: 'MCP authentication required.', details: error.message });
        } else if (error.message.includes("Backend token refresh failed")) {
            res.status(401).json({ error: 'Backend authentication failed. Please try logging in to MCP again.', details: error.message });
        } else {
            res.status(500).json({ error: 'Failed to process CV overview', details: error.message });
        }
    }
});



// Basic health check for the MCP server itself
app.get('/mcp/health', (req, res) => {
    res.json({ status: 'MCP Server is UP', timestamp: new Date().toISOString() });
});


// mcp.js
// ... (other requires, cors, session, express.json) ...

// --- MCP Core/Handshake Endpoints ---

// POST handler for the root path - NOW JSON-RPC 2.0 COMPLIANT
// mcp.js
// ... (other requires, cors, session, express.json) ...

// --- MCP Core/Handshake Endpoints ---

// mcp.js
// ... (other requires, cors, session, express.json) ...

// --- MCP Core/Handshake Endpoints ---

// --- Define your tools array centrally so it can be reused ---
const mcpToolDefinitions = [
    {
        // --- Fields expected by use-mcp-react-client ---
        name: "getCvOverview", // Derived from operationId or a unique name
        description: "Fetches an overview of the user's CVs and their fields.", // From openapi.info.description or operation description
        inputSchema: { // For GET with no query params, or if params are handled by path
            type: "object",
            properties: {}, // No specific input parameters expected for this simple GET
            required: []
        },
        // outputSchema: { /* Define schema for the response array here if client expects it */ },

        // --- Original MCP ToolDefinition structure ---
        id: "cv_overview_tool_v1", // Your internal ID
        type: "openapi",
        openapi: {
            openapi: "3.0.0",
            info: {
                title: "CV Overview Tool",
                version: "v1.0.0",
                description: "Fetches an overview of the user's CVs and their fields." // Source for top-level description
            },
            paths: {
                "/mcp/tools/cv-overview": {
                    get: {
                        summary: "Get User's CVs and Fields Overview",
                        operationId: "getCvOverview", // Source for top-level name
                        description: "Fetches a list of all CVs for the user and their fields.", // Can also be source for top-level description
                        // No parameters defined in this example, so inputSchema is simple
                        responses: {
                            '200': {
                                description: "Successfully retrieved the CV overview.",
                                content: { "application/json": { schema: { type: "array", items: {type: "object"} /* your detailed array schema */ } } }
                            },
                            '401': { description: "MCP Authentication Required" }
                        }
                    }
                }
            }
        }
    },
    {
        // --- Fields expected by use-mcp-react-client ---
        name: "triggerBackendAction",
        description: "Triggers a generic action on the backend server.",
        inputSchema: { // Derived from openapi.paths["/mcp/tools/trigger-action"].post.requestBody.content["application/json"].schema
            type: "object",
            properties: {
                // Define properties based on your actual requestBody schema
                actionName: { type: "string", description: "The name of the action to perform." },
                payload: { type: "object", description: "Data payload for the action." }
            },
            required: ["actionName"] // Example: if actionName is required
        },
        // outputSchema: { /* Define schema for the response here if client expects it */ },

        // --- Original MCP ToolDefinition structure ---
        id: "trigger_action_tool_v1",
        type: "openapi",
        openapi: {
            openapi: "3.0.0",
            info: {
                title: "Trigger Action Tool",
                version: "v1.0.0",
                description: "Triggers a generic action on the backend server."
            },
            paths: {
                "/mcp/tools/trigger-action": {
                    post: {
                        summary: "Trigger Backend Action",
                        operationId: "triggerBackendAction",
                        description: "Sends a payload to the backend to perform an action.",
                        requestBody: {
                            required: true,
                            content: {
                                "application/json": {
                                    schema: { // This is the source for the top-level inputSchema
                                        type: "object",
                                        properties: {
                                            actionName: { type: "string", description: "The name of the action to perform." },
                                            payload: { type: "object", description: "Data payload for the action." }
                                        },
                                        required: ["actionName"]
                                    }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: "Action triggered successfully.",
                                content: { "application/json": { schema: { type: "object" /* your detailed response schema */ } } }
                            },
                            '401': { description: "MCP Authentication Required" }
                        }
                    }
                }
            }
        }
    },
    // In mcpToolDefinitions
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
    },
    // outputSchema: { type: "object", properties: { message: {type: "string"}, user: {type: "object"} } },
    id: "mcp_login_tool_v1",
    type: "openapi",
    openapi: {
        openapi: "3.0.0",
        info: { title: "MCP Login Tool", version: "v1.0.0", description: "Logs into the MCP server." },
        paths: {
            "/mcp/auth/login": { // Uses your existing MCP login endpoint
                post: {
                    summary: "Login to MCP",
                    operationId: "loginToMcp",
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        email: { type: "string" },
                                        password: { type: "string" }
                                    },
                                    required: ["email", "password"]
                                }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: "MCP login successful.",
                            content: { "application/json": { schema: { /* schema for your /mcp/auth/login response */ } } }
                        },
                        '400': { description: "Missing credentials" },
                        '401': { description: "Backend login failed" }
                    }
                }
            }
        }
    }
}
];


app.post('/', async (req, res) => {
    console.log('MCP: POST / hit by client (expecting JSON-RPC).');
    const clientRpcRequest = req.body; // req.body is parsed by express.json() middleware

    // Validate basic JSON-RPC structure of the request
    if (!clientRpcRequest || clientRpcRequest.jsonrpc !== "2.0" || typeof clientRpcRequest.method !== 'string') {
        console.error('MCP: Invalid JSON-RPC request structure received:', JSON.stringify(clientRpcRequest, null, 2));
        // Send a JSON-RPC error response for invalid request structure
        // Note: If clientRpcRequest.id is not available, we can't echo it.
        // JSON-RPC spec says if id is not present, it's a notification OR an error.
        // If it's an error state (like invalid JSON-RPC), id might be null.
        const errorRpcId = (clientRpcRequest && typeof clientRpcRequest.id !== 'undefined') ? clientRpcRequest.id : null;
        return res.status(200).json({ // HTTP 200, but JSON-RPC error
            jsonrpc: "2.0",
            id: errorRpcId,
            error: {
                code: -32600, // Invalid Request
                message: "Invalid JSON-RPC request structure."
            }
        });
    }

    const rpcId = typeof clientRpcRequest.id !== 'undefined' ? clientRpcRequest.id : null; // Can be string, number, or null
    const clientMethod = clientRpcRequest.method;

    console.log('MCP: POST / request body (validated):', JSON.stringify(clientRpcRequest, null, 2));
    console.log(`MCP: Received client RPC ID: ${rpcId}, Method: ${clientMethod}`);

    let jsonRpcResponse; // This will hold the complete JSON-RPC response object

    if (clientMethod === 'initialize') {
        const resultPayload = {
            protocolVersion: "2025-03-26", // Use the version your server aims to comply with
            capabilities: {
                tool_protocol: {
                    type: "openapi_v3",
                    discovery: ["initialize_response", "rpc_method"],
                    list_method: "tools/list"
                },
                authentication: {
                    type: "session_cookie",
                    login_path: "/mcp/auth/login",
                    logout_path: "/mcp/auth/logout"
                },
                event_stream: {
                    type: "sse",
                    path: "/" // GET / for SSE
                },
                message_formats: [
                    { protocol: "json-rpc", version: "2.0", transport: "http_post", path: "/" },
                    { protocol: "sse", transport: "http_get", path: "/" }
                ]
            },
            serverInfo: {
                name: "DrosteCV MCP Server",
                version: "1.0.0"
            },
            tools: mcpToolDefinitions // Use the centrally defined tools array
        };
        console.log('MCP: "initialize" method processed.');
        // console.log('MCP: Constructed resultPayload for initialize:', JSON.stringify(resultPayload, null, 2)); // Can be verbose

        jsonRpcResponse = {
            jsonrpc: "2.0",
            id: rpcId,
            result: resultPayload
        };

    } else if (clientMethod === 'tools/list') {
        console.log('MCP: "tools/list" method processed.');
        jsonRpcResponse = {
            jsonrpc: "2.0",
            id: rpcId,
            result: { // As per MCP Spec: ToolsListResult object
                tools: mcpToolDefinitions
            }
        };

    } else if (clientMethod === 'notifications/initialized') {
        console.log('MCP: "notifications/initialized" notification received.');
        // JSON-RPC Notifications (id is null or not present) MUST NOT be responded to.
        // If clientRpcRequest.id was indeed not present, rpcId will be null.
        if (rpcId === null) {
            console.log('MCP: Valid notification, no response sent.');
            return res.status(204).send(); // HTTP 204 No Content is appropriate and standard.
        } else {
            // This case is unusual for a message named "notifications/*"
            // but if an ID was present, we treat it as an error.
            console.warn(`MCP: "notifications/initialized" received with an ID (${rpcId}). Sending error.`);
            jsonRpcResponse = {
                jsonrpc: "2.0",
                id: rpcId,
                error: {
                    code: -32600, // Invalid Request
                    message: "Notifications should not include an 'id'."
                }
            };
        }

    } 
    // app.post('/') handler in mcp.js

// ... (previous if/else if blocks for initialize, tools/list, notifications/initialized) ...

else if (clientMethod === 'tools/call') {
    console.log('MCP: "tools/call" method received.');
    const callParams = clientRpcRequest.params;

    if (!callParams || typeof callParams.tool_id !== 'string') { // Or check for 'name' if client sends that
        console.error('MCP: Invalid "tools/call" params: missing or invalid tool_id/name.', callParams);
        jsonRpcResponse = {
            jsonrpc: "2.0", id: rpcId,
            error: { code: -32602, message: "Invalid params: 'tool_id' (string) is required." } // Invalid Params
        };
    } else {
        const toolId = callParams.tool_id; // Or callParams.name
        const toolInputs = callParams.inputs || {}; // Inputs are optional

        console.log(`MCP: Request to call tool_id: "${toolId}" with inputs:`, JSON.stringify(toolInputs, null, 2));

        // --- This is where you dispatch to your actual tool logic ---
        // You'll need a way to map toolId to the actual function/endpoint on your MCP server.

        // Ensure user is authenticated for tool calls (IMPORTANT!)
        if (!req.session || !req.session.accessToken) {
            console.warn(`MCP: "tools/call" for tool "${toolId}" attempted without MCP session.`);
            jsonRpcResponse = {
                jsonrpc: "2.0", id: rpcId,
                error: {
                    code: -32000, // Example: Application-defined error for "Authentication Required"
                    message: "MCP authentication required to call tools. Please use the 'loginToMcp' tool first.",
                    data: {
                        login_tool_id: "mcp_login_tool_v1" // Or however your login tool is identified
                    }
                }
            };
        } else {
            // User is authenticated with MCP, proceed to call the tool's backend logic
            try {
                let toolOutput; // This will store the result from your tool

                if (toolId === "cv_overview_tool_v1" || toolId === "getCvOverview") { // Match by ID or name
                    // Call your logic for getCvOverview
                    // This logic will use makeAuthenticatedBackendRequest
                    console.log('MCP: Calling cv_overview_tool_v1 logic...');
                    const response = await makeAuthenticatedBackendRequest(req, 'GET', '/api/cvs'); // Path to your backend
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Backend error for cv_overview: ${response.status} - ${errorText}`);
                    }
                    const cvsList = await response.json();
                    // Potentially fetch fields for each CV here if that's part of this tool's contract
                    // For now, just return the list as an example
                    toolOutput = cvsList; // The actual data your tool /mcp/tools/cv-overview would return

                } else if (toolId === "trigger_action_tool_v1" || toolId === "triggerBackendAction") {
                    // Call your logic for triggerBackendAction
                    console.log('MCP: Calling trigger_action_tool_v1 logic with inputs:', toolInputs);
                    // toolInputs should match the requestBody schema for this tool
                    const response = await makeAuthenticatedBackendRequest(req, 'POST', '/api/perform-action', toolInputs); // Path to backend
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Backend error for trigger_action: ${response.status} - ${errorText}`);
                    }
                    toolOutput = await response.json(); // The actual data your tool /mcp/tools/trigger-action would return

                } else {
                    console.error(`MCP: Unknown tool_id "${toolId}" in tools/call.`);
                    jsonRpcResponse = {
                        jsonrpc: "2.0", id: rpcId,
                        error: { code: -32601, message: `Method not found: Tool with id '${toolId}' not implemented.` }
                    };
                }

                // If a tool was successfully called and produced output, and jsonRpcResponse wasn't set by an error above:
                if (typeof toolOutput !== 'undefined' && !jsonRpcResponse) {
                    jsonRpcResponse = {
                        jsonrpc: "2.0", id: rpcId,
                        result: {
                            outputs: toolOutput // As per MCP spec for ToolsCallResult
                        }
                    };
                }

            } catch (error) {
                console.error(`MCP: Error during "tools/call" for tool "${toolId}":`, error.message, error.stack);
                jsonRpcResponse = {
                    jsonrpc: "2.0", id: rpcId,
                    error: {
                        code: -32001, // Example: Application-defined error for "Tool Execution Error"
                        message: `Error executing tool '${toolId}': ${error.message}`,
                        // data: { stack: error.stack } // Optionally include stack in dev
                    }
                };
            }
        }
    }
}

// ... (else block for unknown methods) ...
    
    else {
        // Handle other/unknown methods with a JSON-RPC Error Response
        console.log(`MCP: Method "${clientMethod}" not found or not implemented.`);
        jsonRpcResponse = {
            jsonrpc: "2.0",
            id: rpcId,
            error: {
                code: -32601, // JSON-RPC standard error code for "Method not found"
                message: `Method not found: ${clientMethod}`
            }
        };
    }

    // Only send a JSON response if one was constructed.
    // This check is mainly for the notification case which returns early.
    if (jsonRpcResponse) {
        console.log('MCP: Attempting to send JSON-RPC response:', JSON.stringify(jsonRpcResponse, null, 2));
        res.status(200).json(jsonRpcResponse);
    }
    // If it was a notification and we already sent 204, this part is skipped.
});

// GET handler for the root path (your existing modified one for SSE)
// ... (should be fine) ...

// ... (rest of your mcp.js, including auth, tools, health, and the catch-all 404 handler) ...

// GET handler for the root path (your existing modified one for SSE)
app.get('/', (req, res) => {
    // ... (your existing SSE handling logic for GET / - this should be fine) ...
    console.log(`MCP: Root path / hit by client. Accept header: ${req.headers.accept}`);
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
        console.log('MCP: Detected SSE connection attempt on /');
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('\n'); // Initial newline
        // It's good practice to send an initial event or comment
        // to confirm to the client that the SSE stream is open and working.
        res.write('event: mcp_sse_connected\n');
        res.write('data: {"message":"MCP SSE Stream Ready on /"}\n\n');

        const keepAliveInterval = setInterval(() => {
            try {
                if (res.writableEnded) { // Check if stream has been closed
                    clearInterval(keepAliveInterval);
                    return;
                }
                res.write(': keepalive\n\n');
            } catch (e) {
                console.error("MCP: Error writing keepalive to SSE client on /", e.message);
                clearInterval(keepAliveInterval);
            }
        }, 20000);

        req.on('close', () => {
            clearInterval(keepAliveInterval);
            console.log('MCP: SSE client disconnected from /');
        });
    } else {
        console.log('MCP: Regular HTTP GET to /');
        res.json({
            message: 'MCP Server Base - Ready for HTTP',
            info: 'This MCP server supports SSE for event streams, potentially on this path if client accepts text/event-stream.',
            health_path: '/mcp/health',
            timestamp: new Date().toISOString()
        });
    }
});


// ... (rest of your mcp.js, including auth, tools, health, and the catch-all 404 handler) ...

// ... (rest of your mcp.js, including the catch-all 404 handler) ...

// helpers 

async function makeAuthenticatedBackendRequest(req, method, path, body = null) {
    if (!req.session || !req.session.accessToken) {
        throw new Error('MCP user not authenticated or access token missing in session.');
    }

    const attemptRequest = async (accessToken) => {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
        const options = {
            method,
            headers
        };
        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            options.body = JSON.stringify(body);
        }

        console.log(`MCP: Making ${method} request to backend: ${EXISTING_SERVER_URL}${path}`);
        return fetch(`${EXISTING_SERVER_URL}${path}`, options);
    };

    let response = await attemptRequest(req.session.accessToken);

    if (response.status === 401 && req.session.refreshToken) {
        console.log('MCP: Access token expired or invalid. Attempting refresh...');
        try {
            const refreshResponse = await fetch(`${EXISTING_SERVER_URL}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: req.session.refreshToken })
            });

            const refreshData = await refreshResponse.json();

            if (!refreshResponse.ok) {
                console.error('MCP: Backend token refresh failed:', refreshData);
                // Clear potentially invalid tokens and force re-login
                delete req.session.accessToken;
                delete req.session.refreshToken;
                req.session.save(); // Save changes to session
                throw new Error(`Backend token refresh failed: ${refreshData.message || refreshResponse.statusText}`);
            }

            console.log('MCP: Backend token refreshed successfully.');
            req.session.accessToken = refreshData.accessToken;
            // Some refresh endpoints might also return a new refresh token
            if (refreshData.refreshToken) {
                req.session.refreshToken = refreshData.refreshToken;
            }
            req.session.save(); // Save new tokens to session

            // Retry the original request with the new access token
            console.log('MCP: Retrying original request with new access token.');
            response = await attemptRequest(req.session.accessToken);

        } catch (refreshError) {
            console.error('MCP: Error during token refresh process:', refreshError.message);
            // If refresh fails, the original 401 response or this new error should be propagated
            throw refreshError; // Propagate the refresh error
        }
    }
    return response; // Return the final response (either original success, retried success, or original error if not 401/refresh failed)
}

// Catch-all 404 handler - MUST BE LAST route handler
app.use((req, res, next) => {
    console.error(`MCP: 404 Not Found - Path: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// --- Start the MCP Server ---
app.listen(MCP_PORT, () => {
    console.log(`MCP Server running on http://localhost:${MCP_PORT}`);
    console.log(`Proxying and providing tools for server at ${EXISTING_SERVER_URL}`);
    console.log(`CORS enabled for origin: https://playground.ai.cloudflare.com`);

});