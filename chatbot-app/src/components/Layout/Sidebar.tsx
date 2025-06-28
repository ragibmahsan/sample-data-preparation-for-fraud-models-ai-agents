import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataAnalysisModal from '../DataAnalysisModal/DataAnalysisModal';
import AnalyzeReportModal from '../AnalyzeReportModal/AnalyzeReportModal';
import DataTransformModal from '../DataTransformModal/DataTransformModal';
import './Sidebar.css';

interface QuickAction {
    id: string;
    label: string;
    type: 'data-analysis' | 'analyze-report' | 'data-transform';
}

const quickActions: QuickAction[] = [
    {
        id: '1',
        label: 'Create Report',
        type: 'data-analysis'
    },
    {
        id: '2',
        label: 'Analyze Report',
        type: 'analyze-report'
    },
    {
        id: '3',
        label: 'Transform Data',
        type: 'data-transform'
    }
];

const Sidebar: React.FC = () => {
    const navigate = useNavigate();
    const [showDataAnalysisModal, setShowDataAnalysisModal] = useState(false);
    const [showAnalyzeReportModal, setShowAnalyzeReportModal] = useState(false);
    const [showDataTransformModal, setShowDataTransformModal] = useState(false);

    const handleQuickAction = (action: QuickAction) => {
        if (action.type === 'data-analysis') {
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

    const handleDataTransformSubmit = (inputS3Uri: string, outputS3Path: string) => {
        navigate('/chat', {
            state: {
                quickAction: {
                    type: 'Transform Data',
                    data: {
                        message: `Transform the data from input S3 URI ${inputS3Uri} and save the results to the output S3 uri ${outputS3Path}.`
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
        </div>
    );
};

export default Sidebar;
