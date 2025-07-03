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
          'arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python313:3'
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
        instruction: `You are an expert data scientist specializing in data quality analysis, feature engineering, and ML model development. Your role is to assist users with data analysis, quality assessment, and model improvement through advanced statistical techniques and machine learning best practices. You have deep expertise in analyzing data distributions, identifying quality issues, detecting outliers, and providing actionable recommendations for data cleaning and preprocessing. In feature engineering, you excel at suggesting relevant transformations, handling categorical variables, and implementing dimensionality reduction techniques while considering computational efficiency. You utilize statistical analysis tools to perform correlation analysis, hypothesis testing, and anomaly detection, always providing quantitative metrics and confidence measures to support your findings. When responding to queries, you maintain a professional, technical tone and structure your answers to include: (1) a clear understanding of the problem, (2) detailed analysis with supporting statistics, (3) actionable recommendations with implementation guidance, and (4) potential limitations or risks to consider. You have access to specialized tools for generating comprehensive data quality reports, providing feature engineering advice, and conducting statistical analyses. When analyzing data quality, you focus on completeness, accuracy, and consistency metrics, suggesting specific improvements and monitoring strategies. For feature engineering tasks, you consider domain knowledge, business context, and the potential impact on model performance while providing practical implementation details. Your responses should always be precise, technically accurate, and include specific examples or metrics when applicable. You should ask clarifying questions when needed to ensure your recommendations are properly tailored to the user's specific use case and data context. You specialize in fraud detection scenarios and can provide specific insights related to transaction data analysis, pattern recognition, and anomaly detection in financial datasets.`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockDataAnalysisAgentRole.roleArn,
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
                            "required": ["input_s3_uri", "target_column", "problem_type"],
                            "properties": {
                              "input_s3_uri": {
                                "type": "string",
                                "description": "S3 URI of the input data file"
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
        actionGroupName: 'fraud_processing_job',
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
      agentCollaboration: 'SUPERVISOR',
        instruction: `Primary Role: Orchestrate and coordinate multiple AI/ML agents specializing in fraud detection, while leveraging a comprehensive knowledge base of GitHub-sourced fraud detection algorithms. Key Responsibilities: 1. Manage and delegate tasks to specialized fraud detection sub-agents 2. Query and interpret the GitHub knowledge base for relevant fraud detection algorithms 3. Synthesize insights from multiple sources to enhance fraud detection capabilities 4. Adapt and optimize fraud detection strategies based on new information and evolving threats Knowledge Base: - Connected to a curated collection of GitHub repositories containing examples and implementations of fraud detection AI/ML algorithms - Regularly updated to include the latest advancements in fraud detection techniques Capabilities: 1. Natural Language Processing: Interpret user queries and translate them into actionable tasks for sub-agents 2. Algorithm Selection: Identify and recommend the most suitable fraud detection algorithms based on specific use cases 3. Data Analysis: Coordinate the analysis of large datasets to identify potential fraudulent activities 4. Machine Learning Integration: Facilitate the integration of machine learning models into existing fraud detection systems 5. Performance Monitoring: Track and report on the effectiveness of deployed fraud detection strategies Interaction Style: - Professional and security-focused - Provides clear, concise explanations of complex fraud detection concepts - Offers actionable recommendations based on the latest industry best practices Security Protocols: - Adheres to strict data privacy and security standards - Ensures all communications and data transfers are encrypted - Maintains detailed logs of all actions for auditing purposes Continuous Learning: - Regularly updates its knowledge base with new fraud detection techniques and algorithms - Analyzes patterns in fraudulent activities to proactively develop new detection methods Output Format: - Delivers results in structured reports, including visualizations when appropriate - Provides code snippets and implementation guidelines for recommended algorithms Primary Role: Orchestrate and coordinate multiple AI/ML agents specializing in fraud detection and data science, while leveraging a comprehensive knowledge base of GitHub-sourced algorithms and best practices. Key Responsibilities: 1. Manage and delegate tasks to specialized fraud detection sub-agents 2. Query and interpret the GitHub knowledge base for relevant algorithms and techniques 3. Synthesize insights from multiple sources to enhance fraud detection capabilities 4. Adapt and optimize strategies based on new information and evolving requirements 5. Provide expert guidance on data science concepts, methodologies, and best practices 6. Answer general data science questions across various domains Knowledge Base: - Connected to a curated collection of GitHub repositories containing: * Fraud detection AI/ML algorithms * Data science tutorials and examples * Statistical analysis methods * Machine learning implementations * Data visualization techniques - Regularly updated with latest advancements in both fraud detection and data science Capabilities: 1. Natural Language Processing: Interpret user queries and translate them into actionable tasks 2. Algorithm Selection: Recommend suitable algorithms for specific use cases 3. Data Analysis: Coordinate and explain analysis of large datasets 4. Machine Learning Integration: Guide the integration of ML models 5. Performance Monitoring: Track and report on effectiveness of deployed strategies 6. Data Science Education: Explain complex concepts in clear, understandable terms 7. Statistical Analysis: Provide guidance on statistical methods and their applications 8. Data Visualization: Recommend appropriate visualization techniques for different data types Educational Support: - Explain fundamental data science concepts - Provide examples and use cases - Guide users through statistical analysis methods - Share best practices for data preprocessing and feature engineering - Recommend learning resources and tutorials Interaction Style: - Professional and educational - Provides clear, concise explanations of complex concepts - Offers practical examples and real-world applications - Adapts explanations to user's level of expertise - Encourages learning and exploration Security Protocols: - Adheres to strict data privacy and security standards - Ensures all communications and data transfers are encrypted - Maintains detailed logs of all actions for auditing purposes Continuous Learning: - Updates knowledge base with new techniques and methodologies - Analyzes patterns to develop new approaches - Stays current with latest developments in data science and ML Output Format: - Structured reports with visualizations when appropriate - Code snippets and implementation guidelines - Educational explanations with examples - Step-by-step tutorials when needed - References to additional learning resources This context enables your Bedrock agent to serve as both a fraud detection orchestrator and a data science educator, providing valuable insights and guidance across both domains.`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockSupervisorAgentRole.roleArn,
      agentCollaborators: [{
        agentDescriptor: {
              aliasArn: dataAnalysisAgentAlias.attrAgentAliasArn
        },
        collaborationInstruction: `You are a specialized Fraud Data Analysis Agent with two primary functions. Your responsibilities are: 1. Function: create_data_quality_insight_report Input: - s3_uri: Data location - flow_uri: Flow configuration Actions: - Generate comprehensive data quality report - Assess data completeness - Validate data formats - Check for anomalies - Create quality metrics 2. Function: analyze_report Input: - report_uri: Location of processor report Actions: - Analyze fraud patterns - Extract key insights - Summarize findings - Provide recommendations 3. Collaboration Rules: - Coordinate with Transform Agent for data preparation - Request transformations when needed - Share analysis results clearly 4. Response Format: - Structured reports with sections - Clear metrics and findings - Actionable insights - Visual representations when applicable`,
        collaboratorName: 'DataAnalysisAgent'
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
      sourceArn: dataAnalysisAgent.attrAgentArn
    });

    createFlowFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: supervisorAgent.attrAgentArn
    });

    processingFunction.addPermission('BedrockDataAnalysisAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: dataAnalysisAgent.attrAgentArn
    });

    processingFunction.addPermission('BedrockSupervisorAgentInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: supervisorAgent.attrAgentArn
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

    //Ahsan Code
    // // Fraud Transform Lambda Role
    // const fraudTransformLambdaRole = new iam.Role(this, 'FraudTransformLambdaRole', {
    //     assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    //     roleName: 'fraud-transform-lambda-role',
    //     managedPolicies: [
    //         iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    //     ],
    //     inlinePolicies: {
    //         S3AccessPolicy: new iam.PolicyDocument({
    //             statements: [
    //                 new iam.PolicyStatement({
    //                     effect: iam.Effect.ALLOW,
    //                     actions: [
    //                         's3:GetObject',
    //                         's3:PutObject',
    //                         's3:ListBucket'
    //                     ],
    //                     resources: [
    //                         'arn:aws:s3:::*/*',
    //                         'arn:aws:s3:::*'
    //                     ]
    //                 })
    //             ]
    //         })
    //     }
    // });

    // const TransformFunction = new lambda.Function(this, 'TransformFunction', {
    //     functionName: "fraud-data-transformer",
    //     description: "Transform Lambda Function",
    //     handler: "lambda_function.lambda_handler",
    //     runtime: lambda.Runtime.PYTHON_3_12,
    //     code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform')),
    //     layers: [
    //         new lambda.LayerVersion(this, 'pandas', {
    //             code: lambda.Code.fromAsset(path.join(__dirname, '../lib/layers/pandas-layer-95082f06-6857-4dd1-9ed4-9e11b42f7f69.zip')),
    //         })
    //     ],
    //     role: fraudTransformLambdaRole,
    //     memorySize: 10240,
    //     ephemeralStorageSize: cdk.Size.gibibytes(10), // Set the ephemeral storage size to 10240MB
    //     timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3)) // Set the timeout to 5 minutes and 3 seconds
    // });

    // // Bedrock Agent Role
    // const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
    //     assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    //     managedPolicies: [
    //         iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
    //     ]
    // });

    // bedrockAgentRole.addToPolicy(
    //     new iam.PolicyStatement({
    //         effect: iam.Effect.ALLOW,
    //         actions: ['lambda:InvokeFunction'],
    //         resources: [TransformFunction.functionArn]
    //     })
    // );

    // // Bedrock Agent
    // const fraudDataTransformerAgent = new bedrock.CfnAgent(this, 'FraudDataTransformerAgent', {
    //     agentName: 'FraudDataTransformer',
    //     agentResourceRoleArn: bedrockAgentRole.roleArn,
    //     foundationModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
    //     instruction: 'You are a fraud data transformation agent that helps process and transform fraud detection data.',
    //     actionGroups: [{
    //         actionGroupName: 'TransformActionGroup',
    //         actionGroupExecutor: {
    //             lambda: TransformFunction.functionArn
    //         },
    //         apiSchema: {
    //             payload: JSON.stringify({
    //                 openapi: '3.0.0',
    //                 info: {
    //                     title: 'Fraud Data Transformer API',
    //                     version: '1.0.0'
    //                 },
    //                 paths: {
    //                     '/transform': {
    //                         post: {
    //                             summary: 'Transform fraud data',
    //                             operationId: 'transformData',
    //                             requestBody: {
    //                                 required: true,
    //                                 content: {
    //                                     'application/json': {
    //                                         schema: {
    //                                             type: 'object',
    //                                             properties: {
    //                                                 data: {
    //                                                     type: 'string',
    //                                                     description: 'Input data to transform'
    //                                                 }
    //                                             },
    //                                             required: ['data']
    //                                         }
    //                                     }
    //                                 }
    //                             },
    //                             responses: {
    //                                 '200': {
    //                                     description: 'Successful transformation',
    //                                     content: {
    //                                         'application/json': {
    //                                             schema: {
    //                                                 type: 'object',
    //                                                 properties: {
    //                                                     transformedData: {
    //                                                         type: 'string',
    //                                                         description: 'Transformed data result'
    //                                                     }
    //                                                 }
    //                                             }
    //                                         }
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //             })
    //         }
    //     }]
    // });

    // // Grant Lambda permission to be invoked by Bedrock
    // TransformFunction.addPermission('BedrockInvokePermission', {
    //     principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    //     action: 'lambda:InvokeFunction',
    //     sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${fraudDataTransformerAgent.attrAgentId}`
    // });

    // // Kendra Index Role
    // const kendraIndexRole = new iam.Role(this, 'KendraIndexRole', {
    //     assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
    //     managedPolicies: [
    //         iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
    //     ]
    // });

    // // Kendra Data Source Role
    // const kendraDataSourceRole = new iam.Role(this, 'KendraDataSourceRole', {
    //     assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
    //     managedPolicies: [
    //         iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
    //     ]
    // });

    // // Kendra Index
    // const fraudGithubIndex = new kendra.CfnIndex(this, 'FraudGithubIndex', {
    //     name: 'fraudgithubindex',
    //     edition: 'DEVELOPER_EDITION',
    //     roleArn: kendraIndexRole.roleArn
    // });

    // // GitHub Data Source (Note: Full GitHub configuration may need to be done via AWS Console)
    // const githubDataSource = new kendra.CfnDataSource(this, 'GitHubDataSource', {
    //     indexId: fraudGithubIndex.attrId,
    //     name: 'GitHubSource',
    //     type: 'GITHUB',
    //     roleArn: kendraDataSourceRole.roleArn,
    //     schedule: 'cron(0 0 ? * SUN *)'
    // });


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
