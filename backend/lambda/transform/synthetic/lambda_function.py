import pandas as pd
import numpy as np
import boto3
import io
import json
from datetime import datetime, timedelta
from faker import Faker
import secrets

# Note: Using secrets module for cryptographically secure random generation
# This addresses security scan findings about standard pseudo-random generators

def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))
        
        # Parse input parameters from Bedrock Agent event
        if 'requestBody' in event:
            properties = event['requestBody']['content']['application/json']['properties']
            output_s3_path = next(prop['value'] for prop in properties if prop['name'] == 'output_s3_path')
            num_records = int(next(prop['value'] for prop in properties if prop['name'] == 'num_records'))
            fraud_ratio = float(next(prop['value'] for prop in properties if prop['name'] == 'fraud_ratio'))
        else:
            output_s3_path = event['output_s3_path']
            num_records = event['num_records']
            fraud_ratio = event['fraud_ratio']

        print(f"Generating {num_records} records with fraud ratio {fraud_ratio}")
        
        # Generate synthetic data
        df = generate_synthetic_transactions(num_records, fraud_ratio)
        
        # Save to S3
        s3 = boto3.client('s3')
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
                        'body': f'Generated {num_records} synthetic transactions with {int(num_records * fraud_ratio)} fraudulent transactions. Saved to {output_s3_path}'
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

def generate_synthetic_transactions(num_records, fraud_ratio):
    fake = Faker()
    
    # Generate timestamps first
    base_timestamp = datetime.now()
    timestamps = [
        (base_timestamp - timedelta(days=secrets.randbelow(365))).strftime("%Y-%m-%dT%H:%M:%SZ")
        for _ in range(num_records)
    ]
    
    # Constants
    product_categories = ['grocery_net', 'kids_pets', 'shopping_pos', 'home', 'gas_transport', 
                         'food_dining', 'entertainment', 'health_fitness', 'shopping_net', 'travel', 
                         'misc_pos']
    currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR']
    
    # Create data dictionary
    data = {
        'event_timestamp': timestamps,
        'label_name': timestamps,  # Same as event_timestamp
        'event_id': [fake.uuid4() for _ in range(num_records)],
        'entity_type': ['customer'] * num_records,
        'entity_id': [f"{fake.random_number(digits=3)}-{fake.random_number(digits=2)}-{fake.random_number(digits=4)}" 
                     for _ in range(num_records)],
        'card_bin': [str(fake.random_number(digits=6)) for _ in range(num_records)],
        'customer_name': [fake.first_name() for _ in range(num_records)],
        'billing_street': [fake.street_address() for _ in range(num_records)],
        'billing_city': [fake.city() for _ in range(num_records)],
        'billing_state': [fake.state_abbr() for _ in range(num_records)],
        'billing_zip': [fake.zipcode() for _ in range(num_records)],
        'billing_latitude': [round(float(fake.latitude()), 4) for _ in range(num_records)],
        'billing_longitude': [round(float(fake.longitude()), 4) for _ in range(num_records)],
        'billing_country': ['US'] * num_records,
        'customer_job': [fake.job() for _ in range(num_records)],
        'ip_address': [fake.ipv4() for _ in range(num_records)],
        'customer_email': [fake.email() for _ in range(num_records)],
        'billing_phone': [fake.phone_number() for _ in range(num_records)],
        'user_agent': [fake.user_agent() for _ in range(num_records)],
        'product_category': [secrets.choice(product_categories) for _ in range(num_records)],
        'order_price': [round(secrets.randbelow(1000) + 1 + secrets.randbelow(100)/100, 2) for _ in range(num_records)],
        'payment_currency': [secrets.choice(currencies) for _ in range(num_records)],
        'merchant': [f"fraud_{fake.company()}" for _ in range(num_records)]
    }
    
    # Add fraud labels based on ratio
    num_fraud = int(num_records * fraud_ratio)
    fraud_indices = np.random.choice(num_records, num_fraud, replace=False)
    data['is_fraud'] = ['yes' if i in fraud_indices else 'no' for i in range(num_records)]
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    # Mask sensitive information with asterisks
    mask_fields = ['entity_id', 'billing_street', 'ip_address', 'billing_phone', 'customer_email']
    for field in mask_fields:
        df[field] = df[field].apply(lambda x: '*' * len(str(x)))
    
    # Ensure all columns are present and in the right order
    expected_columns = [
        'event_timestamp', 'label_name', 'event_id', 'entity_type', 'entity_id',
        'card_bin', 'customer_name', 'billing_street', 'billing_city', 'billing_state',
        'billing_zip', 'billing_latitude', 'billing_longitude', 'billing_country',
        'customer_job', 'ip_address', 'customer_email', 'billing_phone', 'user_agent',
        'product_category', 'order_price', 'payment_currency', 'merchant', 'is_fraud'
    ]
    
    df = df.reindex(columns=expected_columns)
    
    return df
