import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal/Modal';
import './Sidebar.css';

interface QuickAction {
    id: string;
    label: string;
    prompt: string;
    questions: { id: string; question: string }[];
}

const quickActions: QuickAction[] = [
    {
        id: '1',
        label: 'Data Analysis',
        prompt: 'Analyze data for...',
        questions: [
            { id: 'q1', question: 'What type of data would you like to analyze?' },
            { id: 'q2', question: 'What is the time period for analysis?' }
        ]
    },
    {
        id: '2',
        label: 'Generate Report',
        prompt: 'Generate a report for...',
        questions: [
            { id: 'q1', question: 'What type of report do you need?' },
            { id: 'q2', question: 'What should be included in the report?' }
        ]
    }
];

const Sidebar: React.FC = () => {
    const navigate = useNavigate();
    const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);

    const handleQuickAction = (action: QuickAction) => {
        setSelectedAction(action);
    };

    const handleModalSubmit = (answers: Record<string, string>) => {
        navigate('/chat', {
            state: {
                quickAction: {
                    type: selectedAction?.label || '',
                    data: answers
                }
            }
        });
    };

    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <h2>AI Assistant</h2>
            </div>
            <nav className="sidebar-nav">
                <button onClick={() => navigate('/')} className="nav-button">
                    Home
                </button>
                <button onClick={() => navigate('/chat')} className="nav-button">
                    Chatbot
                </button>
            </nav>
            <div className="quick-actions">
                <h3>Quick Actions</h3>
                {quickActions.map((action) => (
                    <button
                        key={action.id}
                        className="quick-action-button"
                        onClick={() => handleQuickAction(action)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
            {selectedAction && (
                <Modal
                    isOpen={true}
                    onClose={() => setSelectedAction(null)}
                    title={selectedAction.label}
                    questions={selectedAction.questions}
                    onSubmit={handleModalSubmit}
                />
            )}
        </div>
    );
};

export default Sidebar;
