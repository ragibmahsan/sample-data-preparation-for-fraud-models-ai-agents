import pandas as pd
import boto3
import io
import json

def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))
        
        if 'requestBody' in event:
            properties = event['requestBody']['content']['application/json']['properties']
            input_s3_path = next(prop['value'] for prop in properties if prop['name'] == 'input_s3_path')
            output_s3_path = next(prop['value'] for prop in properties if prop['name'] == 'output_s3_path')
        else:
            input_s3_path = event['input_s3_path']
            output_s3_path = event['output_s3_path']

        s3 = boto3.client('s3')
        input_bucket, input_key = input_s3_path.split('/', 3)[2:]
        
        obj = s3.get_object(Bucket=input_bucket, Key=input_key)
        df = pd.read_csv(io.BytesIO(obj['Body'].read()))
        
        if 'entity_id' in df.columns:
            df['entity_id'] = df['entity_id'].str.replace('-', '').str.replace('.', '')
        
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
                        'body': f'Entity ID cleaned. Data saved to {output_s3_path}'
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
