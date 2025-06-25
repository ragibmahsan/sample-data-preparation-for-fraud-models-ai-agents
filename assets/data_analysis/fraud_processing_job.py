import os
import json
import boto3
import uuid
from datetime import datetime


def lambda_handler(event, context):
    """Lambda handler function to start fraud processing job"""
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
        flow_export_name = f"flow-{flow_export_id}"

        # Set up job configuration
        output_name = "5e3f3288-9e31-4886-a304-3951c1f4e361.default"
        s3_output_prefix = f"processor_output"
        s3_output_base_path = f"s3://{bucket}/{s3_output_prefix}"

        # Get S3 URIs from event input
        flow_s3_uri = event.get('flow_s3_uri')
        transactions_s3_uri = event.get('transactions_s3_uri')
        if not flow_s3_uri:
            raise ValueError("flow_s3_uri is required in event input")
        if not transactions_s3_uri:
            raise ValueError("transactions_s3_uri is required in event input")

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
            'statusCode': 200,
            'body': json.dumps({
                'jobName': processing_job_name,
                'jobArn': response['ProcessingJobArn'],
                'resultsPath': s3_job_results_path,
                'status': 'InProgress'
            })
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }
