import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessageViaWebSocket, disconnectWebSocket } from '../../services/api';
import { useAuth } from 'react-oidc-context';
import ReactMarkdown from 'react-markdown';

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
            textareaRef.current.style.height = '48px';
        }
        setIsLoading(true);

        const botMessageId = (Date.now() + 1).toString();
        const initialBotMessage: Message = {
            id: botMessageId,
            content: '',
            sender: 'bot',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, initialBotMessage]);

        try {
            if (auth.user?.access_token) {
                localStorage.setItem('auth_token', `Bearer ${auth.user.access_token}`);
            }

            await sendMessageViaWebSocket(
                messageToSend,
                (chunk: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? { ...msg, content: msg.content + chunk }
                            : msg
                    ));
                },
                (fullMessage: string, sessionId?: string) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === botMessageId
                            ? { ...msg, content: fullMessage }
                            : msg
                    ));
                    console.log('Message completed:', { fullMessage, sessionId });
                },
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

    useEffect(() => {
        return () => {
            disconnectWebSocket();
        };
    }, []);

    useEffect(() => {
        hasSubmitted.current = false;
        const quickAction = location.state?.quickAction;
        if (quickAction?.data?.message && !hasSubmitted.current) {
            hasSubmitted.current = true;
            const message = quickAction.data.message;
            setInputValue(message);
        }
    }, [location.state]);

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
        <div className="flex flex-col h-screen bg-gradient-to-br from-gray-900 to-black">
            {/* Header */}
            <div className="bg-gray-900/90 backdrop-blur-sm border-b border-gray-700 px-6 py-4 shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-primary-600 to-primary-700 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white">Fraud Detection on AWS Assistant</h1>
                        <p className="text-sm text-gray-400">Ask me anything about fraud detection</p>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 && (
                    <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">Start a conversation</h3>
                        <p className="text-gray-400 max-w-md mx-auto">Ask me about fraud detection, data analysis, or use the quick actions in the sidebar to get started.</p>
                    </div>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                    >
                        <div className={`max-w-3xl ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
                            <div className={`flex items-start space-x-3 ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                                {/* Avatar */}
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    message.sender === 'user'
                                        ? 'bg-gradient-to-r from-primary-600 to-primary-700'
                                        : 'bg-gradient-to-r from-gray-600 to-gray-700'
                                }`}>
                                    {message.sender === 'user' ? (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                    )}
                                </div>

                                {/* Message Content */}
                                <div className={`flex-1 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}>
                                    <div className={`inline-block px-4 py-3 rounded-2xl shadow-sm ${
                                        message.sender === 'user'
                                            ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white'
                                            : 'bg-gray-800 border border-gray-700 text-gray-100'
                                    }`}>
                                        <div className={`prose prose-sm max-w-none ${
                                            message.sender === 'user' ? 'prose-invert' : 'prose-gray'
                                        }`}>
                                            <ReactMarkdown>{message.content}</ReactMarkdown>
                                        </div>
                                    </div>
                                    <div className={`text-xs text-gray-500 mt-1 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}>
                                        {message.timestamp.toLocaleTimeString()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <div className="bg-gray-900/90 backdrop-blur-sm border-t border-gray-700 p-6">
                <form ref={formRef} onSubmit={handleSendMessage} className="flex items-end space-x-4">
                    <div className="flex-1 relative">
                        <textarea
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                e.target.style.height = '48px';
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
                            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-400 rounded-2xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none transition-all duration-200 shadow-sm scrollbar-thin"
                            style={{
                                minHeight: '48px',
                                maxHeight: `${maxHeight}px`,
                                overflowY: 'auto'
                            }}
                            disabled={isLoading}
                            rows={1}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading || !inputValue.trim()}
                        className="px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-2xl transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100 shadow-lg hover:shadow-xl disabled:shadow-sm flex items-center space-x-2"
                    >
                        {isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Sending...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                <span>Send</span>
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Chat;
