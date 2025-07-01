import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from "react-oidc-context";
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Chat from './components/Chat/Chat';
import './App.css';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const auth = useAuth();

    if (auth.isLoading) {
        return <div>Loading...</div>;
    }

    if (auth.error) {
        return <div>Encountering error... {auth.error.message}</div>;
    }

    if (!auth.isAuthenticated) {
        return (
            <div className="login-container">
                <h1>Welcome to Fraud Detection AI Assistant</h1>
                <button className="login-button" onClick={() => auth.signinRedirect()}>Sign in</button>
            </div>
        );
    }

    return <>{children}</>;
};

const App: React.FC = () => {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={
                    <ProtectedRoute>
                        <Layout />
                    </ProtectedRoute>
                }>
                    <Route index element={<Home />} />
                    <Route path="chat" element={<Chat />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default App;
