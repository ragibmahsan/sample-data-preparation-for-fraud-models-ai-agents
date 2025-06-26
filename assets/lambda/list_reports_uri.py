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
    AWS Lambda function to list available report URIs.
    :param event: dict, API Gateway event
    :param context: LambdaContext object
    :return: dict, Response with list of report URIs
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
        bucket_name = os.getenv('S3_BUCKET_NAME', 'fraud-detection-ws')
        prefix = 'processor_output/'

        # List objects in the bucket with prefix
        paginator = s3_client.get_paginator('list_objects_v2')
        reports = []

        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                # Check if the file is a visualization job JSON
                if key.endswith('data_wrangler_visualization_job.json'):
                    reports.append(f"s3://{bucket_name}/{key}")

        # Sort reports by last modified date (newest first)
        reports.sort(reverse=True)

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                'reports': reports
            })
        }

    except Exception as e:
        logger.error(f"Error listing report URIs: {str(e)}")
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
