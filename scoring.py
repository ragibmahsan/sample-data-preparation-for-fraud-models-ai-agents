import os
import base64
import boto3
import json
from decimal import *

ddb = boto3.resource('dynamodb')
lookup_city = ddb.Table(os.environ['LOOKUP_CITY'])
lookup_state = ddb.Table(os.environ['LOOKUP_STATE'])
lookup_user_agent = ddb.Table(os.environ['LOOKUP_USER_AGENT'])
lookup_product_category = ddb.Table(os.environ['LOOKUP_PRODUCT_CATEGORY'])
lookup_payment_currency = ddb.Table(os.environ['LOOKUP_PAYMENT_CURRENCY'])
lookup_merchant = ddb.Table(os.environ['LOOKUP_MERCHANT'])
processed_transactions = ddb.Table(os.environ['PROCESSED_TRANSACTIONS'])

sagemaker_runtime = boto3.client(service_name="sagemaker-runtime")
inference_endpoint = os.environ['INFERENCE_ENDPOINT']


def lambda_handler(event, context):

    for partition_key, partition_value in event['records'].items():
        for record_value in partition_value:
            data = json.loads(base64.b64decode(
                record_value['value']), parse_float=Decimal)
            event_timestamp = data["event_timestamp"]
            entity_id = data["entity_id"].replace('-', "")
            card_bin = data["card_bin"]
            city = data["billing_city"]
            state = data["billing_state"]
            zip_code = data["billing_zip"]
            billing_latitude = data["billing_latitude"]
            billing_longitude = data["billing_longitude"]
            user_agent = data["user_agent"]
            product_category = data["product_category"]
            order_price = data["order_price"]
            payment_currency = data["payment_currency"]
            merchant = data["merchant"]

            # Get City
            response = lookup_city.get_item(
                Key={
                    'city_key': city
                })
            if 'Item' not in response:
                print(f"City not found: {city}")
                continue  # Skip to next record

            item = response['Item']
            city_value = item['city_value']

            # Get State
            response = lookup_state.get_item(
                Key={
                    'state_key': state
                })
            if 'Item' not in response:
                print(f"State not found: {state}")
                continue  # Skip to next record

            item = response['Item']
            state_value = item['state_value']

            # Get user_agent
            response = lookup_user_agent.get_item(
                Key={
                    'user_agent_id': user_agent
                })
            if 'Item' not in response:
                print(f"User agent not found: {user_agent}")
                continue  # Skip to next record

            item = response['Item']
            user_agent_value = item['user_agent_value']

            # Get product_category
            response = lookup_product_category.get_item(
                Key={
                    'product_category_id': product_category
                })
            if 'Item' not in response:
                print(f"Product category not found: {product_category}")
                continue  # Skip to next record

            item = response['Item']
            product_category_value = item['product_category_value']

            # Get payment_currency
            response = lookup_payment_currency.get_item(
                Key={
                    'payment_currency_id': payment_currency
                })
            if 'Item' not in response:
                print(f"Payment currency not found: {payment_currency}")
                continue  # Skip to next record

            item = response['Item']
            payment_currency_value = item['payment_currency_value']

            # Get merchant
            response = lookup_merchant.get_item(
                Key={
                    'merchant_id': merchant
                })
            if 'Item' not in response:
                print(f"Merchant not found: {merchant}")
                continue  # Skip to next record

            item = response['Item']
            merchant_value = item['merchant_value']

            # ----- Inference Endpoint Payload
            payload_json = entity_id + "," + card_bin + "," + str(city_value) + "," + str(state_value) + "," + zip_code + "," + billing_latitude + "," + billing_longitude + "," + str(
                user_agent_value) + "," + str(product_category_value) + "," + order_price + "," + str(payment_currency_value) + "," + str(merchant_value) + "," + "2022, 11, 25"

            # ----- Call Inference Endpoint
            print("Calling Inference Enpoint with payload = ", payload_json)
            response = sagemaker_runtime.invoke_endpoint(
                EndpointName=inference_endpoint,
                Body=payload_json,
                ContentType="text/csv",
            )

            fraud_score = response["Body"].read()
            fraud_score_val = float(fraud_score)
            is_fraud = "no"

            if fraud_score_val < 0.1:
                is_fraud = "no"
                print("NOT A FRAUD... Fraud score = ", fraud_score_val, ".")
            else:
                is_fraud = "yes"
                print("FRAUD... Fraud score = ", fraud_score_val, ".")

            # ----- Insert transaction into processed transactions table
            processed_transactions.put_item(
                Item={
                    "event_timestamp": data["event_timestamp"],
                    "label_name": data["label_name"],
                    "event_id": data["event_id"],
                    "entity_type": data["entity_type"],
                    "entity_id": data["entity_id"],
                    "card_bin": data["card_bin"],
                    "billing_city": data["billing_city"],
                    "billing_state": data["billing_state"],
                    "billing_zip": data["billing_zip"],
                    "billing_latitude": data["billing_latitude"],
                    "billing_longitude": data["billing_longitude"],
                    "billing_country": data["billing_country"],
                    "customer_job": data["customer_job"],
                    "ip_address": data["ip_address"],
                    "user_agent": data["user_agent"],
                    "product_category": data["product_category"],
                    "order_price": data["order_price"],
                    "payment_currency": data["payment_currency"],
                    "merchant": data["merchant"],
                    "fraud": is_fraud,
                    "fraud_score": str(round(fraud_score_val*1000))
                }
            )
