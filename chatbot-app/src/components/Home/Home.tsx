import React from 'react';
import './Home.css';

const Home: React.FC = () => {
    return (
        <div className="home">
            <div className="home-content">
                <h1>Welcome to AI Assistant</h1>
                <p>
                    This is your intelligent chatbot assistant. Use the sidebar to:
                </p>
                <ul>
                    <li>Navigate to different sections</li>
                    <li>Access quick actions for common tasks</li>
                    <li>Start conversations with predefined prompts</li>
                </ul>
                <div className="quick-start">
                    <h2>Getting Started</h2>
                    <p>
                        Click on the "Chatbot" option in the sidebar to start a conversation,
                        or use one of the quick action buttons to perform specific tasks.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Home;
