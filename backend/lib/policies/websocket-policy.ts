import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

export function createWebSocketPolicy(scope: cdk.Stack, name: string): iam.ManagedPolicy {
    return new iam.ManagedPolicy(scope, name, {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'execute-api:ManageConnections'
                ],
                resources: [
                    `arn:aws:execute-api:${scope.region}:${scope.account}:*/*/*/*`
                ]
            })
        ]
    });
}
