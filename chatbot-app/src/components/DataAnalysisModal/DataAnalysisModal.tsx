import React, { useState, useEffect } from 'react';
import { listS3URIs, listFlowURIs } from '../../services/api';
import './DataAnalysisModal.css';

interface DataAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (s3Uri: string, flowUri: string) => void;
}

const DataAnalysisModal: React.FC<DataAnalysisModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [s3URIs, setS3URIs] = useState<string[]>([]);
    const [flowURIs, setFlowURIs] = useState<string[]>([]);
    const [selectedS3URI, setSelectedS3URI] = useState<string>('');
    const [selectedFlowURI, setSelectedFlowURI] = useState<string>('');
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
                <h2>Data Analysis Configuration</h2>
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
                        <div className="modal-actions">
                            <button type="button" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="submit">
                                Create Analysis
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default DataAnalysisModal;
