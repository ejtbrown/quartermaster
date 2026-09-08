#!/usr/bin/env bash
set -euo pipefail
# Installs only into the disposable CodeBuild container, never a signing host.
npm install --global node@24.20.0 pnpm@10.34.5
mkdir -p .local/bin
curl --fail --silent --show-error --location \
  https://releases.hashicorp.com/terraform/1.14.3/terraform_1.14.3_linux_amd64.zip \
  --output .local/terraform.zip
node --input-type=module -e '
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const actual = createHash("sha256").update(readFileSync(".local/terraform.zip")).digest("hex");
if (actual !== "178b2a602251bb68b94732aceca2cc1023d87597cb83dba92cab31b6689edb4d") throw new Error("Terraform checksum mismatch");
'
unzip -o -q .local/terraform.zip terraform -d .local/bin
