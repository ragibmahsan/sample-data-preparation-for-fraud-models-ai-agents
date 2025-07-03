import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';

/** 
 * Ensure that you have enabled access to foundational model
*/
const foundationModel = 'amazon.nova-lite-v1:0';

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
        domainPrefix: 'chatbot-fraud-detection'
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

    // Create all IAM roles first
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
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')
      ]
    });

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
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          'PandasLayer',
          `arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python313:3
`
        )
      ]
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
    const dataAnalysisAgent = new bedrock.CfnAgent(this, 'DataAnalysisAgent', {
      agentName: 'DataAnalysisAgent',
      description: 'Agent for data analysis and processing',
      foundationModel: foundationModel,
      instruction: `You are an expert data scientist specializing in data quality analysis, feature engineering, and ML model development. Your role is to assist users with data analysis, quality assessment, and model improvement through advanced statistical techniques and machine learning best practices. You collaborate with the Supervisor Agent to ensure coordinated execution of complex workflows.`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockDataAnalysisAgentRole.roleArn,
      agentCollaboration: 'ENABLED',
      actionGroups: [{
        actionGroupName: 'flow_creation_actions',
        description: 'Create a fraud detection flow',
        actionGroupExecutor: {
          lambda: createFlowFunction.functionArn
        },
        apiSchema: {
          payload: `{
            "openapi": "3.0.0",
            "info": {
              "title": "Fraud_Detection_Flow_API",
              "version": "1.0.0"
            },
            "paths": {
              "/create_flow": {
                "post": {
                  "operationId": "create_flow",
                  "description": "Create a new fraud detection flow",
                  "responses": {
                    "200": {
                      "description": "Flow created successfully",
                      "content": {
                        "application/json": {
                          "schema": {
                            "type": "object",
                            "properties": {
                              "flow_name": {
                                "type": "string",
                                "description": "Name of the created flow"
                              },
                              "s3_uri": {
                                "type": "string",
                                "description": "S3 URI of the created flow"
                              },
                              "status": {
                                "type": "string",
                                "description": "Status of the flow creation"
                              },
                              "message": {
                                "type": "string",
                                "description": "Result message"
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "requestBody": {
                    "required": true,
                    "content": {
                      "application/json": {
                          "schema": {
                            "type": "object",
                            "required": ["input_s3_uri", "output_s3_path", "target_column", "problem_type"],
                            "properties": {
                              "input_s3_uri": {
                                "type": "string",
                                "description": "S3 URI of the input data file"
                              },
                              "output_s3_path": {
                                "type": "string",
                                "description": "Output path for the flow file"
                              },
                              "target_column": {
                                "type": "string",
                                "description": "Name of the target column for prediction"
                              },
                              "problem_type": {
                                "type": "string",
                                "enum": ["Classification", "Regression"],
                                "description": "Type of machine learning problem"
                              }
                            }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`
        }
      },
      {
        actionGroupName: 'data_analysis_actions',
        description: 'Data analysis and processing actions',
        actionGroupExecutor: {
          lambda: processingFunction.functionArn
        },
        apiSchema: {
          payload: `{
            "openapi": "3.0.0",
            "info": {
              "title": "Data_Analysis_API",
              "version": "1.0.0"
            },
            "paths": {
              "/analyze_report": {
                "post": {
                  "operationId": "analyze_report",
                  "description": "Analyze a report from S3",
                  "responses": {
                    "200": {
                      "description": "Report analyzed successfully",
                      "content": {
                        "application/json": {
                          "schema": {
                            "type": "object",
                            "properties": {
                              "reportUri": {
                                "type": "string",
                                "description": "S3 URI of the analyzed report"
                              },
                              "data": {
                                "type": "object",
                                "description": "Analyzed report data"
                              },
                              "status": {
                                "type": "string",
                                "description": "Analysis status"
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "requestBody": {
                    "required": true,
                    "content": {
                      "application/json": {
                        "schema": {
                          "type": "object",
                          "required": ["report_uri"],
                          "properties": {
                            "report_uri": {
                              "type": "string",
                              "description": "S3 URI of the report to analyze"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              "/create_data_quality_insight": {
                "post": {
                  "operationId": "create_data_quality_insight",
                  "description": "Create data quality insight",
                  "responses": {
                    "200": {
                      "description": "Data quality insight job created successfully",
                      "content": {
                        "application/json": {
                          "schema": {
                            "type": "object",
                            "properties": {
                              "jobName": {
                                "type": "string",
                                "description": "Name of the created job"
                              },
                              "jobArn": {
                                "type": "string",
                                "description": "ARN of the created job"
                              },
                              "resultsPath": {
                                "type": "string",
                                "description": "S3 path for job results"
                              },
                              "status": {
                                "type": "string",
                                "description": "Job status"
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "requestBody": {
                    "required": true,
                    "content": {
                      "application/json": {
                        "schema": {
                          "type": "object",
                          "required": ["flow_s3_uri", "transactions_s3_uri"],
                          "properties": {
                            "flow_s3_uri": {
                              "type": "string",
                              "description": "S3 URI of the flow file"
                            },
                            "transactions_s3_uri": {
                              "type": "string",
                              "description": "S3 URI of the transactions file"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`
        }
      }]
    });

    // Create data analysis agent alias
    const dataAnalysisAgentAlias = new bedrock.CfnAgentAlias(this, 'DataAnalysisAgentAlias', {
      agentAliasName: 'prod',
      agentId: dataAnalysisAgent.attrAgentId
    });

    // Create Bedrock supervisor agent
    const supervisorAgent = new bedrock.CfnAgent(this, 'SupervisorAgent', {
      agentName: 'SupervisorAgent',
      description: 'Supervisor agent for orchestrating data analysis',
      foundationModel: foundationModel,
      instruction: `You are a supervisor agent responsible for coordinating data analysis tasks. You work with the Data Analysis Agent to ensure proper execution of data processing and analysis workflows.`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockSupervisorAgentRole.roleArn,
      agentCollaboration: 'ENABLED',
      agentCollaborators: [{
        agentDescriptor: {
          aliasArn: `arn:aws:bedrock:${this.region}:${this.account}:agent-alias/${dataAnalysisAgent.attrAgentId}/prod`
        },
        collaborationInstruction: `Collaborate with the Data Analysis Agent for specialized tasks including:
                                    - Data quality analysis and validation
                                    - Feature engineering and preprocessing
                                    - Model development and optimization
                                    - Statistical analysis and insights
                                    - Performance monitoring and improvement`,
        collaboratorName: 'DataAnalysisAgent',
        relayConversationHistory: 'ENABLED'
      }],
      actionGroups: [{
        actionGroupName: 'flow_creation_actions',
        description: 'Create a fraud detection flow',
        actionGroupExecutor: {
          lambda: createFlowFunction.functionArn
        },
        apiSchema: {
          payload: `{
            "openapi": "3.0.0",
            "info": {
              "title": "Fraud_Detection_Flow_API",
              "version": "1.0.0"
            },
            "paths": {
              "/create_flow": {
                "post": {
                  "operationId": "create_flow",
                  "description": "Create a new fraud detection flow",
                  "responses": {
                    "200": {
                      "description": "Flow created successfully",
                      "content": {
                        "application/json": {
                          "schema": {
                            "type": "object",
                            "properties": {
                              "flow_name": {
                                "type": "string",
                                "description": "Name of the created flow"
                              },
                              "s3_uri": {
                                "type": "string",
                                "description": "S3 URI of the created flow"
                              },
                              "status": {
                                "type": "string",
                                "description": "Status of the flow creation"
                              },
                              "message": {
                                "type": "string",
                                "description": "Result message"
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "requestBody": {
                    "required": true,
                    "content": {
                      "application/json": {
                          "schema": {
                            "type": "object",
                            "required": ["input_s3_uri", "output_s3_path", "target_column", "problem_type"],
                            "properties": {
                              "input_s3_uri": {
                                "type": "string",
                                "description": "S3 URI of the input data file"
                              },
                              "output_s3_path": {
                                "type": "string",
                                "description": "Output path for the flow file"
                              },
                              "target_column": {
                                "type": "string",
                                "description": "Name of the target column for prediction"
                              },
                              "problem_type": {
                                "type": "string",
                                "enum": ["Classification", "Regression"],
                                "description": "Type of machine learning problem"
                              }
                            }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`
        }
      }]
    });

    // Create supervisor agent alias
    const supervisorAgentAlias = new bedrock.CfnAgentAlias(this, 'SupervisorAgentAlias', {
      agentAliasName: 'prod',
      agentId: supervisorAgent.attrAgentId
    });

    // Add resource-based policy to allow Bedrock agents to invoke the functions
    createFlowFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${dataAnalysisAgent.attrAgentId}`
    });

    createFlowFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${supervisorAgent.attrAgentId}`
    });

    processingFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${dataAnalysisAgent.attrAgentId}`
    });

    processingFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${supervisorAgent.attrAgentId}`
    });

    // Update chat handler environment with agent IDs
    chatHandler.addEnvironment('BEDROCK_AGENT_ID', supervisorAgent.attrAgentId);
    chatHandler.addEnvironment('BEDROCK_AGENT_ALIAS_ID', supervisorAgentAlias.attrAgentAliasId);

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
