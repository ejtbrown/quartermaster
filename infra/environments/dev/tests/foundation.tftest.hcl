mock_provider "aws" {}
variables {
  expected_account_id = "111111111111"
  alert_email         = "alerts@example.invalid"
}

run "development_defaults" {
  command = plan
  assert {
    condition     = output.development_domain == "qm.ejtbrown.com"
    error_message = "The development domain must match the accepted decision."
  }
}

run "invalid_alert_recipient" {
  command = plan
  variables { alert_email = "qm.ejtbrown.com" }
  expect_failures = [var.alert_email]
}
