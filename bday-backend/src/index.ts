import { DurableObject } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class TapriRadioRoom extends DurableObject<Env> {
	// hardcoded start state
	currentTrackId: string = '1';
	trackStartedAt: number = Date.now();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// immediately loads persistent state
		this.ctx.blockConcurrencyWhile(async () => {
			const savedTrack = await this.ctx.storage.get<string> ('currentTrackId');
			const savedTime = await this.ctx.storage.get<number> ('trackStartedAt');

			if (savedTrack) {
				this.currentTrackId = savedTrack;
			} else {
				await this.ctx.storage.put('currentTrackId', this.currentTrackId);
			}

			if (savedTime) {
				this.trackStartedAt = savedTime;
			} else {
				await this.ctx.storage.put('trackStartedAt', this.trackStartedAt);
			}
		});
	}

	async fetch(request: Request): Promise<Response> {
		// websocket request check
		const upgradeHeader = request.headers.get("Upgrade");

		if (!upgradeHeader || upgradeHeader != "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}

		// validate origin header
		const origin = request.headers.get("Origin");
		if (origin && !origin.includes("localhost") && !origin.includes("127.0.0.1") && !origin.endsWith(".vercel.app")) { 
			return new Response("Forbidden Origin", { status: 403 });
		}

		// websocket pair (for both the client and server)
		const webSocketPair = new WebSocketPair();

		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);

		// initial sync state to client
		server.send(JSON.stringify({
			type: "init",
			trackId: this.currentTrackId,
			trackStartedAt: this.trackStartedAt,
			connections: this.ctx.getWebSockets().length
		}));

		// broadcast to all clients for a new join
		this.broadcast({ type: "presence", connections: this.ctx.getWebSockets().length }, server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
		
	}

	// triggered whenever a client sends a message
	webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		try {
			
			const data = JSON.parse(message as string);

			if (data.type === "cursor") {
				// validates types before blindly broadcasting
				if (typeof data.id !== 'string' || typeof data.x !== 'number' || typeof data.y !== 'number') return;

				// strict length limit to prevent huge payload injection
				if (data.id.length > 20) return;

				// broadcast client mouse position to everyone and strip out malicious hidden fields
				this.broadcast({
					type: "cursor",
					id: data.id,
					x: data.x,
					y: data.y
				}, ws);
			}

			else if (data.type === "track_ended") {
				// validate types
				if (typeof data.finishedTrackId !== 'string') return;
				/* 
				* preventing multiple clients from skipping tracks simultaneously
				* by making sure the server is still on the track that just ended
				*/
				if (this.currentTrackId === data.finishedTrackId) {
					// malicious spng skipping prevention
					const timeElapsedMs = Date.now() - this.trackStartedAt;
					if (timeElapsedMs < 30000) {
						return; // ignore the skip request
					}

					const totalTracks = data.totalTracks || 4;
					
					let nextId = parseInt(this.currentTrackId);
					if (totalTracks > 1) {
						// a random track plays that isn't the one that just played (shuffle)
						while (nextId.toString() === this.currentTrackId) {
							nextId = Math.floor(Math.random() * totalTracks) + 1;
						}
					} else {
						nextId = 1;
					}

					this.currentTrackId = nextId.toString();
					this.trackStartedAt = Date.now();

					// saves to persistent disk to survive reboots and hibernations
					this.ctx.storage.put('currentTrackId', this.currentTrackId);
					this.ctx.storage.put('trackStartedAt', this.trackStartedAt);


					// broadcasting an "init" message to all listeners to ensure syncrhonisation
					this.broadcast({
						type: "init",
						trackId: this.currentTrackId,
						trackStartedAt: this.trackStartedAt,
						connections: this.ctx.getWebSockets().length
					});
				}
			}
		} catch (e) {
			// ignoring invalid JSON
		}
	}

	// triggered when client disconnects
	webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		// update someone leaving as an event, and clean up their cursor
		this.broadcast({
			type: "presence",
			connections: this.ctx.getWebSockets().length
		});
	}

	// sends a message to all connected websockets
	broadcast(message: unknown, excludeWs?: WebSocket) {
		const str = JSON.stringify(message);

		for (const ws of this.ctx.getWebSockets()) {
			if (ws !== excludeWs) {
				ws.send(str);
			}

		}

	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// global room for MVP
		const id = env.TAPRI_RADIO.idFromName("global-room");
		const stub = env.TAPRI_RADIO.get(id);

		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
