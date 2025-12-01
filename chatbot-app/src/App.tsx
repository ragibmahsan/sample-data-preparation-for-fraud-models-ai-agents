import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from "react-oidc-context";
import Layout from './components/Layout/Layout';
import Home from './components/Home/Home';
import Chat from './components/Chat/Chat';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const auth = useAuth();

    // Store the access token when authenticated
    React.useEffect(() => {
        if (auth.user?.access_token) {
            localStorage.setItem('auth_token', `Bearer ${auth.user.access_token}`);
        }
    }, [auth.user?.access_token]);

    // Handle authentication errors by clearing state and retrying
    React.useEffect(() => {
        if (auth.error && auth.error.message.includes('No matching state found')) {
            console.log('Clearing OIDC state and retrying...');
            auth.clearStaleState();
        }
    }, [auth.error, auth]);

    if (auth.isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-gray-300 text-lg font-medium">Loading...</p>
                </div>
            </div>
        );
    }

    if (auth.error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full mx-4">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-2">Authentication Error</h2>
                        <p className="text-gray-600 mb-4">{auth.error.message}</p>
                        <button
                            onClick={() => {
                                auth.clearStaleState();
                                window.location.href = '/';
                            }}
                            className="bg-primary-600 hover:bg-primary-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!auth.isAuthenticated) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center p-4">
                <div className="max-w-md w-full">
                    <div className="bg-white/95 backdrop-blur-sm p-8 rounded-3xl shadow-2xl border border-gray-200">
                        <div className="text-center">
                            <div className="w-20 h-20 bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                            </div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-3">
                                Fraud Detection on AWS
                            </h1>
                            <p className="text-lg text-primary-600 font-semibold mb-2">Assistant</p>
                            <p className="text-gray-600 mb-8 leading-relaxed">
                                Advanced financial fraud detection powered by generative AI and AWS services
                            </p>
                            <button
                                onClick={() => auth.signinRedirect()}
                                className="w-full bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                            >
                                Sign In to Continue
                            </button>
                        </div>
                    </div>
                </div>
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
