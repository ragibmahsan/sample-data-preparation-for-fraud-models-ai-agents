import os
import json
import boto3
import uuid
import logging
from datetime import datetime

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def process_fraud_detection(flow_s3_uri, transactions_s3_uri):
    """
    Core function to process fraud detection using SageMaker
    """
    try:
        # Initialize clients
        region = os.environ.get('AWS_REGION', 'us-east-2')
        sagemaker_client = boto3.client('sagemaker', region_name=region)

        # Get environment variables
        bucket = os.environ.get('BUCKET_NAME', 'fraud-detection-ws')
        iam_role = os.environ.get('SAGEMAKER_ROLE_ARN')
        container_uri = os.environ.get('CONTAINER_URI')

        # Generate unique flow export ID
        timestamp = datetime.now().strftime('%d-%H-%M-%S')
        flow_export_id = f"{timestamp}-{str(uuid.uuid4())[:8]}"

        # Set up job configuration
        output_name = "5e3f3288-9e31-4886-a304-3951c1f4e361.default"
        s3_output_prefix = f"processor_output"
        s3_output_base_path = f"s3://{bucket}/{s3_output_prefix}"

        # Validate S3 URIs
        if not flow_s3_uri:
            raise ValueError("flow_s3_uri is required")
        if not transactions_s3_uri:
            raise ValueError("transactions_s3_uri is required")

        # Configure processing job inputs and outputs
        processing_inputs = [
            {
                'InputName': 'flow',
                'S3Input': {
                    'S3Uri': flow_s3_uri,
                    'LocalPath': '/opt/ml/processing/flow',
                    'S3DataType': 'S3Prefix',
                    'S3InputMode': 'File',
                    'S3DataDistributionType': 'FullyReplicated'
                }
            },
            {
                'InputName': 'transactions',
                'S3Input': {
                    'S3Uri': transactions_s3_uri,
                    'LocalPath': '/opt/ml/processing/transactions',
                    'S3DataType': 'S3Prefix',
                    'S3InputMode': 'File',
                    'S3DataDistributionType': 'FullyReplicated'
                }
            }
        ]

        processing_outputs = {
            'Outputs': [
                {
                    'OutputName': output_name,
                    'S3Output': {
                        'S3Uri': s3_output_base_path,
                        'LocalPath': '/opt/ml/processing/output',
                        'S3UploadMode': 'EndOfJob'
                    }
                }
            ]
        }

        # Configure job settings
        processing_job_name = f"fraud-detection-flow-processing-{flow_export_id}"
        instance_count = int(os.environ.get('INSTANCE_COUNT', '2'))
        instance_type = os.environ.get('INSTANCE_TYPE', 'ml.m5.4xlarge')
        volume_size = int(os.environ.get('VOLUME_SIZE', '30'))

        # Output configuration
        output_config = {
            output_name: {
                "content_type": "CSV"
            }
        }

        # Refit configuration
        refit_trained_params = {
            "refit": False,
            "output_flow": f"fraud-detection-flow-processing-{flow_export_id}.flow"
        }

        # Create processing job
        response = sagemaker_client.create_processing_job(
            ProcessingJobName=processing_job_name,
            ProcessingResources={
                'ClusterConfig': {
                    'InstanceCount': instance_count,
                    'InstanceType': instance_type,
                    'VolumeSizeInGB': volume_size
                }
            },
            StoppingCondition={
                'MaxRuntimeInSeconds': 7200  # 2 hours
            },
            AppSpecification={
                'ImageUri': container_uri,
                'ContainerArguments': [
                    f"--output-config '{json.dumps(output_config)}'",
                    f"--refit-trained-params '{json.dumps(refit_trained_params)}'"
                ]
            },
            ProcessingInputs=processing_inputs,
            ProcessingOutputConfig=processing_outputs,
            RoleArn=iam_role,
            NetworkConfig={
                'EnableNetworkIsolation': False
            }
        )

        # Prepare response
        s3_job_results_path = f"{s3_output_base_path}/{processing_job_name}/{output_name.replace('.', '/')}"

        return {
            'jobName': processing_job_name,
            'jobArn': 'temp',  # response['ProcessingJobArn'],
            'resultsPath': s3_job_results_path,
            'status': 'InProgress'
        }

    except Exception as e:
        logger.error(f"Error in process_fraud_detection: {str(e)}")
        raise


def lambda_handler(event, context):
    """
    Lambda handler function for Bedrock agent action to start fraud processing job
    """
    try:
        # Log the full event for debugging
        logger.info(f"Received event: {json.dumps(event, indent=2)}")

        # Extract event parameters
        actionGroup = event.get('actionGroup', '')
        function = event.get('function', '')
        parameters = event.get('parameters', [])

        logger.info(f"Processing parameters: {parameters}")

        # Extract S3 URIs from parameters array
        flow_s3_uri = None
        transactions_s3_uri = None

        try:
            for param in parameters:
                if param.get('name') == 'flow_s3_uri':
                    flow_s3_uri = param.get('value')
                elif param.get('name') == 'transactions_s3_uri':
                    transactions_s3_uri = param.get('value')
        except (TypeError, AttributeError) as e:
            logger.error(f"Error parsing parameters: {str(e)}")
            raise ValueError("Invalid parameters format")

        logger.info(
            f"Extracted URIs - flow: {flow_s3_uri}, transactions: {transactions_s3_uri}")

        if not flow_s3_uri or not transactions_s3_uri:
            raise ValueError(
                "flow_s3_uri and transactions_s3_uri are required parameters")

        # Process fraud detection
        result = process_fraud_detection(flow_s3_uri, transactions_s3_uri)

        # Add informative message to result
        result_with_message = {
            **result,
            'message': 'Data quality insight job is now running. This process can take up to 2 hours to complete. You can check the job status using the provided jobName.'
        }

       # Format response to match Bedrock agent's expected schema
        api_response = {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': actionGroup,
                'function': function,
                'functionResponse': {
                    'responseState': 'REPROMPT',
                    'responseBody': {
                        'TEXT': {
                            'body': json.dumps(result_with_message)
                        }
                    }
                }
            },
            'sessionAttributes': event.get('sessionAttributes', {}),
            'promptSessionAttributes': event.get('promptSessionAttributes', {})
        }

        return api_response

    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")

        # Format error response to match Bedrock agent's expected schema
        error_response = {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': actionGroup,
                'function': function,
                'functionResponse': {
                    'responseState': 'FAILURE',
                    'responseBody': {
                        'TEXT': {
                            'body': json.dumps({
                                'error': str(e),
                                'status': 'Failed'
                            })
                        }
                    }
                }
            },
            'sessionAttributes': event.get('sessionAttributes', {}),
            'promptSessionAttributes': event.get('promptSessionAttributes', {})
        }

        return error_response
