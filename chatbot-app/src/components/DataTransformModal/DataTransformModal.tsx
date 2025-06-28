import React, { useState, useEffect } from 'react';
import { listS3URIs } from '../../services/api';
import './DataTransformModal.css';

interface DataTransformModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (inputS3Uri: string, outputS3Path: string) => void;
}

const DataTransformModal: React.FC<DataTransformModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [s3URIs, setS3URIs] = useState<string[]>([]);
    const [selectedInputURI, setSelectedInputURI] = useState<string>('');
    const [outputURI, setOutputURI] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadURIs();
        } else {
            // Reset selections when modal closes
            setSelectedInputURI('');
            setOutputURI('');
        }
    }, [isOpen]);

    const loadURIs = async () => {
        setIsLoading(true);
        try {
            const s3Data = await listS3URIs();
            setS3URIs(s3Data);
            if (s3Data.length > 0) {
                setSelectedInputURI(s3Data[0]);
            }
        } catch (error) {
            console.error('Error loading URIs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedInputURI && outputURI) {
            onSubmit(selectedInputURI, outputURI);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Data Transform Configuration</h2>
                {isLoading ? (
                    <div>Loading...</div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="input-uri">Input S3 URI:</label>
                            <select
                                id="input-uri"
                                value={selectedInputURI}
                                onChange={(e) => setSelectedInputURI(e.target.value)}
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
                            <label htmlFor="output-uri">Output S3 URI:</label>
                            <input
                                type="text"
                                id="output-uri"
                                value={outputURI}
                                onChange={(e) => setOutputURI(e.target.value)}
                                placeholder="Enter output S3 URI (e.g., s3://bucket-name/folder/output.csv)"
                                required
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="submit">
                                Transform Data
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default DataTransformModal;
