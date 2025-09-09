interface WebSocketMessage {
    type: 'status' | 'chunk' | 'complete' | 'error' | 'trace';
    content?: string;
    message?: string;
    error?: string;
    sessionId?: string;
    chunkNumber?: number;
    totalChunks?: number;
    timestamp: string;
    trace?: any;
}

// Configuration for API endpoints
const API_CONFIG = {
    CHAT_ENDPOINT: process.env.REACT_APP_API_GATEWAY_ENDPOINT || '',
    WEBSOCKET_ENDPOINT: process.env.REACT_APP_WEBSOCKET_ENDPOINT || ''
};

// WebSocket-based list operations
const sendListRequest = (operation: string): Promise<string[]> => {
    return new Promise(async (resolve, reject) => {
        try {
            const ws = await connectWebSocket();

            const messageHandler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'listResponse' && data.operation === operation) {
                        ws.removeEventListener('message', messageHandler);

                        if (data.success) {
                            // Handle different response formats from the Lambda functions
                            let items: string[] = [];

                            if (Array.isArray(data.data)) {
                                items = data.data;
                            } else if (data.data) {
                                // Handle JSON response body - data.data is always a string from the backend
                                let responseBody;
                                try {
                                    responseBody = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                                } catch (parseError) {
                                    console.error('Error parsing data.data:', parseError);
                                    responseBody = data.data;
                                }

                                if (operation === 'listS3URIs' && responseBody.uris) {
                                    items = responseBody.uris;
                                } else if (operation === 'listFlowURIs' && responseBody.flows) {
                                    items = responseBody.flows;
                                } else if (operation === 'listReportURIs' && responseBody.reports) {
                                    items = responseBody.reports;
                                } else if (Array.isArray(responseBody)) {
                                    items = responseBody;
                                }
                            }

                            console.log(`${operation} resolved with items:`, items);
                            resolve(items);
                        } else {
                            reject(new Error(data.error || 'List operation failed'));
                        }
                    }
                } catch (error) {
                    ws.removeEventListener('message', messageHandler);
                    reject(new Error('Error parsing list response'));
                }
            };

            ws.addEventListener('message', messageHandler);

            // Send list request
            const payload = {
                type: 'list',
                operation: operation
            };

            ws.send(JSON.stringify(payload));

            // Set timeout for the request
            setTimeout(() => {
                ws.removeEventListener('message', messageHandler);
                reject(new Error('List operation timeout'));
            }, 30000); // 30 second timeout

        } catch (error) {
            console.error(`Error in ${operation}:`, error);
            reject(error);
        }
    });
};

export const listS3URIs = async (): Promise<string[]> => {
    try {
        return await sendListRequest('listS3URIs');
    } catch (error) {
        console.error('Error fetching S3 URIs:', error);
        return [];
    }
};

export const listFlowURIs = async (): Promise<string[]> => {
    try {
        return await sendListRequest('listFlowURIs');
    } catch (error) {
        console.error('Error fetching Flow URIs:', error);
        return [];
    }
};

export const listReportURIs = async (): Promise<string[]> => {
    try {
        return await sendListRequest('listReportURIs');
    } catch (error) {
        console.error('Error fetching Report URIs:', error);
        return [];
    }
};

// WebSocket connection management
let webSocket: WebSocket | null = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 1000; // Start with 1 second

export const connectWebSocket = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            resolve(webSocket);
            return;
        }

        if (!API_CONFIG.WEBSOCKET_ENDPOINT) {
            reject(new Error('WebSocket endpoint not configured'));
            return;
        }

        try {
            webSocket = new WebSocket(API_CONFIG.WEBSOCKET_ENDPOINT);

            webSocket.onopen = () => {
                console.log('WebSocket connected');
                reconnectAttempts = 0;
                resolve(webSocket!);
            };

            webSocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            webSocket.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason);
                webSocket = null;

                // Attempt to reconnect if not a normal closure
                if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
                    setTimeout(() => {
                        reconnectAttempts++;
                        console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
                        connectWebSocket().catch(console.error);
                    }, reconnectDelay * Math.pow(2, reconnectAttempts));
                }
            };

        } catch (error) {
            reject(error);
        }
    });
};

export const disconnectWebSocket = () => {
    if (webSocket) {
        webSocket.close(1000, 'User disconnected');
        webSocket = null;
    }
};

export const sendMessageViaWebSocket = (
    message: string,
    onChunk: (chunk: string) => void,
    onComplete: (fullMessage: string, sessionId?: string) => void,
    onError: (error: string) => void,
    onStatus?: (status: string) => void
): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        try {
            const ws = await connectWebSocket();
            let fullMessage = '';
            let sessionId = localStorage.getItem('bedrock_session_id');

            const messageHandler = (event: MessageEvent) => {
                try {
                    const data: WebSocketMessage = JSON.parse(event.data);

                    switch (data.type) {
                    case 'status':
                        if (onStatus && data.message) {
                            onStatus(data.message);
                        }
                        break;

                    case 'chunk':
                        if (data.content) {
                            fullMessage += data.content;
                            onChunk(data.content);
                        }
                        break;

                    case 'complete':
                        if (data.sessionId && !sessionId) {
                            localStorage.setItem('bedrock_session_id', data.sessionId);
                            sessionId = data.sessionId;
                        }
                        onComplete(data.content || fullMessage, sessionId || undefined);
                        ws.removeEventListener('message', messageHandler);
                        resolve();
                        break;

                    case 'error':
                        const errorMsg = data.error || data.message || 'Unknown error occurred';
                        onError(errorMsg);
                        ws.removeEventListener('message', messageHandler);
                        reject(new Error(errorMsg));
                        break;

                    case 'trace':
                        // Optional: handle trace information
                        console.log('Trace data:', data.trace);
                        break;

                    default:
                        console.warn('Unknown message type:', data.type);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                    onError('Error parsing server response');
                    ws.removeEventListener('message', messageHandler);
                    reject(error);
                }
            };

            ws.addEventListener('message', messageHandler);

            // Send the message with correct type for chat
            const payload = {
                type: 'chat',
                message: message.trim(),
                sessionId: sessionId || undefined
            };

            ws.send(JSON.stringify(payload));

        } catch (error) {
            console.error('Error sending message via WebSocket:', error);
            onError(error instanceof Error ? error.message : 'Failed to connect to chat service');
            reject(error);
        }
    });
};
