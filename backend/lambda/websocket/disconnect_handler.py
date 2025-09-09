import json
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """
    WebSocket disconnect handler for API Gateway WebSocket API.
    Called when a client disconnects from the WebSocket.
    """
    try:
        connection_id = event['requestContext']['connectionId']
        logger.info(f"WebSocket connection disconnected: {connection_id}")

        # For this implementation, we don't need to clean up connection IDs
        # as per the requirement "no need to keep track of connection ids across sessions"

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Disconnected successfully',
                'connectionId': connection_id
            })
        }

    except Exception as e:
        logger.error(f"Error in WebSocket disconnect handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Disconnect failed',
                'message': str(e)
            })
        }
