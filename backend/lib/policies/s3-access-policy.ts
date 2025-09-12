import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';

export function createS3AccessPolicy(scope: cdk.Stack, name: string, bucket: s3.Bucket, readOnly: boolean = false): iam.ManagedPolicy {
    const actions = readOnly ? 
        ['s3:GetObject', 's3:ListBucket'] :
        ['s3:GetObject', 's3:PutObject', 's3:ListBucket'];

    return new iam.ManagedPolicy(scope, name, {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions,
                resources: [
                    bucket.bucketArn,
                    `${bucket.bucketArn}/*`
                ]
            })
        ]
    });
}
