import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
// import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';

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

    // Shared pandas layer
    const pandasLayer = lambda.LayerVersion.fromLayerVersionArn(
        this,
        'AwsPandasLayer',
        'arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python313:3'
    )

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
    const dataAnalysisAgent = new bedrock.CfnAgent(this, 'DataAnalysisAgent', {
      agentName: 'DataAnalysisAgent',
      description: 'Agent for data analysis and processing',
      foundationModel: foundationModel,
        instruction: `You are an expert data scientist specializing in fraud detection with these capabilities:

1. Flow Creation Actions (/create_flow):
   - Create classification/regression flows from S3 data
   - Configure flow parameters (input_s3_uri, target_column, problem_type)
   - Generate data schemas and sampling configurations
   - Handle data validation and error recovery
   - Support both binary and multiclass classification

2. Data Analysis Actions (/analyze_report):
   - Analyze reports from S3 with detailed metrics
   - Process and interpret analysis results
   - Generate comprehensive data quality insights
   - Perform statistical analysis and hypothesis testing
   - Identify patterns and anomalies in data

3. Data Quality Actions (/create_data_quality_insight):
   - Create and configure data quality assessment jobs
   - Monitor completeness, accuracy, and consistency
   - Generate quality metrics and recommendations
   - Track data drift and distribution changes
   - Provide actionable improvement suggestions

4. Feature Engineering Capabilities:
   - Suggest optimal data transformations
   - Handle categorical and numerical features
   - Implement dimensionality reduction
   - Perform correlation analysis
   - Create derived features for fraud detection

5. ML Model Development:
   - Select appropriate algorithms
   - Configure model parameters
   - Evaluate model performance
   - Handle class imbalance
   - Implement cross-validation strategies

You should maintain a professional, technical tone and structure responses with:
1. Clear problem understanding
2. Detailed analysis with supporting statistics
3. Actionable recommendations
4. Implementation guidance
5. Potential limitations and risks

Focus on fraud detection scenarios, transaction analysis, pattern recognition, and financial anomaly detection.`,
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
          runtime: lambda.Runtime.PYTHON_3_13,
          code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform/drop')),
          layers: [pandasLayer],
          role: fraudTransformLambdaRole,
          memorySize: 10240,
          ephemeralStorageSize: cdk.Size.gibibytes(10),
          timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3))
      });

      //convert time function
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

      //symbol removal function
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

      //text to lowercase function
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

      //event time function
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

      // convert to long function
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

      // One-Hot Encode function
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

      // categorical to ordinal function
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


      // Bedrock Agent Role
      const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
          assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
          managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess')
          ]
      });

      // Bedrock Agent
      const fraudDataTransformerAgent = new bedrock.CfnAgent(this, 'FraudDataTransformerAgent', {
          agentName: 'FraudDataTransformer',
          description: 'Agent for fraud data transformation',
          foundationModel: foundationModel,
          instruction: `You are a fraud data transformation specialist that executes transformations based solely on the action type and input/output URIs.

Available Actions (each requires ONLY input_s3_path and output_s3_path):

1. drop_columns: 
   - Removes predefined unnecessary columns
   - No additional parameters needed
   - DO NOT ask which columns to drop

2. symbol_removal:
   - Cleans special characters from text fields
   - No additional parameters needed
   - DO NOT ask which columns to clean

3. text_2_lower:
   - Converts text to lowercase
   - No additional parameters needed
   - DO NOT ask which columns to convert

4. convert_timestamp:
   - Standardizes time formats
   - No additional parameters needed
   - DO NOT ask about timestamp columns

5. event_time:
   - Processes temporal sequences
   - No additional parameters needed
   - DO NOT ask about time fields

6. convert_2_long:
   - Converts numeric values to long format
   - No additional parameters needed
   - DO NOT ask which columns to convert

7. categorical_2_ord:
   - Converts categorical values to ordinal
   - No additional parameters needed
   - DO NOT ask about categorical columns

8. onehot_encode:
   - Creates binary columns for categories
   - No additional parameters needed
   - DO NOT ask which columns to encode

Operation Guidelines:
1. ONLY ask for or validate:
   - The transformation action to perform
   - Input S3 path
   - Output S3 path
2. DO NOT ask for any additional parameters
3. DO NOT ask which columns to transform
4. DO NOT request configuration options
5. Execute the transformation directly with provided paths`,
          idleSessionTtlInSeconds: 300,
          agentResourceRoleArn: bedrockAgentRole.roleArn,
          actionGroups: [
            {
              actionGroupName: 'DropColumnsActionGroup',
              description: 'Drop specified columns from the dataset',
              actionGroupExecutor: {
                lambda: dropcolumnsfunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Drop Columns API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/drop_columns": {
                      "post": {
                        "operationId": "drop_columns",
                        "description": "Drop specified columns from the dataset",
                        "responses": {
                          "200": {
                            "description": "Columns dropped successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'ConvertTimeActionGroup',
              description: 'Convert timestamp columns to standard format',
              actionGroupExecutor: {
                lambda: converttimefunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Convert Timestamp API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/convert_timestamp": {
                      "post": {
                        "operationId": "convert_timestamp",
                        "description": "Convert timestamp columns to standard format",
                        "responses": {
                          "200": {
                            "description": "Timestamp converted successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'SymbolRemovalActionGroup',
              description: 'Remove special symbols from specified columns',
              actionGroupExecutor: {
                lambda: symbolremovalfunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Symbol Removal API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/symbol_removal": {
                      "post": {
                        "operationId": "symbol_removal",
                        "description": "Remove special symbols from specified columns",
                        "responses": {
                          "200": {
                            "description": "Symbols removed successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'TextLowercaseActionGroup',
              description: 'Convert text to lowercase',
              actionGroupExecutor: {
                lambda: text2lowerfunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Text to Lowercase API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/text_2_lower": {
                      "post": {
                        "operationId": "text_2_lower",
                        "description": "Convert text columns to lowercase",
                        "responses": {
                          "200": {
                            "description": "Text converted to lowercase successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'EventTimeActionGroup',
              description: 'Process event time data',
              actionGroupExecutor: {
                lambda: eventtimefunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Event Time API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/event_time": {
                      "post": {
                        "operationId": "event_time",
                        "description": "Process event time data",
                        "responses": {
                          "200": {
                            "description": "Event time processed successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'ConvertLongActionGroup',
              description: 'Convert columns to long format',
              actionGroupExecutor: {
                lambda: convert2longfunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Convert to Long API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/convert_2_long": {
                      "post": {
                        "operationId": "convert_2_long",
                        "description": "Convert columns to long format",
                        "responses": {
                          "200": {
                            "description": "Columns converted to long successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "action": {
                                      "type": "string",
                                      "description": "The transformation action performed"
                                    },
                                    "input_s3_path": {
                                      "type": "string",
                                      "description": "Input S3 path used"
                                    },
                                    "output_s3_path": {
                                      "type": "string",
                                      "description": "Output S3 path where data was saved"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'OneHotEncodeActionGroup',
              description: 'One-hot encode categorical columns',
              actionGroupExecutor: {
                lambda: onehotencodefunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "One-Hot Encode API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/onehot_encode": {
                      "post": {
                        "operationId": "onehot_encode",
                        "description": "One-hot encode categorical columns",
                        "responses": {
                          "200": {
                            "description": "One-hot encoding completed successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "transformed_url": {
                                      "type": "string",
                                      "description": "S3 URL of the transformed data"
                                    },
                                    "status": {
                                      "type": "string",
                                      "description": "Transformation status"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
              actionGroupName: 'CategoricalOrdinalActionGroup',
              description: 'Convert categorical columns to ordinal',
              actionGroupExecutor: {
                lambda: categorical2ordfunction.functionArn
              },
              apiSchema: {
                payload: `{
                  "openapi": "3.0.0",
                  "info": {
                    "title": "Categorical to Ordinal API",
                    "version": "1.0.0"
                  },
                  "paths": {
                    "/categorical_2_ord": {
                      "post": {
                        "operationId": "categorical_2_ord",
                        "description": "Convert categorical columns to ordinal",
                        "responses": {
                          "200": {
                            "description": "Categorical to ordinal conversion completed successfully",
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "transformed_url": {
                                      "type": "string",
                                      "description": "S3 URL of the transformed data"
                                    },
                                    "status": {
                                      "type": "string",
                                      "description": "Transformation status"
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
                                "required": ["input_s3_path", "output_s3_path"],
                                "properties": {
                                  "input_s3_path": {
                                    "type": "string",
                                    "description": "S3 path of input data"
                                  },
                                  "output_s3_path": {
                                    "type": "string",
                                    "description": "S3 path for output data"
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
            }
          ]
      });

      // Create alias here
      const fraudDataTransformerAlias = new bedrock.CfnAgentAlias(this, 'fraudDataTransformerAlias', {
          agentAliasName: 'prod',
          agentId: fraudDataTransformerAgent.attrAgentId
      });
  

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

      // Kendra Index Role
      const kendraIndexRole = new iam.Role(this, 'KendraIndexRole', {
          assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
          managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
          ]
      });

      // Kendra Data Source Role
      const kendraDataSourceRole = new iam.Role(this, 'KendraDataSourceRole', {
          assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
          managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
          ]
      });

      // kendraDataSourceRole.addToPolicy(
      //     new iam.PolicyStatement({
      //         effect: iam.Effect.ALLOW,
      //         actions: [
      //             'kendra:BatchPutDocument',
      //             'kendra:BatchDeleteDocument'
      //         ],
      //         resources: [fraudGithubIndex.attrArn]
      //     })
      // );

      // // Kendra Index
      // const fraudGithubIndex = new kendra.CfnIndex(this, 'FraudGithubIndex', {
      //     name: 'fraudgithubindex',
      //     edition: 'DEVELOPER_EDITION',
      //     roleArn: kendraIndexRole.roleArn
      // });

      // // Web Crawler Data Source
      // const githubDataSource = new kendra.CfnDataSource(this, 'GitHubDataSource', {
      //     indexId: fraudGithubIndex.attrId,
      //     name: 'GitHubSource',
      //     type: 'WEBCRAWLER',
      //     roleArn: kendraDataSourceRole.roleArn,
      //     schedule: 'cron(0 0 ? * SUN *)',
      //     dataSourceConfiguration: {
      //         webCrawlerConfiguration: {
      //             urls: {
      //                 seedUrlConfiguration: {
      //                     seedUrls: ['https://github.com/topics/fraud-detection']
      //                 }
      //             },
      //             crawlDepth: 2,
      //             maxLinksPerPage: 100,
      //             maxContentSizePerPageInMegaBytes: 50
      //         }
      //     }
      // });

    // Create Bedrock supervisor agent
    const supervisorAgent = new bedrock.CfnAgent(this, 'SupervisorAgent', {
      agentName: 'SupervisorAgent',
      description: 'Supervisor agent for orchestrating data analysis',
      foundationModel: foundationModel,
      agentCollaboration: 'SUPERVISOR',
        instruction: `You are a knowledgeable and versatile supervisor agent with deep expertise in data science, machine learning, and fraud detection. Your role encompasses both executing tasks and providing comprehensive insights on data science topics.

Core Capabilities:
1. Task Execution:
   - Efficient processing of data analysis requests
   - Flow creation and management
   - Report analysis and interpretation
   - Data quality assessment and monitoring

2. Knowledge Sharing:
   - Explaining statistical concepts and methodologies
   - Providing insights on machine learning algorithms
   - Discussing data preprocessing techniques
   - Offering guidance on feature engineering
   - Sharing best practices in model evaluation

3. Technical Expertise:
   - Statistical analysis and hypothesis testing
   - Machine learning model selection and evaluation
   - Feature importance and selection methods
   - Data visualization techniques
   - Anomaly detection approaches
   - Time series analysis
   - Model interpretability methods

4. Domain Knowledge:
   - Fraud detection patterns and indicators
   - Risk assessment methodologies
   - Transaction monitoring systems
   - Behavioral analytics
   - Compliance considerations

Interaction Style:
- Clear and educational when explaining concepts
- Precise and action-oriented for task execution
- Balanced between technical depth and accessibility
- Proactive in sharing relevant insights
- Professional and thorough in responses

Problem-Solving Approach:
1. Understand the context and requirements
2. Apply relevant statistical and ML concepts
3. Consider practical implementation aspects
4. Provide actionable recommendations
5. Explain rationale and limitations

Output Format:
- Structured and comprehensive responses
- Clear success/failure indicators for tasks
- Detailed explanations when needed
- Practical examples and use cases
- Visual representations when beneficial
- Citations of relevant methodologies`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockSupervisorAgentRole.roleArn,
      agentCollaborators: [
      {
        agentDescriptor: {
              aliasArn: dataAnalysisAgentAlias.attrAgentAliasArn
        },
              collaborationInstruction: `Collaboration Guidelines for Data Analysis:

1. Available Action Groups:

   a) flow_creation_actions (/create_flow):
      - Creates and configures fraud detection flows
      - Required parameters:
        * input_s3_uri: S3 data source location
        * target_column: Column for prediction
        * problem_type: Classification/Regression
      - Handles schema generation and validation
      - Manages sampling configuration
      - Monitors flow execution status

   b) fraud_processing_job:
      - /analyze_report endpoint:
        * Analyzes reports from S3
        * Generates detailed metrics
        * Provides statistical analysis
      - /create_data_quality_insight endpoint:
        * Creates data quality assessment jobs
        * Monitors completeness and accuracy
        * Tracks data drift patterns
        * Generates quality recommendations

2. Feature Engineering Support:
   - Recommend optimal transformations
   - Handle categorical and numerical features
   - Implement dimensionality reduction
   - Create fraud-specific derived features
   - Validate feature importance

3. Quality Control:
   - Monitor data quality metrics
   - Track data drift patterns
   - Validate transformation results
   - Ensure statistical significance
   - Maintain data integrity

4. Communication Protocol:
   - Provide detailed analysis reports
   - Include supporting statistics
   - Clear error messaging
   - Progress tracking updates
   - Performance metrics reporting`,
        collaboratorName: 'DataAnalysisAgent'
      }, {
            agentDescriptor: {
                aliasArn: dataAnalysisAgentAlias.attrAgentAliasArn
            },
            collaborationInstruction: `You are a direct and efficient Fraud Data Analysis Agent...`,
            collaboratorName: 'DataAnalysisAgent'
        }, {
            agentDescriptor: {
                aliasArn: fraudDataTransformerAlias.attrAgentAliasArn
            },
            collaborationInstruction: `Collaboration Guidelines for Fraud Detection System:

1. Interaction with DataAnalysisAgent:
   - Delegate flow creation and configuration
   - Request data analysis and quality reports
   - Monitor analysis job progress
   - Handle result interpretation
   - Coordinate feature engineering strategies

2. Interaction with TransformerAgent:
   - Orchestrate data transformation sequences
   - Direct specific cleaning operations
   - Manage feature engineering pipeline
   - Handle transformation error recovery
   - Monitor transformation quality

3. Processing and Coordination Rules:
   - Execute direct tasks without confirmation
   - Chain transformations when appropriate
   - Maintain transformation state
   - Handle error responses and retries
   - Track job progress and completion

4. Data Quality Management:
   - Validate transformation results
   - Ensure data consistency
   - Monitor quality metrics
   - Flag potential issues
   - Recommend corrective actions

5. Communication Protocol:
   - Clear task delegation
   - Explicit error handling
   - Progress updates
   - Result verification
   - Performance metrics

6. Optimization Strategies:
   - Parallel processing when possible
   - Resource utilization monitoring
   - Performance bottleneck identification
   - Batch processing coordination
   - Cache management`,
        collaboratorName: 'TransformerAgent'
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
