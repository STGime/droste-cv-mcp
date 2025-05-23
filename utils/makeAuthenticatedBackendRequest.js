// utils/makeAuthenticatedBackendRequest.js (or similar)
import express from 'express';


// If using Node.js v18+ and want to use the global fetch:
// You might not need to import 'fetch' if it's globally available in your Node version.
// However, for clarity and compatibility, explicit import is often preferred.

const BACKEND_API_BASE_URL = process.env.BACKEND_API_URL || 'http://localhost:3000/api'; // Your main backend API

/**
 * Makes an authenticated request from the MCP server to the main backend API.
 *
 * @param {object} mcpReq - The Express request object from the incoming MCP request (to access session).
 * @param {'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'} method - The HTTP method.
 * @param {string} apiPath - The path for the backend API endpoint (e.g., '/cvs', '/auth/login').
 * @param {object} [payload] - The JSON payload for POST/PUT/PATCH requests.
 * @param {object} [additionalHeaders] - Any additional headers to include.
 * @returns {Promise<Response>} The raw fetch Response object.
 *                               The caller is responsible for calling .json(), .text(), etc.
 *                               and checking response.ok.
 */
export async function makeAuthenticatedBackendRequest(mcpReq, method, apiPath, payload = null, additionalHeaders = {}) {
    const fullUrl = `${BACKEND_API_BASE_URL}${apiPath}`;
    const headers = {
        'Content-Type': 'application/json', // Default, can be overridden by additionalHeaders
        'Accept': 'application/json',
        ...additionalHeaders,
    };

    // Retrieve the backend API access token from the MCP session
    // This token was stored in the MCP session after a successful 'loginToMcp' tool call,
    // which itself called your backend's /api/auth/login.
    if (mcpReq.session && mcpReq.session.accessToken) {
        headers['Authorization'] = `Bearer ${mcpReq.session.accessToken}`;
        console.log(`MCP -> Backend: Request to ${method} ${fullUrl} will use token from MCP session.`);
    } else {
        // No token in MCP session. This is expected for login/register calls to the backend.
        // For other calls, it means the MCP user isn't "logged in" to the backend via MCP.
        console.log(`MCP -> Backend: Request to ${method} ${fullUrl} without Authorization token (no token in MCP session).`);
    }

    const options = {
        method: method.toUpperCase(),
        headers: headers,
    };

    if (payload && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH')) {
        options.body = JSON.stringify(payload);
    }

    console.log(`MCP -> Backend: Making ${options.method} request to ${fullUrl} with headers:`, headers, payload ? `and payload: ${options.body.substring(0,100)}...` : '');

    try {
        const response = await fetch(fullUrl, options);
        // console.log(`MCP -> Backend: Response received from ${fullUrl}. Status: ${response.status}`);
        // The caller will handle response.ok and .json()/.text()
        return response;
    } catch (error) {
        console.error(`MCP -> Backend: Network or fetch error calling ${method} ${fullUrl}:`, error);
        // Re-throw a more specific error or a structured error object
        throw new Error(`Network error communicating with backend API: ${error.message}`);
    }
}