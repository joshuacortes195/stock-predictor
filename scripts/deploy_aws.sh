#!/usr/bin/env bash
# Deploy (or redeploy) the app to AWS Lambda as a container image behind a
# public Function URL. Idempotent: first run creates everything, later runs
# just push the new image and update the function.
#
# Prereqs:
#   - Docker running
#   - AWS CLI v2 authenticated (`aws configure`) with a default region
#   - DATABASE_URL exported (Neon Postgres connection string)
#
# Usage:  DATABASE_URL='postgresql://...' ./scripts/deploy_aws.sh
#
# Cost: Lambda always-free tier (1M requests + 400k GB-s per month) covers
# this app's demo traffic indefinitely; ECR storage for one ~1GB image is
# ~ $0.10/month, the only line item.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME=${APP_NAME:-stock-predictor}
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_HOST="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$ECR_HOST/$APP_NAME:latest"
ROLE_NAME="$APP_NAME-lambda-role"

# Match the Lambda architecture to the build machine so Docker builds
# natively (Apple Silicon -> arm64, which is also the cheaper Lambda arch).
if [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "aarch64" ]]; then
    LAMBDA_ARCH=arm64 PLATFORM=linux/arm64
else
    LAMBDA_ARCH=x86_64 PLATFORM=linux/amd64
fi

: "${DATABASE_URL:?Set DATABASE_URL to your Neon Postgres connection string}"

echo "==> Deploying $APP_NAME to $REGION ($LAMBDA_ARCH) in account $ACCOUNT_ID"

# --- ECR repository + image -------------------------------------------------
aws ecr describe-repositories --repository-names "$APP_NAME" >/dev/null 2>&1 ||
    aws ecr create-repository --repository-name "$APP_NAME" \
        --image-scanning-configuration scanOnPush=true >/dev/null
aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_HOST"

# --provenance=false: Lambda rejects the OCI attestation manifest list that
# buildx attaches by default.
docker build --platform "$PLATFORM" --provenance=false -t "$IMAGE" .
docker push "$IMAGE"

# --- execution role (CloudWatch logs only) ----------------------------------
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow",
                       "Principal": {"Service": "lambda.amazonaws.com"},
                       "Action": "sts:AssumeRole"}]
    }' >/dev/null
    aws iam attach-role-policy --role-name "$ROLE_NAME" \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    echo "==> Created IAM role, waiting for it to propagate..."
    sleep 12
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

# --- function env: reuse the existing SECRET_KEY across deploys so session
# --- cookies survive; generate one only on first create.
if EXISTING_KEY=$(aws lambda get-function-configuration --function-name "$APP_NAME" \
        --query 'Environment.Variables.SECRET_KEY' --output text 2>/dev/null) \
        && [[ "$EXISTING_KEY" != "None" && -n "$EXISTING_KEY" ]]; then
    SECRET_KEY=$EXISTING_KEY
else
    SECRET_KEY=${SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}
fi
ENV_JSON=$(python3 - "$DATABASE_URL" "$SECRET_KEY" <<'PY'
import json, sys
print(json.dumps({"Variables": {
    "DATABASE_URL": sys.argv[1],
    "SECRET_KEY": sys.argv[2],
    "COOKIE_SECURE": "1",
    "TRUST_PROXY": "1",
    "WEB_CONCURRENCY": "1",
}}))
PY
)

# --- create or update the function ------------------------------------------
if aws lambda get-function --function-name "$APP_NAME" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$APP_NAME" \
        --image-uri "$IMAGE" >/dev/null
    aws lambda wait function-updated --function-name "$APP_NAME"
    aws lambda update-function-configuration --function-name "$APP_NAME" \
        --environment "$ENV_JSON" >/dev/null
    aws lambda wait function-updated --function-name "$APP_NAME"
else
    aws lambda create-function --function-name "$APP_NAME" \
        --package-type Image --code ImageUri="$IMAGE" \
        --architectures "$LAMBDA_ARCH" --role "$ROLE_ARN" \
        --memory-size 1024 --timeout 60 \
        --environment "$ENV_JSON" >/dev/null
    aws lambda wait function-active --function-name "$APP_NAME"
fi

# --- public Function URL ------------------------------------------------------
aws lambda get-function-url-config --function-name "$APP_NAME" >/dev/null 2>&1 ||
    aws lambda create-function-url-config --function-name "$APP_NAME" \
        --auth-type NONE >/dev/null
aws lambda add-permission --function-name "$APP_NAME" \
    --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true

URL=$(aws lambda get-function-url-config --function-name "$APP_NAME" \
    --query FunctionUrl --output text)
echo "==> Deployed. App URL: $URL"
