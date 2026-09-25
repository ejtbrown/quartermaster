# Quartermaster AWS cost model

Status: design estimate, not a quote

## Current development decision — 2026-09-24

This section supersedes older Free-plan and twice-daily/90-day assumptions below for development. The owner selected standard CloudFront + WAF and weekly historical snapshots. Ohio native PITR remains seven days; snapshots run every 12 hours with seven-day retention, plus Sundays at 00:00 UTC with 90-day retention from creation. Overlapping windows retain the longer-lived recovery point. Existing snapshots retain their original expiry; no pruning is authorized.

At a constant illustrative 10 GB database, approximately 12 weekly snapshots older than PITR cost `12 * 10 * $0.021 = $2.52/month`, versus `$34.86` for 166 older twice-daily snapshots. Ohio backup rate rechecked 2026-09-24 via Price List SKU `PYNU7WJBSCTWR8XF`. Add database storage `$1.00` and one secret `$0.40` (regional rates in section 3.1), and standard WAF `$5/ACL + $1/rule = $6`: **$9.92/month steady-state component estimate**, saving about **$32.34/month** against the prior $42.26 example. Snapshot phase/size, PITR changed bytes and legacy recovery points affect actual cost. Savings phase in as existing recovery points expire.

Standard WAF adds `$0.60/million requests` for the current one-rule configuration. CloudFront delivery has no monthly distribution fee, but requests, transfer, edge functions and invalidations are usage-billed. Its published monthly allowances are 1 TB transfer, 10 million requests and 2 million function invocations; these are shared with other account workloads, not guaranteed incremental credits. At low usage with available allowances the combined edge is roughly $6–$7/month; this is not a cap. No Free-plan S3/DNS credits are assumed. Photo storage, S3 operations, logging, shared DNS/state, CI, active database/Lambda/AI, regional recovery, taxes and support are excluded from $9.92.

