from sagemaker.processing import Processor
from sagemaker.network import NetworkConfig
from sagemaker.processing import ProcessingInput, ProcessingOutput
from sagemaker import image_uris
import time
import uuid
import boto3
import sagemaker
import json

# Initialize boto3 and SageMaker session with specific region
boto_session = boto3.Session(region_name='us-east-2')
sagemaker_client = boto_session.client('sagemaker')
sess = sagemaker.Session(boto_session=boto_session,
                         sagemaker_client=sagemaker_client)
region = 'us-east-2'
bucket = 'fraud-detection-ws'
print(f"Data Wrangler export storage bucket: {bucket}")

# Generate unique flow export ID
flow_export_id = f"{time.strftime('%d-%H-%M-%S', time.gmtime())}-{str(uuid.uuid4())[:8]}"
flow_export_name = f"flow-{flow_export_id}"

# Configure input data source
data_sources = []
data_sources.append(ProcessingInput(
    source=f"s3://fraud-detection-ws/assets/demo_transactions_100k.csv",
    destination="/opt/ml/processing/transactions",
    input_name="transactions",
    s3_data_type="S3Prefix",
    s3_input_mode="File",
    s3_data_distribution_type="FullyReplicated"
))

# Configure output
# Using node ID from flow file
output_name = "5e3f3288-9e31-4886-a304-3951c1f4e361.default"
s3_output_prefix = f"export-{flow_export_name}/output"
s3_output_base_path = f"s3://{bucket}/{s3_output_prefix}"
print(f"Processing output base path: {s3_output_base_path}")

processing_job_output = ProcessingOutput(
    output_name=output_name,
    source="/opt/ml/processing/output",
    destination=s3_output_base_path,
    s3_upload_mode="EndOfJob"
)

# Upload flow file to S3
flow_file_name = "console_flow.flow"
s3_client = boto3.client("s3")
s3_client.upload_file(
    f"data_analysis/{flow_file_name}",
    bucket,
    f"data_wrangler_flows/{flow_export_name}.flow",
    ExtraArgs={"ServerSideEncryption": "aws:kms"}
)

flow_s3_uri = f"s3://{bucket}/data_wrangler_flows/{flow_export_name}.flow"
print(f"Data Wrangler flow {flow_file_name} uploaded to {flow_s3_uri}")

# Configure flow input
flow_input = ProcessingInput(
    source=flow_s3_uri,
    destination="/opt/ml/processing/flow",
    input_name="flow",
    s3_data_type="S3Prefix",
    s3_input_mode="File",
    s3_data_distribution_type="FullyReplicated"
)

# Job configurations
# Using the provided SageMaker execution role
iam_role = "arn:aws:iam::757523506328:role/fraud-ws-SageMakerExecutionRole-dfFpdr1I5QHi"
processing_job_name = f"fraud-detection-flow-processing-{flow_export_id}"
container_uri = f"415577184552.dkr.ecr.us-east-2.amazonaws.com/sagemaker-data-wrangler-container:5.0.9"

# Processing job settings
instance_count = 2
instance_type = "ml.m5.4xlarge"
volume_size_in_gb = 30
output_content_type = "CSV"

# Output configuration
output_config = {
    output_name: {
        "content_type": output_content_type,
    }
}

# Refit configuration
refit_trained_params = {
    "refit": False,
    "output_flow": f"fraud-detection-flow-processing-{flow_export_id}.flow"
}

# Network configuration
network_config = NetworkConfig(
    enable_network_isolation=False,
    security_group_ids=None,
    subnets=None
)

# Create and run processing job

processor = Processor(
    role=iam_role,
    image_uri=container_uri,
    instance_count=instance_count,
    instance_type=instance_type,
    volume_size_in_gb=volume_size_in_gb,
    network_config=network_config,
    sagemaker_session=sess,
    tags=[]
)

# Start Job
processor.run(
    inputs=[flow_input] + data_sources,
    outputs=[processing_job_output],
    arguments=[
        f"--output-config '{json.dumps(output_config)}'",
        f"--refit-trained-params '{json.dumps(refit_trained_params)}'"
    ],
    wait=False,
    logs=False,
    job_name=processing_job_name
)

# Print job details and wait for completion
s3_job_results_path = f"{s3_output_base_path}/{processing_job_name}/{output_name.replace('.', '/')}"
print(f"Job results will be saved to S3 path: {s3_job_results_path}")

job_result = sess.wait_for_processing_job(processing_job_name)
print("Processing job completed with status:", job_result)
