import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class BackendStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigateway.RestApi;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        flows: {
          implicitCodeGrant: true
        },
        callbackUrls: [
          'http://localhost:3000/callback'
        ],
        logoutUrls: [
          'http://localhost:3000/login'
        ],
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE
        ]
      }
    });

    // Create API Gateway with Cognito Authorizer
    this.api = new apigateway.RestApi(this, 'ChatbotApi', {
      restApiName: 'Chatbot API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS
      }
    });

    // Create Cognito Authorizer
    const auth = new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatbotAuthorizer', {
      cognitoUserPools: [this.userPool]
    });

    // Fraud Transform Lambda Role
    const fraudTransformLambdaRole = new iam.Role(this, 'FraudTransformLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: 'fraud-transform-lambda-role',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3AccessPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:ListBucket'
              ],
              resources: [
                'arn:aws:s3:::*/*',
                'arn:aws:s3:::*'
              ]
            })
          ]
        })
      }
    });
  
    const TransformFunction = new lambda.Function(this, 'TransformFunction', {
      functionName: "fraud-data-transformer",
      description: "Transform Lambda Function",
      handler: "lambda_function.lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/transform')),
      layers: [
        new lambda.LayerVersion(this, 'pandas', {
          code: lambda.Code.fromAsset(path.join(__dirname, '../lib/layers/pandas-layer-95082f06-6857-4dd1-9ed4-9e11b42f7f69.zip')),
        })
      ],
      role: fraudTransformLambdaRole,
      memorySize: 10240,
      ephemeralStorageSize: cdk.Size.gibibytes(10), // Set the ephemeral storage size to 10240MB
      timeout: cdk.Duration.minutes(5).plus(cdk.Duration.seconds(3)) // Set the timeout to 5 minutes and 3 seconds
    });

    // Add authorizer to API Gateway
    const chatEndpoint = this.api.root.addResource('chat');
    chatEndpoint.addMethod('POST', new apigateway.LambdaIntegration(TransformFunction), {
      authorizer: auth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // Bedrock Agent Role
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
      ]
    });

    bedrockAgentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [TransformFunction.functionArn]
      })
    );

    // Bedrock Agent
    const fraudDataTransformerAgent = new bedrock.CfnAgent(this, 'FraudDataTransformerAgent', {
      agentName: 'FraudDataTransformer',
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      foundationModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
      instruction: 'You are a fraud data transformation agent that helps process and transform fraud detection data.',
      actionGroups: [{
        actionGroupName: 'TransformActionGroup',
        actionGroupExecutor: {
          lambda: TransformFunction.functionArn
        },
        apiSchema: {
          payload: JSON.stringify({
            openapi: '3.0.0',
            info: {
              title: 'Fraud Data Transformer API',
              version: '1.0.0'
            },
            paths: {
              '/transform': {
                post: {
                  summary: 'Transform fraud data',
                  operationId: 'transformData',
                  requestBody: {
                    required: true,
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            data: {
                              type: 'string',
                              description: 'Input data to transform'
                            }
                          },
                          required: ['data']
                        }
                      }
                    }
                  },
                  responses: {
                    '200': {
                      description: 'Successful transformation',
                      content: {
                        'application/json': {
                          schema: {
                            type: 'object',
                            properties: {
                              transformedData: {
                                type: 'string',
                                description: 'Transformed data result'
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          })
        }
      }]
    });

    // Grant Lambda permission to be invoked by Bedrock
    TransformFunction.addPermission('BedrockInvokePermission', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/${fraudDataTransformerAgent.attrAgentId}`
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

    // Kendra Index
    const fraudGithubIndex = new kendra.CfnIndex(this, 'FraudGithubIndex', {
      name: 'fraudgithubindex',
      edition: 'DEVELOPER_EDITION',
      roleArn: kendraIndexRole.roleArn
    });

    // GitHub Data Source (Note: Full GitHub configuration may need to be done via AWS Console)
    const githubDataSource = new kendra.CfnDataSource(this, 'GitHubDataSource', {
      indexId: fraudGithubIndex.attrId,
      name: 'GitHubSource',
      type: 'GITHUB',
      roleArn: kendraDataSourceRole.roleArn,
      schedule: 'cron(0 0 ? * SUN *)'
    });

  }
}
