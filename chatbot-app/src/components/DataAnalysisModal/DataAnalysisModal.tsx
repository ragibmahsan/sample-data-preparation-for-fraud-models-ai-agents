import React, { useState, useEffect } from 'react';
import { listS3URIs, listFlowURIs } from '../../services/api';
import './DataAnalysisModal.css';

interface DataAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (s3Uri: string, flowUri: string) => void;
    onCreateFlowText: (text: string) => void;
    mode?: 'flow' | 'report';
}

const DataAnalysisModal: React.FC<DataAnalysisModalProps> = ({ isOpen, onClose, onSubmit, onCreateFlowText, mode = 'report' }) => {
    const [s3URIs, setS3URIs] = useState<string[]>([]);
    const [flowURIs, setFlowURIs] = useState<string[]>([]);
    const [selectedS3URI, setSelectedS3URI] = useState<string>('');
    const [selectedFlowURI, setSelectedFlowURI] = useState<string>('');
    const [outputPath, setOutputPath] = useState<string>('data_flow.flow');
    const [targetColumn, setTargetColumn] = useState<string>('');
    const [problemType, setProblemType] = useState<'Classification' | 'Regression'>('Classification');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadURIs();
        } else {
            // Reset selections when modal closes
            setSelectedS3URI('');
            setSelectedFlowURI('');
        }
    }, [isOpen]);

    const loadURIs = async () => {
        setIsLoading(true);
        try {
            // Reset selections before loading new data
            setSelectedS3URI('');
            setSelectedFlowURI('');

            const [s3Data, flowData] = await Promise.all([
                listS3URIs(),
                listFlowURIs()
            ]);
            setS3URIs(s3Data);
            setFlowURIs(flowData);
            // Only set default selections if we have data
            if (s3Data.length > 0) setSelectedS3URI(s3Data[0]);
            if (flowData.length > 0) setSelectedFlowURI(flowData[0]);
        } catch (error) {
            console.error('Error loading URIs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedS3URI && selectedFlowURI) {
            onSubmit(selectedS3URI, selectedFlowURI);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>{mode === 'flow' ? 'Create Flow Configuration' : 'Data Analysis Configuration'}</h2>
                {isLoading ? (
                    <div>Loading...</div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="s3-uri">S3 URI:</label>
                            <select
                                id="s3-uri"
                                value={selectedS3URI}
                                onChange={(e) => setSelectedS3URI(e.target.value)}
                                required
                            >
                                {s3URIs.map((uri) => (
                                    <option key={uri} value={uri}>
                                        {uri}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {mode === 'report' && (
                            <div className="form-group">
                                <label htmlFor="flow-uri">Flow URI:</label>
                                <select
                                    id="flow-uri"
                                    value={selectedFlowURI}
                                    onChange={(e) => setSelectedFlowURI(e.target.value)}
                                    required
                                >
                                    {flowURIs.map((uri) => (
                                        <option key={uri} value={uri}>
                                            {uri}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="form-group">
                            <label htmlFor="output-path">Output S3 Path:</label>
                            <input
                                id="output-path"
                                type="text"
                                value={outputPath}
                                onChange={(e) => setOutputPath(e.target.value)}
                                placeholder="s3://bucket/output/path/"
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="target-column">Target Column:</label>
                            <input
                                id="target-column"
                                type="text"
                                value={targetColumn}
                                onChange={(e) => setTargetColumn(e.target.value)}
                                placeholder="e.g., is_fraud"
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="problem-type">Problem Type:</label>
                            <select
                                id="problem-type"
                                value={problemType}
                                onChange={(e) => setProblemType(e.target.value as 'Classification' | 'Regression')}
                            >
                                <option value="Classification">Classification</option>
                                <option value="Regression">Regression</option>
                            </select>
                        </div>
                        <div className="modal-actions">
                            <button type="button" onClick={onClose}>
                                Cancel
                            </button>
                            {mode === 'flow' ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const text = `create flow from data in S3 uri ${selectedS3URI}, make the flow output to output_s3_path ${outputPath}, for target column ${targetColumn} and problem type ${problemType}`;
                                        onCreateFlowText(text);
                                        onClose();
                                    }}
                                >
                                    Create Flow
                                </button>
                            ) : (
                                <button type="submit">
                                    Create Analysis
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default DataAnalysisModal;
