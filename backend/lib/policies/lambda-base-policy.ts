import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

export function createBaseLambdaPolicy(scope: cdk.Stack, name: string): iam.ManagedPolicy {
    return new iam.ManagedPolicy(scope, name, {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'logs:CreateLogGroup',
                    'logs:CreateLogStream',
                    'logs:PutLogEvents'
                ],
                resources: [
                    `arn:aws:logs:${scope.region}:${scope.account}:log-group:/aws/lambda/*`
                ]
            })
        ]
    });
}
