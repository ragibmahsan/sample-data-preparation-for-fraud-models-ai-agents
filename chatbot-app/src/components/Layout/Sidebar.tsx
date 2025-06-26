import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal/Modal';
import DataAnalysisModal from '../DataAnalysisModal/DataAnalysisModal';
import './Sidebar.css';

interface QuickAction {
    id: string;
    label: string;
    type: 'data-analysis' | 'report';
}

const quickActions: QuickAction[] = [
    {
        id: '1',
        label: 'Data Analysis',
        type: 'data-analysis'
    },
    {
        id: '2',
        label: 'Generate Report',
        type: 'report'
    }
];

const Sidebar: React.FC = () => {
    const navigate = useNavigate();
    const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);
    const [showDataAnalysisModal, setShowDataAnalysisModal] = useState(false);

    const handleQuickAction = (action: QuickAction) => {
        if (action.type === 'data-analysis') {
            setShowDataAnalysisModal(true);
        } else {
            setSelectedAction(action);
        }
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

    const handleDataAnalysisSubmit = (s3Uri: string, flowUri: string) => {
        navigate('/chat', {
            state: {
                quickAction: {
                    type: 'Data Analysis',
                    data: {
                        message: `Create a data quality insight report using this S3 URI ${s3Uri} for data and S3 Flow URI ${flowUri} for the flow. This process can take some time.`
                    }
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
            {selectedAction && selectedAction.type === 'report' && (
                <Modal
                    isOpen={true}
                    onClose={() => setSelectedAction(null)}
                    title={selectedAction.label}
                    questions={[
                        { id: 'q1', question: 'What type of report do you need?' },
                        { id: 'q2', question: 'What should be included in the report?' }
                    ]}
                    onSubmit={handleModalSubmit}
                />
            )}
            <DataAnalysisModal
                isOpen={showDataAnalysisModal}
                onClose={() => setShowDataAnalysisModal(false)}
                onSubmit={handleDataAnalysisSubmit}
            />
        </div>
    );
};

export default Sidebar;