Current sources: [WAF pricing](https://aws.amazon.com/waf/pricing/), [CloudFront pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), [overlapping backup rules](https://docs.aws.amazon.com/aws-backup/latest/devguide/plan-options-and-configuration.html), [existing recovery-point retention](https://docs.aws.amazon.com/aws-backup/latest/devguide/updating-a-backup-plan.html). Checked 2026-09-24. This is a bounded update, not a refresh of all older full-product scenarios. No workload measurement or completed rollout is implied.

Currency: USD, public on-demand list prices

Pricing region: US East (Ohio), with US West (Oregon) for proposed recovery copies and CloudFront global pricing

Retrieved: 2026-09-07 for the core regional rates in section 3.1; remaining planning rates retain their 2026-08-19 provenance and need an Ohio refresh before budget approval

Scope updated: 2026-09-07 for the Ohio primary region, existing development account, separate production account after church acceptance, accepted 24-hour recovery time and data-loss tolerance, public repository, and owned mobile build machines. Recording the latest decisions changes account assumptions, not the price-retrieval dates below.

Month length: 730 hours

Architecture modeled: full target in [DESIGN.md](DESIGN.md); the deployed development subset is recorded separately in [deployment evidence](docs/DEPLOYMENT-2026-09-07.md).

Implementation update: the development data/governance foundation is deployed, including a $100/month budget and 90-day same-region snapshots. The first encrypted snapshot completed; no bill or steady workload has yet been measured. At an illustrative constant 10 GB database size, the mature retained database/secret/snapshot component is about **$36.26/month**, not $1.40; see section 5.3. This excludes activity, media, cross-region recovery, CI, other credentials, and shared-service charges. `CostScope` activation/reporting remains pending, so budget attribution is not ready despite the configured alerts.

## 1. How to read this model

Current delivery milestone adds GitHub CodeConnections, ephemeral Linux CodeBuild checks/build/deploy jobs, CodePipeline V2, private S3 web/artifact origins, a non-VPC Lambda API, and CloudFront/ACM/DNS. No production, warm workers, or active AI is included. New compute is usage-billed with bounded duration/concurrency. The installed Terraform provider lacks a Pricing Plan Manager resource; a Terraform-managed CloudFormation stack uses the official `AWS::PricingPlanManager::Subscription` resource with `PlanTier=FREE`. Read-only SDK discovery found no existing subscriptions. The distribution starts disabled and DNS publication waits for verified ACTIVE/FREE status. A failed subscription is not permission to substitute a paid plan. The unrelated parent DNS zone and six existing distributions remain outside this subscription.

### Development delivery increment (2026-09-08 UTC)

**Deployment exception:** AWS rejected FREE eligibility for the new distribution. No subscription exists and public ingress remains disabled. The retained web ACL and its single rule therefore currently carry approximately **$6/month** of standard WAF baseline charges, prorated until the issue is resolved; disabling CloudFront does not remove this WAF fee. This is a disclosed partial-deployment cost, not acceptance of a permanent paid edge alternative. A console explanation/support investigation or an explicitly selected alternative is needed. The 9.7/10 target scale-to-zero score is not the current deployed score; the temporary WAF floor lowers the current configuration heuristic to 8.7/10 (one additional point for the avoidable fixed edge charge).

Ohio CodeBuild on-demand Linux `general1.small` costs **$0.005/minute**, rounded per build; verified through the AWS Price List API, SKU `9343EGWDZJRG5FR6`, effective 2026-08-01. This is the on-demand EC2-backed container product, not the separately priced Sandbox product. CodePipeline V2 costs **$0.002/action-execution-minute**; source/custom actions are excluded under the [current pricing terms](https://aws.amazon.com/codepipeline/pricing/). There are no reserved fleets. Each project has concurrency one and a 20-minute timeout. At an illustrative 100 monthly releases, ten build minutes plus five deployment minutes per release imply $7.50 CodeBuild plus $3.00 CodePipeline. A separate five-minute GitHub check for each adds $2.50: **$13/month** before logs, S3 artifacts, API usage, and any account allowances. Actual build durations remain to be measured. Zero builds means zero build/pipeline compute charges; timeout/concurrency limits and the $100 budget are not a monthly hard cap.

The FREE subscription includes its associated WAF and CloudFront usage subject to published allowances, not Lambda origin execution or arbitrary other services. Provisioning the web ACL before subscription activation can incur brief prorated standard WAF charges (baseline $5/ACL-month plus $1/rule-month under [AWS WAF pricing](https://aws.amazon.com/waf/pricing/)); one ACL/one rule is about $0.0082/hour before subscription, not a continuing accepted $6/month fallback. Stop and leave public ingress disabled if FREE activation fails. Generated build artifacts expire after 30 days under a dedicated public-binary prefix; website versions are retained for rollback. Neither rule touches user media. The existing parent DNS zone's charge is shared and unchanged.

The repository is greenfield, so there is no bill or measured load. This model makes usage assumptions explicit and gives formulas that can be replaced by measurements. “Gross” excludes free tiers, credits, and bundled offsets. “Expected” applies durable published free allowances or selected plan inclusions where noted. Taxes, AWS Support, negotiated discounts, startup/nonprofit credits, and commitments are excluded.

The AWS Price List Query API is available through the local `default` profile and was used for the regional rates recorded in section 3.1. That profile authenticates to the development/testing account and is configured for Ohio. Price List requests use the service's `us-east-1` endpoint with explicit product-region filters; that endpoint is not the workload-region selection. Rows not rechecked remain inherited planning rates, not a fully validated Ohio quote. Finish the service-by-service refresh and replace illustrative workload with measured usage before approving a deployment budget.

## 2. Provisional architecture assumptions

- One existing account is confirmed for development/testing via local profile `default`. Q-032 selects a separate production account, to be created only if the church accepts the product; development remains in the existing account. Reference scenarios model both eventual environments in separate accounts, not two guaranteed sets of unused account-level allowances. Production costs are deferred until that environment is provisioned.
- Multi-tenant SaaS with one real church in the initial pilot; future tenant counts and all activity volumes remain unconfirmed. Tenant isolation does not require additional database instances per church.
- Primary region `us-east-2`; approved processing alternatives are `us-east-1` and `us-west-2`. The Ohio Nova US profile was verified to route only to those three regions.
- CloudFront Free flat-rate plan at $0/month in both environments.
- One Aurora PostgreSQL Serverless v2 writer per environment, Aurora Standard storage.
- Production minimum 0 ACU, maximum 8 ACUs; development minimum 0 ACU, maximum 4 ACUs; both auto-pause after five idle minutes.
- Neither environment has a reader at launch. A later Serverless v2 reader must also preserve zero-minimum pause behavior.
- Lambda uses arm64 and on-demand concurrency, with no provisioned concurrency.
- RDS Data API is used; there is no NAT gateway, load balancer, RDS Proxy, cache, container cluster, OpenSearch, provisioned model endpoint, or interface VPC endpoint.
- Average original image is 3 MB. Derived thumbnails/display images add 20% storage.
- Routine AI uses Nova 2 Lite at $0.30/million input tokens and $2.50/million output tokens. An image is modeled as 230 fixed input tokens based on the current published example.
- One ordinary conversational turn uses 2,000 input and 300 output tokens.
- One image extraction uses one image, 700 text input tokens, and 500 output tokens.
- Transcribe Streaming is $0.01/minute in tier 1 and has a 15-second minimum per request.
- Core Lambda average: 512 MB for 200 ms. AI/media runtimes are modeled in each scenario rather than in the core request unit.
- One core API request produces 1.5 billable Data API request units on average. Validate this after query batching and payload measurements.
- Preferred completed recovery-point age is ≤24 hours, with seven days the accepted data-loss tolerance if shorter protection is disproportionately expensive. Retain backups three months (90-day convention), with seven-day native PITR and 12-hour snapshots. Same-region snapshot retention is declared; cross-region database/media recovery is pending. No warm DR database. Costs are additive under sections 5.2 and 5.3.
- The 24-hour regional recovery time is accepted in Q-031. Timed restore drills must demonstrate it; retain backup-and-restore rather than introducing a live standby or assuming the target has already been achieved.
- Decision 0007 defers native apps, signing and their build coordinator. One web release serves phones and desktop; existing `mac-dev`/`linux-dev` hosts may support optional testing. Device/test-host costs are outside the AWS bill; no cloud mobile build fleet is included. This scope change does not itself alter the cloud runtime/AI/storage estimates.

## 3. Pricing provenance

| Service/dimension | Rate used | Source and notes |
|---|---:|---|
| CloudFront Free plan | $0/month | [CloudFront plans](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html); 1M requests, 100 GB transfer, 5 GB S3 credit; no standard CloudFront/WAF request logging or SLA assumed; eligibility must be checked for each selected account |
| CloudFront Pro flat-rate plan (optional) | $15/month | [CloudFront pricing plans](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html); includes 10M requests, 50 TB transfer, WAF/DDoS, DNS, log ingestion, and 50 GB S3 credit subject to plan terms |
| Aurora Serverless v2 Standard | $0.12/ACU-hour | Ohio Price List SKU `F68JYQJBHCXKZMJX`, 2026-09-07; [Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/) |
| Aurora Standard storage | $0.10/GB-month | Ohio SKU `6URTSSU2UNPPNGCY`, 2026-09-07 |
| Aurora Standard I/O | $0.20/million I/Os | Ohio SKU `BY4H8DC28FBCKJSH`, 2026-09-07 |
| RDS Data API | $0.35/million request units for first 1B; payload metered per 32 KB | Ohio SKU `3C6FAF2HBNTY26YF`, 2026-09-07; first-year-only allowance is excluded |
| Secrets Manager | $0.40/secret-month, $0.05/10K calls | Ohio SKUs `HHK3AZN6HN5CFDJM` / `DYZUZWKV5HMGF5A9`, 2026-09-07; [Secrets pricing](https://aws.amazon.com/secrets-manager/pricing/) |
| Lambda arm64 compute | $0.0000133334/GB-second | [Lambda pricing](https://aws.amazon.com/lambda/pricing/); first-tier rate |
| Lambda requests | $0.20/million | Same source |
| DynamoDB on-demand writes/reads | $0.625/M WRU; $0.125/M RRU | [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), Standard table, US East example |
| DynamoDB Standard storage | $0.25/GB-month | Same source; first 25 GB organization/account allowance is shown separately |
| S3 Standard | $0.023/GB-month | [S3 pricing](https://aws.amazon.com/s3/pricing/); first 50 TB US East |
| S3 Standard PUT/GET | $0.005/1K PUT; $0.0004/1K GET | Same source |
| SQS Standard | $0.40/million requests | [SQS pricing/FAQ](https://aws.amazon.com/sqs/pricing/); first 1M requests/month allowance shown separately |
| Nova 2 Lite | $0.30/M input tokens; $2.50/M output tokens | Current [AWS multimodal cost example](https://aws.amazon.com/blogs/machine-learning/pair-nova-2-lite-with-claude-for-cost-optimized-document-processing/) and [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) |
| Transcribe Streaming | $0.01/minute | [Transcribe pricing](https://aws.amazon.com/transcribe/pricing/), US East tier-1 example; 15-second minimum/request |
| Cognito Essentials | first 10K direct/social MAU free, then $0.015/MAU | [Cognito pricing](https://aws.amazon.com/cognito/pricing/); SAML/OIDC has different 50-MAU allowance |
| CloudWatch Logs | $0.50/GB ingest; $0.03/GB archived | [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), US East examples; first 5 GB/month allowance handled separately |
| CloudWatch standard alarm | $0.10/alarm metric-month | Same source; first 10 standard alarm metrics/account handled separately |
| CodePipeline V2 | $0.002/action execution minute | [CodePipeline pricing](https://aws.amazon.com/codepipeline/pricing/); first 100 minutes/account/month shown separately |
| CodeBuild general Linux small | $0.005/build minute | [CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/); first 100 minutes/account/month shown separately |

Rates can differ by region, tier, table class, model profile, payload size, and account aggregation. The formulas take precedence over rounded totals.

### 3.1 Additional region-specific Price List evidence

All rows below were retrieved on 2026-09-07 using on-demand USD terms from the authenticated [Price List Query API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-price-list-query-api.html). Each row identifies the exact SKU so a deployment review can reproduce the quote.

| Service/dimension | Region/filter | SKU | Rate |
|---|---|---|---:|
| Aurora v2 I/O-Optimized compute | Ohio; `USE2-Aurora:ServerlessV2IOOptimizedUsage` | `53UQ2RQAFQM8XBJJ` | $0.16/ACU-hour |
| Aurora I/O-Optimized storage | Ohio; `USE2-Aurora:IO-OptimizedStorageUsage` | `JTRBSEMWTPH2UYQN` | $0.225/GB-month |
| Aurora retained backup storage | Oregon; `USW2-Aurora:BackupUsage` | `JZGHDWS5VTC87BRN` | $0.021/GB-month beyond included allocation |
| S3 Standard recovery objects | Oregon; `USW2-TimedStorage-ByteHrs`, first 50 TB | `Z3FQZG73HYSPVABR` | $0.023/GB-month |
| Ordinary regional transfer | Ohio → Oregon; `USE2-USW2-AWS-Out-Bytes` | `H6CM7XJ9ZZ2JD2NZ` | $0.02/GB |

Use native Aurora snapshot-copy billing for the recovery example; do not assume an AWS Backup-managed vault has the same price or behavior. Service-specific transfer billing, requests, encrypted-copy keys, retention churn, and restore traffic must be checked for the implemented path. The Ohio I/O-Optimized compute quote differs from the earlier $0.156 example, so the break-even below is updated.

Example reproducible read-only query (region filter selects the priced workload):

```bash
aws pricing get-products --profile default --region us-east-1 \
  --service-code AmazonRDS \
  --filters Type=TERM_MATCH,Field=regionCode,Value=us-east-2 \
            Type=TERM_MATCH,Field=usagetype,Value=USE2-Aurora:ServerlessV2Usage
```

## 4. Auditable unit formulas

```text
aurora_compute = ACU_hours * 0.12
aurora_storage = average_GB * 0.10
aurora_io = IO_operations / 1,000,000 * 0.20
data_api = billable_32KB_request_units / 1,000,000 * tier_rate

lambda_core_per_1k =
  (1,000 * 0.5_GB * 0.2_seconds * 0.0000133334)
  + (1,000 / 1,000,000 * 0.20)
  = 0.00153334

voice = max(actual_seconds, 15_seconds_per_stream) / 60 * 0.01

ordinary_AI_turn =
  (2,000 / 1,000,000 * 0.30)
  + (300 / 1,000,000 * 2.50)
  = 0.00135

image_extraction =
  ((230_image_tokens + 700_prompt_tokens) / 1,000,000 * 0.30)
  + (500 / 1,000,000 * 2.50)
  = 0.001529

s3_media_storage = average_GB * 0.023
dynamodb = WRU / 1,000,000 * 0.625 + RRU / 1,000,000 * 0.125

scenario_total = fixed_or_minimum_floor + sum(variable_dimensions)
cost_per_1k = scenario_variable_cost / scenario_units * 1,000
```

An “API request” is not the same as a Lambda invocation, Data API request, database I/O, S3 request, or CloudFront request. Every layer must be counted independently.

## 5. Monthly idle cost floor

Idle means the stacks exist, both Aurora writers have paused at 0 ACU, and only assumed durable bytes/secrets/alarms remain. Stored business data is usage-proportional but cannot disappear without deleting the product’s purpose; 20 GB Aurora across both environments is included as the design starting assumption. The application has no continuously billed compute, network, or edge capacity in this state, but durable data means the AWS bill is not literally zero.

| Component | Quantity | Calculation | Gross monthly | Expected after published plan/free allowances |
|---|---:|---:|---:|---:|
| Production Aurora capacity | paused at 0 ACU | `0 * 730 * 0.12` | $0.00 | $0.00 |
| Dev Aurora capacity | paused at 0 ACU | `0 * 730 * 0.12` | $0.00 | $0.00 |
| Aurora storage | 20 GB across environments | `20 * 0.10` | $2.00 | $2.00 |
| CloudFront plans | 2 Free | `0 + 0` | $0.00 | $0.00 |
| Aurora secrets | 2 | `2 * 0.40` | $0.80 | $0.80 |
| Standard alarms | 16 across two environments, eight per account | `16 * 0.10` | $1.60 | $0 if both accounts have sufficient unused allowance; charge uncovered alarm metrics at the listed rate |
| Route 53 hosted zone | 1 incremental zone | `1 * 0.50` | $0.50 | $0.00 if eligible and attached to a CloudFront plan; shared `ejtbrown.com` is an excluded pre-existing cost |
| State/artifact baseline | 2 GB S3 equivalent | `2 * 0.023` plus tiny requests | $0.05 | $0.00 if offset by plan credit |
| Lambda/API/SQS/Dynamo throughput | zero usage | $0 | $0.00 | $0.00 |
| **Total, eventual two-account/two-environment reference** |  |  | **$4.95** | **approximately $2.80 if the stated account/plan allowances are available** |

The allowance range is not a bound on the full idle bill: account sharing, plan attachment, actual retained database/media/backup bytes, logs, and state artifacts are not yet measured. Retained S3 media and backups grow with customer data and are intentionally outside this 20 GB relational-storage starting assumption. An ineligible account invalidates the edge assumption and requires a separate pay-as-you-go CloudFront/WAF/DNS quote before deployment.

For the currently authorized development-only environment, an illustrative 10 GB Aurora database and one secret cost `$1.00 + $0.40 = $1.40/month` before recovery copies and shared services. Neither 10 GB nor 20 GB is a service minimum or measured data size. No production stack is included in that development-only figure. Account-level allowances are shared with any unrelated applications already in the account; they are not dedicated Quartermaster entitlements.

### 5.1 Alternative floors

| Architecture/SLO choice | Approximate expected floor | Delta | Tradeoff |
|---|---:|---:|---|
| Proposed: both writers pause, both edge plans Free | $2.80 | baseline | Typical database wake around 15 s and 30 s+ after deep sleep; durable storage/secrets remain |
| Keep production writer at 0.5 ACU | $46.60 | +$43.80 | Faster first database interaction but violates the selected zero-compute idle posture |
| Add a zero-minimum production reader | $2.80 idle | $0 idle; active cost rises | Can pause/resume with the writer at failover priority 0/1; benchmark activation and failover before adoption |
| Upgrade production CloudFront to Pro | $17.80 | +$15.00 | Higher allowances and standard access logs; neither Free nor Pro currently lists a plan uptime SLA |
| Pay-as-you-go edge plus separately priced WAF/DNS/logs | usage-dependent | quote required | More variable dimensions and attack/transfer exposure; consider only for a required feature or demonstrated economics |

The alternatives use the $2.80 two-environment storage/secret reference before any uncovered alarm charges and recovery copies. The earlier $2.80–$3.40 sensitivity compared two-account versus one-account alarm allowances; a shared development/production account is no longer the selected topology.

### 5.2 Cost of daily-preferred recovery

RPO is the age of the newest completed, consistent recovery point; retention is how far back older points are kept. A snapshot of metadata alone does not recover its referenced photos. Twelve-hour snapshot/copy attempts allow time for completion and retry while targeting a point no older than 24 hours. Measure the actual age; a schedule is not a guarantee.

```text
recovery_monthly = aurora_backup_billable_GB * 0.021
                 + recovery_S3_GB * 0.023
                 + Ohio_to_Oregon_transferred_GB * 0.02
                 + copy/request/key/restore_drill_costs
```

The earlier illustrative 20 GB of billable recovery storage plus 30 GB of photos gave `$1.11/month` of retained bytes, but that quantity is not a model of the now-accepted 90-day snapshot policy. It is superseded by section 5.3 for the implemented snapshot cadence. Ohio-to-Oregon transfer remains `$0.02 * actual_transferred_GB`; measure the implemented copy path rather than assume full-copy or incremental-transfer economics.

This small-data example supports attempting the preferred daily protection first, rather than assuming a live standby is necessary. It is not an approved backup budget: data volume, retention policy, encryption, copy mechanism, and restore frequency determine the final total. Weekly backups save only some changed-byte/retention/request work while increasing potential data loss; keep seven days as the accepted fallback ceiling and show a measured cost comparison before selecting that fallback.

### 5.3 Implemented 90-day snapshot policy and $100 budget

Ohio Aurora PostgreSQL backup storage was rechecked through the Price List API on 2026-09-07: SKU `PYNU7WJBSCTWR8XF`, `USE2-Aurora:BackupUsage`, $0.021/GB-month. [Aurora's storage documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-storage-backup.html) states that manual snapshots, including AWS Backup snapshots, are full backups; those older than the native PITR window are billable. Consequently the snapshot count matters.

For a constant illustrative 10 GB cluster, two snapshots daily, 90-day snapshot retention, and seven-day native PITR, after retention reaches steady state:

```text
billed_snapshot_count ≈ 2 * (90 - 7) = 166
snapshot_storage ≈ 166 * 10 GB * $0.021 = $34.86/month
database + one managed secret ≈ 10 GB * $0.10 + $0.40 = $1.40/month
retained_component ≈ $36.26/month
```

This is a retained-data estimate, not the current bill or a complete $100 budget forecast. Initial months ramp up; exact snapshot timing, database size, PITR changes, and service accounting must be measured. A larger database changes the estimate proportionally. Cross-region copies and original-media recovery are not yet implemented or included; retaining full 90-day histories in both regions can materially increase cost and needs a revised plan before deployment.

Terraform declares a project-scoped $100 monthly budget using `CostScope=Quartermaster-dev`. Activate and verify that cost-allocation tag and reconcile untaggable/shared charges. The operator supplied the recipient in protected configuration. Use actual 50/80/100% and forecast 80/100% notifications within the five-notification API limit. Budgets alerts can lag and do not cap the bill; runtime AI admission/usage controls remain unimplemented and AI stays disabled. The user-approved envelope does not validate the earlier illustrative workload.

Resized-photo retention is now explicit: no age-based expiry while the user retains the photo and its asset exists. Include primary and recovery storage for retained resized bytes in addition to the rolling 15-day originals. Expired originals cannot regenerate resized photos. Storage scales with retained estate size, not just recent uploads; photo/asset/tenant deletion requires version-aware purge. Those workers and cross-region media copies are not deployed in the foundation.

## 6. Variable cost by unit

| Unit | Assumption | Approximate marginal list cost | Excludes |
|---|---|---:|---|
| 1,000 core API requests | 512 MB × 200 ms and one invocation each | $0.00153 Lambda | Data API, Aurora capacity/I/O, logs, transfer |
| 1,000 Data API units under 32 KB | first pricing tier | $0.00035 | Aurora compute/storage/I/O |
| 1M Aurora I/Os | Standard configuration | $0.20 | ACU and storage |
| 1,000 ordinary AI turns | 2K input + 300 output each | $1.35 | speech, Lambda, retries |
| 1,000 image extractions | 930 input + 500 output tokens each | $1.529 | image validation/variants, retries, storage |
| 1,000 voice utterances averaging 15 sec | exactly minimum billable duration | $2.50 | AI turns and network |
| 1,000 voice minutes | tier-1 streaming | $10.00 | AI turns |
| 1,000 DynamoDB 1 KB writes + 1,000 strong 4 KB reads | Standard on-demand | $0.00075 | transactions, indexes, PITR/storage |
| 1,000 images queued through SQS | ~3 API requests/message | $0.0012 | Lambda and free allowance |
| 1,000 images stored for one month | 3.6 MB/image incl. variants | $0.0828 | plan S3 credit, requests/versions/replication |

Voice duration and model output/context are the leading marginal risks. Retry storms multiply Transcribe, model, Lambda, Data API, log, and queue charges together, so retry and idempotency policy matter more than SQS request price.

## 7. Illustrative scenarios

These are planning scenarios, not forecasts or fully refreshed Ohio quotes. Totals use the eventual $2.80 two-account/two-environment reference and inherited variable rates; add any uncovered alarm charges and the recovery costs from section 5.2. Only development is planned until church acceptance. These scenarios exclude temporary new-account credits and first-year-only allowances.

### 7.1 One-church pilot with illustrative workload

The tenant count is confirmed by Q-002. All other quantities below remain illustrative assumptions under Q-012; they have not been validated as the church's actual workload. Retaining those quantities keeps the prior workload example comparable and does not imply that cost falls in direct proportion to tenant count.

- 1 tenant (confirmed), 50 direct MAU and 5,000 assets (illustrative).
- 10,000 images / 36 GB average stored including variants; 500 new images analyzed this month.
- 250,000 core API requests, 375,000 Data API units, and 10M Aurora I/Os.
- 200 conversational capture sessions, 10 turns and 8 voice minutes each.
- Production consumes 100 ACU-hours across its active periods; dev consumes 20 ACU-hours. All other hours cost no Aurora capacity.
- 100K DynamoDB writes, 500K reads; 3 GB Lambda/application logs.

| Dimension | Calculation | Monthly |
|---|---:|---:|
| Expected durable floor | from section 5 | $2.80 |
| Production database activity | `100 * 0.12` | $12.00 |
| Dev database activity | `20 * 0.12` | $2.40 |
| Core Lambda | `250 * 0.00153334` | $0.38 |
| Data API | `.375 * 0.35` | $0.13 |
| Aurora I/O | `10 * 0.20` | $2.00 |
| Transcribe | `200 * 8 * 0.01` | $16.00 |
| Conversation model | `2,000 * 0.00135` | $2.70 |
| Image model | `500 * 0.001529` | $0.76 |
| DynamoDB requests | `.1 * .625 + .5 * .125` | $0.13 |
| S3 media | `(36 - 5) * 0.023`, assuming one applicable Free-plan S3 credit | $0.71 expected |
| Logs | 3 GB, within account allowance if otherwise unused | $0.00 expected |
| **Modeled total** |  | **about $40/month** |

Allow $40–$65/month until actual active ACU-hours, CI, backups, email, logs, media versions, retries, and edge-plan behavior are measured.

### 7.2 Growth

Assumptions:

- 50 tenants, 500 direct MAU, 100,000 assets.
- 300,000 images / 1,080 GB stored including variants; 10,000 new images analyzed.
- 2M core API requests, 3M Data API units, 100M Aurora I/Os.
- 25,000 conversational turns and 20,000 voice minutes.
- Production averages 2 ACUs over 730 hours; dev adds $5 compute.
- Aurora grows to 50 GB total; 2M DynamoDB writes, 10M reads; 20 GB logs.

| Dimension | Approximate monthly |
|---|---:|
| Durable/edge/observability floor | $2.80 |
| Production Aurora compute | $175.20 |
| Dev Aurora compute | $5.00 |
| Aurora storage and I/O | $25.00 |
| Core Lambda and Data API | $4.12 |
| Transcribe | $200.00 |
| Conversation model | $33.75 |
| Image model | $15.29 |
| S3 media after one applicable 5 GB plan credit | $24.73 |
| DynamoDB requests | $2.50 |
| Logs after 5 GB allowance | about $7.50 |
| **Modeled total** | **about $496/month** |

Allow $470–$640/month. Voice and database compute/I/O dominate; optimization should start with measured session duration/context and SQL/query plans.

### 7.3 Larger estate

Assumptions:

- 250 tenants, 3,000 MAU, 1M assets, 3M images / about 10.8 TB including variants.
- 10M core API requests, 15M Data API units, 500M Aurora I/Os.
- Production averages 8 ACUs; total relational storage 200 GB.
- 150,000 conversational turns, 50,000 new images, and 100,000 voice minutes.
- 10M DynamoDB writes, 50M reads; 100 GB logs.

Approximate dimensions: $701 Aurora compute, $120 Aurora storage/I/O, $1,000 transcription, $203 conversational inference, $76 image inference, $254 S3, $48 logs, and roughly $25 for the modeled durable/base/API/Data API/DynamoDB dimensions. The total is approximately **$2,435/month**, with a reasonable planning range of **$2,200–$3,100/month** before backup replication, support, integrations, and mobile build/distribution costs.

At this point, profile reporting/search, inspect CloudFront plan eligibility, price Aurora I/O-Optimized, evaluate transcription turn length/on-device options, and negotiate/commit only after several stable months.

## 8. Cost ramps, steps, and break-even points

### 8.1 Database activation

Both writers use zero minimum and the five-minute auto-pause timeout. Keeping 0.5 ACU warm would cost `$43.80/month` per continuously warm instance, so it is not the default. Aurora commonly resumes in about 15 seconds and can take 30 seconds or longer after more than 24 hours of deep sleep. Use a 60-second end-to-end timeout, visible activation state, and no more than three retry attempts; measure cold first-use completion, abandonment, and duplicate-prevention separately from warm latency. Do not issue health checks or login warm-ups that prevent pause. Maintenance can wake the cluster and may keep it active for at least 20 minutes afterward.

### 8.2 Aurora Standard vs I/O-Optimized

Using the current example rates:

```text
standard = ACU_hours * 0.12 + storage_GB * 0.10 + IO_millions * 0.20
io_optimized = ACU_hours * 0.16 + storage_GB * 0.225

break_even_IO_millions =
  ((ACU_hours * 0.04) + (storage_GB * 0.125)) / 0.20
```

At the growth assumptions (1,460 ACU-hours and 50 GB), Ohio I/O-Optimized breaks even around 323M monthly I/Os. The scenario uses 100M, so Aurora Standard remains cheaper. Recalculate with actual billed I/O; do not switch based on generic advice.

### 8.3 Reader

No reader is present at launch. If availability or read load later requires one, first test a zero-minimum Serverless v2 reader at failover priority 0 or 1 so it pauses/resumes with the writer. That preserves the idle compute floor but approximately doubles database capacity while both instances are active. A reader fixed at 0.5 ACU would add about `$43.80/month` and does not meet the selected idle posture.

### 8.4 CloudFront plan step

Free is selected for both environments. Pro is $15/month and Business is $200/month, a $185 Pro-to-Business step. Pro’s request/transfer allowances are 10M/50TB and adds standard access logs; Business adds higher request allowance and SLA/private-origin features. Do not upgrade solely because an isolated month exceeds an allowance—the plan documentation says allowances are not hard limits—but review sustained usage, required features, and current plan terms.

### 8.5 DynamoDB vs Aurora as system of record

DynamoDB can have near-zero request floor and very low simple-key request cost. It is not an equivalent replacement for Quartermaster’s relational search, temporal accounting, arbitrary faceting, and calculation requirements. There is no honest request-volume-only break-even: the alternative must also price duplicated projections, analytics/search infrastructure, consistency, and engineering. Keep DynamoDB limited to ephemeral/key-value workloads unless product query requirements materially change.

### 8.6 S3 lifecycle

S3 Standard-IA can reduce storage after the required access window, but retrieval charges, per-object monitoring/transition, minimum size, and minimum duration apply. Images are multi-object groups (original + variants); keep thumbnails/display variants warm and lifecycle originals only after access telemetry and insurance/disaster retrieval objectives are known.

### 8.7 CI and shared web delivery

CodePipeline/CodeBuild use on-demand cloud jobs, with no provisioned runner fleet. Shared web/API checks and builds consume CodeBuild Linux minutes, artifact storage/transfer and tool downloads. Decision 0007 removes the planned native SSH coordinator, signing and app-store release prerequisites from v1. Actual-device browser testing still costs time and potentially hardware; those costs are outside the AWS estimate. No cloud bridge/VPN/NAT or paid macOS fleet is required. This is a client-scope update, not a new price retrieval or measured AWS savings claim.

## 9. Runaway-cost protections

- WAF and CloudFront origin isolation prevent direct origin bypass and reduce malicious origin/model calls.
- Lambda reserved concurrency: core receives a protected allocation; AI/media/export have lower independent caps.
- SQS queues absorb bursts; maximum receives and DLQ prevent poison-message infinite loops.
- Delayed SQS triggers address exact transactional outbox batches; no periodic outbox poll or empty scheduled database scan is allowed to consume ACUs during otherwise idle periods.
- Every model call has token/image limits, timeout, maximum attempts, tenant daily/monthly cap, and global circuit breaker.
- Transcribe grants enforce concurrent streams, maximum duration, and budget before signing.
- Report DSL has row, time, join, and export thresholds; interactive endpoints never return unbounded results.
- Log sampling/redaction and short retention prevent payload/cardinality explosions.
- AWS Budgets and Cost Anomaly Detection alert on service/environment; application counters alert before the bill.
- CI policy blocks NAT, public IPv4, ALB, provisioned inference/concurrency, OpenSearch, RDS Proxy, provisioned Aurora instances, logical replication, Aurora Global Database, zero-ETL, Babelfish, and any nonzero database minimum without a reviewed exception.

## 10. Exclusions and unresolved cost inputs

Not modeled or not sufficiently known:

- AWS Support, taxes, domain registration, third-party SaaS/crash analytics, Apple/Google developer programs, mobile build service, and GitHub plan/minutes.
- SES/SNS email/SMS, mobile push provider, maps/geocoding, barcode/label printing, and accounting/insurance integrations.
- Cross-region backup/replication costs beyond the illustrative native-copy formula in section 5.2, KMS customer-managed keys, legal holds, audit archive, and restored-test environments.
- CloudTrail data events, GuardDuty/Security Hub/Config organizational security services, centralized log account, and penetration testing.
- Data transfer not covered by the CloudFront plan, direct S3 upload transfer characteristics, downloads outside CloudFront, and cross-region Bedrock effects.
- Aurora backup storage beyond the included allowance, snapshot export, extended support, and exact auto-pause maintenance wake-ups.
- AI escalation to stronger models, prompt caching, guardrails, evaluation jobs, reprocessing, failed/abusive sessions, and raw-audio retention.
- Actual Lambda memory/duration, Data API payload/request amplification, Aurora I/O/query pattern, image size/variants/versions, and retention.
- Enterprise SAML/OIDC pricing after its separate 50-MAU allowance.

Q-005 through Q-009 and Q-031/Q-032 are accepted. Before an affected release budget is approved, answer Q-012/Q-014/Q-022/Q-023, refresh the remaining Ohio rates, and replace illustrative load/backup bytes with owner-approved ranges. Confirm actual account allowances and production account eligibility when its later bootstrap is authorized after church acceptance; demonstrate the accepted 24-hour recovery time in a restore drill. Within 30 days after pilot launch, reconcile this model against Cost and Usage Reports and measured product units.
