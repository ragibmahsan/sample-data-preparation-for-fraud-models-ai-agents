import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { bedrock, kendra } from '@cdklabs/generative-ai-cdk-constructs';
import { Agent, AgentActionGroup, AgentCollaboratorType } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock';

/** 
 * Ensure that you have enabled access to foundational model
*/
const foundationModel = 'amazon.nova-micro-v1:0';


export class BackendStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigateway.RestApi;
  public readonly bucket: s3.Bucket;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create S3 Bucket
    this.bucket = new s3.Bucket(this, 'FraudDetectionBucket', {
      bucketName: `fraud-detection-${this.account}-${this.region}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create folder structure in S3 bucket
    const folderStructure = new s3deploy.BucketDeployment(this, 'CreateFolderStructure', {
      sources: [s3deploy.Source.data('.keep', '')],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'flows'
    });

    const reportsFolder = new s3deploy.BucketDeployment(this, 'CreateReportsFolder', {
      sources: [s3deploy.Source.data('.keep', '')],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'reports'
    });

    const inputDataFolder = new s3deploy.BucketDeployment(this, 'CreateInputDataFolder', {
      sources: [s3deploy.Source.data('.keep', '')],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'input_data'
    });

    const transformedDataFolder = new s3deploy.BucketDeployment(this, 'CreateTransformedDataFolder', {
      sources: [s3deploy.Source.data('.keep', '')],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'transformed_data'
    });

    // Create Cognito User Pool
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

    // Add Cognito Domain
    const domain = this.userPool.addDomain('ChatbotDomain', {
      cognitoDomain: {
        domainPrefix: `chatbot-fraud-detection-${this.account}`
      }
    });

    // Create User Pool Client
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

    // Create API Gateway with Cognito Authorizer
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
      deploy: false // Don't deploy until all resources are created
    });

    // Create Cognito Authorizer
    const auth = new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatbotAuthorizer', {
      cognitoUserPools: [this.userPool],
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.seconds(0)
    });

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

        // Shared pandas layer
    const pandasLayer = new lambda.LayerVersion(this, 'PandasLayer', {
        code: lambda.Code.fromAsset(path.join(__dirname, '../lib/layers/pandas_layer.zip'))
    });

    // Create Lambda functions
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

    // Create processing Lambda function
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

    // Create Lambda function for create_flow with resource-based policy
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

    // Create chat handler Lambda
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

    // Create IAM role for the Bedrock data analysis agent
    const bedrockDataAnalysisAgentRole = new iam.Role(this, 'BedrockDataAnalysisAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com')
    });

    bedrockDataAnalysisAgentRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess')
    );

    bedrockDataAnalysisAgentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:*'
        ],
        resources: ['*']
      })
    );

    // Create IAM role for the Bedrock supervisor agent
    const bedrockSupervisorAgentRole = new iam.Role(this, 'BedrockSupervisorAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com')
    });

    bedrockSupervisorAgentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:*'
        ],
        resources: ['*']
      })
    );

    // Create Bedrock data analysis agent
    const dataAnalysisAgent = new bedrock.Agent(this, 'DataAnalysisAgent', {
      foundationModel: bedrock.BedrockFoundationModel.AMAZON_NOVA_MICRO_V1,
      existingRole: bedrockDataAnalysisAgentRole,
      instruction: `You are an expert data scientist specializing in data quality analysis, feature engineering, and ML model development. Your role is to assist users with data analysis, quality assessment, and model improvement through advanced statistical techniques and machine learning best practices. You have deep expertise in analyzing data distributions, identifying quality issues, detecting outliers, and providing actionable recommendations for data cleaning and preprocessing. In feature engineering, you excel at suggesting relevant transformations, handling categorical variables, and implementing dimensionality reduction techniques while considering computational efficiency. You utilize statistical analysis tools to perform correlation analysis, hypothesis testing, and anomaly detection, always providing quantitative metrics and confidence measures to support your findings. When responding to queries, you maintain a professional, technical tone and structure your answers to include: (1) a clear understanding of the problem, (2) detailed analysis with supporting statistics, (3) actionable recommendations with implementation guidance, and (4) potential limitations or risks to consider. You have access to specialized tools for generating comprehensive data quality reports, providing feature engineering advice, and conducting statistical analyses. When analyzing data quality, you focus on completeness, accuracy, and consistency metrics, suggesting specific improvements and monitoring strategies. For feature engineering tasks, you consider domain knowledge, business context, and the potential impact on model performance while providing practical implementation details. Your responses should always be precise, technically accurate, and include specific examples or metrics when applicable. You should ask clarifying questions when needed to ensure your recommendations are properly tailored to the user's specific use case and data context.`,
      idleSessionTTL: cdk.Duration.minutes(5)
    });

    // Add action groups to the data analysis agent
    dataAnalysisAgent.addActionGroup(new AgentActionGroup({
      name: 'flow_creation_actions',
      description: 'Create a fraud detection flow',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(createFlowFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/flow.json')),
      },
    ));

    dataAnalysisAgent.addActionGroup( new AgentActionGroup({
      name: 'fraud_processing_job',
      description: 'Data analysis and processing actions',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(processingFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../lib/openapi/processing.json'))
      }
    ));

//   Create data analysis agent alias
    const dataAnalysisAgentAlias = new bedrock.AgentAlias(this, 'DataAnalysisAgentAlias', {
      aliasName: 'prod',
      agent: dataAnalysisAgent,
      description: 'Production alias for Data Analysis Agent',
    });

     // Create Bedrock supervisor agent
    const supervisorAgent = new Agent(this, 'SupervisorAgent', {
      name: 'SupervisorAgent',
      instruction: `Primary Role: Orchestrate and coordinate multiple AI/ML agents specializing in fraud detection, while leveraging a comprehensive knowledge base of GitHub-sourced fraud detection algorithms. Key Responsibilities: 1. Manage and delegate tasks to specialized fraud detection sub-agents 2. Query and interpret the GitHub knowledge base for relevant fraud detection algorithms 3. Synthesize insights from multiple sources to enhance fraud detection capabilities 4. Adapt and optimize fraud detection strategies based on new information and evolving threats Knowledge Base: - Connected to a curated collection of GitHub repositories containing examples and implementations of fraud detection AI/ML algorithms - Regularly updated to include the latest advancements in fraud detection techniques Capabilities: 1. Natural Language Processing: Interpret user queries and translate them into actionable tasks for sub-agents 2. Algorithm Selection: Identify and recommend the most suitable fraud detection algorithms based on specific use cases 3. Data Analysis: Coordinate the analysis of large datasets to identify potential fraudulent activities 4. Machine Learning Integration: Facilitate the integration of machine learning models into existing fraud detection systems 5. Performance Monitoring: Track and report on the effectiveness of deployed fraud detection strategies Interaction Style: - Professional and security-focused - Provides clear, concise explanations of complex fraud detection concepts - Offers actionable recommendations based on the latest industry best practices Security Protocols: - Adheres to strict data privacy and security standards - Ensures all communications and data transfers are encrypted - Maintains detailed logs of all actions for auditing purposes Continuous Learning: - Regularly updates its knowledge base with new fraud detection techniques and algorithms - Analyzes patterns in fraudulent activities to proactively develop new detection methods Output Format: - Delivers results in structured reports, including visualizations when appropriate - Provides code snippets and implementation guidelines for recommended algorithms Primary Role: Orchestrate and coordinate multiple AI/ML agents specializing in fraud detection and data science, while leveraging a comprehensive knowledge base of GitHub-sourced algorithms and best practices. Key Responsibilities: 1. Manage and delegate tasks to specialized fraud detection sub-agents 2. Query and interpret the GitHub knowledge base for relevant algorithms and techniques 3. Synthesize insights from multiple sources to enhance fraud detection capabilities 4. Adapt and optimize strategies based on new information and evolving requirements 5. Provide expert guidance on data science concepts, methodologies, and best practices 6. Answer general data science questions across various domains Knowledge Base: - Connected to a curated collection of GitHub repositories containing: * Fraud detection AI/ML algorithms * Data science tutorials and examples * Statistical analysis methods * Machine learning implementations * Data visualization techniques - Regularly updated with latest advancements in both fraud detection and data science Capabilities: 1. Natural Language Processing: Interpret user queries and translate them into actionable tasks 2. Algorithm Selection: Recommend suitable algorithms for specific use cases 3. Data Analysis: Coordinate and explain analysis of large datasets 4. Machine Learning Integration: Guide the integration of ML models 5. Performance Monitoring: Track and report on effectiveness of deployed strategies 6. Data Science Education: Explain complex concepts in clear, understandable terms 7. Statistical Analysis: Provide guidance on statistical methods and their applications 8. Data Visualization: Recommend appropriate visualization techniques for different data types Educational Support: - Explain fundamental data science concepts - Provide examples and use cases - Guide users through statistical analysis methods - Share best practices for data preprocessing and feature engineering - Recommend learning resources and tutorials Interaction Style: - Professional and educational - Provides clear, concise explanations of complex concepts - Offers practical examples and real-world applications - Adapts explanations to user's level of expertise - Encourages learning and exploration Security Protocols: - Adheres to strict data privacy and security standards - Ensures all communications and data transfers are encrypted - Maintains detailed logs of all actions for auditing purposes Continuous Learning: - Updates knowledge base with new techniques and methodologies - Analyzes patterns to develop new approaches - Stays current with latest developments in data science and ML Output Format: - Structured reports with visualizations when appropriate - Code snippets and implementation guidelines - Educational explanations with examples - Step-by-step tutorials when needed - References to additional learning resources This context enables your Bedrock agent to serve as both a fraud detection orchestrator and a data science educator, providing valuable insights and guidance across both domains.`,
      foundationModel: bedrock.BedrockFoundationModel.AMAZON_NOVA_MICRO_V1,
      agentCollaboration: AgentCollaboratorType.SUPERVISOR,
      agentCollaborators: [
        new bedrock.AgentCollaborator({
          agentAlias: dataAnalysisAgentAlias,
          collaborationInstruction: `You are a specialized Fraud Data Analysis Agent with two primary functions. Your responsibilities are: 1. Function: create_data_quality_insight_report Input: - s3_uri: Data location - flow_uri: Flow configuration Actions: - Generate comprehensive data quality report - Assess data completeness - Validate data formats - Check for anomalies - Create quality metrics 2. Function: analyze_report Input: - report_uri: Location of processor report Actions: - Analyze fraud patterns - Extract key insights - Summarize findings - Provide recommendations 3. Collaboration Rules: - Coordinate with Transform Agent for data preparation - Request transformations when needed - Share analysis results clearly 4. Response Format: - Structured reports with sections - Clear metrics and findings - Actionable insights - Visual representations when applicable`,
          collaboratorName: 'DataAnalysisAgent'
        }),
      ],
    });

//     Create supervisor agent alias
    const supervisorAgentAlias = new bedrock.AgentAlias(this, 'SupervisorAgentAlias', {
      aliasName: 'prod',
      agent: supervisorAgent,
      description: 'Production alias for Supervisor Agent',
    });
    
   // Bedrock Agent Role
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
            iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess')
        ]
    });
    
    const transformagent = new bedrock.Agent(this, 'Transform Agent', {
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
      existingRole: bedrockAgentRole,
      instruction: 'You are a helpful and friendly agent that transforms inputted data in S3 into fraud detection data.'
    });

        // Add resource-based policy to allow Bedrock agents to invoke the functions
    createFlowFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: dataAnalysisAgent.agentArn
    });

    createFlowFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: supervisorAgent.agentArn
    });

    processingFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: dataAnalysisAgent.agentArn
    });

    processingFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: supervisorAgent.agentArn
    });

    // Update chat handler environment with agent IDs
    chatHandler.addEnvironment('BEDROCK_AGENT_ID', supervisorAgent.agentId);
    chatHandler.addEnvironment('BEDROCK_AGENT_ALIAS_ID', supervisorAgentAlias.aliasArn);

    // Create API Gateway resources and methods last
    const apiResources = {
      chat: this.api.root.addResource('chat'),
      listFlow: this.api.root.addResource('list-flow-uri'),
      listReports: this.api.root.addResource('list-report-uri'),
      listS3: this.api.root.addResource('list-s3-uri')
    };

    // Add methods to resources
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

    // Create API Gateway deployment and stage after all resources and methods are created
    const deployment = new apigateway.Deployment(this, 'ChatbotApiDeployment', {
      api: this.api
    });

    const stage = new apigateway.Stage(this, 'prod', {
      deployment
    });

    this.api.deploymentStage = stage;

   // Fraud Transform Lambda Role
    const fraudTransformLambdaRole = new iam.Role(this, 'FraudTransformLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        roleName: 'fraud-transform-lambda-role',
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
        ]
    });


    //drop_columns function
    const dropcolumnsfunction = new lambda.Function(this, 'DropColumnsFunction', {
        functionName: "drop_columns",
        description: "Drop Columns Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    //convert time function
    const converttimefunction = new lambda.Function(this, 'ConvertTimeFunction', {
        functionName: "convert_timestamp",
        description: "Convert Time Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    //symbol removal function
    const symbolremovalfunction = new lambda.Function(this, 'SymbolRemovalFunction', {
        functionName: "symbol_removal",
        description: "Convert Time Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    //text to lowercase function
    const text2lowerfunction = new lambda.Function(this, 'Text2LowercaseFunction', {
        functionName: "text_2_lower",
        description: "Text to Lowercase Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    //event time function
    const eventtimefunction = new lambda.Function(this, 'EventTimeFunction', {
        functionName: "event_time",
        description: "Event Time Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    // convert to long function
    const convert2longfunction = new lambda.Function(this, 'Convert2LongFunction', {
        functionName: "convert_2_long",
        description: "Event Time Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

        // One-Hot Encode function
    const onehotencodefunction = new lambda.Function(this, 'OneHotEncodeFunction', {
        functionName: "onehot_encode",
        description: "One Hot Encode Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

      // categorical to ordinal function
    const categorical2ordfunction = new lambda.Function(this, 'Categorical2OrdFunction', {
        functionName: "categorical_2_ord",
        description: "Categorical to Ordinal Lambda Function",
        handler: "lambda_function.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_12,
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

    transformagent.addActionGroup(cat2ord);
    transformagent.addActionGroup(onehotencode);
    transformagent.addActionGroup(convert2long);
    transformagent.addActionGroup(eventtime);
    transformagent.addActionGroup(text2lower);
    transformagent.addActionGroup(symbolremoval);
    transformagent.addActionGroup(converttime);
    transformagent.addActionGroup(dropcol);

    // Add permissions for Bedrock to invoke the Lambda functions
    dropcolumnsfunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    converttimefunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    symbolremovalfunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    text2lowerfunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    eventtimefunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    convert2longfunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    onehotencodefunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });
    categorical2ordfunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction'
    });


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
    //   foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
    //   instruction: 'You are a helpful and friendly agent that answers questions about fraud detection pipelines.',
    // });

    // agent.addKnowledgeBase(kb);

    // CDK Outputs
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
