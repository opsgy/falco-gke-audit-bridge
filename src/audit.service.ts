import { PubSub } from "@google-cloud/pubsub";
import * as fs from "fs";
import { Gauge } from "prom-client";
import * as request from "request";
import * as winston from "winston";
import { GKEAuditEvent } from "./models/gke-audit-event";
import { KubernetesAuditEvent } from "./models/kubernetes-audit-event";
import { Options } from "./options";

/**
 * Service for receiving audit events from Pub/Sub, converts it and send it to Falco
 */
export class AuditService {

  private gaugeEventsReceiveSum: Gauge;
  private gaugeEventsSendSum: Gauge;
  private gaugeEventsErrorParse: Gauge;
  private gaugeEventsErrorSend: Gauge;

  public async init(): Promise<void> {
    let gcpServiceAccountRaw = process.env[Options.GCP_SERVICE_ACCOUNT];
    if (!gcpServiceAccountRaw && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      gcpServiceAccountRaw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS).toString();
    }
    if (!gcpServiceAccountRaw) {
      throw new Error(`Could now find gcp service account`);
    }
    let gcpServiceAccount = JSON.parse(gcpServiceAccountRaw);

    const pubsub = new PubSub({
      projectId: gcpServiceAccount.project_id,
      credentials: gcpServiceAccount
    });

    let subscriptionName = process.env[Options.GCP_PUBSUB_SUBSCRIPTION] || "falco-gke-audit-bridge";
    let subscription = await pubsub.subscription(subscriptionName);
    let falcoUrl = process.env[Options.FALCO_URL] || "http://127.0.0.18765/k8s-audit";

    this.gaugeEventsReceiveSum = new Gauge({
      name: "events_receive_sum",
      help: "events received from pubsub",
      labelNames: [""]
    });
    this.gaugeEventsSendSum = new Gauge({
      name: "events_send_sum",
      help: "events send to falco",
      labelNames: [""]
    });
    this.gaugeEventsErrorParse = new Gauge({
      name: "events_error_parse",
      help: "errors parsing events from pubsub",
      labelNames: [""]
    });
    this.gaugeEventsErrorSend = new Gauge({
      name: "events_error_send",
      help: "errors sending events to falco",
      labelNames: [""]
    });

    subscription.on("message", message => {
      this.gaugeEventsReceiveSum.inc();
      winston.debug("receive message: " + message.data);
      let gkeAuditEvent = JSON.parse(message.data) as GKEAuditEvent;

      try {
        let kubernetesAuditEvent = this.convertAuditEvent(gkeAuditEvent);
        if (kubernetesAuditEvent) {
          request({
            uri: falcoUrl,
            method: "POST",
            json: true,
            body: kubernetesAuditEvent
          }, (e, res, body) => {
            if (e) {
              winston.error(`Failed to send event ${gkeAuditEvent.insertId}`, e);
              this.gaugeEventsErrorSend.inc();
            } else if (res.statusCode >= 400) {
              winston.error(`Failed to send event ${gkeAuditEvent.insertId}`,
                `Unexpected status code: ${res.statusCode}, with body: ${body}`);
              this.gaugeEventsErrorSend.inc();
            } else {
              message.ack();
              this.gaugeEventsSendSum.inc();
            }
          });
        }
      } catch (e) {
        winston.error(`Failed to convert event ${gkeAuditEvent.insertId}`, e);
        this.gaugeEventsErrorParse.inc();
      }
    });
  }

  private convertAuditEvent(auditEvent: GKEAuditEvent): KubernetesAuditEvent {
    let eventTimestamp = new Date(auditEvent.timestamp);
    let verbs = auditEvent.protoPayload.methodName.split(".");
    let objectRef: any;
    let resourceNames = auditEvent.protoPayload.resourceName.split("/");
    let resourceName = resourceNames.length >= 2 && resourceNames[resourceNames.length - 2];
    if (auditEvent.protoPayload.response && auditEvent.protoPayload.response.metadata && resourceName) {
      let metadata = auditEvent.protoPayload.response.metadata;
      objectRef = {
        resource: resourceName,
        namespace: metadata.namespace,
        name: metadata.name,
        uid: metadata.uid,
        apiVersion: auditEvent.protoPayload.response.apiVersion
      };
    }

    return {
      kind: "Event",
      apiVersion: "audit.k8s.io/v1beta1",
      metadata: {
        creationTimestamp: eventTimestamp.toISOString()
      },
      level: "RequestResponse",
      timestamp: eventTimestamp.toISOString(),
      auditID: auditEvent.insertId,
      stage: "ResponseComplete",
      requestURI: auditEvent.protoPayload.resourceName,
      verb: verbs[verbs.length - 1],
      user: {
        username: auditEvent.protoPayload.authenticationInfo.principalEmail,
        groups: []
      },
      sourceIPs: [auditEvent.protoPayload.requestMetadata.callerIp],
      objectRef,
      responseStatus: {
        metadata: {},
        code: auditEvent.protoPayload.status.code
      },
      requestObject: auditEvent.protoPayload.request,
      responseObject: auditEvent.protoPayload.response,
      requestReceivedTimestamp: eventTimestamp.toISOString(),
      stageTimestamp: eventTimestamp.toISOString(),
      annotations: auditEvent.labels
    };
  }

}