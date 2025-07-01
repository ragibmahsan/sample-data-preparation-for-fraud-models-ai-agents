import json
from datetime import datetime
import io
import pandas as pd
import boto3

# Constants (can also come from environment variables)
CONTAINER_REPO = "663277389841.dkr.ecr.us-east-1.amazonaws.com/sagemaker-data-wrangler-container"
DEFAULT_TAG = "5.0.9"
FLOW_S3_BUCKET = "sagemaker-us-east-1-757523506328"
FLOW_S3_PREFIX = "flows"
INSTANCE_TYPE = "ml.m5.4xlarge"
INSTANCE_COUNT = 2
SAMPLE_SIZE = 50000
TARGET_COLUMN = "is_fraud"
PROBLEM_TYPE = "Classification"

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


def generate_flow(dataset_s3_uri, output_s3_path, filename):
    source_id = "35160a5f-41b4-4b77-83f4-6330bd39f912"
    transform_id = "df6590b9-209e-4019-a568-cc633f41b402"
    report_id = "6a58f2fa-9d34-4a14-a92a-9c82468e8b47"

    filename = dataset_s3_uri.split('/')[-1]
    bucket, key = parse_s3_uri(dataset_s3_uri)
    schema_result = generate_schema_from_s3(bucket, key)

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
                            "target_column": TARGET_COLUMN,
                            "problem_type": PROBLEM_TYPE
                        },
                    "full_data": "true",
                    "instance_type": INSTANCE_TYPE,
                    "number_of_instances": 2,
                    "output_config": {
                            "output_path": output_s3_path,
                            "output_content_type": "JSON"
                    }
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
                "container_uri": f"{CONTAINER_REPO}:{DEFAULT_TAG}",
                "outputs": [
                    f"{report_id}.default"
                ]
            }
        }

    }


def lambda_handler(event, context):
    dataset_uri = event.get("dataset_s3_uri")
    output_uri = event.get("output_s3_path")
    container_tag = event.get("tag", DEFAULT_TAG)

    # Filename with timestamp
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    s3_key = f"{FLOW_S3_PREFIX}/flow-{timestamp}.flow"

    flow_json = generate_flow(dataset_uri, output_uri, container_tag)
    flow_str = json.dumps(flow_json, indent=2)

    # Upload to S3
    try:
        s3.put_object(
            Bucket=FLOW_S3_BUCKET,
            Key=s3_key,
            Body=flow_str,
            ContentType="application/json"
        )
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Flow file generated and uploaded to S3",
                "s3_uri": f"s3://{FLOW_S3_BUCKET}/{s3_key}"
            })
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
