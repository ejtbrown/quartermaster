import unittest
from handler import summary


class SummaryTests(unittest.TestCase):
    def test_scope_and_content(self):
        event = {"account": "test", "region": "us-east-2", "source": "aws.backup", "detail": {"resourceArn": "database", "state": "FAILED", "backupJobId": "job", "statusMessage": "private content"}}
        result = summary(event, "test", "database")
        self.assertEqual(result["state"], "FAILED")
        self.assertNotIn("private content", str(result))
        self.assertIsNone(summary(event, "another-account", "database"))
        self.assertIsNone(summary(event, "test", "another-database"))

    def test_unrelated_events_are_silent(self):
        self.assertIsNone(summary({}, "test", "database"))
        self.assertIsNone(summary({"account": "test", "region": "us-east-2", "source": "aws.codepipeline", "detail": {"pipeline": "unrelated", "state": "FAILED"}}, "test", "database"))


if __name__ == "__main__":
    unittest.main()
