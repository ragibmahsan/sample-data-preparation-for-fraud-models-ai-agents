#!/usr/bin/env python3

import boto3
import json

def setup_websocket_routes():
    """Set up WebSocket API routes"""
    
    apigateway_client = boto3.client('apigatewayv2')
    lambda_client = boto3.client('lambda')
    
    # API ID from previous deployment - UPDATE THIS WITH YOUR API ID
    api_id = 'YOUR_API_ID_HERE'
    
    # Get Lambda function ARNs
    functions = {
        'connect': lambda_client.get_function(FunctionName='fraud-websocket-connect')['Configuration']['FunctionArn'],
        'disconnect': lambda_client.get_function(FunctionName='fraud-websocket-disconnect')['Configuration']['FunctionArn'],
        'message': lambda_client.get_function(FunctionName='fraud-websocket-message')['Configuration']['FunctionArn']
    }
    
    # Create integrations
    integrations = {}
    
    for route_name, function_arn in functions.items():
        try:
            integration_response = apigateway_client.create_integration(
                ApiId=api_id,
                IntegrationType='AWS_PROXY',
                IntegrationUri=f"arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/{function_arn}/invocations",
                PayloadFormatVersion='1.0'
            )
            integrations[route_name] = integration_response['IntegrationId']
            print(f"Created integration for {route_name}: {integration_response['IntegrationId']}")
        except Exception as e:
            print(f"Error creating integration for {route_name}: {e}")
    
    # Create routes
    routes = [
        {'key': '$connect', 'integration': integrations.get('connect')},
        {'key': '$disconnect', 'integration': integrations.get('disconnect')},
        {'key': '$default', 'integration': integrations.get('message')}
    ]
    
    for route in routes:
        if route['integration']:
            try:
                route_response = apigateway_client.create_route(
                    ApiId=api_id,
                    RouteKey=route['key'],
                    Target=f"integrations/{route['integration']}"
                )
                print(f"Created route {route['key']}: {route_response['RouteId']}")
            except Exception as e:
                print(f"Error creating route {route['key']}: {e}")
    
    # Create stage
    try:
        stage_response = apigateway_client.create_stage(
            ApiId=api_id,
            StageName='prod',
            AutoDeploy=True
        )
        print(f"Created stage: {stage_response['StageName']}")
    except Exception as e:
        print(f"Error creating stage: {e}")
    
    # Add Lambda permissions
    for route_name, function_arn in functions.items():
        try:
            lambda_client.add_permission(
                FunctionName=f'fraud-websocket-{route_name}',
                StatementId=f'websocket-{route_name}-permission',
                Action='lambda:InvokeFunction',
                Principal='apigateway.amazonaws.com',
                SourceArn=f"arn:aws:execute-api:us-east-1:YOUR_ACCOUNT_ID:{api_id}/*/*"
            )
            print(f"Added permission for {route_name}")
        except Exception as e:
            print(f"Permission for {route_name} may already exist: {e}")
    
    print(f"\nWebSocket API is ready at: wss://{api_id}.execute-api.us-east-1.amazonaws.com/prod")

if __name__ == "__main__":
    setup_websocket_routes()
