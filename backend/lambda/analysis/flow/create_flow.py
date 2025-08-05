import json
import logging
from datetime import datetime
import io
import pandas as pd
import boto3
import os

# Environment variables
CONTAINER_URI = os.environ.get(
    'CONTAINER_URI', '663277389841.dkr.ecr.us-east-1.amazonaws.com/sagemaker-data-wrangler-container:5.0.9')
FLOW_S3_BUCKET = os.environ.get('BUCKET_NAME')
FLOW_S3_PREFIX = os.environ.get('S3_DATA_PREFIX', 'flows')
INSTANCE_TYPE = os.environ.get('INSTANCE_TYPE', 'ml.m5.4xlarge')
INSTANCE_COUNT = int(os.environ.get('INSTANCE_COUNT', '2'))
SAMPLE_SIZE = int(os.environ.get('SAMPLE_SIZE', '50000'))

s3 = boto3.client("s3")


def generate_schema_from_s3(bucket, key, sample_rows=1000):
    # Get just the first chunk of the file using byte range
    try:
        # Request first ~1MB of data (or adjust size as needed)
        response = s3.get_object(
            Bucket=bucket,
            Key=key,
            Range='bytes=0-1048576'  # First 1MB
        )

        # Read the chunk into pandas
        chunk = pd.read_csv(
            io.BytesIO(response['Body'].read()),
            nrows=sample_rows  # Limit rows
        )

        # Type mapping
        type_mapping = {
            'object': 'string',
            'int64': 'long',
            'float64': 'float',
            'datetime64[ns]': 'datetime'
        }

        # Generate schema directly from data types
        schema = {}
        for column in chunk.columns:
            dtype = str(chunk[column].dtype)
            schema[column] = type_mapping.get(dtype, 'string')

        return {"schema": schema}

    except Exception as e:
        print(f"Error reading from S3: {str(e)}")
        return None


def parse_s3_uri(s3_uri):
    """
    Parse an S3 URI into bucket and key using string operations.

    Example:
    s3://my-bucket/path/to/file.csv -> ('my-bucket', 'path/to/file.csv')
    """
    # Remove 's3://' prefix
    if s3_uri.startswith('s3://'):
        s3_uri = s3_uri[5:]

    # Split into bucket and key at first '/'
    parts = s3_uri.split('/', 1)

    if len(parts) == 2:
        bucket, key = parts
    else:
        bucket = parts[0]
        key = ''

    return bucket, key


def generate_flow(dataset_s3_uri, target_column, problem_type):
    source_id = "35160a5f-41b4-4b77-83f4-6330bd39f912"
    transform_id = "df6590b9-209e-4019-a568-cc633f41b402"
    report_id = "6a58f2fa-9d34-4a14-a92a-9c82468e8b47"

    filename = dataset_s3_uri.split('/')[-1]
    bucket, key = parse_s3_uri(dataset_s3_uri)
    schema_result = generate_schema_from_s3(bucket, key)
    if schema_result is None:
        # If schema generation fails, use a default empty schema
        schema_result = {"schema": {}}
        logger = logging.getLogger()
        logger.warning(
            "Failed to generate schema, using empty schema as fallback")

    return {
        "metadata": {
            "version": 1,
            "disable_limits": False,
            "instance_type": INSTANCE_TYPE,
            "disable_validation": True
        },
        "parameters": [],
        "nodes": [
            {
                "node_id": source_id,
                "type": "SOURCE",
                "operator": "sagemaker.s3_source_0.1",
                "parameters": {
                        "dataset_definition": {
                            "datasetSourceType": "S3",
                            "name": filename,
                            "description": None,
                            "s3ExecutionContext": {
                                "s3Uri": dataset_s3_uri,
                                "s3ContentType": "csv",
                                "s3HasHeader": True,
                                "s3FieldDelimiter": ",",
                                "s3DirIncludesNested": False,
                                "s3AddsFilenameColumn": False,
                                "s3RoleArn": None,
                                "s3CsvEncodingType": "UTF_8",
                                "s3SkipLines": 0,
                                "s3MultiLine": False,
                                "s3DataType": "S3Prefix",
                                "s3ManifestPlain": {
                                    "s3Uris": None
                                }
                            },
                            "canvasDatasetMetadata": None
                        }
                },
                "inputs": [],
                "outputs": [
                    {
                        "name": "default",
                        "sampling": {
                                "sampling_method": "sample_by_count",
                                "sample_size": SAMPLE_SIZE
                        }
                    }
                ]
            },
            {
                "node_id": transform_id,
                "type": "TRANSFORM",
                "operator": "sagemaker.spark.infer_and_cast_type_0.1",
                "parameters": {},
                "trained_parameters": {
                        "schema": schema_result["schema"]
                },
                "inputs": [
                    {
                        "name": "default",
                        "node_id": source_id,
                        "output_name": "default"
                    }
                ],
                "outputs": [
                    {
                        "name": "default"
                    }
                ]
            },
            {
                "node_id": report_id,
                "type": "VISUALIZATION",
                "operator": "sagemaker.visualizations.data_insights_report_0.1",
                "parameters": {
                        "name": "fraud-processing-job",
                        "insights_report_parameters": {
                            "target_column": target_column,
                            "problem_type": problem_type
                        },
                    "full_data": "true",
                    "instance_type": INSTANCE_TYPE,
                    "number_of_instances": 2
                },
                "inputs": [
                    {
                        "name": "df",
                        "node_id": transform_id,
                        "output_name": "default"
                    }
                ],
                "outputs": [
                    {
                        "name": "default"
                    }
                ]
            }
        ],
        "internal_metadata": {
            "dw_job": {
                "instance_type": INSTANCE_TYPE,
                "instance_count": 2,
                "job_name": "fraud-processing-job",
                "container_uri": CONTAINER_URI,
                "outputs": [
                    f"{report_id}.default"
                ]
            }
        }

    }


