import json
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """
    WebSocket connection handler for API Gateway WebSocket API.
    Called when a client connects to the WebSocket.
    """
    try:
        connection_id = event['requestContext']['connectionId']
        logger.info(f"WebSocket connection established: {connection_id}")

        # For this implementation, we don't need to store connection IDs

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Connected successfully',
                'connectionId': connection_id
            })
        }

    except Exception as e:
        logger.error(f"Error in WebSocket connect handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Connection failed',
                'message': str(e)
            })
        }
