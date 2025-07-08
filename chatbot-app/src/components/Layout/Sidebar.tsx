import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from "react-oidc-context";
import DataAnalysisModal from '../DataAnalysisModal/DataAnalysisModal';
import AnalyzeReportModal from '../AnalyzeReportModal/AnalyzeReportModal';
import DataTransformModal from '../DataTransformModal/DataTransformModal';
import CreateFlowModal from '../CreateFlowModal/CreateFlowModal';
import './Sidebar.css';

interface QuickAction {
    id: string;
    label: string;
    type: 'create-flow' | 'data-analysis' | 'analyze-report' | 'data-transform';
}

const quickActions: QuickAction[] = [
    {
        id: '1',
        label: 'Create Flow',
        type: 'create-flow'
    },
    {
        id: '2',
        label: 'Create Report',
        type: 'data-analysis'
    },
    {
        id: '3',
        label: 'Analyze Report',
        type: 'analyze-report'
    },
    {
        id: '4',
        label: 'Transform Data',
        type: 'data-transform'
    }
];

const Sidebar: React.FC = () => {
    const navigate = useNavigate();

    const auth = useAuth();

    const handleSignOut = async () => {
        await auth.removeUser();
        const clientId = process.env.REACT_APP_COGNITO_CLIENT_ID;
        const logoutUri = process.env.REACT_APP_LOGOUT_URI || "http://localhost:3000/";
        const cognitoDomain = process.env.REACT_APP_COGNITO_DOMAIN;
        window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
    };
    const [showDataAnalysisModal, setShowDataAnalysisModal] = useState(false);
    const [showAnalyzeReportModal, setShowAnalyzeReportModal] = useState(false);
    const [showDataTransformModal, setShowDataTransformModal] = useState(false);
    const [showCreateFlowModal, setShowCreateFlowModal] = useState(false);
    const [message, setMessage] = useState('');

    const handleQuickAction = (action: QuickAction) => {
        if (action.type === 'create-flow') {
            setShowCreateFlowModal(true);
        } else if (action.type === 'data-analysis') {
            setShowDataAnalysisModal(true);
        } else if (action.type === 'analyze-report') {
            setShowAnalyzeReportModal(true);
        } else if (action.type === 'data-transform') {
            setShowDataTransformModal(true);
        }
    };

    const handleDataAnalysisSubmit = (s3Uri: string, flowUri: string) => {
        navigate('/chat', {
            state: {
                quickAction: {
                    type: 'Create Report',
                    data: {
                        message: `Create a data quality insight report using this S3 URI ${s3Uri} for data and S3 Flow URI ${flowUri} for the flow. This process can take some time.`
                    }
                }
            }
        });
    };

    const handleAnalyzeReportSubmit = (reportUri: string) => {
        navigate('/chat', {
            state: {
                quickAction: {
                    type: 'Analyze Report',
                    data: {
                        message: `Analyze the processor report from S3 URI ${reportUri}. Summarize the report and describe key details.`
                    }
                }
            }
        });
    };

    const handleDataTransformSubmit = (inputS3Uri: string, outputS3Path: string, transformAction: string) => {
        const message = `Please perform the following data transformation:
Action: ${transformAction}
Input: ${inputS3Uri}
Output: ${outputS3Path}`;

        navigate('/chat', {
            state: {
                quickAction: {
                    type: 'Transform Data',
                    data: {
                        message: message
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
            <DataAnalysisModal
                isOpen={showDataAnalysisModal}
                onClose={() => setShowDataAnalysisModal(false)}
                onSubmit={handleDataAnalysisSubmit}
            />
            <CreateFlowModal
                isOpen={showCreateFlowModal}
                onClose={() => setShowCreateFlowModal(false)}
                onCreateFlow={(text) => {
                    navigate('/chat', {
                        state: {
                            quickAction: {
                                type: 'Create Flow',
                                data: {
                                    message: text
                                }
                            }
                        }
                    });
                    setShowCreateFlowModal(false);
                }}
            />
            <AnalyzeReportModal
                isOpen={showAnalyzeReportModal}
                onClose={() => setShowAnalyzeReportModal(false)}
                onSubmit={handleAnalyzeReportSubmit}
            />
            <DataTransformModal
                isOpen={showDataTransformModal}
                onClose={() => setShowDataTransformModal(false)}
                onSubmit={handleDataTransformSubmit}
            />
            <button onClick={handleSignOut} className="sign-out-button">
                Sign Out
            </button>
        </div>
    );
};

export default Sidebar;
