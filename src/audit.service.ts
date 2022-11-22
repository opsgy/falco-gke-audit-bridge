import { PubSub } from "@google-cloud/pubsub";
import * as fs from "fs";
import { Gauge } from "prom-client";
import * as request from "request";
import * as throttledQueue from "throttled-queue";
import * as winston from "winston";
import { GKEAuditEvent } from "./models/gke-audit-event";
import { GoogleAuth } from "google-auth-library";
import { KubernetesAuditEvent } from "./models/kubernetes-audit-event";
import { Options } from "./options";

/**
 * Service for receiving audit events from Pub/Sub, converts it and send it to Falco
 */
export class AuditService {

  private static readonly RESOURCE_URL_REGEX = /([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/(?:namespaces\/([a-zA-Z0-9-]+)\/)?([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)(?:\/([a-zA-Z0-9-]+))?/;

  private gaugeEventsReceiveSum: Gauge;
  private gaugeEventsSendSum: Gauge;
  private gaugeEventsErrorParse: Gauge;
  private gaugeEventsErrorSend: Gauge;
  private falcoUrl: string;
  private throttle;

  public async init(): Promise<void> {
    const auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/pubsub'
    });
    const pubsub = new PubSub({
      auth: auth,
    });
    let subscriptionName = process.env[Options.GCP_PUBSUB_SUBSCRIPTION] || "falco-gke-audit-bridge";
    let subscription = await pubsub.subscription(subscriptionName, {
      flowControl: {
        maxMessages: 100
      }
    });
    this.falcoUrl = process.env[Options.FALCO_URL] || "http://falco:8765/k8s-audit";

    this.gaugeEventsReceiveSum = new Gauge({
      name: "events_receive_sum",
      help: "events received from pubsub",
      labelNames: []
    });
    this.gaugeEventsSendSum = new Gauge({
      name: "events_send_sum",
      help: "events send to falco",
      labelNames: []
    });
    this.gaugeEventsErrorParse = new Gauge({
      name: "events_error_parse",
      help: "errors parsing events from pubsub",
      labelNames: []
    });
    this.gaugeEventsErrorSend = new Gauge({
      name: "events_error_send",
      help: "errors sending events to falco",
      labelNames: []
    });

    subscription.on("error", error => winston.error(error));
    subscription.on("close", () => {
      winston.error("Subscription closed unexpectedly");
      process.exit(1);
    });

    let rateLimit = parseInt(process.env[Options.RATE_LIMIT_PER_SECOND] || "2");
    let rateLimitWindow = parseInt(process.env[Options.RATE_LIMIT_WINDOW] || "1");

    this.throttle = throttledQueue(rateLimit * rateLimitWindow, rateLimitWindow * 1000);

    subscription.on("message", message => {
      this.throttle(() => {
        this.handleMessage(message);
      });
    });

  }

  private handleMessage(message, retry = 0) {
    this.gaugeEventsReceiveSum.inc();
    winston.debug("receive message: " + message.data);
    let gkeAuditEvent = JSON.parse(message.data) as GKEAuditEvent;

    try {
      let kubernetesAuditEvent = this.convertAuditEvent(gkeAuditEvent);
      if (process.env[Options.LOG_LEVEL] === "debug") {
        winston.debug(JSON.stringify(kubernetesAuditEvent, undefined, 2));
      }
      request({
        uri: this.falcoUrl,
        method: "POST",
        json: true,
        body: kubernetesAuditEvent
      }, (e, res, body) => {
        if (e) {
          winston.error(`Failed to send event ${gkeAuditEvent.insertId} (try: ${retry})`, e);
          if (retry > 2) {
            this.gaugeEventsErrorSend.inc();
            message.ack();
          } else {
            this.handleMessage(message, retry + 1);
          }
        } else if (res.statusCode >= 400) {
          winston.error(`Failed to send event ${gkeAuditEvent.insertId}`,
            `Unexpected status code: ${res.statusCode}, with body: ${body} (try: ${retry})`);
          if (retry > 2) {
            this.gaugeEventsErrorSend.inc();
            message.ack();
          } else {
            this.handleMessage(message, retry + 1);
          }
        } else {
          message.ack();
          this.gaugeEventsSendSum.inc();
        }
      });
    } catch (e) {
      winston.error(`Failed to convert event ${gkeAuditEvent.insertId}`, e);
      this.gaugeEventsErrorParse.inc();
      message.ack();
    }
  }

  private convertAuditEvent(auditEvent: GKEAuditEvent): KubernetesAuditEvent {
    let eventTimestamp = new Date(auditEvent.timestamp);
    let verbs = auditEvent.protoPayload.methodName.split(".");
    let objectRef: any;

    let resourceUrlMatches = auditEvent.protoPayload.resourceName.match(AuditService.RESOURCE_URL_REGEX);
    if (resourceUrlMatches) {
      let apiGroup = resourceUrlMatches[1];
      let apiVersion = resourceUrlMatches[2];
      let namespace = resourceUrlMatches[3];
      let resourceName = resourceUrlMatches[4];
      let name = resourceUrlMatches[5];
      let subresource = resourceUrlMatches[6];
      objectRef = {
        resource: resourceName,
        namespace,
        name,
        uid: auditEvent.protoPayload.response && auditEvent.protoPayload.response.metadata && auditEvent.protoPayload.response.metadata.uid,
        apiVersion: apiVersion === "v1" ? apiVersion : `${apiGroup}/${apiVersion}`,
        subresource
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
        code: auditEvent.protoPayload.response && auditEvent.protoPayload.response.code || 200
      },
      requestObject: auditEvent.protoPayload.request,
      responseObject: auditEvent.protoPayload.response,
      requestReceivedTimestamp: eventTimestamp.toISOString(),
      stageTimestamp: eventTimestamp.toISOString(),
      annotations: auditEvent.labels
    };
  }

}
