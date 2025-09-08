import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from "react-oidc-context";

const cognitoAuthConfig = {
    authority: `https://cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_COGNITO_USER_POOL_ID}`,
    client_id: process.env.REACT_APP_COGNITO_CLIENT_ID,
    redirect_uri: process.env.REACT_APP_REDIRECT_SIGNIN,
    post_logout_redirect_uri: process.env.REACT_APP_REDIRECT_SIGNOUT,
    response_type: "code",
    scope: "email openid phone profile"
};

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);
root.render(
    <React.StrictMode>
        <AuthProvider
            authority={cognitoAuthConfig.authority}
            client_id={cognitoAuthConfig.client_id}
            redirect_uri={cognitoAuthConfig.redirect_uri}
            post_logout_redirect_uri={cognitoAuthConfig.post_logout_redirect_uri}
            response_type={cognitoAuthConfig.response_type}
            scope={cognitoAuthConfig.scope}
        >
            <App />
        </AuthProvider>
    </React.StrictMode>
);
