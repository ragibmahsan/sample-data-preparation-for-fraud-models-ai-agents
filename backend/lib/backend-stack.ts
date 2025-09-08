import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
// import { kendra } from '@cdklabs/generative-ai-cdk-constructs';
import { Agent, AgentActionGroup, AgentCollaboratorType } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock';
import { supervisorInstruction, dataAnalysisAgentInstruction, transformAgentInstruction, supervisorDataAnalysisCollaboratorInstruction, supervisorTransformCollaboratorInstruction } from './instructions/agent-instructions';

/**
 * Ensure that you have enabled access to foundational model
 * Using the US region on-demand version of Claude 3.7
*/
const foundationModel = bedrock.CrossRegionInferenceProfile.fromConfig({
    geoRegion: bedrock.CrossRegionInferenceProfileRegion.US,
    model: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_3_7_SONNET_V1_0
})


export class BackendStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly api: apigateway.RestApi;
    public readonly bucket: s3.Bucket;

    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        /*
        Create S3 Bucket
    */
        // Create a separate bucket for access logs to follow security best practices
        const accessLogsBucket = new s3.Bucket(this, 'FraudDetectionAccessLogsBucket', {
            bucketName: `fraud-detection-access-logs-${this.account}-${this.region}`,
            versioned: false,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            lifecycleRules: [{
                id: 'DeleteOldAccessLogs',
                enabled: true,
                expiration: cdk.Duration.days(90), // Delete access logs after 90 days
            }]
        });

        this.bucket = new s3.Bucket(this, 'FraudDetectionBucket', {
            bucketName: `fraud-detection-${this.account}-${this.region}`,
            versioned: false,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            serverAccessLogsBucket: accessLogsBucket,
            serverAccessLogsPrefix: 'fraud-detection-bucket-logs/',
        });

        new s3deploy.BucketDeployment(this, 'CreateInputDataFolder', {
            sources: [
                s3deploy.Source.asset('demo_transactions')
            ],
            destinationBucket: this.bucket,
            destinationKeyPrefix: 'input_data/'
        });

        /*
        Lambda Roles
    */
        const listLambdaRole = new iam.Role(this, 'ListLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });

        listLambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    's3:ListBucket',
                    's3:GetObject'
                ],
                resources: [
                    this.bucket.bucketArn,
                    `${this.bucket.bucketArn}/*`
                ]
            })
        );

        const analysisLambdaRole = new iam.Role(this, 'AnalysisLambdaRole', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('lambda.amazonaws.com'),
                new iam.ServicePrincipal('sagemaker.amazonaws.com')
            ),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')
            ]
        });

        analysisLambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'iam:PassRole'
                ],
                resources: [
                    analysisLambdaRole.roleArn
                ]
            })
        );

        analysisLambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    's3:GetObject',
                    's3:PutObject',
                    's3:ListBucket'
                ],
                resources: [
                    this.bucket.bucketArn,
                    `${this.bucket.bucketArn}/*`
                ]
            })
        );

        const chatHandlerRole = new iam.Role(this, 'ChatHandlerRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });

        chatHandlerRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'bedrock:*'
                ],
                resources: ['*']
            })
        );

        const fraudTransformLambdaRole = new iam.Role(this, 'FraudTransformLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            roleName: 'fraud-transform-lambda-role',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
            ]
        });

        const pandasLayer = lambda.LayerVersion.fromLayerVersionArn(
            this,
            'PandasLayer',
            ssm.StringParameter.fromStringParameterAttributes(this, "PandaLayerArn", {
                parameterName: "/aws/service/aws-sdk-pandas/3.12.1/py3.13/x86_64/layer-arn"
            }).stringValue
        );

        // Layer for synthetic fraud transanction data generation
        const syntheticDataLayer = new lambda.LayerVersion(this, 'syntheticdata', {
            code: lambda.Code.fromAsset(path.join(__dirname, '../lib/layers/fraud_detection_layer.zip'))
        });

        /*
        Lambda Functions
        */
        // Functions called by API Gateway
        const listFlowUriFunction = new lambda.Function(this, 'ListFlowUriFunction', {
            functionName: 'fraud-list-flow-uri',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'list_flow_uri.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/list/flow')),
            role: listLambdaRole,
            environment: {
                S3_BUCKET_NAME: this.bucket.bucketName,
                S3_FLOW_PREFIX: 'flows'
            },
            timeout: cdk.Duration.minutes(1)
        });

        const listReportsUriFunction = new lambda.Function(this, 'ListReportsUriFunction', {
            functionName: 'fraud-list-reports-uri',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'list_reports_uri.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/list/reports')),
            role: listLambdaRole,
            environment: {
                S3_BUCKET_NAME: this.bucket.bucketName,
                S3_DATA_PREFIX: 'reports'
            },
            timeout: cdk.Duration.minutes(1)
        });

        const listS3UriFunction = new lambda.Function(this, 'ListS3UriFunction', {
            functionName: 'fraud-list-s3-uri',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'list_s3_uri.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/list/data')),
            role: listLambdaRole,
            environment: {
                S3_BUCKET_NAME: this.bucket.bucketName,
                S3_DATA_PREFIX: 'input_data'
            },
            timeout: cdk.Duration.minutes(1)
        });

        const chatHandler = new lambda.Function(this, 'ChatHandler', {
            functionName: 'fraud-chat-handler',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'chat_handler.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/chat')),
            role: chatHandlerRole,
            environment: {
                ENABLE_DEBUG: 'true',
                BEDROCK_AGENT_ID: '',  // Will be updated after supervisor agent is created
                BEDROCK_AGENT_ALIAS_ID: ''  // Will be updated after supervisor agent alias is created
            },
            timeout: cdk.Duration.minutes(5)
        });

        // Functions called by Data Analysis Agent
        const processingFunction = new lambda.Function(this, 'ProcessingFunction', {
            functionName: 'fraud-processing',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'fraud_processing_job.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/analysis/processing')),
            role: analysisLambdaRole,
            environment: {
                BUCKET_NAME: this.bucket.bucketName,
                SAGEMAKER_ROLE_ARN: analysisLambdaRole.roleArn,
                CONTAINER_URI: '663277389841.dkr.ecr.us-east-1.amazonaws.com/sagemaker-data-wrangler-container:5.0.9',
                INSTANCE_COUNT: '2',
                INSTANCE_TYPE: 'ml.m5.4xlarge',
                VOLUME_SIZE: '30'
            },
            timeout: cdk.Duration.minutes(5)
        });

        const processingFunc = new AgentActionGroup({
            name: 'fraud_processing_job',
            description: 'Execute SageMaker Data Wrangler processing jobs and analyze reports for fraud detection data quality insights.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(processingFunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/processing.yaml'))
        })

        const createFlowFunction = new lambda.Function(this, 'CreateFlowFunction', {
            functionName: 'fraud-create-flow',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'create_flow.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/analysis/flow')),
            role: analysisLambdaRole,
            timeout: cdk.Duration.minutes(5),
            environment: {
                BUCKET_NAME: this.bucket.bucketName,
                SAMPLE_SIZE: '10000',
                INSTANCE_TYPE: 'ml.m5.xlarge',
                INSTANCE_COUNT: '2'
            },
            memorySize: 1024,
            layers: [pandasLayer]
        });

        const flowFunction = new AgentActionGroup({
            name: 'flow_creation_actions',
            description: 'Create SageMaker Data Wrangler flow files for fraud detection. Use when user asks to create, make, or generate a flow.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(createFlowFunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/flow.yaml')),
        });

        // Functions called by Transformer Agent
        const syntheticDataFunction = new lambda.Function(this, 'SyntheticDataFunction', {
            functionName: 'fraud-synthetic-data',
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: 'lambda_function.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/synthetic')),
            layers: [syntheticDataLayer],
            role: fraudTransformLambdaRole,
            timeout: cdk.Duration.minutes(5),
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10)
        });

        const syntheticDataActionGroup = new AgentActionGroup({
            name: 'fraud_synthetic_data',
            description: 'Generate synthetic fraud transaction data',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(syntheticDataFunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/synthetic_data.yaml')),
        });

        const dropcolumnsfunction = new lambda.Function(this, 'DropColumnsFunction', {
            functionName: "drop_columns",
            description: "Drop Columns Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/drop')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const dropcol = new AgentActionGroup({
            name: 'drop_columns',
            description: 'Use this function to drop columns from data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(dropcolumnsfunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/dropcol.yaml')),
        });

        const converttimefunction = new lambda.Function(this, 'ConvertTimeFunction', {
            functionName: "convert_timestamp",
            description: "Convert Time Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/converttime')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const converttime = new AgentActionGroup({
            name: 'convert_time',
            description: 'Use this function to convert time data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(converttimefunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/converttime.yaml')),
        });

        const symbolremovalfunction = new lambda.Function(this, 'SymbolRemovalFunction', {
            functionName: "symbol_removal",
            description: "Convert Time Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/symbolremoval')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const symbolremoval = new AgentActionGroup({
            name: 'symbol_removal',
            description: 'Use this function to remove symbols from text data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(symbolremovalfunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/symbolremoval.yaml')),
        });

        const text2lowerfunction = new lambda.Function(this, 'Text2LowercaseFunction', {
            functionName: "text_2_lower",
            description: "Text to Lowercase Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/text2lower')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const text2lower = new AgentActionGroup({
            name: 'text_to_lowercase',
            description: 'Use this function to convert text data to lowercase.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(text2lowerfunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/text2lower.yaml')),
        });

        const eventtimefunction = new lambda.Function(this, 'EventTimeFunction', {
            functionName: "event_time",
            description: "Event Time Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/eventtime')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const eventtime = new AgentActionGroup({
            name: 'event_time',
            description: 'Use this function to convert event time data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(eventtimefunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/eventtime.yaml')),
        });

        const convert2longfunction = new lambda.Function(this, 'Convert2LongFunction', {
            functionName: "convert_2_long",
            description: "Event Time Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/convert2long')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const convert2long = new AgentActionGroup({
            name: 'convert_to_long',
            description: 'Use this function to convert data to long format.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(convert2longfunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/convert2long.yaml')),
        });

        const onehotencodefunction = new lambda.Function(this, 'OneHotEncodeFunction', {
            functionName: "onehot_encode",
            description: "One Hot Encode Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/onehotencode')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const onehotencode = new AgentActionGroup({
            name: 'one_hot_encode',
            description: 'Use this function to one-hot encode data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(onehotencodefunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/onehotencode.yaml')),
        });

        const categorical2ordfunction = new lambda.Function(this, 'Categorical2OrdFunction', {
            functionName: "categorical_2_ord",
            description: "Categorical to Ordinal Lambda Function",
            handler: "lambda_function.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_13,
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/cat2ord')),
            layers: [pandasLayer],
            role: fraudTransformLambdaRole,
            memorySize: 10240,
            ephemeralStorageSize: cdk.Size.gibibytes(10),
            timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
        });

        const cat2ord = new AgentActionGroup({
            name: 'categorical_to_ordinal',
            description: 'Use this function to convert categorical data to ordinal data.',
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(categorical2ordfunction),
            enabled: true,
            apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/cardinal2ord.yaml')),
        });

        /*
        Bedrock Worker Agents
        Data Analyst Agent
    */
        const bedrockDataAnalysisAgentRole = new iam.Role(this, 'BedrockDataAnalysisAgentRole', {
            assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess')
            ]
        });

        const dataAnalysisAgent = new bedrock.Agent(this, 'DataAnalysisAgent', {
            foundationModel: foundationModel,
            existingRole: bedrockDataAnalysisAgentRole,
            instruction: dataAnalysisAgentInstruction,
            idleSessionTTL: cdk.Duration.minutes(5),
            shouldPrepareAgent: true,
        });

        createFlowFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: dataAnalysisAgent.agentArn
        });
        dataAnalysisAgent.addActionGroup(flowFunction);

        processingFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: dataAnalysisAgent.agentArn
        });
        dataAnalysisAgent.addActionGroup(processingFunc);

        const dataAnalysisAgentAlias = new bedrock.AgentAlias(this, 'DataAnalysisAgentAlias', {
            aliasName: 'prod',
            agent: dataAnalysisAgent,
            description: 'Production alias for Data Analysis Agent',
        });
        dataAnalysisAgentAlias.node.addDependency(dataAnalysisAgent);

        // Transformer Agent
        const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
            assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess')
            ]
        });

        const transformAgent = new bedrock.Agent(this, 'TransformAgent', {
            foundationModel: foundationModel,
            existingRole: bedrockAgentRole,
            instruction: transformAgentInstruction,
            shouldPrepareAgent: true
        });

        // Add a dependency to ensure the agent is fully prepared before creating the alias
        const transformAgentAlias = new bedrock.AgentAlias(this, 'TransformAgentAlias', {
            aliasName: 'prod',
            agent: transformAgent,
            description: 'Production alias for Transform Agent'
        });
        transformAgentAlias.node.addDependency(transformAgent);

        syntheticDataFunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(syntheticDataActionGroup);

        categorical2ordfunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(cat2ord);

        onehotencodefunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(onehotencode);

        convert2longfunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(convert2long);

        eventtimefunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(eventtime);

        text2lowerfunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(text2lower);

        symbolremovalfunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(symbolremoval);

        converttimefunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(converttime);

        dropcolumnsfunction.addPermission('BedrockTransformAgentInvokePermission', {
            principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: transformAgent.agentArn
        });
        transformAgent.addActionGroup(dropcol);


        // Supervisor Agent
        const bedrockSupervisorAgentRole = new iam.Role(this, 'BedrockSupervisorAgentRole', {
            assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')]
        });

        const supervisorAgent = new Agent(this, 'SupervisorAgent', {
            name: 'SupervisorAgent',
            instruction: supervisorInstruction,
            existingRole: bedrockSupervisorAgentRole,
            foundationModel: foundationModel,
            agentCollaboration: AgentCollaboratorType.SUPERVISOR,
            agentCollaborators: [
                new bedrock.AgentCollaborator({
                    agentAlias: dataAnalysisAgentAlias,
                    collaborationInstruction: supervisorDataAnalysisCollaboratorInstruction,
                    collaboratorName: 'DataAnalysisAgent'
                }),
                new bedrock.AgentCollaborator({
                    agentAlias: transformAgentAlias,
                    collaborationInstruction: supervisorTransformCollaboratorInstruction,
                    collaboratorName: 'TransformAgent'
                })
            ],
            shouldPrepareAgent: true
        });

        const supervisorAgentAlias = new bedrock.AgentAlias(this, 'SupervisorAgentAlias', {
            aliasName: 'prod',
            agent: supervisorAgent,
            description: 'Production alias for Supervisor Agent',
        });
        supervisorAgentAlias.node.addDependency(supervisorAgent);

        chatHandler.addEnvironment('BEDROCK_AGENT_ID', supervisorAgent.agentId);
        chatHandler.addEnvironment('BEDROCK_AGENT_ALIAS_ID', supervisorAgentAlias.aliasId);

        /*
        Authentication
    */
        this.userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
            userPoolName: 'chatbot-user-pool',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true
                }
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true
            }
        });

        const domain = this.userPool.addDomain('ChatbotDomain', {
            cognitoDomain: {
                domainPrefix: `chatbot-fraud-detection-${this.account}`
            }
        });

        this.userPoolClient = this.userPool.addClient('ChatbotUserPoolClient', {
            userPoolClientName: 'chatbot-app-client',
            idTokenValidity: cdk.Duration.days(1),
            accessTokenValidity: cdk.Duration.days(1),
            authFlows: {
                userPassword: true,
                userSrp: true
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true
                },
                callbackUrls: [
                    'http://localhost:3000',
                    'http://localhost:3000/'
                ],
                logoutUrls: [
                    'http://localhost:3000',
                    'http://localhost:3000/'
                ],
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PHONE,
                    cognito.OAuthScope.PROFILE
                ]
            },
            generateSecret: false,
            preventUserExistenceErrors: true,
            supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO]
        });

        /*
        API Gateway + Integration with Cognito
    */
        this.api = new apigateway.RestApi(this, 'ChatbotApi', {
            restApiName: 'Chatbot API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'Authorization'
                ]
            },
            deploy: false, // Don't deploy until all resources are created

        });

        const auth = new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatbotAuthorizer', {
            cognitoUserPools: [this.userPool],
            identitySource: 'method.request.header.Authorization',
            resultsCacheTtl: cdk.Duration.seconds(0)
        });

        const apiResources = {
            chat: this.api.root.addResource('chat'),
            listFlow: this.api.root.addResource('list-flow-uri'),
            listReports: this.api.root.addResource('list-report-uri'),
            listS3: this.api.root.addResource('list-s3-uri')
        };

        apiResources.chat.addMethod('POST', new apigateway.LambdaIntegration(chatHandler), {
            authorizer: auth,
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizationScopes: ['email', 'openid', 'phone', 'profile']
        });

        apiResources.listFlow.addMethod('GET', new apigateway.LambdaIntegration(listFlowUriFunction), {
            authorizer: auth,
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizationScopes: ['email', 'openid', 'phone', 'profile']
        });

        apiResources.listReports.addMethod('GET', new apigateway.LambdaIntegration(listReportsUriFunction), {
            authorizer: auth,
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizationScopes: ['email', 'openid', 'phone', 'profile']
        });

        apiResources.listS3.addMethod('GET', new apigateway.LambdaIntegration(listS3UriFunction), {
            authorizer: auth,
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizationScopes: ['email', 'openid', 'phone', 'profile']
        });

        const deployment = new apigateway.Deployment(this, 'ChatbotApiDeployment', {
            api: this.api
        });

        const stage = new apigateway.Stage(this, 'prod', {
            deployment
        });

        this.api.deploymentStage = stage;


        // Uncomment the following lines if you want to create a Kendra index and knowledge base

        // const index = new kendra.KendraGenAiIndex(this, 'index', {
        //   name: 'kendra-index-cdk',
        //   documentCapacityUnits: 1, // 40K documents
        //   queryCapacityUnits: 1,    // 0.2 QPS
        // });

        // const kb = new bedrock.KendraKnowledgeBase(this, 'kb', {
        //   name: 'kendra-kb-cdk',
        //   description: 'Knowledge base for fraud detection information',
        //   kendraIndex: index,
        // });

        // const agent = new bedrock.Agent(this, 'Agent', {
        //   foundationModel: foundationModel,
        //   instruction: 'You are a helpful and friendly agent that answers questions about fraud detection pipelines.',
        // });

        // agent.addKnowledgeBase(kb);

        new CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito User Pool ID'
        });

        new CfnOutput(this, 'UserPoolClientId', {
            value: this.userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID'
        });

        new CfnOutput(this, 'ApiUrl', {
            value: this.api.url,
            description: 'API Gateway URL'
        });

        new CfnOutput(this, 'Region', {
            value: this.region,
            description: 'AWS Region'
        });

        new CfnOutput(this, 'CognitoDomain', {
            value: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito Domain URL'
        });

    }
}
