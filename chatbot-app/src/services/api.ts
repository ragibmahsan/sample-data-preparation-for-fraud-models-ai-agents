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

// Configuration for API endpoint
const API_CONFIG = {
    CHAT_ENDPOINT: process.env.REACT_APP_API_GATEWAY_ENDPOINT || ''
};

export const listS3URIs = async (): Promise<string[]> => {
    try {
        const response = await fetch(`${API_CONFIG.CHAT_ENDPOINT}/list-s3-uri`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
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
            headers: {
                'Content-Type': 'application/json',
            }
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

export const sendMessage = async (message: string): Promise<ChatMessage> => {
    try {
        const response = await fetch(API_CONFIG.CHAT_ENDPOINT + '/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message
            })
        });

        const data = await response.json();
        if (!response.ok) {
            const errorMessage = data?.response?.responseBody?.['application/json']?.body?.error || 
                               data?.message || 
                               `Failed to process request (Status: ${response.status})`;
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
            content: `error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
            sender: 'bot',
            timestamp: new Date()
        };
    }
};
