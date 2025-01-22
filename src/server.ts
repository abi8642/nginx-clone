import cluster, { Worker } from "node:cluster";
import http from 'node:http'
import {ConfigSchemaType, rootConfigSchema} from "./config-schema";
import {workerMessageSchema, WorkerMessageType, workerMessageReplySchema, WorkerMessageReplyType} from "./server-schema";

const WORKER_POOL: Worker[] = [];
interface CreateServerConfig {
    port: number;
    workerCount: number;
    config: ConfigSchemaType;
}

export async function createServer(config: CreateServerConfig) {
    const { port, workerCount } = config;
    // let currentWorkerIndex = 0;
    const workerLoad: Map<number, number> = new Map();

    if(cluster.isPrimary) {
        console.log("Master Process is up.");

        for (let wc = 0; wc < workerCount; wc++) {
            const w = cluster.fork({ config: JSON.stringify(config.config) });
            WORKER_POOL.push(w);
            workerLoad.set(w.id, 0);
            console.log(`New worker process is spin up. ID: ${wc + 1}`);
        }

        const server = http.createServer(function(req, res) {
            // Round Robin Worker Selection
            // const worker = WORKER_POOL.at(currentWorkerIndex);
            // currentWorkerIndex = (currentWorkerIndex + 1) % WORKER_POOL.length;

            // Least Loaded Worker Selection
            const worker = getLeastLoadedWorker(workerLoad);

            if(!worker) throw new Error("Worker not found!");

            workerLoad.set(worker.id, workerLoad.get(worker.id)! + 1)

            let body = '';

            req.on('data', (chunk) => {
                body += chunk;
            });


            req.on('end', () => {
                let parsedBody = null;
                try {
                    parsedBody = body ? JSON.parse(body) : null;
                } catch (err) {
                    console.error('Error parsing request body:', err);
                    res.statusCode = 400;
                    res.end('Invalid JSON body');
                    return;
                }

                const payload: WorkerMessageType = {
                    requestType: req.method || "GET",
                    headers: req.headers,
                    body: parsedBody,
                    url: `${req.url}`,
                };

                worker.send(JSON.stringify(payload));
            });

            let responseSent = false;
            worker.on("message", async (workerReply: string) => {
                if (responseSent) return;

                try {
                    const reply = await workerMessageReplySchema.parseAsync(
                        JSON.parse(workerReply)
                    );

                    if (reply.errorCode) {
                        res.writeHead(parseInt(reply.errorCode));
                        res.end(reply.error);
                    } else {
                        res.writeHead(200);
                        res.end(reply.data);
                    }
                } catch (error) {
                    console.error("Error processing worker response:", error);
                    res.writeHead(500);
                    res.end("Internal Server Error");
                }

                responseSent = true;
            });
        });

        server.listen(port, () => {
            console.log(`Reverse Proxy Ninja Listening on port ${port}`)
        });

        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM. Shutting down gracefully...');
            server.close(() => {
                console.log('HTTP server closed.');
            });

            for (const worker of WORKER_POOL) {
                console.log(`Killing worker ${worker.id}`);
                worker.kill();
            }
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('Received SIGINT (Ctrl+C). Shutting down gracefully...');
            server.close(() => {
                console.log('HTTP server closed.');
            });

            for (const worker of WORKER_POOL) {
                console.log(`Killing worker ${worker.id}`);
                worker.kill();
            }
            process.exit(0);
        });
    } else {
        console.log("Worker Node");
        const configuration = await rootConfigSchema.parseAsync(JSON.parse(`${process.env.config}`));
        let currentUpstreamIndex = 0;

        process.on('message', async (message: string) => {
            const messageValidated = await workerMessageSchema.parseAsync(JSON.parse(message));

            const requestUrl = messageValidated.url;
            const sortedRules = config.config.server.rules.sort((a, b) => b.path.length - a.path.length);

            const rule = sortedRules.find((e) => {
                const regEx = new RegExp(`^${e.path}(.*)?$`);
                return regEx.test(requestUrl);
            });

            if(!rule) {
                const reply: WorkerMessageReplyType = {
                    errorCode: '404',
                    error: `Rule Not Found`
                }
                if (process.send) return process.send(JSON.stringify(reply));
            }
            const upstreamID = rule?.upstreams[currentUpstreamIndex];
            currentUpstreamIndex = (currentUpstreamIndex + 1) % (rule?.upstreams.length ?? 0);
            const upstream = config.config.server.upstreams.find(e => e.id === upstreamID);

            console.log(upstream);

            if(!upstream) {
                const reply: WorkerMessageReplyType = {
                    errorCode: '500',
                    error: `Upstream Not Found`
                }
                if (process.send) return process.send(JSON.stringify(reply));
            }

            const url = upstream?.url ?? '';
            const [host, port] = url.split(':');

            const request = http.request({ host: host, port: port, path: requestUrl, method: messageValidated.requestType, headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(JSON.stringify(messageValidated.body)),
                }  }, (proxyRes) => {
                let body = "";

                proxyRes.on("data", (chunk) => {
                    body += chunk;
                })
                proxyRes.on("end", () => {
                    const reply: WorkerMessageReplyType = {
                        data: body
                    }
                    if (process.send) return process.send(JSON.stringify(reply));
                })
            })
            if (messageValidated.body) {
                request.write(JSON.stringify(messageValidated.body));
            }
            request.end();
        });

        process.on('SIGTERM', () => {
            console.log(`Worker ${process.pid} shutting down.`);
            process.exit(0);
        });
    }
}

// Helper function to get the worker with the least load
function getLeastLoadedWorker(workerLoad: Map<number, number>) {
    let leastLoadedWorker: Worker | undefined;
    let minLoad = Infinity;

    for (const [workerId, load] of workerLoad.entries()) {
        if (load < minLoad) {
            minLoad = load;
            leastLoadedWorker = WORKER_POOL.find(worker => worker.id === workerId);
        }
    }

    return leastLoadedWorker;
}