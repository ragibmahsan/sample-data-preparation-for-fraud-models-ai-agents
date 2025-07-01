interface ChatMessage {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

interface S3URIResponse {
    uris: string[];
}

interface FlowURIResponse {
    flows: string[];
}

interface ReportURIResponse {
    reports: string[];
}

// Configuration for API endpoint
const API_CONFIG = {
    CHAT_ENDPOINT: process.env.REACT_APP_API_GATEWAY_ENDPOINT || ''
};

// Helper to get headers with auth token
const getHeaders = (accessToken?: string) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    
    if (accessToken) {
        headers['Authorization'] = accessToken;
    }
    
    return headers;
};

export const listS3URIs = async (): Promise<string[]> => {
    try {
        const response = await fetch(`${API_CONFIG.CHAT_ENDPOINT}/list-s3-uri`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: S3URIResponse = await response.json();
        return data.uris;
    } catch (error) {
        console.error('Error fetching S3 URIs:', error);
        return [];
    }
};

export const listFlowURIs = async (): Promise<string[]> => {
    try {
        const response = await fetch(`${API_CONFIG.CHAT_ENDPOINT}/list-flow-uri`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: FlowURIResponse = await response.json();
        return data.flows;
    } catch (error) {
        console.error('Error fetching Flow URIs:', error);
        return [];
    }
};

export const listReportURIs = async (): Promise<string[]> => {
    try {
        const response = await fetch(`${API_CONFIG.CHAT_ENDPOINT}/list-report-uri`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: ReportURIResponse = await response.json();
        return data.reports;
    } catch (error) {
        console.error('Error fetching Report URIs:', error);
        return [];
    }
};

export const sendMessage = async (message: string): Promise<ChatMessage> => {
    try {
        const token = localStorage.getItem('auth_token') || undefined;
        const response = await fetch(API_CONFIG.CHAT_ENDPOINT + '/chat', {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({
                message,
                function: message.toLowerCase().includes('analyze') ? 'analyze_report' : 'create_report'
            })
        });

        const data = await response.json();
        if (!response.ok) {
            // Extract error details from various possible response formats
            let errorMessage = 'An error occurred';
            
            if (data?.response?.responseBody?.['application/json']?.body?.error) {
                errorMessage = data.response.responseBody['application/json'].body.error;
            } else if (data?.response?.responseBody?.TEXT?.body) {
                try {
                    const bodyJson = JSON.parse(data.response.responseBody.TEXT.body);
                    errorMessage = bodyJson.error || bodyJson.message || errorMessage;
                } catch (e) {
                    errorMessage = data.response.responseBody.TEXT.body;
                }
            } else if (data?.message) {
                errorMessage = data.message;
            } else if (data?.error) {
                errorMessage = data.error;
            }

            // Add status code to error message for debugging
            errorMessage = `Error (${response.status}): ${errorMessage}`;
            throw new Error(errorMessage);
        }
        return {
            id: Date.now().toString(),
            content: data.content,
            sender: 'bot',
            timestamp: new Date()
        };
    } catch (error) {
        console.error('Error calling chat endpoint:', error);
        return {
            id: Date.now().toString(),
            content: `Error: ${error instanceof Error ? error.message : 'Failed to send message. Please try again in a few seconds as the Bedrock agent may need time to process.'}`,
            sender: 'bot',
            timestamp: new Date()
        };
    }
};
