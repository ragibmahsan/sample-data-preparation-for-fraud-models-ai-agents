import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { CfnOutput } from 'aws-cdk-lib';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';

const foundationModel = 'amazon.nova-lite-v1:0';

export class BedrockAgentStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create IAM role for the Lambda function
    const createFlowLambdaRole = new iam.Role(this, 'CreateFlowLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // Add permissions for the Lambda to interact with Bedrock and S3
    createFlowLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:*',
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket'
        ],
        resources: [
          `arn:aws:s3:::fraud-detection-${this.account}-${this.region}`,
          `arn:aws:s3:::fraud-detection-${this.account}-${this.region}/*`
        ]
      })
    );

    // Create Lambda function for create_flow
    const createFlowFunction = new lambda.Function(this, 'CreateFlowFunction', {
      functionName: 'fraud-create-flow',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'create_flow.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/analysis/flow')),
      role: createFlowLambdaRole,
      timeout: cdk.Duration.minutes(5),
      environment: {
        BUCKET_NAME: `fraud-detection-${this.account}-${this.region}`,
        SAMPLE_SIZE: '10000',
        INSTANCE_TYPE: 'ml.m5.xlarge',
        INSTANCE_COUNT: '2'
      },
      memorySize: 1024,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          'PandasLayer',
          `arn:aws:lambda:${this.region}:336392948345:layer:AWSSDKPandas-Python312:1`
        )
      ]
    });

    // Add resource policy to allow Bedrock to invoke the Lambda
    createFlowFunction.addPermission('BedrockInvoke', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction'
    });

    // Create IAM role for the Bedrock agent
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com')
    });

    // Add required Bedrock permissions
    bedrockAgentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:*',
          'lambda:InvokeFunction'
        ],
        resources: ['*', createFlowFunction.functionArn]
      })
    );

    // Create Bedrock agent with embedded action group
    const agent = new bedrock.CfnAgent(this, 'FraudDetectionAgent', {
      agentName: 'FraudDetectionAgent',
      description: 'Agent for fraud detection flow creation',
      foundationModel: foundationModel,
        instruction: `You are an expert data scientist specializing in data quality analysis, feature engineering, and ML model development, with a focus on creating and managing data processing flows. Your role is to assist users with data analysis, quality assessment, and model improvement through advanced statistical techniques and machine learning best practices. 

You have deep expertise in analyzing data distributions, identifying quality issues, detecting outliers, and providing actionable recommendations for data cleaning and preprocessing. In feature engineering, you excel at suggesting relevant transformations, handling categorical variables, and implementing dimensionality reduction techniques while considering computational efficiency.

You utilize statistical analysis tools to perform correlation analysis, hypothesis testing, and anomaly detection, always providing quantitative metrics and confidence measures to support your findings. When responding to queries, you maintain a professional, technical tone and structure your answers to include: (1) a clear understanding of the problem, (2) detailed analysis with supporting statistics, (3) actionable recommendations with implementation guidance, and (4) potential limitations or risks to consider.

You have access to specialized tools for generating comprehensive data quality reports, providing feature engineering advice, and conducting statistical analyses. When analyzing data quality, you focus on completeness, accuracy, and consistency metrics, suggesting specific improvements and monitoring strategies. For feature engineering tasks, you consider domain knowledge, business context, and the potential impact on model performance while providing practical implementation details.

Your responses should always be precise, technically accurate, and include specific examples or metrics when applicable. You should ask clarifying questions when needed to ensure your recommendations are properly tailored to the user's specific use case and data context. You specialize in fraud detection scenarios and can provide specific insights related to transaction data analysis, pattern recognition, and anomaly detection in financial datasets.`,
      idleSessionTtlInSeconds: 300,
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      autoPrepare: true,
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
                              "agent_id": {
                                "type": "string",
                                "description": "ID of the Bedrock agent"
                              },
                              "caller_chain": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "agent_alias_arn": {
                                      "type": "string",
                                      "description": "ARN of the agent alias"
                                    }
                                  }
                                }
                              },
                              "event_time": {
                                "type": "string",
                                "format": "date-time",
                                "description": "Time of the event"
                              },
                              "model_invocation_input": {
                                "type": "object",
                                "properties": {
                                  "foundation_model": {
                                    "type": "string",
                                    "description": "The foundation model used"
                                  },
                                  "inference_configuration": {
                                    "type": "object",
                                    "properties": {
                                      "maximum_length": { "type": "integer" },
                                      "stop_sequences": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                      },
                                      "temperature": { "type": "number" },
                                      "top_k": { "type": "integer" },
                                      "top_p": { "type": "number" }
                                    }
                                  },
                                  "text": { "type": "string" },
                                  "trace_id": { "type": "string" },
                                  "type": { "type": "string" }
                                }
                              },
                              "model_invocation_output": {
                                "type": "object",
                                "properties": {
                                  "metadata": {
                                    "type": "object",
                                    "properties": {
                                      "client_request_id": { "type": "string" },
                                      "end_time": { "type": "string" },
                                      "start_time": { "type": "string" },
                                      "total_time_ms": { "type": "integer" },
                                      "usage": {
                                        "type": "object",
                                        "properties": {
                                          "input_tokens": { "type": "integer" },
                                          "output_tokens": { "type": "integer" }
                                        }
                                      }
                                    }
                                  },
                                  "raw_response": { "type": "object" },
                                  "trace_id": { "type": "string" }
                                }
                              },
                              "rationale": {
                                "type": "object",
                                "properties": {
                                  "text": {
                                    "type": "string",
                                    "description": "Rationale text"
                                  },
                                  "trace_id": {
                                    "type": "string",
                                    "description": "Trace ID"
                                  }
                                }
                              },
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

    // Outputs
    new CfnOutput(this, 'AgentId', {
      value: agent.ref,
      description: 'Bedrock Agent ID'
    });

    new CfnOutput(this, 'ActionGroupId', {
      value: `${agent.ref}/action-groups/flow_creation_actions`,
      description: 'Action Group ID'
    });

    // Create an alias for the agent
    const agentAlias = new bedrock.CfnAgentAlias(this, 'FraudDetectionAgentAlias', {
      agentAliasName: 'prod',
      agentId: agent.attrAgentId
    });

    // Output the alias ID
    new CfnOutput(this, 'AgentAliasId', {
      value: agentAlias.attrAgentAliasId,
      description: 'Bedrock Agent Alias ID'
    });
  }
}
