import React, { useState, useEffect } from 'react';
import { listS3URIs } from '../../services/api';
import './DataTransformModal.css';

interface DataTransformModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (inputS3Uri: string, outputS3Path: string, transformAction: string) => void;
}

const TRANSFORM_ACTIONS = [
    {
        value: 'drop_columns',
        label: 'Drop Columns',
        description: 'Remove unnecessary columns (only requires input and output URIs)'
    },
    {
        value: 'symbol_removal',
        label: 'Remove Symbols',
        description: 'Clean special characters from text (only requires input and output URIs)'
    },
    {
        value: 'text_2_lower',
        label: 'Text to Lowercase',
        description: 'Convert text to lowercase (only requires input and output URIs)'
    },
    {
        value: 'convert_timestamp',
        label: 'Convert Timestamp',
        description: 'Standardize time formats (only requires input and output URIs)'
    },
    {
        value: 'event_time',
        label: 'Process Event Time',
        description: 'Process temporal sequences (only requires input and output URIs)'
    },
    {
        value: 'convert_2_long',
        label: 'Convert to Long',
        description: 'Convert numeric values to long format (only requires input and output URIs)'
    },
    {
        value: 'categorical_2_ord',
        label: 'Categorical to Ordinal',
        description: 'Convert categorical values to ordinal numbers (only requires input and output URIs)'
    },
    {
        value: 'onehot_encode',
        label: 'One-Hot Encode',
        description: 'Create binary columns for categories (only requires input and output URIs)'
    }
];

const DataTransformModal: React.FC<DataTransformModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [s3URIs, setS3URIs] = useState<string[]>([]);
    const [selectedInputURI, setSelectedInputURI] = useState<string>('');
    const [outputURI, setOutputURI] = useState<string>('s3://fraud-detection-<account id>-us-east-1/transformed_data/output.csv');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedAction, setSelectedAction] = useState(TRANSFORM_ACTIONS[0].value);

    useEffect(() => {
        if (isOpen) {
            loadURIs();
        } else {
            // Reset selections when modal closes
            setSelectedInputURI('');
            setOutputURI('s3://fraud-detection-<account id>-us-east-1/transformed_data/output.csv');
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
        if (selectedInputURI && outputURI && selectedAction) {
            onSubmit(selectedInputURI, outputURI, selectedAction);
            onClose();
        }
    };

    const handleActionChange = (action: string) => {
        setSelectedAction(action);
    };

    const selectedActionConfig = TRANSFORM_ACTIONS.find(a => a.value === selectedAction);

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
                            <label htmlFor="transform-action">Transform Action:</label>
                            <select
                                id="transform-action"
                                value={selectedAction}
                                onChange={(e) => handleActionChange(e.target.value)}
                                required
                            >
                                {TRANSFORM_ACTIONS.map((action) => (
                                    <option key={action.value} value={action.value}>
                                        {action.label}
                                    </option>
                                ))}
                            </select>
                            <p className="action-description">
                                {selectedActionConfig?.description}
                            </p>
                        </div>


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
