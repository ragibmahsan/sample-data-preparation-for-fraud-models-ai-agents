# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Post-Deployment Configuration

After running `npx cdk deploy`, you'll need to configure the following:

### 1. Environment Variables
Create `.env` files in both `backend/` and `chatbot-app/` directories using the CloudFormation stack outputs:

```
REACT_APP_AWS_REGION=us-east-1
REACT_APP_COGNITO_USER_POOL_ID=<from stack output>
REACT_APP_COGNITO_CLIENT_ID=<from stack output>
REACT_APP_COGNITO_DOMAIN=<from stack output>
REACT_APP_REDIRECT_SIGNIN=http://localhost:3000/
REACT_APP_REDIRECT_SIGNOUT=http://localhost:3000/
REACT_APP_API_GATEWAY_ENDPOINT=<from stack output>
REACT_APP_WEBSOCKET_ENDPOINT=<from stack output>
```

### 2. WebSocket Setup (if using setup-websocket-routes.py)
Update `setup-websocket-routes.py` with your deployment-specific values:
- Replace `YOUR_API_ID_HERE` with your WebSocket API ID
- Replace `YOUR_ACCOUNT_ID` with your AWS account ID

## .env template

REACT_APP_AWS_REGION=
REACT_APP_COGNITO_USER_POOL_ID=
REACT_APP_COGNITO_CLIENT_ID=
REACT_APP_COGNITO_DOMAIN=
REACT_APP_REDIRECT_SIGNIN=http://localhost:3000/
REACT_APP_REDIRECT_SIGNOUT=http://localhost:3000/
REACT_APP_API_GATEWAY_ENDPOINT=

Fill in values from the output of stack in CloudFormation on AWS Console
