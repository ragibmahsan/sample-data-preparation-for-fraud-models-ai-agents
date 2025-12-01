import React from 'react';
import { useNavigate } from 'react-router-dom';

const Home: React.FC = () => {
    const navigate = useNavigate();

    const features = [
        {
            icon: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
            title: "Data Analysis",
            description: "Generate comprehensive data quality reports and insights from your fraud detection datasets"
        },
        {
            icon: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
            title: "Data Transformation",
            description: "Apply sophisticated data transformations including encoding, cleaning, and preprocessing"
        },
        {
            icon: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" /></svg>,
            title: "Flow Creation",
            description: "Create and manage SageMaker Data Wrangler flows for advanced data processing pipelines"
        },
        {
            icon: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
            title: "AI Chat Assistant",
            description: "Interact with our intelligent AI assistant for guidance and automated task execution"
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black">
            {/* Hero Section */}
            <div className="relative px-8 py-12">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="w-20 h-20 bg-gradient-to-r from-primary-600 to-primary-700 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <h1 className="text-5xl font-bold text-white mb-6 leading-tight">
                        Welcome to <span className="bg-gradient-to-r from-primary-400 to-primary-500 bg-clip-text text-transparent">Fraud Detection on AWS Assistant</span>
                    </h1>
                    <p className="text-xl text-gray-300 mb-8 leading-relaxed max-w-3xl mx-auto">
                        Your intelligent fraud detection companion powered by generative AI and AWS services.
                        Streamline your data analysis, transformation, and fraud detection workflows with advanced automation.
                    </p>
                    <button
                        onClick={() => navigate('/chat')}
                        className="bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white font-semibold px-8 py-4 rounded-2xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                    >
                        Start Chatting
                    </button>
                </div>
            </div>

            {/* Features Grid */}
            <div className="px-8 py-12">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-bold text-white text-center mb-12">
                        Powerful Features at Your Fingertips
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="bg-gray-800/80 backdrop-blur-sm p-8 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 border border-gray-700"
                            >
                                <div className="text-primary-500 mb-4">
                                    {feature.icon}
                                </div>
                                <h3 className="text-xl font-bold text-white mb-3">
                                    {feature.title}
                                </h3>
                                <p className="text-gray-300 leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Getting Started Section */}
            <div className="px-8 py-12 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-gray-800/90 backdrop-blur-sm rounded-3xl p-8 shadow-xl border border-gray-700">
                        <h2 className="text-3xl font-bold text-white mb-6 text-center">
                            Getting Started
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="text-center">
                                <div className="w-12 h-12 bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <span className="text-white font-bold text-lg">1</span>
                                </div>
                                <h3 className="font-semibold text-white mb-2">Navigate</h3>
                                <p className="text-gray-300 text-sm">Use the sidebar to access different sections and features</p>
                            </div>
                            <div className="text-center">
                                <div className="w-12 h-12 bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <span className="text-white font-bold text-lg">2</span>
                                </div>
                                <h3 className="font-semibold text-white mb-2">Quick Actions</h3>
                                <p className="text-gray-300 text-sm">Use quick action buttons for common fraud detection tasks</p>
                            </div>
                            <div className="text-center">
                                <div className="w-12 h-12 bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <span className="text-white font-bold text-lg">3</span>
                                </div>
                                <h3 className="font-semibold text-white mb-2">Chat</h3>
                                <p className="text-gray-300 text-sm">Start conversations with our AI assistant for guidance</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Home;
