#!/usr/bin/env python3

import boto3
import json
import zipfile
import os
from pathlib import Path

def create_lambda_zip(source_dir, zip_path):
    """Create a zip file for Lambda deployment"""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                if file.endswith('.py'):
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, source_dir)
                    zipf.write(file_path, arcname)

def deploy_websocket_functions():
    """Deploy WebSocket Lambda functions without Bedrock dependencies"""
    
    # Initialize AWS clients
    lambda_client = boto3.client('lambda')
    iam_client = boto3.client('iam')
    apigateway_client = boto3.client('apigatewayv2')
    
    # Create IAM role for Lambda functions
    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "lambda.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }
    
    lambda_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "arn:aws:logs:*:*:*"
            },
            {
                "Effect": "Allow",
                "Action": [
                    "execute-api:ManageConnections"
                ],
                "Resource": "arn:aws:execute-api:*:*:*"
            },
            {
                "Effect": "Allow",
                "Action": [
                    "lambda:InvokeFunction"
                ],
                "Resource": "*"
            }
        ]
    }
    
    role_name = 'fraud-websocket-lambda-role'
    
    try:
        # Create IAM role
        role_response = iam_client.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(trust_policy),
            Description='Role for fraud detection WebSocket Lambda functions'
        )
        role_arn = role_response['Role']['Arn']
        print(f"Created IAM role: {role_arn}")
        
        # Attach policy to role
        iam_client.put_role_policy(
            RoleName=role_name,
            PolicyName='WebSocketLambdaPolicy',
            PolicyDocument=json.dumps(lambda_policy)
        )
        print("Attached policy to role")
        
    except iam_client.exceptions.EntityAlreadyExistsException:
        # Role already exists, get its ARN
        role_response = iam_client.get_role(RoleName=role_name)
        role_arn = role_response['Role']['Arn']
        print(f"Using existing IAM role: {role_arn}")
    
    # Wait a bit for role to propagate
    import time
    time.sleep(10)
    
    # Create WebSocket API
    try:
        api_response = apigateway_client.create_api(
            Name='Fraud Detection Chat WebSocket API',
            ProtocolType='WEBSOCKET',
            RouteSelectionExpression='$request.body.action',
            Description='WebSocket API for streaming chat responses'
        )
        api_id = api_response['ApiId']
        print(f"Created WebSocket API: {api_id}")
    except Exception as e:
        print(f"Error creating API (may already exist): {e}")
        # List existing APIs to find ours
        apis = apigateway_client.get_apis()
        api_id = None
        for api in apis['Items']:
            if api['Name'] == 'Fraud Detection Chat WebSocket API':
                api_id = api['ApiId']
                break
        if not api_id:
            raise Exception("Could not create or find WebSocket API")
    
    websocket_endpoint = f"https://{api_id}.execute-api.us-east-1.amazonaws.com/prod"
    
    # Create Lambda functions
    lambda_functions = [
        {
            'name': 'fraud-websocket-connect',
            'handler': 'connect_handler.lambda_handler',
            'description': 'WebSocket connect handler'
        },
        {
            'name': 'fraud-websocket-disconnect', 
            'handler': 'disconnect_handler.lambda_handler',
            'description': 'WebSocket disconnect handler'
        },
        {
            'name': 'fraud-websocket-message',
            'handler': 'message_handler.lambda_handler', 
            'description': 'WebSocket message handler'
        },
        {
            'name': 'fraud-websocket-streaming-chat',
            'handler': 'simple_streaming_chat_handler.lambda_handler',
            'description': 'Simple streaming chat handler'
        }
    ]
    
    # Create zip file for WebSocket functions
    websocket_dir = Path('./backend/lambda/websocket')
    zip_path = '/tmp/websocket_functions.zip'
    create_lambda_zip(websocket_dir, zip_path)
    
    with open(zip_path, 'rb') as zip_file:
        zip_content = zip_file.read()
    
    for func in lambda_functions:
        try:
            # Create or update Lambda function
            try:
                lambda_client.create_function(
                    FunctionName=func['name'],
                    Runtime='python3.9',
                    Role=role_arn,
                    Handler=func['handler'],
                    Code={'ZipFile': zip_content},
                    Description=func['description'],
                    Timeout=60,
                    Environment={
                        'Variables': {
                            'WEBSOCKET_API_ENDPOINT': websocket_endpoint,
                            'STREAMING_CHAT_HANDLER_NAME': 'fraud-websocket-streaming-chat'
                        }
                    }
                )
                print(f"Created Lambda function: {func['name']}")
            except lambda_client.exceptions.ResourceConflictException:
                # Function exists, update it
                lambda_client.update_function_code(
                    FunctionName=func['name'],
                    ZipFile=zip_content
                )
                lambda_client.update_function_configuration(
                    FunctionName=func['name'],
                    Environment={
                        'Variables': {
                            'WEBSOCKET_API_ENDPOINT': websocket_endpoint,
                            'STREAMING_CHAT_HANDLER_NAME': 'fraud-websocket-streaming-chat'
                        }
                    }
                )
                print(f"Updated Lambda function: {func['name']}")
                
        except Exception as e:
            print(f"Error with function {func['name']}: {e}")
    
    print(f"\nWebSocket API URL: wss://{api_id}.execute-api.us-east-1.amazonaws.com/prod")
    print("WebSocket functions deployed successfully!")
    print("\nUpdate your .env file with:")
    print(f"REACT_APP_WEBSOCKET_URL=wss://{api_id}.execute-api.us-east-1.amazonaws.com/prod")

if __name__ == "__main__":
    deploy_websocket_functions()
