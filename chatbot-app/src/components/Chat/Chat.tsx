import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessage } from '../../services/api';
import './Chat.css';

interface Message {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

const Chat: React.FC = () => {
    const location = useLocation();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const hasSubmitted = useRef(false);

    const handleSendMessage = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            content: inputValue,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);

        try {
            const response = await sendMessage(inputValue.trim());

            // Check if response contains error message
            if (response.content.toLowerCase().includes('error')) {
                setMessages(prev => [...prev, {
                    ...response,
                    content: response.content.includes('Bedrock') ?
                        response.content : // Keep the full message if it mentions Bedrock
                        response.content + '\n\n: Please try again'
                }]);
            } else {
                setMessages(prev => [...prev, response]);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
            setMessages(prev => [
                ...prev,
                {
                    id: Date.now().toString(),
                    content: `${errorMessage}\n\nPlease wait a few seconds and try again, as the Bedrock agent may need time to process.`,
                    sender: 'bot',
                    timestamp: new Date()
                }
            ]);
        } finally {
            setIsLoading(false);
        }
    }, [inputValue, isLoading]);

    useEffect(() => {
        // Reset hasSubmitted when location changes
        hasSubmitted.current = false;

        const quickAction = location.state?.quickAction;
        if (quickAction?.data?.message && !hasSubmitted.current) {
            hasSubmitted.current = true;
            const message = quickAction.data.message;
            setInputValue(message);
        }
    }, [location.state]);

    // Reset state when component unmounts or location changes
    useEffect(() => {
        return () => {
            setInputValue('');
            hasSubmitted.current = false;
        };
    }, [location.pathname]);

    useEffect(() => {
        const quickAction = location.state?.quickAction;
        if (quickAction?.data?.message && inputValue && formRef.current && !isLoading) {
            formRef.current.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    }, [inputValue, isLoading, location.state]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    return (
        <div className="chat-container">
            <div className="chat-messages">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`message ${message.sender === 'user' ? 'user-message' : 'bot-message'}`}
                    >
                        <div className="message-content">{message.content}</div>
                        <div className="message-timestamp">
                            {message.timestamp.toLocaleTimeString()}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <form ref={formRef} onSubmit={handleSendMessage} className="chat-input-form">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Type your message..."
                    className="chat-input"
                    disabled={isLoading}
                />
                <button type="submit" className="send-button" disabled={isLoading}>
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </form>
        </div>
    );
};

export default Chat;
