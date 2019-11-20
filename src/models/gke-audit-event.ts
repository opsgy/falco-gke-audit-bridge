export interface GKEAuditEvent {
  insertId: string;
  labels: any;
  logName: string;
  operation: {
    first: boolean;
    id: string;
    producer: string;
  };
  protoPayload: {
    "@type": string;
    authenticationInfo: {
      principalEmail: string;
    };
    authorizationInfo: [
      {
        granted: boolean
        permission: string;
        resource: string;
      }];
    methodName: string;
    request: any;
    response: any;
    requestMetadata: {
      callerIp: string;
      callerSuppliedUserAgent: string;
    };
    resourceName: string;
    serviceName: string;
    status: {
      code: number;
    }
  };
  receiveTimestamp: string;
  resource: {
    labels: {
      cluster_name: string;
      location: string;
      project_id: string;
    }
    type: string;
  };
  timestamp: string;
}
