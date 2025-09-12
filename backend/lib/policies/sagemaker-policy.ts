import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

export function createSageMakerPolicy(scope: cdk.Stack, name: string): iam.ManagedPolicy {
    return new iam.ManagedPolicy(scope, name, {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'sagemaker:CreateProcessingJob',
                    'sagemaker:DescribeProcessingJob',
                    'sagemaker:StopProcessingJob',
                    'sagemaker:ListProcessingJobs'
                ],
                resources: [
                    `arn:aws:sagemaker:${scope.region}:${scope.account}:processing-job/*`
                ]
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'sagemaker:CreateDataWranglerFlowDefinition',
                    'sagemaker:DescribeDataWranglerFlowDefinition'
                ],
                resources: [
                    `arn:aws:sagemaker:${scope.region}:${scope.account}:flow-definition/*`
                ]
            })
        ]
    });
}
