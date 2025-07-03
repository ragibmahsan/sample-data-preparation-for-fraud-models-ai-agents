import pandas as pd
import boto3
import io
import json

def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))  # Debug print
        
        # Extract parameters from Bedrock Agent event structure
        if 'requestBody' in event:
            try:
                properties = event['requestBody']['content']['application/json']['properties']
                input_s3_path = next(prop['value'] for prop in properties if prop['name'] == 'input_s3_path')
                output_s3_path = next(prop['value'] for prop in properties if prop['name'] == 'output_s3_path')
            except Exception as e:
                print(f"Error parsing Bedrock event: {str(e)}")
                raise
        else:
            # Direct Lambda invocation format
            input_s3_path = event['input_s3_path']
            output_s3_path = event['output_s3_path']

        print(f"Input S3 path: {input_s3_path}")
        print(f"Output S3 path: {output_s3_path}")

        # Initialize S3 client
        s3 = boto3.client('s3')
        
        # Parse S3 paths
        input_bucket, input_key = input_s3_path.split('/', 3)[2:]
        
        # Read data from S3
        obj = s3.get_object(Bucket=input_bucket, Key=input_key)
        df = pd.read_csv(io.BytesIO(obj['Body'].read()))
        
        # Drop unnecessary columns
        columns_to_drop = ['label_name', 'entity_type', 'customer_name', 'billing_street', 
                          'billing_country', 'billing_phone', 'customer_email', 'customer_job', 
                          'entity_type', 'event_id', 'ip_address']
        df = df.drop(columns=[col for col in columns_to_drop if col in df.columns])
        
        # Save to S3
        output_bucket, output_key = output_s3_path.split('/', 3)[2:]
        
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        s3.put_object(Bucket=output_bucket, Key=output_key, Body=csv_buffer.getvalue())
        
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'apiPath': event.get('apiPath', ''),
                'httpMethod': event.get('httpMethod', ''),
                'httpStatusCode': 200,
                'responseBody': {
                    'application/json': {
                        'body': f'Columns dropped. Data saved to {output_s3_path}'
                    }
                }
            }
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'apiPath': event.get('apiPath', ''),
                'httpMethod': event.get('httpMethod', ''),
                'httpStatusCode': 500,
                'responseBody': {
                    'application/json': {
                        'body': f'Error: {str(e)}'
                    }
                }
            }
        }
