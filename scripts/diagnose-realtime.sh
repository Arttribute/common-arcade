#!/usr/bin/env bash
set -euo pipefail
stage="${1:?deployment stage is required}"
cluster="common-arcade-${stage}"
services=$(aws ecs list-services --cluster "$cluster" --query 'serviceArns[]' --output text)
if [[ -n "$services" ]]; then
  aws ecs describe-services --cluster "$cluster" --services $services \
    --query 'services[].{service:serviceName,running:runningCount,pending:pendingCount,deployments:deployments[].{status:status,state:rolloutState,reason:rolloutStateReason},events:events[:8]}'
fi
tasks=$(aws ecs list-tasks --cluster "$cluster" --desired-status STOPPED --max-results 5 --query 'taskArns[]' --output text)
if [[ -n "$tasks" ]]; then
  aws ecs describe-tasks --cluster "$cluster" --tasks $tasks \
    --query 'tasks[].{stoppedReason:stoppedReason,stopCode:stopCode,stoppedAt:stoppedAt,containers:containers[].{name:name,exitCode:exitCode,reason:reason}}'
fi
groups=$(aws logs describe-log-groups --log-group-name-prefix "CommonArcade-${stage}-RealtimePilot" --query 'logGroups[].logGroupName' --output text)
for group in $groups; do
  aws logs filter-log-events --log-group-name "$group" --filter-pattern '?ERROR ?Error ?error ?Exception ?failed' --limit 40 \
    --query 'events[].{timestamp:timestamp,message:message}'
done