def lambda_handler(event, context):
    """
    Lambda handler function for Bedrock agent action to create a flow
    """
    try:
        # Set up logging
        logger = logging.getLogger()
        logger.setLevel(logging.INFO)
        logger.info(f"Received event: {json.dumps(event, indent=2)}")

        # Extract event parameters
        actionGroup = event.get('actionGroup', '')
        apiPath = event.get('apiPath', '')

        # Extract parameters from the request body
        properties = event.get('requestBody', {}).get('content', {}).get(
            'application/json', {}).get('properties', [])

        # Extract parameters from properties
        dataset_uri = None
        target_column = None
        problem_type = None

        for prop in properties:
            prop_name = prop.get('name')
            prop_value = prop.get('value')

            if prop_name == 'input_s3_uri':
                dataset_uri = prop_value
            elif prop_name == 'target_column':
                target_column = prop_value
            elif prop_name == 'problem_type':
                problem_type = prop_value
        # Validate required parameters
        if not all([dataset_uri, target_column, problem_type]):
            raise ValueError(
                "Missing required parameters: input_s3_uri, target_column, and problem_type are required")

        # Validate problem type
        if problem_type.lower() not in ["classification", "regression"]:
            raise ValueError(
                "problem_type must be either 'Classification' or 'Regression'")

        # Standardize problem_type to match SageMaker's expected format
        # Convert to title case (e.g., "classification" -> "Classification")
        problem_type = problem_type.lower().title()

        # Generate timestamp for unique flow name
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        s3_key = f"{FLOW_S3_PREFIX}/flow-{timestamp}.flow"

        # Generate flow JSON
        flow_json = generate_flow(
            dataset_uri, target_column, problem_type)

        # Upload to S3
        flow_str = json.dumps(flow_json, indent=2)
        s3.put_object(
            Bucket=FLOW_S3_BUCKET,
            Key=s3_key,
            Body=flow_str,
            ContentType="application/json"
        )

        # Prepare success response
        result = {
            "flowName": s3_key.split('/')[-1],
            "s3Uri": f"s3://{FLOW_S3_BUCKET}/{s3_key}",
            "status": "Completed",
            "message": "Flow file generated and uploaded successfully"
        }

        # Format response for Bedrock agent
        api_response = {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': actionGroup,
                'apiPath': apiPath,
                'httpMethod': 'POST',
                'responseBody': json.dumps(result)
            },
            'sessionAttributes': event.get('sessionAttributes', {}),
            'promptSessionAttributes': event.get('promptSessionAttributes', {})
        }

        logger.info(f"API response: {json.dumps(api_response, indent=2)}")
        return api_response

    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")

        # Format error response for Bedrock agent
        error_response = {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': actionGroup,
                'apiPath': apiPath,
                'httpMethod': 'POST',
                'responseBody': json.dumps({
                    'error': str(e),
                    'status': 'Failed'
                })
            },
            'sessionAttributes': event.get('sessionAttributes', {}),
            'promptSessionAttributes': event.get('promptSessionAttributes', {})
        }

        return error_response
