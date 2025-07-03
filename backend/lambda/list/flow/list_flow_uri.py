import json
import boto3
import os
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the S3 client
s3_client = boto3.client('s3')


def lambda_handler(event, context):
    """
    AWS Lambda function to list available Flow URIs.
    :param event: dict, API Gateway event
    :param context: LambdaContext object
    :return: dict, Response with list of Flow URIs
    """
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                'body': ''
            }

        # Get bucket name and prefix from environment variables
        bucket_name = os.getenv('S3_BUCKET_NAME')
        prefix = os.getenv('S3_FLOW_PREFIX')

        if not bucket_name:
            raise ValueError("S3_BUCKET_NAME environment variable must be set")

        # List objects in the bucket with prefix
        response = s3_client.list_objects_v2(
            Bucket=bucket_name,
            Prefix=prefix
        )

        # Format the URIs
        flows = [f"s3://{bucket_name}/{obj['Key']}"
                 for obj in response.get('Contents', [])
                 if obj['Key'].endswith('.flow')]

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                'flows': flows
            })
        }

    except Exception as e:
        logger.error(f"Error listing Flow URIs: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
