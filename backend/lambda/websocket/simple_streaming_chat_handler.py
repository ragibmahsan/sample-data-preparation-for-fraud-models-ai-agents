import json
import boto3
import os
import logging
from datetime import datetime

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
apigateway_client = boto3.client('apigatewaymanagementapi')


def lambda_handler(event, context):
    """
    Simple streaming chat handler for WebSocket API.
    This is a temporary version that doesn't use Bedrock agents.
    """
    try:
        # Extract data from the event
        connection_id = event.get('connectionId')
        user_message = event.get('message')
        session_id = event.get('sessionId')
        websocket_endpoint = event.get('websocketEndpoint')

        if not all([connection_id, user_message, websocket_endpoint]):
            raise ValueError(
                "Missing required parameters: connectionId, message, or websocketEndpoint")

        logger.info(
            f"Processing streaming chat for connection: {connection_id}")
        logger.info(f"Message: {user_message[:100]}...")

        # Initialize API Gateway Management API client with WebSocket endpoint
        apigateway_client = boto3.client(
            'apigatewaymanagementapi',
            endpoint_url=websocket_endpoint
        )

        # Send a simple response back to the client
        # This is a placeholder - in production, this would call Bedrock
        response_message = {
            'type': 'chatResponse',
            'message': f"Echo: {user_message}",
            'sessionId': session_id,
            'timestamp': datetime.utcnow().isoformat(),
            'isComplete': True
        }

        # Send the response
        apigateway_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(response_message)
        )

        logger.info(f"Response sent to connection {connection_id}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Chat response sent successfully',
                'sessionId': session_id
            })
        }

    except Exception as e:
        logger.error(f"Error in streaming chat handler: {str(e)}")
        
        # Try to send error message to client
        try:
            if connection_id and websocket_endpoint:
                error_message = {
                    'type': 'error',
                    'message': 'Sorry, there was an error processing your message.',
                    'error': str(e),
                    'timestamp': datetime.utcnow().isoformat()
                }
                
                apigateway_client = boto3.client(
                    'apigatewaymanagementapi',
                    endpoint_url=websocket_endpoint
                )
                
                apigateway_client.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(error_message)
                )
        except Exception as send_error:
            logger.error(f"Failed to send error message: {str(send_error)}")

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
