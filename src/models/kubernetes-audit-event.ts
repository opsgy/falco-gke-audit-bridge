export interface KubernetesAuditEvent {
  kind: "Event";
  apiVersion: "audit.k8s.io/v1beta1";
  metadata: { [name: string]: string };
  level: string;
  timestamp: string;
  auditID: string;
  stage: string;
  requestURI: string;
  verb: string;
  user: {
    "username": string;
    "groups": string[];
  };
  sourceIPs: string[];
  objectRef: {
    resource: string;
    namespace: string;
    name: string;
    uid: string;
    apiVersion: string;
  };
  responseStatus: {
    metadata: any;
    code: number;
  };
  requestObject: {
    kind: string,
    apiVersion: string,
    metadata: {
      name: string,
      namespace: string,
      selfLink: string,
      uid: string,
      creationTimestamp: string
    },
    data: { [name: string]: string }
  };
  responseObject: {
    kind: string;
    apiVersion: string;
    metadata: {
      name: string;
      namespace: string;
      selfLink: string;
      uid: string;
      resourceVersion: string;
      creationTimestamp: string;
    },
    data: { [name: string]: string }
  };
  requestReceivedTimestamp: string;
  stageTimestamp: string;
  annotations: { [name: string]: string };
}
