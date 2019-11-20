import * as express from "express";
import * as http from "http";
import * as promClient from "prom-client";
import * as winston from "winston";
import { Options } from "./options";

/**
 * Webserver for metrics and health endpoints
 */
export class WebServer {

  private server: http.Server;

  public async init(): Promise<void> {
    let app = express();
    app.disable("x-powered-by");

    app.get("/", (req, res) => {
      res.send("See: /health, /metrics");
    });

    app.get("/metrics", (req, res) => {
      res.send(promClient.register.metrics());
    });

    app.get("/health", (req, res) => {
      res.send("healthy");
    });

    let port = process.env[Options.SERVER_PORT] || "8080";
    this.server = app.listen(parseInt(port));
  }

  public close(callback?: () => void) {
    winston.info(`Close web server`);
    this.server.close(callback);
  }

}
