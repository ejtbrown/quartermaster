"""Small event-driven alert relay; never logs full events or reads the database."""

import json
import os


def summary(event, account, database_arn):
    if event.get("account") != account or event.get("region") != "us-east-2":
        return None
    detail = event.get("detail", {})
    source = event.get("source")
    if source == "aws.backup":
        if detail.get("resourceArn") != database_arn:
            return None
        if detail.get("state") not in {"FAILED", "ABORTED", "EXPIRED", "PARTIAL"}:
            return None
        fields = {"kind": "backup", "state": detail["state"], "job": detail.get("backupJobId")}
    elif source == "aws.codepipeline":
        if detail.get("pipeline") != "quartermaster-dev" or detail.get("state") != "FAILED":
            return None
        fields = {"kind": "deployment", "state": "FAILED", "execution": detail.get("execution-id")}
    elif source == "aws.cloudwatch":
        if detail.get("alarmName") not in {"quartermaster-dev-api-errors", "quartermaster-dev-api-throttles", "quartermaster-dev-alert-delivery"}:
            return None
        if detail.get("state", {}).get("value") != "ALARM":
            return None
        fields = {"kind": "alarm", "name": detail["alarmName"], "state": "ALARM"}
    else:
        return None
    # Do not copy statusMessage/reason: upstream text may contain user input.
    fields["time"] = event.get("time")
    return fields


def handler(event, _context):
    fields = summary(event, os.environ["QM_ACCOUNT"], os.environ["QM_DATABASE_ARN"])
    if fields is None:
        return {"published": False}
    import boto3

    boto3.client("sns").publish(
        TopicArn=os.environ["QM_TOPIC_ARN"],
        Subject="Quartermaster development needs attention",
        Message=json.dumps(fields, sort_keys=True),
    )
    return {"published": True}
