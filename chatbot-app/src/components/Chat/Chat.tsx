import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessageViaWebSocket, disconnectWebSocket } from '../../services/api';
import { useAuth } from 'react-oidc-context';
import ReactMarkdown from 'react-markdown';
import './Chat.css';

interface Message {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

const Chat: React.FC = () => {
    const location = useLocation();
    const auth = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const hasSubmitted = useRef(false);

    // Max height for more rows of text
    const maxHeight = 200;

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
        const messageToSend = inputValue.trim();
        setInputValue('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        setIsLoading(true);

        // Create a bot message that will be updated with streaming content
        const botMessageId = (Date.now() + 1).toString();
        const initialBotMessage: Message = {
            id: botMessageId,
            content: '',
            sender: 'bot',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, initialBotMessage]);

        try {
            // Store the access token in localStorage for API calls
            if (auth.user?.access_token) {
                localStorage.setItem('auth_token', `Bearer ${auth.user.access_token}`);
            }

            // Use WebSocket for streaming responses
            await sendMessageViaWebSocket(
                messageToSend,
                // onChunk: Update the bot message with each chunk
                (chunk: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? { ...msg, content: msg.content + chunk }
                            : msg
                    ));
                },
                // onComplete: Final message received
                (fullMessage: string, sessionId?: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? { ...msg, content: fullMessage }
                            : msg
                    ));
                    console.log('Message completed:', { fullMessage, sessionId });
                },
                // onError: Handle errors
                (error: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? {
                                ...msg,
                                content: `Error: ${error}\n\nPlease try again. If the problem persists, the system may be processing other requests.`
                            }
                            : msg
                    ));
                },
                // onStatus: Handle status updates (optional)
                (status: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? { ...msg, content: `${status}...` }
                            : msg
                    ));
                }
            );

        } catch (error) {
            console.error('Error sending message via WebSocket:', error);
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

            setMessages(prev => prev.map(msg =>
                msg.id === botMessageId
                    ? {
                        ...msg,
                        content: `Error: ${errorMessage}\n\nPlease wait a few seconds and try again, as the system may need time to process.`
                    }
                    : msg
            ));
        } finally {
            setIsLoading(false);
        }
    }, [inputValue, isLoading, auth.user?.access_token]);
    // Cleanup WebSocket connection when component unmounts
    useEffect(() => {
        return () => {
            disconnectWebSocket();
        };
    }, []);

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
                        <div className="message-content">
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                        <div className="message-timestamp">
                            {message.timestamp.toLocaleTimeString()}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <form ref={formRef} onSubmit={handleSendMessage} className="chat-input-form">
                <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        // Auto-resize with max height limit
                        e.target.style.height = 'auto';
                        const scrollHeight = e.target.scrollHeight;
                        e.target.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage(e);
                        }
                    }}
                    placeholder="Type your message... (Shift + Enter for new line)"
                    className="chat-input"
                    disabled={isLoading}
                    rows={1}
                />
                <button type="submit" className="send-button" disabled={isLoading}>
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </form>
        </div>
    );
};

export default Chat;
