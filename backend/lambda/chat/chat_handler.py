import json
import boto3
import os
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the Bedrock agent runtime client
client = boto3.client('bedrock-agent-runtime', region_name='us-east-1')


def lambda_handler(event, context):
    """
    AWS Lambda function to invoke a Bedrock Agent.
    :param event: dict, API Gateway event or direct invocation input
    :param context: LambdaContext, AWS Lambda context object
    :return: dict, Response
    """
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
                },
                'body': ''
            }

        logger.info(f"Received event: {json.dumps(event)}")

        # Get session ID from request or create new one
        body = json.loads(event['body'])
        session_id = body.get('sessionId')
        if not session_id:
            session_id = context.aws_request_id
        logger.info(f"Session ID: {session_id}")

        # Extract Agent ID and Alias from environment variables
        agent_id = os.getenv("BEDROCK_AGENT_ID")
        agent_alias_id = os.getenv("BEDROCK_AGENT_ALIAS_ID")

        if not agent_id or not agent_alias_id:
            raise ValueError(
                "Agent ID and Alias ID must be set in environment variables. Both should be set to 'X3SLAWXSRH'.")

        # Get message from request
        input_text = body.get('message', '').strip()

        if not input_text:
            raise ValueError("Input text cannot be empty.")

        # Log the input
        logger.info(f"Invoking Bedrock Agent with input: {input_text}")

        # Call Bedrock agent
        response = client.invoke_agent(
            agentId=agent_id,
            agentAliasId=agent_alias_id,
            sessionId=session_id,
            endSession=False,
            enableTrace=True,
            inputText=input_text
        )

        # Process the streaming response
        final_answer = ''
        for event in response['completion']:
            if 'chunk' in event:
                data = event['chunk']['bytes']
                final_answer += data.decode('utf8')
                logger.info(f"Received chunk: {data.decode('utf8')}")
            elif 'trace' in event:
                logger.info("Trace event received.")
                logger.info(json.dumps(event['trace']))
            else:
                logger.info(f"Unexpected event structure: {event}")

        if not final_answer.strip():
            raise ValueError(
                "No valid response received from the Bedrock Agent.")

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
                "Access-Control-Allow-Headers": "Content-Type,Authorization"
            },
            "body": json.dumps({
                "content": final_answer,
                "sessionId": session_id
            })
        }

    except Exception as e:
        logger.error(f"Error invoking Bedrock Agent: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
                "Access-Control-Allow-Headers": "Content-Type,Authorization"
            },
            "body": json.dumps({
                "error": "Internal server error",
                "message": str(e)
            })
        }
