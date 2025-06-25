import React from 'react';
import './Modal.css';

interface Question {
    id: string;
    question: string;
}

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    questions: Question[];
    onSubmit: (answers: Record<string, string>) => void;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, questions, onSubmit }) => {
    const [answers, setAnswers] = React.useState<Record<string, string>>({});

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(answers);
        onClose();
    };

    const handleInputChange = (questionId: string, value: string) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: value
        }));
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="close-button" onClick={onClose}>×</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {questions.map((q) => (
                            <div key={q.id} className="form-group">
                                <label htmlFor={q.id}>{q.question}</label>
                                <input
                                    type="text"
                                    id={q.id}
                                    value={answers[q.id] || ''}
                                    onChange={(e) => handleInputChange(q.id, e.target.value)}
                                    required
                                />
                            </div>
                        ))}
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="cancel-button" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="submit-button">
                            Submit
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Modal;
