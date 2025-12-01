import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const Layout: React.FC = () => {
    return (
        <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-black">
            <Sidebar />
            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    );
};

export default Layout;
