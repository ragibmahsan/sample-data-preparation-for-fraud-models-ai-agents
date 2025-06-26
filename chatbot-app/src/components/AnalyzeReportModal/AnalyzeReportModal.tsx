import React, { useState, useEffect } from 'react';
import { listReportURIs } from '../../services/api';
import './AnalyzeReportModal.css';

interface AnalyzeReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (reportUri: string) => void;
}

const AnalyzeReportModal: React.FC<AnalyzeReportModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [reportURIs, setReportURIs] = useState<string[]>([]);
    const [selectedReportURI, setSelectedReportURI] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadReportURIs();
        } else {
            // Reset selection when modal closes
            setSelectedReportURI('');
        }
    }, [isOpen]);

    const loadReportURIs = async () => {
        setIsLoading(true);
        try {
            // Reset selection before loading new data
            setSelectedReportURI('');

            const reports = await listReportURIs();
            setReportURIs(reports);
            // Set default selection if we have data
            if (reports.length > 0) {
                setSelectedReportURI(reports[0]);
            }
        } catch (error) {
            console.error('Error loading report URIs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedReportURI) {
            onSubmit(selectedReportURI);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Analyze Report</h2>
                {isLoading ? (
                    <div>Loading...</div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="report-uri">Select Report:</label>
                            <select
                                id="report-uri"
                                value={selectedReportURI}
                                onChange={(e) => setSelectedReportURI(e.target.value)}
                                required
                            >
                                {reportURIs.map((uri) => (
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
                                Analyze
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default AnalyzeReportModal;
