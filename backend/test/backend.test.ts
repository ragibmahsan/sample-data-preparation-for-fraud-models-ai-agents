import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as Backend from '../lib/backend-stack';

describe('Backend Stack', () => {
    const app = new cdk.App();
    const stack = new Backend.BackendStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    test('Fraud Transform Lambda Role Created', () => {
        template.hasResourceProperties('AWS::IAM::Role', {
            RoleName: 'fraud-transform-lambda-role',
            AssumeRolePolicyDocument: {
                Statement: [
                    {
                        Action: 'sts:AssumeRole',
                        Effect: 'Allow',
                        Principal: {
                            Service: 'lambda.amazonaws.com'
                        }
                    }
                ],
                Version: '2012-10-17'
            },
            ManagedPolicyArns: [
                {
                    'Fn::Join': [
                        '',
                        [
                            'arn:',
                            { 'Ref': 'AWS::Partition' },
                            ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
                        ]
                    ]
                }
            ]
        });
    });

    test('Fraud Transform Lambda Role Has S3 Access Policy', () => {
        template.hasResourceProperties('AWS::IAM::Role', {
            Policies: [
                {
                    PolicyDocument: {
                        Statement: [
                            {
                                Action: [
                                    's3:GetObject',
                                    's3:PutObject',
                                    's3:ListBucket'
                                ],
                                Effect: 'Allow',
                                Resource: [
                                    'arn:aws:s3:::/',
                                    'arn:aws:s3:::*'
                                ]
                            }
                        ],
                        Version: '2012-10-17'
                    }
                }
            ]
        });
    });
});