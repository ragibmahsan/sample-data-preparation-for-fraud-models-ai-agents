import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from "react-oidc-context";
import DataAnalysisModal from '../DataAnalysisModal/DataAnalysisModal';
import AnalyzeReportModal from '../AnalyzeReportModal/AnalyzeReportModal';
import DataTransformModal from '../DataTransformModal/DataTransformModal';
import CreateFlowModal from '../CreateFlowModal/CreateFlowModal';

interface QuickAction {
    id: string;
    label: string;
    type: 'create-flow' | 'data-analysis' | 'analyze-report' | 'data-transform';
    icon: React.ReactNode;
}

const quickActions: QuickAction[] = [
    {
        id: '1',
        label: 'Create Flow',
        type: 'create-flow',
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" /></svg>
    },
    {
        id: '2',
        label: 'Create Report',
        type: 'data-analysis',
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
    },
    {
        id: '3',
        label: 'Analyze Report',
        type: 'analyze-report',
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
    },
    {
        id: '4',
        label: 'Transform Data',
        type: 'data-transform',
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
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
        <div className="w-80 bg-gray-900/95 backdrop-blur-sm border-r border-gray-700 shadow-xl flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-gray-700">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl flex items-center justify-center shadow-lg">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Fraud Detection on AWS</h2>
                        <p className="text-sm text-gray-400">Assistant</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="p-4 space-y-2">
                <button
                    onClick={() => navigate('/')}
                    className="w-full flex items-center space-x-3 px-4 py-3 text-left text-gray-300 hover:bg-primary-900/30 hover:text-primary-400 rounded-xl transition-all duration-200 group"
                >
                    <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    <span className="font-medium">Home</span>
                </button>
                <button
                    onClick={() => navigate('/chat')}
                    className="w-full flex items-center space-x-3 px-4 py-3 text-left text-gray-300 hover:bg-primary-900/30 hover:text-primary-400 rounded-xl transition-all duration-200 group"
                >
                    <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="font-medium">Chat</span>
                </button>
            </nav>

            {/* Quick Actions */}
            <div className="flex-1 p-4">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">Quick Actions</h3>
                <div className="space-y-3">
                    {quickActions.map((action) => (
                        <button
                            key={action.id}
                            className="w-full flex items-center space-x-3 px-4 py-3 text-left bg-gray-800/50 hover:bg-primary-900/30 text-gray-300 hover:text-primary-400 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-sm hover:shadow-md group"
                            onClick={() => handleQuickAction(action)}
                        >
                            <div className="text-primary-500 group-hover:text-primary-400 group-hover:scale-110 transition-all">
                                {action.icon}
                            </div>
                            <span className="font-medium">{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Modals */}
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

            {/* Sign Out */}
            <div className="p-4 border-t border-gray-700">
                <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-red-900/30 hover:bg-red-800/40 text-red-400 hover:text-red-300 rounded-xl transition-all duration-200 font-medium"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );
};

export default Sidebar;
