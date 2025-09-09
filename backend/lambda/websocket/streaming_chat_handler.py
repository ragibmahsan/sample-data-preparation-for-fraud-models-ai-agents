import json
import boto3
import os
import logging
from datetime import datetime

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_client = boto3.client('bedrock-agent-runtime')
apigateway_client = boto3.client('apigatewaymanagementapi')


def lambda_handler(event, context):
    """
    Streaming chat handler for WebSocket API.
    Processes Bedrock agent requests and streams responses back to WebSocket clients.
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

        # Extract Agent ID and Alias from environment variables
        agent_id = os.getenv("BEDROCK_AGENT_ID")
        agent_alias_id = os.getenv("BEDROCK_AGENT_ALIAS_ID")

        # Extract just the alias ID from ARN if it's a full ARN
        if agent_alias_id and agent_alias_id.startswith('arn:aws:bedrock'):
            agent_alias_id = agent_alias_id.split('/')[-1]

        if not agent_id or not agent_alias_id:
            raise ValueError(
                "Agent ID and Alias ID must be set in environment variables")

        logger.info(
            f"Using Bedrock Agent ID: {agent_id}, Alias: {agent_alias_id}")

        # Send initial acknowledgment to client
        await_message = {
            'type': 'status',
            'message': 'Processing your request...',
            'timestamp': datetime.utcnow().isoformat()
        }

        try:
            apigateway_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(await_message)
            )
        except Exception as e:
            logger.warning(f"Failed to send initial status message: {str(e)}")

        # Call Bedrock agent
        logger.info(f"Invoking Bedrock Agent with input: {user_message}")

        response = bedrock_client.invoke_agent(
            agentId=agent_id,
            agentAliasId=agent_alias_id,
            sessionId=session_id or context.aws_request_id,
            endSession=False,
            enableTrace=True,
            inputText=user_message
        )

        # Process the streaming response
        final_answer = ''
        chunk_count = 0

        for event_data in response['completion']:
            try:
                if 'chunk' in event_data:
                    chunk_data = event_data['chunk']['bytes']
                    chunk_text = chunk_data.decode('utf8')
                    final_answer += chunk_text
                    chunk_count += 1

                    logger.info(
                        f"Received chunk {chunk_count}: {chunk_text[:50]}...")

                    # Send chunk to WebSocket client
                    chunk_message = {
                        'type': 'chunk',
                        'content': chunk_text,
                        'chunkNumber': chunk_count,
                        'timestamp': datetime.utcnow().isoformat()
                    }

                    try:
                        apigateway_client.post_to_connection(
                            ConnectionId=connection_id,
                            Data=json.dumps(chunk_message)
                        )
                    except Exception as e:
                        logger.warning(
                            f"Failed to send chunk {chunk_count}: {str(e)}")
                        # If we can't send to the connection, it might be disconnected
                        if 'GoneException' in str(e):
                            logger.info(
                                f"Connection {connection_id} is gone, stopping stream")
                            break

                elif 'trace' in event_data:
                    logger.info("Trace event received")
                    trace_data = event_data['trace']

                    # Send trace information to client (optional)
                    trace_message = {
                        'type': 'trace',
                        'trace': trace_data,
                        'timestamp': datetime.utcnow().isoformat()
                    }

                    try:
                        apigateway_client.post_to_connection(
                            ConnectionId=connection_id,
                            Data=json.dumps(trace_message)
                        )
                    except Exception as e:
                        logger.warning(
                            f"Failed to send trace message: {str(e)}")

                else:
                    logger.info(f"Unexpected event structure: {event_data}")

            except Exception as e:
                logger.error(f"Error processing event data: {str(e)}")
                continue

        if not final_answer.strip():
            raise ValueError(
                "No valid response received from the Bedrock Agent")

        # Send completion message
        completion_message = {
            'type': 'complete',
            'content': final_answer,
            'sessionId': session_id,
            'totalChunks': chunk_count,
            'timestamp': datetime.utcnow().isoformat()
        }

        try:
            apigateway_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(completion_message)
            )
        except Exception as e:
            logger.warning(f"Failed to send completion message: {str(e)}")

        logger.info(
            f"Streaming completed successfully. Total chunks: {chunk_count}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Streaming completed successfully',
                'sessionId': session_id,
                'totalChunks': chunk_count
            })
        }

    except ValueError as ve:
        logger.error(f"Validation error in streaming chat handler: {str(ve)}")

        # Try to send error to client
        if 'connection_id' in locals() and 'apigateway_client' in locals():
            error_message = {
                'type': 'error',
                'error': 'Validation error',
                'message': str(ve),
                'timestamp': datetime.utcnow().isoformat()
            }

            try:
                apigateway_client.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(error_message)
                )
            except Exception as e:
                logger.warning(
                    f"Failed to send error message to client: {str(e)}")

        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'Validation error',
                'message': str(ve)
            })
        }

    except Exception as e:
        logger.error(f"Error in streaming chat handler: {str(e)}")

        # Try to send error to client
        if 'connection_id' in locals() and 'apigateway_client' in locals():
            error_message = {
                'type': 'error',
                'error': 'Internal server error',
                'message': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

            try:
                apigateway_client.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(error_message)
                )
            except Exception as e:
                logger.warning(
                    f"Failed to send error message to client: {str(e)}")

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
