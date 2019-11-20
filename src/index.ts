import * as winston from "winston";
import { AuditService } from "./audit.service";
import { Options } from "./options";
import { WebServer } from "./web-server";

const bootTime = Date.now();

(async () => {
  let logLevel = process.env[Options.LOG_LEVEL] || "info";
  winston.info(`Log level: ${logLevel}`);
  winston.configure({
    level: logLevel,
    transports: [
      new (winston.transports.Console)()
    ]
  });

  let webServer = new WebServer();
  await webServer.init();

  let auditService = new AuditService();
  await auditService.init();

  process.on("SIGTERM", () => {
    webServer.close(() => {
      process.exit(0);
    });
  });

})().then(() => {
  winston.info(`Application started in ${Date.now() - bootTime}ms`);
}).catch(e => {
  winston.error(`Fatal errors`, e);
  process.exit(1);
});
