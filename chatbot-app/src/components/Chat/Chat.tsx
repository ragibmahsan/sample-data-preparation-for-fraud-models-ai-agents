import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessage, handleQuickAction } from '../../services/api';
import './Chat.css';

interface Message {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

interface LocationState {
    quickAction?: {
        type: string;
        data: Record<string, string>;
    };
}

const Chat: React.FC = () => {
    const location = useLocation();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleQuickActionState = useCallback(async () => {
        const state = location.state as LocationState;
        if (state?.quickAction) {
            setIsLoading(true);
            try {
                const response = await handleQuickAction(
                    state.quickAction.type,
                    state.quickAction.data
                );
                setMessages(prev => [...prev, response]);
            } catch (error) {
                console.error('Error handling quick action:', error);
                setMessages(prev => [
                    ...prev,
                    {
                        id: Date.now().toString(),
                        content: 'Sorry, there was an error processing your request.',
                        sender: 'bot',
                        timestamp: new Date()
                    }
                ]);
            } finally {
                setIsLoading(false);
            }
        }
    }, [location.state]);

    useEffect(() => {
        handleQuickActionState();
    }, [handleQuickActionState]);

    const handleSendMessage = async (e: React.FormEvent) => {
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
            setMessages(prev => [...prev, response]);
        } catch (error) {
            console.error('Error sending message:', error);
            setMessages(prev => [
                ...prev,
                {
                    id: Date.now().toString(),
                    content: 'Sorry, there was an error processing your message.',
                    sender: 'bot',
                    timestamp: new Date()
                }
            ]);
        } finally {
            setIsLoading(false);
        }
    };

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
            <form onSubmit={handleSendMessage} className="chat-input-form">
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
