import React, { useState, useEffect } from 'react';
import { listS3URIs } from '../../services/api';
import './CreateFlowModal.css';

interface CreateFlowModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateFlow: (text: string) => void;
}

const CreateFlowModal: React.FC<CreateFlowModalProps> = ({ isOpen, onClose, onCreateFlow }) => {
    const [s3URIs, setS3URIs] = useState<string[]>([]);
    const [selectedS3URI, setSelectedS3URI] = useState<string>('');
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
        }
    }, [isOpen]);

    const loadURIs = async () => {
        setIsLoading(true);
        try {
            // Reset selection before loading new data
            setSelectedS3URI('');

            const s3Data = await listS3URIs();
            setS3URIs(s3Data);
            // Set default selection if we have data
            if (s3Data.length > 0) {
                setSelectedS3URI(s3Data[0]);
            }
        } catch (error) {
            console.error('Error loading S3 URIs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedS3URI) {
            const text = `create flow from data in S3 uri ${selectedS3URI}, make the flow output to output_s3_path ${outputPath}, for target column ${targetColumn} and problem type ${problemType}`;
            onCreateFlow(text);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Create Flow Configuration</h2>
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
                            <button type="submit">
                                Create Flow
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default CreateFlowModal;
