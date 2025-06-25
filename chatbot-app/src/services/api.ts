interface ChatMessage {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

export const sendMessage = async (message: string): Promise<ChatMessage> => {
    // TODO: Implement actual API call to Lambda function
    // This is a placeholder that simulates an API response
    return {
        id: Date.now().toString(),
        content: `I received your message: "${message}". This is a placeholder response.`,
        sender: 'bot',
        timestamp: new Date()
    };
};

export const handleQuickAction = async (type: string, data: Record<string, string>): Promise<ChatMessage> => {
    // TODO: Implement actual API call to Lambda function
    let response = '';

    switch (type) {
        case 'Data Analysis':
            response = `I'll analyze ${data.q1} for the period: ${data.q2}. Analysis results will be available shortly.`;
            break;
        case 'Generate Report':
            response = `I'll generate a ${data.q1} report including: ${data.q2}. The report will be ready soon.`;
            break;
        default:
            response = 'I received your request and will process it shortly.';
    }

    return {
        id: Date.now().toString(),
        content: response,
        sender: 'bot',
        timestamp: new Date()
    };
};
