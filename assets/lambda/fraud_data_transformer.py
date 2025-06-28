import pandas as pd
import numpy as np
import boto3
from datetime import datetime
import json


def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))  # Log the incoming event

        # Handle Bedrock Agent request format
        if 'requestBody' in event:
            try:
                # Extract values from the nested structure
                properties = event['requestBody']['content']['application/json']['properties']

                # Convert properties list to dictionary
                props = {prop['name']: prop['value'] for prop in properties}

                input_s3_path = props['input_s3_path']
                output_s3_path = props['output_s3_path']

            except Exception as e:
                print(f"Error parsing requestBody: {str(e)}")
                raise
        else:
            # Direct Lambda invocation format
            input_s3_path = event['input_s3_path']
            output_s3_path = event['output_s3_path']

        print(f"Input S3 path: {input_s3_path}")
        print(f"Output S3 path: {output_s3_path}")

        # Parse S3 paths
        input_bucket = input_s3_path.split('/')[2]
        input_key = '/'.join(input_s3_path.split('/')[3:])

        print(f"Reading from bucket: {input_bucket}, key: {input_key}")

        # Initialize S3 client
        s3 = boto3.client('s3')

        # Read data from S3
        try:
            obj = s3.get_object(Bucket=input_bucket, Key=input_key)
            df = pd.read_csv(obj['Body'])
            print(f"Successfully read data. Shape: {df.shape}")
        except Exception as e:
            print(f"Error reading from S3: {str(e)}")
            raise

        # Apply transformations
        try:
            # 1. Drop unnecessary columns
            columns_to_drop = ['label_name', 'entity_type', 'customer_name', 'billing_street',
                               'billing_country', 'billing_phone', 'customer_email', 'customer_job',
                               'entity_type', 'event_id', 'ip_address']
            df = df.drop(
                columns=[col for col in columns_to_drop if col in df.columns])
            print("Dropped unnecessary columns")

            # 2. Convert text to lowercase
            cat_cols = df.select_dtypes(include=['object']).columns
            df[cat_cols] = df[cat_cols].apply(lambda x: x.str.lower())
            print("Converted text to lowercase")

            # 3. Remove symbols from entity_id
            if 'entity_id' in df.columns:
                df['entity_id'] = df['entity_id'].str.replace(
                    '-', '').str.replace('.', '')
                print("Cleaned entity_id")

            # 4. Convert timestamp to year, month, day
            if 'event_timestamp' in df.columns:
                df['year'] = pd.to_datetime(df['event_timestamp']).dt.year
                df['month'] = pd.to_datetime(df['event_timestamp']).dt.month
                df['day'] = pd.to_datetime(df['event_timestamp']).dt.day
                df = df.drop('event_timestamp', axis=1)
                print("Processed timestamp")

            # 5. Ordinal encoding for categorical columns
            categorical_cols = ['billing_city', 'billing_state', 'merchant',
                                'payment_currency', 'product_category', 'user_agent']
            for col in categorical_cols:
                if col in df.columns:
                    df[col] = pd.Categorical(df[col]).codes
            print("Applied ordinal encoding")

            # 6. Convert entity_id to long
            if 'entity_id' in df.columns:
                df['entity_id'] = df['entity_id'].astype('int64')
                print("Converted entity_id to long")

            # 7. One-hot encode is_fraud
            if 'is_fraud' in df.columns:
                fraud_dummies = pd.get_dummies(
                    df['is_fraud'], prefix='is_fraud')
                df = pd.concat([df, fraud_dummies], axis=1)
                df = df.drop('is_fraud', axis=1)
                print("One-hot encoded is_fraud")

            # 8. Add event_time
            df['event_time'] = pd.to_datetime('now').timestamp()
            print("Added event_time")

        except Exception as e:
            print(f"Error during transformation: {str(e)}")
            raise

        # Save transformed data back to S3
        try:
            output_bucket = output_s3_path.split('/')[2]
            output_key = '/'.join(output_s3_path.split('/')[3:])

            print(f"Saving to bucket: {output_bucket}, key: {output_key}")

            csv_buffer = df.to_csv(index=False)
            s3.put_object(Bucket=output_bucket,
                          Key=output_key, Body=csv_buffer)
            print("Successfully saved transformed data")

        except Exception as e:
            print(f"Error saving to S3: {str(e)}")
            raise

        # Return response in Bedrock Agent format
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'apiPath': event.get('apiPath', ''),
                'httpMethod': event.get('httpMethod', ''),
                'httpStatusCode': 200,
                'responseBody': {
                    'application/json': {
                        'body': {
                            'message': f'Data transformed and saved to {output_s3_path}',
                            'input_shape': str(df.shape)
                        }
                    }
                }
            }
        }

    except Exception as e:
        print(f"Error in lambda_handler: {str(e)}")
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'apiPath': event.get('apiPath', ''),
                'httpMethod': event.get('httpMethod', ''),
                'httpStatusCode': 500,
                'responseBody': {
                    'application/json': {
                        'body': {
                            'error': str(e)
                        }
                    }
                }
            }
        }
