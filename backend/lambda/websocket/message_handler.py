import json
import boto3
import os
import logging
from datetime import datetime

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
lambda_client = boto3.client('lambda')
apigateway_client = boto3.client('apigatewaymanagementapi')


def send_websocket_message(connection_id, message_data):
    """Send a message to a WebSocket connection."""
    try:
        websocket_endpoint = os.environ.get('WEBSOCKET_API_ENDPOINT')
        if not websocket_endpoint:
            raise ValueError(
                "WEBSOCKET_API_ENDPOINT environment variable not set")

        # Create API Gateway Management API client with the WebSocket endpoint
        apigateway_client = boto3.client(
            'apigatewaymanagementapi',
            endpoint_url=websocket_endpoint
        )

        apigateway_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message_data)
        )
        logger.info(f"Message sent to connection {connection_id}")

    except Exception as e:
        logger.error(f"Failed to send WebSocket message: {str(e)}")
        raise


def handle_list_operation(connection_id, operation_type):
    """Handle list operations (S3, Flow, Reports) synchronously."""
    try:
        # Map operation types to Lambda function names
        function_mapping = {
            'listS3URIs': 'fraud-list-s3-uri',
            'listFlowURIs': 'fraud-list-flow-uri',
            'listReportURIs': 'fraud-list-reports-uri'
        }

        function_name = function_mapping.get(operation_type)
        if not function_name:
            raise ValueError(f"Unknown list operation: {operation_type}")

        logger.info(f"Invoking list function: {function_name}")

        # Invoke the list function synchronously
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='RequestResponse'  # Synchronous invocation
        )

        # Parse the response
        payload = json.loads(response['Payload'].read())

        if response['StatusCode'] == 200 and payload.get('statusCode') == 200:
            # Parse the body which contains the actual data as JSON string
            body_data = payload.get('body', '{}')
            if isinstance(body_data, str):
                try:
                    parsed_body = json.loads(body_data)
                except json.JSONDecodeError:
                    parsed_body = {}
            else:
                parsed_body = body_data

            # Send successful response back to client
            response_message = {
                'type': 'listResponse',
                'operation': operation_type,
                'data': parsed_body,
                'success': True
            }
        else:
            # Send error response back to client
            error_msg = payload.get('errorMessage', 'Unknown error')
            if payload.get('body'):
                try:
                    error_body = json.loads(payload['body']) if isinstance(
                        payload['body'], str) else payload['body']
                    error_msg = error_body.get('message', error_msg)
                except (json.JSONDecodeError, KeyError, TypeError):
                    # Unable to parse error body, use default error message
                    pass

            response_message = {
                'type': 'listResponse',
                'operation': operation_type,
                'error': error_msg,
                'success': False
            }

        send_websocket_message(connection_id, response_message)

    except Exception as e:
        logger.error(f"Error in list operation {operation_type}: {str(e)}")
        error_message = {
            'type': 'listResponse',
            'operation': operation_type,
            'error': str(e),
            'success': False
        }
        send_websocket_message(connection_id, error_message)


def lambda_handler(event, context):
    """
    WebSocket message handler for API Gateway WebSocket API.
    Receives messages from clients and handles both chat and list operations.
    """
    try:
        connection_id = event['requestContext']['connectionId']
        route_key = event['requestContext']['routeKey']

        logger.info(
            f"WebSocket message received from connection: {connection_id}, route: {route_key}")

        # Parse the message body
        if 'body' not in event:
            raise ValueError("No message body provided")

        try:
            message_data = json.loads(event['body'])
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in message body")

        # Check message type
        message_type = message_data.get('type', 'chat')

        if message_type == 'list':
            # Handle list operations
            operation = message_data.get('operation')
            if not operation:
                raise ValueError("List operation type not specified")

            handle_list_operation(connection_id, operation)

            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': f'List operation {operation} completed'
                })
            }

        elif message_type == 'chat':
            # Handle chat messages
            user_message = message_data.get('message', '').strip()
            session_id = message_data.get('sessionId', context.aws_request_id)

            if not user_message:
                raise ValueError("Empty message provided")

            logger.info(f"Processing chat message: {user_message[:100]}...")

            # Prepare payload for streaming chat handler
            streaming_payload = {
                'connectionId': connection_id,
                'message': user_message,
                'sessionId': session_id,
                'websocketEndpoint': os.environ.get('WEBSOCKET_API_ENDPOINT'),
                'timestamp': datetime.utcnow().isoformat()
            }

            # Invoke streaming chat handler asynchronously
            streaming_handler_name = os.environ.get(
                'STREAMING_CHAT_HANDLER_NAME')
            if not streaming_handler_name:
                raise ValueError(
                    "STREAMING_CHAT_HANDLER_NAME environment variable not set")

            logger.info(
                f"Invoking streaming handler: {streaming_handler_name}")

            response = lambda_client.invoke(
                FunctionName=streaming_handler_name,
                InvocationType='Event',  # Asynchronous invocation
                Payload=json.dumps(streaming_payload)
            )

            logger.info(
                f"Streaming handler invoked successfully. Status: {response['StatusCode']}")

            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Message received and processing started',
                    'sessionId': session_id
                })
            }

        else:
            raise ValueError(f"Unknown message type: {message_type}")

    except ValueError as ve:
        logger.error(
            f"Validation error in WebSocket message handler: {str(ve)}")
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'Invalid request',
                'message': str(ve)
            })
        }

    except Exception as e:
        logger.error(f"Error in WebSocket message handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
