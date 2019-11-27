# PROVIDER
provider "google" {
  project = "${var.project}"
}

# VARIABLE DEFINITIONS
variable "project" {}
variable "name" {
  default = "falco-gke-audit-bridge"
}

# RESOURCES

# Export audit logs to the PubSub
resource "google_logging_project_sink" "logging_sink" {
  name = "${var.name}"

  destination = "pubsub.googleapis.com/projects/${google_pubsub_topic.topic.project}/topics/${google_pubsub_topic.topic.name}"

  filter = "resource.type=\"k8s_cluster\""

  unique_writer_identity = true
}


resource "google_project_iam_binding" "logging_sink_roles" {
  role = "roles/pubsub.publisher"

  members = [
    "${google_logging_project_sink.logging_sink.writer_identity}"
  ]
}


# PubSub Topic
resource "google_pubsub_topic" "topic" {
  name = "${var.name}"
}

# PubSub Subscription
resource "google_pubsub_subscription" "subscription" {
  name = "${var.name}"
  topic = "${google_pubsub_topic.topic.name}"

  # 20 minutes
  message_retention_duration = "1200s"
  retain_acked_messages = true

  ack_deadline_seconds = 20

  expiration_policy {
    ttl = "300000.5s"
  }
}

# Service Account for falco-gke-audit-bridge


resource "google_service_account" "service_account" {
  account_id = "${var.name}"
}

resource "google_project_iam_member" "service_account_role_binding" {
  role = "roles/pubsub.subscriber"
  member = "serviceAccount:${google_service_account.service_account.email}"
}