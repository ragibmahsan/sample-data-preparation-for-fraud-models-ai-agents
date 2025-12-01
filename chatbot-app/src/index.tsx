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
    scope: "email openid phone profile",
    automaticSilentRenew: false,
    loadUserInfo: true,
    onSigninCallback: () => {
        // Clear URL parameters after successful signin
        window.history.replaceState({}, document.title, window.location.pathname);
    },
    metadata: {
        issuer: `https://cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_COGNITO_USER_POOL_ID}`,
        authorization_endpoint: `https://${process.env.REACT_APP_COGNITO_DOMAIN}.auth.${process.env.REACT_APP_AWS_REGION}.amazoncognito.com/oauth2/authorize`,
        token_endpoint: `https://${process.env.REACT_APP_COGNITO_DOMAIN}.auth.${process.env.REACT_APP_AWS_REGION}.amazoncognito.com/oauth2/token`,
        userinfo_endpoint: `https://${process.env.REACT_APP_COGNITO_DOMAIN}.auth.${process.env.REACT_APP_AWS_REGION}.amazoncognito.com/oauth2/userInfo`,
        end_session_endpoint: `https://${process.env.REACT_APP_COGNITO_DOMAIN}.auth.${process.env.REACT_APP_AWS_REGION}.amazoncognito.com/logout`,
        jwks_uri: `https://cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_COGNITO_USER_POOL_ID}/.well-known/jwks.json`
    }
};

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);
root.render(
    <React.StrictMode>
        <AuthProvider {...cognitoAuthConfig}>
            <App />
        </AuthProvider>
    </React.StrictMode>
);
