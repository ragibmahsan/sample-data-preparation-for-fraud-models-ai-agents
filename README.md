# FSI Fraud Detection with Generative AI

This solution provides an advanced financial fraud detection system that leverages generative AI and AWS services. It focuses on preprocessing and transforming financial transaction data to enhance fraud detection capabilities. The system utilizes a series of data transformation steps, implemented as AWS Lambda functions, and orchestrated through an Amazon Bedrock agent.

## Key Features

- Data preprocessing pipeline for fraud detection datasets
- Generation of a data report to inform you about the input dataset
- Utilization of AWS Lambda for scalable data transformations
- Integration with Amazon Bedrock for intelligent orchestration
- Amazon Kendra integration with Bedrock for searching fraud-related documentation (optional due to regional availbility; will have to uncomment in the backend-stack.ts if you want to deploy it)
- Customizable data transformation steps including:
  - Dropping unnecessary columns
  - Converting text to lowercase
  - Cleaning entity IDs
  - Converting timestamps
  - Encoding categorical variables
  - One-hot encoding of fraud indicators
  - Adding event timestamps
  Feel free to add more tailored to the data that you are planning to input.

# Architecture
![Architecture Diagram](images/fraudarch.png)

## Introduction

The FSI Fraud Detection solution leverages AWS services and generative AI to:
- Process and analyze financial transactions in real-time
- Detect potential fraudulent patterns using machine learning
- Provide interactive fraud investigation capabilities through a React-based web interface
- Secure access through AWS Cognito authentication
- Deploy infrastructure as code using AWS CDK

## Prerequisites

Before deploying this solution, ensure you have the following:

1. **AWS Account Access**
   - An AWS account with administrative permissions
   - AWS CLI installed and configured with your credentials

2. **Development Tools**
   - Node.js 18.x or later
   - npm 8.x or later
   - AWS CDK CLI (can be installed via `npm install -g aws-cdk`)
   - Git (for cloning the repository)

3. **AWS Configuration**
   - Code currently only supports us-east-1

## Deployment Instructions

Follow these steps to deploy the solution in your AWS account:

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd scale-fsi-fraud-detection-gen-ai
   ```

2. **Install Dependencies**
   ```bash
   # Install backend dependencies
   cd backend
   npm install
   ```

3. **Deploy the Backend Stack**
   ```bash
   # Ensure you're in the backend directory
   cdk bootstrap
   cdk synth
   cdk deploy 
   ```
   During deployment, CDK will:
   - Create necessary IAM roles and permissions
   - Deploy Lambda functions
   - Set up API Gateway endpoints
   - Configure Cognito user pool
   - Create required DynamoDB tables

4. **Configure Environment Variables**
   After the stack deployment completes, you'll receive various outputs from CloudFormation. Create a `.env` file in the chatbot directory with these values:
   ```
   REACT_APP_AWS_REGION=us-east-1
   REACT_APP_COGNITO_USER_POOL_ID=<user-pool-id>
   REACT_APP_COGNITO_CLIENT_ID=<client-id>
   REACT_APP_COGNITO_DOMAIN=<cognito-domain>
   REACT_APP_REDIRECT_SIGNIN=http://localhost:3000/
   REACT_APP_REDIRECT_SIGNOUT=http://localhost:3000/
   REACT_APP_API_GATEWAY_ENDPOINT=<api-gateway-url>
   ```

5. **Verify Deployment**
   - Check the AWS Console to ensure all resources are created correctly
   - Test the API Gateway endpoints using the provided URLs
   - Verify Cognito user pool configuration

## Post-Deployment Steps


1. **Access the Application**
   ```bash
   cd chatbot-app
   npm install
   npm start
   ```

   - Create user on sign up
   - Verify all functionality is working as expected

## Cleanup

To avoid incurring unnecessary AWS charges, you can remove the deployed resources:

```bash
cd backend
cdk destroy
```

Double check that all resources have been destroyed especially the S3 bucket.

## Support and Contributing

For support, please open an issue in the repository. Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Authors

- [Ragib Ahsan](https://www.linkedin.com/in/ragibmahsan/), AWS AI Acceleration Architect
- [Keith Lee](https://www.linkedin.com/in/keith-kit-lee/), AWS Partner Solutions Architect
