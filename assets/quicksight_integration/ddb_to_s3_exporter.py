import json
import os
import logging
from datetime import datetime
import boto3
import pandas as pd
import pyarrow.parquet as pq
from io import BytesIO

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3 = boto3.client('s3')

# Get environment variables
BUCKET_NAME = os.environ.get('BUCKET_NAME')
PREFIX = os.environ.get('PREFIX', 'ddb-streams/')


def process_record(record):
    """Process a single DynamoDB Stream record."""
    if not record.get('dynamodb', {}).get('NewImage'):
        return None

    # Get the new image (the current state of the item)
    new_image = record['dynamodb']['NewImage']

    # Convert DynamoDB types to Python types
    processed_item = {}
    for key, value in new_image.items():
        # Get the first key in the value dict (e.g., 'S', 'N', etc.)
        type_key = list(value.keys())[0]
        processed_item[key] = value[type_key]

        # Convert numeric strings to float/int
        if type_key == 'N':
            processed_item[key] = float(processed_item[key])
            # Convert to int if it's a whole number
            if processed_item[key].is_integer():
                processed_item[key] = int(processed_item[key])

    return processed_item


def lambda_handler(event, context):
    """
    Lambda handler to process DynamoDB Stream events and store them as parquet in S3.
    """
    try:
        if not BUCKET_NAME:
            raise ValueError("BUCKET_NAME environment variable is not set")

        # Process all records
        processed_records = []
        for record in event['Records']:
            processed_record = process_record(record)
            if processed_record:
                processed_records.append(processed_record)

        if not processed_records:
            logger.info("No valid records to process")
            return {
                'statusCode': 200,
                'body': json.dumps('No records to process')
            }

        # Convert to DataFrame
        df = pd.DataFrame(processed_records)

        # Convert to parquet
        parquet_buffer = BytesIO()
        df.to_parquet(parquet_buffer, engine='pyarrow')

        # Use the timestamp from the first record
        first_timestamp = processed_records[0]['event_timestamp']
        try:
            # Parse the timestamp
            dt = datetime.fromisoformat(first_timestamp)
            # Format day for folder structure
            day_path = dt.strftime('%Y/%m/%d')
            # Format time for file name
            time_str = dt.strftime('%H_%M_%S')
            # Add random suffix for uniqueness
            random_suffix = os.urandom(4).hex()
        except ValueError:
            logger.warning(
                f"Could not parse timestamp {first_timestamp}, using current time")
            now = datetime.now()
            day_path = now.strftime('%Y/%m/%d')
            time_str = now.strftime('%H_%M_%S')
            random_suffix = os.urandom(4).hex()

        s3_key = f"{PREFIX}{day_path}/{time_str}_{random_suffix}.parquet"

        # Upload to S3
        parquet_buffer.seek(0)
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=parquet_buffer.getvalue()
        )

        logger.info(
            f"Successfully processed {len(processed_records)} records and saved to s3://{BUCKET_NAME}/{s3_key}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Success',
                'records_processed': len(processed_records),
                's3_location': f"s3://{BUCKET_NAME}/{s3_key}"
            })
        }

    except Exception as e:
        logger.error(f"Error processing records: {str(e)}")
        raise
