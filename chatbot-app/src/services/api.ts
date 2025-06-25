interface ChatMessage {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

// Configuration for API endpoint
const API_CONFIG = {
    CHAT_ENDPOINT: process.env.REACT_APP_API_GATEWAY_ENDPOINT || ''
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

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
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
            content: 'Sorry, I encountered an error processing your request. Please try again.',
            sender: 'bot',
            timestamp: new Date()
        };
    }
};
